#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

CAPSULE_HEALTH_TIMEOUT_SECONDS=90
CAPSULE_BASELINE_EXCLUDES=(local.db)
CAPSULE_FIXTURE_HASHES_JSON=$(capsule_hash_file_map \
  database "$ROOT/fixtures/directory-9d8/init-db.mjs" \
  inspector "$ROOT/fixtures/directory-9d8/inspect-db.mjs" \
  mutation "$ROOT/fixtures/directory-9d8/mutate-db.mjs")
CAPSULE_BOOTSTRAP_HASHES_JSON=$(capsule_hash_file_map \
  newsletter-fixture "$CAPSULE_DIR/patches/fixture-newsletter.patch")
capsule_install_single_app_compose_hooks

directory_node_run() {
  local image cache_root
  image=$(capsule_image node)
  cache_root=$(capsule_package_cache_path "$image") || return
  mkdir -p "$cache_root/corepack" "$cache_root/npm" "$cache_root/pnpm" \
    "$CAPSULE_PRIVATE_DIR/application-state" "$CAPSULE_PRIVATE_DIR/evaluator"
  docker run --rm \
    --label "$CAPSULE_SITE_LABEL" --label "$CAPSULE_RUN_LABEL" --label "$CAPSULE_MANIFEST_LABEL" \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp/home --env COREPACK_HOME=/cache/corepack --env npm_config_cache=/cache/npm \
    --volume "$CAPSULE_WORKSPACE:/workspace:z" \
    --volume "$cache_root:/cache:z" \
    --volume "$CAPSULE_PRIVATE_DIR/application-state:/state:z" \
    --volume "$CAPSULE_PRIVATE_DIR/evaluator:/evaluator:ro,z" \
    --workdir /workspace "$image" "$@"
}

capsule_prepare() {
  capsule_clone_source
  # WINDTUNNEL: newsletter fixture — /api/subscribe succeeds locally (no real
  # Loops backend in evaluation), with email validation. Applies to ALL arms.
  git -C "$CAPSULE_WORKSPACE" apply --check "$CAPSULE_DIR/patches/fixture-newsletter.patch"
  git -C "$CAPSULE_WORKSPACE" apply "$CAPSULE_DIR/patches/fixture-newsletter.patch"
  capsule_vendor_sdk
  mkdir -p "$CAPSULE_PRIVATE_DIR/application-state" "$CAPSULE_PRIVATE_DIR/evaluator"
  cp "$ROOT/fixtures/directory-9d8/init-db.mjs" "$CAPSULE_PRIVATE_DIR/evaluator/init-db.mjs"
  cp "$ROOT/fixtures/directory-9d8/inspect-db.mjs" "$CAPSULE_PRIVATE_DIR/evaluator/inspect-db.mjs"
  cp "$ROOT/fixtures/directory-9d8/mutate-db.mjs" "$CAPSULE_PRIVATE_DIR/evaluator/mutate-db.mjs"
  chmod 0500 "$CAPSULE_PRIVATE_DIR/evaluator/"*.mjs
  capsule_write_runbook
  capsule_render_single_app_compose
  capsule_compose config --quiet
  if ! capsule_prepare_cache_restore workspace-node_modules "$CAPSULE_WORKSPACE/node_modules"; then
    directory_node_run corepack pnpm@9.15.9 install --frozen-lockfile --store-dir /cache/pnpm
    directory_node_run node /evaluator/init-db.mjs /state/local.db
    directory_node_run env \
      TURSO_DATABASE_URL=file:/state/local.db TURSO_AUTH_TOKEN=local-evaluator-token \
      ADMIN_PASSWORD=local-evaluator-password JWT_SECRET=local-evaluator-jwt-secret \
      ANTHROPIC_API_KEY=local-not-used EXASEARCH_API_KEY=local-not-used LOOPS_API_KEY=local-not-used \
      NEXT_PUBLIC_SITE_URL="$CAPSULE_BASE_URL" corepack pnpm@9.15.9 run build
    capsule_prepare_cache_store workspace-node_modules "$CAPSULE_WORKSPACE/node_modules"
  else
    directory_node_run node /evaluator/init-db.mjs /state/local.db
  fi
}

capsule_capture_reset_state() {
  capsule_snapshot_directory directory-db "$CAPSULE_PRIVATE_DIR/application-state"
}

capsule_restore_reset_state() {
  capsule_compose_down
  capsule_restore_directory_snapshot directory-db "$CAPSULE_PRIVATE_DIR/application-state"
  capsule_up
}

capsule_reset() {
  capsule_restore_reset_state
}
