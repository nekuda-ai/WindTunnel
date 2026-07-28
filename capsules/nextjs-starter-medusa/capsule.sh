#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

MEDUSA_BACKEND_REPOSITORY=$(capsule_config_get '.supportingSources[] | select(.role == "evaluator-private-backend") | .repository')
MEDUSA_BACKEND_REVISION=$(capsule_config_get '.supportingSources[] | select(.role == "evaluator-private-backend") | .revision')
MEDUSA_BACKEND_DIR="$CAPSULE_PRIVATE_DIR/backend"
MEDUSA_RESET_DUMP="$CAPSULE_PRIVATE_DIR/reset/medusa.sql"
MEDUSA_PUBLISHABLE_KEY_FILE="$CAPSULE_PRIVATE_DIR/fixture/publishable-key"
MEDUSA_PACKAGE_CACHE=$(capsule_package_cache_path "$(capsule_image node)")
export MEDUSA_PACKAGE_CACHE

CAPSULE_HEALTH_TIMEOUT_SECONDS=180
CAPSULE_BASELINE_EXCLUDES=(.env.local)
CAPSULE_FIXTURE_HASHES_JSON=$(capsule_hash_file_map \
  storefront-environment "$ROOT/fixtures/nextjs-starter-medusa/storefront.env.template" \
  backend-environment "$ROOT/fixtures/nextjs-starter-medusa/backend.env.template" \
  deterministic-publishable-key "$ROOT/fixtures/nextjs-starter-medusa/deterministic-publishable-key.sql")
CAPSULE_BOOTSTRAP_HASHES_JSON=$(capsule_hash_file_map \
  container-host-patch "$ROOT/fixtures/nextjs-starter-medusa/container-host.patch")
capsule_install_compose_common_hooks

clone_private_backend() {
  [ ! -e "$MEDUSA_BACKEND_DIR" ] || {
    echo "private backend already exists: $MEDUSA_BACKEND_DIR" >&2
    return 1
  }

  local cache=${CAPSULE_SOURCE_CACHE_ROOT:-}/medusa-starter-default
  if [ -n "${CAPSULE_SOURCE_CACHE_ROOT:-}" ] && [ -d "$cache/.git" ] &&
    [ "$(git -C "$cache" rev-parse HEAD 2>/dev/null)" = "$MEDUSA_BACKEND_REVISION" ]; then
    git clone --quiet --no-hardlinks "$cache" "$MEDUSA_BACKEND_DIR"
    git -C "$MEDUSA_BACKEND_DIR" remote set-url origin "$MEDUSA_BACKEND_REPOSITORY"
  else
    git init --quiet "$MEDUSA_BACKEND_DIR"
    git -C "$MEDUSA_BACKEND_DIR" remote add origin "$MEDUSA_BACKEND_REPOSITORY"
    git -C "$MEDUSA_BACKEND_DIR" fetch --quiet --depth 1 origin "$MEDUSA_BACKEND_REVISION"
    git -C "$MEDUSA_BACKEND_DIR" checkout --quiet --detach FETCH_HEAD
  fi

  [ "$(git -C "$MEDUSA_BACKEND_DIR" rev-parse HEAD)" = "$MEDUSA_BACKEND_REVISION" ] || {
    echo "private backend checkout does not match pinned revision" >&2
    return 1
  }
}

render_storefront_environment() {
  local key=$1 temporary="$CAPSULE_WORKSPACE/.env.local.tmp"
  sed -e "s|{{BASE_URL}}|$CAPSULE_BASE_URL|g" \
    -e "s|{{PUBLISHABLE_KEY}}|$key|g" \
    "$ROOT/fixtures/nextjs-starter-medusa/storefront.env.template" > "$temporary"
  mv -f "$temporary" "$CAPSULE_WORKSPACE/.env.local"
}

