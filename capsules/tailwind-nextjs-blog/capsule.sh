#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

CAPSULE_HEALTH_TIMEOUT_SECONDS=90
CAPSULE_BOOTSTRAP_HASHES_JSON='{}'
CAPSULE_FIXTURE_HASHES_JSON='{}'
capsule_install_single_app_compose_hooks

capsule_prepare() {
  local image
  image=$(capsule_image node)
  capsule_clone_source
  capsule_vendor_sdk
  capsule_write_runbook
  capsule_render_single_app_compose
  capsule_compose config --quiet
  if ! capsule_prepare_cache_restore workspace-node_modules "$CAPSULE_WORKSPACE/node_modules"; then
    capsule_node_run "$image" . node .yarn/releases/yarn-3.6.1.cjs install --immutable
    capsule_node_run "$image" . node .yarn/releases/yarn-3.6.1.cjs build
    capsule_prepare_cache_store workspace-node_modules "$CAPSULE_WORKSPACE/node_modules"
  fi
}
