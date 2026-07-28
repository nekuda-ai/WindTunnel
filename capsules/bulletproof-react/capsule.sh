#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

CAPSULE_HEALTH_TIMEOUT_SECONDS=60
CAPSULE_BASELINE_EXCLUDES=(apps/react-vite/node_modules apps/react-vite/dist)
CAPSULE_FIXTURE_HASHES_JSON=$(capsule_hash_file_map environment "$ROOT/fixtures/bulletproof-react/env.template")
CAPSULE_BOOTSTRAP_HASHES_JSON='{}'
capsule_install_single_app_compose_hooks

capsule_prepare() {
  local image
  image=$(capsule_image node)
  capsule_clone_source
  capsule_vendor_sdk
  sed "s|{{BASE_URL}}|$CAPSULE_BASE_URL|g" \
    "$ROOT/fixtures/bulletproof-react/env.template" > "$CAPSULE_WORKSPACE/apps/react-vite/.env"
  capsule_write_runbook
  capsule_render_single_app_compose
  capsule_compose config --quiet
  if ! capsule_prepare_cache_restore react-vite-node_modules "$CAPSULE_WORKSPACE/apps/react-vite/node_modules"; then
    capsule_node_run "$image" apps/react-vite corepack yarn@1.22.22 install --frozen-lockfile
    capsule_node_run "$image" apps/react-vite npm run build
    capsule_prepare_cache_store react-vite-node_modules "$CAPSULE_WORKSPACE/apps/react-vite/node_modules"
  fi
}