render_backend_environment() {
  sed "s|{{BASE_URL}}|$CAPSULE_BASE_URL|g" \
    "$ROOT/fixtures/nextjs-starter-medusa/backend.env.template" > "$MEDUSA_BACKEND_DIR/.env"
  chmod 0600 "$MEDUSA_BACKEND_DIR/.env"
}

medusa_node_run() {
  local image
  image=$(capsule_image node)
  mkdir -p "$MEDUSA_PACKAGE_CACHE/corepack" "$MEDUSA_PACKAGE_CACHE/npm" \
    "$MEDUSA_PACKAGE_CACHE/yarn"
  docker run --rm \
    --label "$CAPSULE_SITE_LABEL" --label "$CAPSULE_RUN_LABEL" --label "$CAPSULE_MANIFEST_LABEL" \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp/home --env COREPACK_HOME=/cache/corepack --env npm_config_cache=/cache/npm \
    --env YARN_ENABLE_GLOBAL_CACHE=true --env YARN_GLOBAL_FOLDER=/cache/yarn \
    --volume "$MEDUSA_BACKEND_DIR:/backend:z" \
    --volume "$MEDUSA_PACKAGE_CACHE:/cache:z" \
    --workdir /backend "$image" "$@"
}

wait_for_database() {
  # On a fresh volume the postgres image first runs a temporary init server
  # (socket only, listen_addresses='') to create POSTGRES_DB, then restarts as
  # the real server. A socket pg_isready answers OK during that temp phase, so a
  # caller could connect mid-restart and hit "the database system is starting
  # up". Gate on the real server: pg_isready over TCP (which only the real server
  # opens) plus a trivial trusted-socket query that succeeds only once it is up.
  local deadline=$((SECONDS + 90))
  until capsule_compose exec -T db pg_isready -h 127.0.0.1 -U medusa -d medusa >/dev/null 2>&1 &&
    capsule_compose exec -T db psql -U medusa -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "Medusa database did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

wait_for_backend() {
  local deadline=$((SECONDS + 120))
  until capsule_compose exec -T backend node -e \
    'fetch("http://127.0.0.1:9000/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))' \
    >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "Medusa backend did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

# This storefront answers the first request to any country-code path with a 307
# that sets the _medusa_cache_id region cookie (see src/middleware.ts), so a
# plain cookieless curl never receives a rendered page. Override the default
# compose health probe to follow the redirect with a cookie jar and allow for
# dev-mode on-demand route compilation. This is a liveness gate on the
# server-rendered store shell ("All products"); product truth is asserted by the
# browser acceptance actor (product detail page) and the catalog observation probe.
capsule_compose_status() {
  local service container check path contains body jar
  while IFS= read -r service; do
    container=$(capsule_compose ps -q "$service" 2>/dev/null) || return 1
    [ -n "$container" ] &&
      [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" = true ] || return 1
  done < <(jq -r '.runtime.requiredServices //
    [(.runtime.applicationService // "app")] | .[]' "$CAPSULE_CONFIG_PATH")
  jar=$(mktemp)
  while IFS= read -r check; do
    path=$(jq -r .path <<<"$check")
    contains=$(jq -r '.contains // ""' <<<"$check")
    body=$(curl -fsSL --max-time 45 -c "$jar" -b "$jar" "$CAPSULE_BASE_URL$path" 2>/dev/null) || {
      rm -f "$jar"
      return 1
    }
    [ -z "$contains" ] || [[ "$body" == *"$contains"* ]] || { rm -f "$jar"; return 1; }
  done < <(jq -c '.runtime.healthChecks[]' "$CAPSULE_CONFIG_PATH")
  rm -f "$jar"
}

# Warm the storefront and pre-compile the acceptance routes before the health
# probe and browser verification so dev-mode on-demand compilation does not race
# them. Uses the same cookie-jar/redirect handling as the health probe.
wait_for_storefront() {
  local deadline=$((SECONDS + 180)) path jar body
  jar=$(mktemp)
  until body=$(curl -fsSL --max-time 45 -c "$jar" -b "$jar" "$CAPSULE_BASE_URL/gb/store" 2>/dev/null) &&
    [ "${body#*"All products"}" != "$body" ]; do
    [ "$SECONDS" -lt "$deadline" ] || {
      rm -f "$jar"
      echo "Medusa storefront did not render the store shell" >&2
      return 1
    }
    sleep 3
  done
  for path in /gb/products/t-shirt /gb/cart; do
    curl -fsSL --max-time 45 -c "$jar" -b "$jar" "$CAPSULE_BASE_URL$path" >/dev/null 2>&1 || true
  done
  rm -f "$jar"
}

read_publishable_key() {
  capsule_compose exec -T db psql -U medusa -d medusa -At -v ON_ERROR_STOP=1 \
    -c "SELECT token FROM api_key WHERE type = 'publishable' AND deleted_at IS NULL ORDER BY created_at LIMIT 1" \
    | tr -d '\r'
}

capsule_prepare() {
  local image publishable_key warm=false
  image=$(capsule_image node)
  capsule_clone_source
  capsule_vendor_sdk
  clone_private_backend
  mkdir -p "$MEDUSA_PACKAGE_CACHE/corepack" "$MEDUSA_PACKAGE_CACHE/npm" \
    "$MEDUSA_PACKAGE_CACHE/yarn" "$CAPSULE_PRIVATE_DIR/fixture" "$CAPSULE_PRIVATE_DIR/reset"

  git -C "$CAPSULE_WORKSPACE" apply --check "$ROOT/fixtures/nextjs-starter-medusa/container-host.patch"
  git -C "$CAPSULE_WORKSPACE" apply "$ROOT/fixtures/nextjs-starter-medusa/container-host.patch"
  render_backend_environment
  render_storefront_environment pk_evaluator_prepare_placeholder
  capsule_write_runbook
  cat >> "$CAPSULE_AUTHOR_DIR/RUNBOOK.md" <<'EOF'

Fixture flows: browse `/gb/store`, open `/gb/products/t-shirt`, add a variant, and inspect `/gb/cart`. Reset restores the evaluator-owned PostgreSQL dump; each verification must use a fresh browser context so stale cart cookies cannot cross runs.
EOF
  capsule_render_compose_overlay
  capsule_compose config --quiet

  # Warm path only when every baked artifact restores from the prepare cache:
  # backend deps + build, app deps, and the post-seed dump (with the deterministic
  # publishable key). A partial hit mixes artifact generations, so wipe the
  # restored pieces and fall back to the full cold sequence.
  if capsule_prepare_cache_restore_bundle seeded \
    backend-node_modules "$MEDUSA_BACKEND_DIR/node_modules" \
    backend-build "$MEDUSA_BACKEND_DIR/.medusa" \
    app-node_modules "$CAPSULE_WORKSPACE/node_modules" \
    seeded-db.sql "$CAPSULE_PRIVATE_DIR/fixture/seeded-db.sql"; then
    warm=true
  else
    rm -rf "$MEDUSA_BACKEND_DIR/node_modules" "$MEDUSA_BACKEND_DIR/.medusa" \
      "$CAPSULE_WORKSPACE/node_modules" "$CAPSULE_PRIVATE_DIR/fixture/seeded-db.sql"
  fi

  if [ "$warm" = true ]; then
    # Restore the seeded schema+data (dump is --clean --if-exists) into the fresh
    # per-run database volume; skips install, migrate, seed and both builds.
    capsule_compose up -d db
    wait_for_database
    capsule_compose exec -T db psql -U medusa -d medusa -v ON_ERROR_STOP=1 \
      < "$CAPSULE_PRIVATE_DIR/fixture/seeded-db.sql"
  else
    medusa_node_run corepack yarn install --immutable
    capsule_node_run "$image" . corepack yarn install --immutable
    capsule_compose up -d db
    wait_for_database
    capsule_compose run --rm --no-deps backend corepack yarn medusa db:migrate
    capsule_compose run --rm --no-deps backend corepack yarn seed
    capsule_compose exec -T db psql -U medusa -d medusa \
      < "$ROOT/fixtures/nextjs-starter-medusa/deterministic-publishable-key.sql"
  fi

  publishable_key=$(read_publishable_key)
  [[ "$publishable_key" == pk_* ]] || {
    echo "Medusa seed did not create a publishable API key" >&2
    return 1
  }
  printf '%s\n' "$publishable_key" > "$MEDUSA_PUBLISHABLE_KEY_FILE"
  chmod 0400 "$MEDUSA_PUBLISHABLE_KEY_FILE"
  render_storefront_environment "$publishable_key"
  # The compose overlay inlines .env.local into the app service environment at
  # render time (capsule_render_compose_overlay runs `compose config`, which
  # resolves env_file into environment). The first render (capsule_prepare, above)
  # ran with the placeholder key because the real publishable key is only known
  # after the seed (cold) or the dump restore (warm). Re-render now so the app
  # build and runtime use the real key.
  capsule_render_compose_overlay

  [ "$warm" = true ] && return 0

  capsule_compose run --rm --no-deps backend corepack yarn build
  capsule_compose up -d backend
  wait_for_backend
  capsule_compose run --rm --no-deps app corepack yarn build

  # Bake artifacts only after the full cold prepare — including the app build
  # compile gate — succeeds, so a failed build never plants a warm-path cache
  # that would skip it. The pg_dump captures the seeded, deterministic-key state;
  # the app build writes no database rows, so the dump is unaffected by ordering.
  # This staging dump + store is cache-only: guarded so proof-mode (cache off)
  # stays byte-identical to pre-cache behavior and writes no extra fixture.
  if capsule_prepare_cache_enabled; then
    capsule_compose exec -T db pg_dump -U medusa -d medusa --clean --if-exists \
      --no-owner --no-privileges > "$CAPSULE_PRIVATE_DIR/fixture/seeded-db.sql"
    capsule_prepare_cache_store_bundle seeded \
      backend-node_modules "$MEDUSA_BACKEND_DIR/node_modules" \
      backend-build "$MEDUSA_BACKEND_DIR/.medusa" \
      app-node_modules "$CAPSULE_WORKSPACE/node_modules" \
      seeded-db.sql "$CAPSULE_PRIVATE_DIR/fixture/seeded-db.sql"
  fi
}

capsule_capture_reset_state() {
  capsule_compose exec -T db pg_dump -U medusa -d medusa --clean --if-exists \
    --no-owner --no-privileges > "$MEDUSA_RESET_DUMP"
  chmod 0400 "$MEDUSA_RESET_DUMP"
  capsule_compose stop app backend db >/dev/null
}

capsule_up() {
  capsule_compose up -d --force-recreate db
  wait_for_database
  capsule_compose up -d --force-recreate backend app
  wait_for_backend
  wait_for_storefront
}

capsule_restore_reset_state() {
  [ -s "$MEDUSA_RESET_DUMP" ] || {
    echo "Medusa reset dump is missing" >&2
    return 1
  }
  capsule_compose stop app backend >/dev/null 2>&1 || true
  capsule_compose up -d db
  wait_for_database
  capsule_compose exec -T db psql -U medusa -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'medusa' AND pid <> pg_backend_pid()" >/dev/null
  capsule_compose exec -T db dropdb -U medusa --if-exists medusa
  capsule_compose exec -T db createdb -U medusa -T template0 medusa
  capsule_compose exec -T db psql -U medusa -d medusa -v ON_ERROR_STOP=1 < "$MEDUSA_RESET_DUMP"
  capsule_compose up -d --force-recreate backend app
  wait_for_backend
  wait_for_storefront
}

capsule_reset() {
  capsule_restore_reset_state
}
