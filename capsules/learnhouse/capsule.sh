#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

CAPSULE_HEALTH_TIMEOUT_SECONDS=360
CAPSULE_FIXTURE_HASHES_JSON=$(capsule_hash_file_map \
  seed "$ROOT/fixtures/learnhouse/seed.mjs" \
  runtimePatch "$ROOT/fixtures/learnhouse/Dockerfile.runtime.patch" \
  nginxPatch "$ROOT/fixtures/learnhouse/nginx.runtime.patch" \
  actor "$CAPSULE_DIR/actors/admin.js")
CAPSULE_BOOTSTRAP_HASHES_JSON='{}'
capsule_install_compose_common_hooks

app_image() {
  printf '%s-app:latest\n' "$CAPSULE_COMPOSE_PROJECT"
}

write_pinned_dockerfile() {
  local bun node node_runtime python
  bun=$(capsule_image bun)
  node=$(capsule_image node)
  node_runtime=$(capsule_image nodeRuntime)
  python=$(capsule_image python)
  cp "$CAPSULE_WORKSPACE/Dockerfile" "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile"
  (
    cd "$CAPSULE_PRIVATE_DIR/evaluator"
    git apply "$ROOT/fixtures/learnhouse/Dockerfile.runtime.patch"
  )
  sed \
    -e "s|^FROM oven/bun:1-alpine|FROM $bun|" \
    -e "s|^FROM node:24-alpine|FROM $node|" \
    -e "s|^FROM node:22-bookworm-slim|FROM $node_runtime|" \
    -e "s|^FROM python:3.14.3-slim-bookworm|FROM $python|" \
    "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile" > "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile.pinned"
  mv "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile.pinned" "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile"
  grep -Fq "FROM $bun AS frontend-deps" "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile"
  grep -Fq "FROM $node AS frontend-runner" "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile"
  grep -Fq "FROM $node_runtime AS node-runtime" "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile"
  grep -Fq "FROM $python AS runner" "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile"
  ! grep -Eq 'nodesource\.com|bun\.sh/install|npm install -g' "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile"
}

build_application_image() {
  local image_id
  docker build \
    --label "$CAPSULE_SITE_LABEL" \
    --label "$CAPSULE_RUN_LABEL" \
    --label "$CAPSULE_MANIFEST_LABEL" \
    --build-arg LEARNHOUSE_PUBLIC=true \
    --tag "$(app_image)" \
    --file "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile" \
    "$CAPSULE_WORKSPACE" >&2
  image_id=$(docker image inspect --format '{{.Id}}' "$(app_image)")
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
  CAPSULE_IMAGE_DIGESTS_JSON=$(jq -c --arg image "$image_id" '. + {application:$image}' \
    <<<"$CAPSULE_IMAGE_DIGESTS_JSON")
  CAPSULE_RUNTIME_REVISION=$image_id
  export CAPSULE_IMAGE_DIGESTS_JSON CAPSULE_RUNTIME_REVISION
}

