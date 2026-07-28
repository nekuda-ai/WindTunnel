#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

IDURAR_RESET_DUMP="$CAPSULE_PRIVATE_DIR/reset/idurar.archive"
IDURAR_API_TOKEN_FILE="$CAPSULE_PRIVATE_DIR/evaluator/api-token"
CAPSULE_HEALTH_TIMEOUT_SECONDS=150
CAPSULE_BASELINE_EXCLUDES=(backend/node_modules frontend/node_modules frontend/dist backend/.env)
CAPSULE_FIXTURE_HASHES_JSON=$(capsule_hash_file_map \
  environment "$ROOT/fixtures/idurar-erp-crm/backend.env.template" \
  gateway "$ROOT/fixtures/idurar-erp-crm/gateway.mjs" \
  crm-seed "$ROOT/fixtures/idurar-erp-crm/seed.mjs")
CAPSULE_BOOTSTRAP_HASHES_JSON=$(capsule_hash_file_map \
  compatibility "$ROOT/fixtures/idurar-erp-crm/compatibility.patch")
capsule_install_compose_common_hooks

wait_for_database() {
  local deadline=$((SECONDS + 90))
  until capsule_compose exec -T db mongo --quiet --eval "quit(db.adminCommand('ping').ok ? 0 : 2)" \
    >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "IDURAR MongoDB did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

wait_for_backend() {
  local deadline=$((SECONDS + 90))
  until capsule_compose exec -T backend node -e \
    'fetch("http://127.0.0.1:8888/api/login", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"nobody@example.test",password:"invalid"})}).then(r=>{if(r.status < 400 || r.status >= 500)process.exit(2)}).catch(()=>process.exit(1))' \
    >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "IDURAR backend did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

capsule_prepare() {
  local image token_json deps_warm=false db_warm=false
  image=$(capsule_image node)
  capsule_clone_source
  capsule_vendor_sdk
  mkdir -p "$CAPSULE_PRIVATE_DIR/cache" "$CAPSULE_PRIVATE_DIR/evaluator" "$CAPSULE_PRIVATE_DIR/reset"

  git -C "$CAPSULE_WORKSPACE" apply --check "$ROOT/fixtures/idurar-erp-crm/compatibility.patch"
  git -C "$CAPSULE_WORKSPACE" apply "$ROOT/fixtures/idurar-erp-crm/compatibility.patch"
  cp "$ROOT/fixtures/idurar-erp-crm/backend.env.template" "$CAPSULE_WORKSPACE/backend/.env"
  cp "$ROOT/fixtures/idurar-erp-crm/gateway.mjs" "$CAPSULE_PRIVATE_DIR/evaluator/gateway.mjs"
  cp "$ROOT/fixtures/idurar-erp-crm/seed.mjs" "$CAPSULE_PRIVATE_DIR/evaluator/seed.mjs"
  chmod 0500 "$CAPSULE_PRIVATE_DIR/evaluator/"*.mjs

  capsule_write_runbook
  capsule_render_compose_overlay
  capsule_compose config --quiet

  # Dependency warm path: both node_modules trees restore together as one atomic
  # bundle or we reinstall from scratch (a partial hit would cross lockfile
  # generations). frontend/dist is a cold-only compile gate (the frontend runs
  # `npm run dev`, dist is never served) so it is deliberately not cached.
  if capsule_prepare_cache_restore_bundle deps \
    backend-node_modules "$CAPSULE_WORKSPACE/backend/node_modules" \
    frontend-node_modules "$CAPSULE_WORKSPACE/frontend/node_modules"; then
    deps_warm=true
  else
    rm -rf "$CAPSULE_WORKSPACE/backend/node_modules" "$CAPSULE_WORKSPACE/frontend/node_modules"
  fi
  if [ "$deps_warm" != true ]; then
    capsule_node_run "$image" backend npm ci
    capsule_node_run "$image" frontend npm ci
    capsule_node_run "$image" frontend env \
      VITE_DEV_REMOTE=remote VITE_BACKEND_SERVER="$CAPSULE_BASE_URL/" npm run build
    capsule_prepare_cache_store_bundle deps \
      backend-node_modules "$CAPSULE_WORKSPACE/backend/node_modules" \
      frontend-node_modules "$CAPSULE_WORKSPACE/frontend/node_modules"
  fi

  # Seeded-database warm path: the post-seed mongo archive and the extracted API
  # token restore together as one atomic bundle or we rebuild the seed from
  # scratch (a partial hit would cross an archive and a token from different
  # generations).
  if capsule_prepare_cache_restore_bundle seed-db \
    seeded-mongo.archive "$CAPSULE_PRIVATE_DIR/reset/seed.archive" \
    api-token "$IDURAR_API_TOKEN_FILE"; then
    db_warm=true
  else
    rm -rf "$CAPSULE_PRIVATE_DIR/reset/seed.archive" "$IDURAR_API_TOKEN_FILE"
  fi

  capsule_compose up -d db
  wait_for_database
  if [ "$db_warm" = true ]; then
    capsule_compose exec -T db mongorestore --quiet --drop --archive < "$CAPSULE_PRIVATE_DIR/reset/seed.archive"
    chmod 0400 "$IDURAR_API_TOKEN_FILE"
  else
    capsule_compose run --rm --no-deps backend npm run setup
    capsule_compose up -d backend
    wait_for_backend
    token_json=$(capsule_compose run --rm --no-deps gateway node /evaluator/seed.mjs http://backend:8888)
    jq -er '.token | select(type == "string" and length > 20)' <<<"$token_json" > "$IDURAR_API_TOKEN_FILE"
    chmod 0400 "$IDURAR_API_TOKEN_FILE"
    # Cache-only staging: the seeded mongo archive that feeds the warm bundle is
    # dumped and stored only when the prepare cache is enabled, so proof-mode
    # (cache off) stays byte-identical to pre-cache behavior and seals no extra
    # reset artifact under reset/.
    if capsule_prepare_cache_enabled; then
      capsule_compose exec -T db mongodump --quiet --db idurar --archive > "$CAPSULE_PRIVATE_DIR/reset/seed.archive"
      capsule_prepare_cache_store_bundle seed-db \
        seeded-mongo.archive "$CAPSULE_PRIVATE_DIR/reset/seed.archive" \
        api-token "$IDURAR_API_TOKEN_FILE"
    fi
  fi
}

capsule_capture_reset_state() {
  capsule_compose exec -T db mongodump --quiet --db idurar --archive > "$IDURAR_RESET_DUMP"
  [ -s "$IDURAR_RESET_DUMP" ] || {
    echo "IDURAR reset dump is empty" >&2
    return 1
  }
  chmod 0400 "$IDURAR_RESET_DUMP"
  capsule_compose stop gateway frontend backend db >/dev/null
}

capsule_up() {
  capsule_compose up -d --force-recreate db
  wait_for_database
  capsule_compose up -d --force-recreate backend frontend gateway
}

capsule_restore_reset_state() {
  [ -s "$IDURAR_RESET_DUMP" ] || {
    echo "IDURAR reset dump is missing" >&2
    return 1
  }
  capsule_compose_down
  capsule_compose up -d db
  wait_for_database
  capsule_compose exec -T db mongorestore --quiet --drop --archive < "$IDURAR_RESET_DUMP"
  capsule_compose up -d --force-recreate backend frontend gateway
}

capsule_reset() {
  capsule_restore_reset_state
}