wait_http_health() {
  local deadline=$((SECONDS + CAPSULE_HEALTH_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$CAPSULE_BASE_URL$CAPSULE_HEALTH_PATH" |
      jq -e '. == true' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_dependencies() {
  local deadline=$((SECONDS + 120))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if capsule_compose exec -T db pg_isready -U learnhouse -d learnhouse >/dev/null 2>&1 &&
      capsule_compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
      return 0
    fi
    sleep 1
  done
  return 1
}

normalize_content_ownership() {
  local image
  image=$(capsule_image redis)
  mkdir -p "$CAPSULE_PRIVATE_DIR/application-state/content"
  docker run --rm \
    --label "$CAPSULE_SITE_LABEL" --label "$CAPSULE_RUN_LABEL" --label "$CAPSULE_MANIFEST_LABEL" \
    --user 0 --entrypoint chown \
    --volume "$CAPSULE_PRIVATE_DIR/application-state/content:/state:z" \
    "$image" -R "$(id -u):$(id -g)" /state
}

capsule_prepare() {
  capsule_clone_source
  capsule_vendor_sdk
  # Evaluator infra fix: the nginx+socat proxy strips the port from the Host
  # header, so Next.js server-action CSRF checks reject x-forwarded-host
  # (127.0.0.1) vs the browser origin (127.0.0.1:PORT). Forward the
  # port-qualified host so server actions on the frontend work.
  git -C "$CAPSULE_WORKSPACE" apply "$ROOT/fixtures/learnhouse/nginx.runtime.patch"
  mkdir -p "$CAPSULE_PRIVATE_DIR/evaluator" "$CAPSULE_PRIVATE_DIR/application-state/content" \
    "$CAPSULE_PRIVATE_DIR/reset"
  cp "$ROOT/fixtures/learnhouse/seed.mjs" "$CAPSULE_PRIVATE_DIR/evaluator/seed.mjs"
  chmod 0500 "$CAPSULE_PRIVATE_DIR/evaluator/seed.mjs"
  write_pinned_dockerfile
  capsule_write_runbook
  LEARNHOUSE_APP_IMAGE=$(app_image)
  export LEARNHOUSE_APP_IMAGE
  capsule_render_compose_overlay
  capsule_compose config --quiet
  # build_application_image stamps a per-run manifest/run LABEL into the app
  # image, so its digest is run-specific. The prepare cache must stay
  # run-independent (spec 2.2: RUN_ID/port/manifest EXCLUDED), so snapshot the
  # pinned base-image digests and key every cache lookup/store off them; the
  # run-specific application digest is layered back for the sealed manifest.
  local pinned_image_digests="$CAPSULE_IMAGE_DIGESTS_JSON"
  build_application_image
  local built_image_digests="$CAPSULE_IMAGE_DIGESTS_JSON"

  # Warm gate: all three baked artifacts must restore together or we fall back
  # fully cold (a partial restore would mix seed/dump/content generations).
  local warm=false
  if capsule_prepare_cache_enabled; then
    CAPSULE_IMAGE_DIGESTS_JSON="$pinned_image_digests"
    if capsule_prepare_cache_restore_bundle seeded \
      learnhouse.dump "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump" \
      seed-result.json "$CAPSULE_PRIVATE_DIR/evaluator/seed-result.json" \
      content "$CAPSULE_PRIVATE_DIR/application-state/content"; then
      warm=true
    else
      rm -rf "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump" \
        "$CAPSULE_PRIVATE_DIR/evaluator/seed-result.json" \
        "$CAPSULE_PRIVATE_DIR/application-state/content"
      mkdir -p "$CAPSULE_PRIVATE_DIR/application-state/content"
    fi
    CAPSULE_IMAGE_DIGESTS_JSON="$built_image_digests"
  fi

  if [ "$warm" = true ]; then
    # Seed the persistent db-data volume from the cached dump. A freshly created
    # postgres db has no schema, so restore without --clean/--if-exists. The
    # volume survives the compose down below (no -v), so capsule_up serves the
    # restored state exactly as the cold path leaves it.
    capsule_compose up -d db redis
    wait_dependencies
    capsule_compose exec -T db pg_restore --no-owner \
      -U learnhouse -d learnhouse < "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump"
    capsule_compose down --remove-orphans --timeout 20
  else
    capsule_compose up -d
    wait_http_health
    node "$CAPSULE_PRIVATE_DIR/evaluator/seed.mjs" "$CAPSULE_BASE_URL" > "$CAPSULE_PRIVATE_DIR/evaluator/seed-result.json"
    capsule_compose stop ssr-fwd app
    capsule_compose exec -T db pg_dump -Fc -U learnhouse -d learnhouse > "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump"
    [ -s "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump" ]
    normalize_content_ownership
    capsule_compose down --remove-orphans --timeout 20
    if capsule_prepare_cache_enabled; then
      # Store under the run-independent (pinned) key so a later warm run HITs.
      CAPSULE_IMAGE_DIGESTS_JSON="$pinned_image_digests"
      capsule_prepare_cache_store_bundle seeded \
        learnhouse.dump "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump" \
        seed-result.json "$CAPSULE_PRIVATE_DIR/evaluator/seed-result.json" \
        content "$CAPSULE_PRIVATE_DIR/application-state/content"
      CAPSULE_IMAGE_DIGESTS_JSON="$built_image_digests"
    fi
  fi

  local generated_hashes
  generated_hashes=$(capsule_hash_file_map \
    runtimeDockerfile "$CAPSULE_PRIVATE_DIR/evaluator/Dockerfile" \
    databaseDump "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump" \
    seedResult "$CAPSULE_PRIVATE_DIR/evaluator/seed-result.json")
  CAPSULE_BOOTSTRAP_HASHES_JSON=$(jq -c --argjson generated "$generated_hashes" \
    '. + $generated' <<<"$CAPSULE_BOOTSTRAP_HASHES_JSON")
  export CAPSULE_BOOTSTRAP_HASHES_JSON
}

capsule_capture_reset_state() {
  capsule_snapshot_directory learnhouse-content "$CAPSULE_PRIVATE_DIR/application-state/content"
}

capsule_up() {
  build_application_image
  capsule_compose up -d --force-recreate
}

capsule_restore_reset_state() {
  capsule_compose stop ssr-fwd app >/dev/null 2>&1 || true
  normalize_content_ownership
  capsule_compose_down
  capsule_restore_directory_snapshot learnhouse-content "$CAPSULE_PRIVATE_DIR/application-state/content"
  capsule_compose up -d db redis
  wait_dependencies
  capsule_compose exec -T db pg_restore --clean --if-exists --no-owner \
    -U learnhouse -d learnhouse < "$CAPSULE_PRIVATE_DIR/reset/learnhouse.dump"
  capsule_compose exec -T redis redis-cli FLUSHALL >/dev/null
  capsule_up
}

capsule_reset() {
  capsule_restore_reset_state
}
