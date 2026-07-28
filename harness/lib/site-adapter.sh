#!/usr/bin/env bash

# Shared primitives for thin, evaluator-owned site adapters. capsule.yaml is
# JSON-compatible YAML so jq can validate it without another parser.

capsule_config_load() {
  CAPSULE_CONFIG_PATH="$CAPSULE_DIR/capsule.yaml"
  [ -f "$CAPSULE_CONFIG_PATH" ] || {
    echo "missing capsule metadata: $CAPSULE_CONFIG_PATH" >&2
    return 2
  }
  jq -e --arg site "$SITE" '
    .runtime.images as $runtimeImages |
    .schemaVersion == 1 and .id == $site and
    (.source.repository | type == "string" and startswith("https://github.com/")) and
    (.source.revision | type == "string" and test("^[0-9a-f]{40}$")) and
    (.runtime.strategy | type == "string") and
    ((.runtime.packageManager? // "") | type == "string" and
      (. == "" or test("^[a-z0-9._-]+@[0-9]+(\\.[0-9]+){2}$"))) and
    (.runtime.resetStrategy | IN("stateless", "browser-context", "volume-snapshot", "database-dump")) and
    (.runtime.applicationPort | type == "number" and floor == . and . >= 1 and . <= 65535) and
    (.runtime.healthPath | type == "string" and startswith("/")) and
    (.runtime.images | type == "array" and length > 0) and
    (([.runtime.images[].name] | unique | length) == (.runtime.images | length)) and
    all(.runtime.images[];
      (.name | type == "string" and length > 0) and
      (.reference | type == "string" and test("@sha256:[0-9a-f]{64}$"))) and
    ((.runtime.application? // null) as $application |
      if $application == null then true else
        ($application | type == "object") and
        ($application.image | type == "string" and length > 0) and
        any($runtimeImages[]; .name == $application.image) and
        ($application.sourceTarget | type == "string" and startswith("/")) and
        ($application.workingDirectory | type == "string" and startswith("/")) and
        ($application.sourceTarget as $sourceTarget |
          $application.workingDirectory == $sourceTarget or
          ($application.workingDirectory | startswith($sourceTarget + "/"))) and
        ($application.command | type == "array" and length > 0 and
          all(.[]; type == "string" and length > 0)) and
        (($application.environment? // {}) | type == "object" and
          all(to_entries[];
            (.key | test("^[A-Za-z_][A-Za-z0-9_]*$")) and (.value | type == "string"))) and
        (($application.baseUrlEnvironment? // []) | type == "array" and
          length == (unique | length) and
          all(.[]; type == "string" and test("^[A-Za-z_][A-Za-z0-9_]*$"))) and
        (($application.privateMounts? // []) | type == "array" and
          ([.[].target] | unique | length) == length and
          all(.[];
            (.source | type == "string" and length > 0 and
              (startswith("/") | not) and (split("/") | index("..") == null)) and
            (.target | type == "string" and startswith("/") and
              . != $application.sourceTarget) and
            ((.readOnly? // false) | type == "boolean")))
      end) and
    ((.runtime.healthChecks? // null) as $healthChecks |
      if $healthChecks == null then true else
        ($healthChecks | type == "array" and length > 0 and all(.[];
          (.path | type == "string" and startswith("/")) and
          ((.contains? // "") | type == "string")))
      end) and
    ((.runtime.composeOverlay? // "") | type == "string" and
      (. == "" or ((startswith("/") | not) and
        (split("/") | index("..") == null) and test("\\.(yaml|yml|json)$")))) and
    ((.runtime.applicationService? // "app") as $applicationService |
      ($applicationService |
        type == "string" and test("^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")) and
      ((.runtime.requiredServices? // [$applicationService]) as $services |
        ($services | type == "array" and length > 0 and length == (unique | length)) and
        all($services[];
          type == "string" and test("^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")) and
        ($services | index($applicationService) != null))) and
    (.acceptance.publicPath | type == "string" and startswith("/")) and
    (.acceptance.liveness.file | type == "string" and length > 0 and
      (startswith("/") | not) and (split("/") | index("..") == null) and test("\\.(js|jsx|ts|tsx)$")) and
    (.acceptance.liveness.language | IN("javascript", "typescript")) and
    (.acceptance.observation.probe | type == "string" and length > 0) and
    (.actors | type == "array") and all(.actors[];
      (.id | type == "string" and test("^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")) and
      (.description | type == "string" and length > 0) and
      (.setup | type == "string" and (startswith("/") | not) and
        (split("/") | index("..") == null)) and
      (.path | type == "string" and startswith("/")) and
      (.expect | type == "string" and length > 0)) and
    (has("lifecycle") | not) and (has("commands") | not) and (has("hooks") | not)
  ' "$CAPSULE_CONFIG_PATH" >/dev/null || {
    echo "invalid capsule metadata: $CAPSULE_CONFIG_PATH" >&2
    return 2
  }

  CAPSULE_SOURCE_REPOSITORY=$(jq -r .source.repository "$CAPSULE_CONFIG_PATH")
  CAPSULE_SOURCE_REVISION=$(jq -r .source.revision "$CAPSULE_CONFIG_PATH")
  CAPSULE_RUNTIME_STRATEGY=$(jq -r .runtime.strategy "$CAPSULE_CONFIG_PATH")
  CAPSULE_RESET_STRATEGY=$(jq -r .runtime.resetStrategy "$CAPSULE_CONFIG_PATH")
  CAPSULE_APPLICATION_PORT=$(jq -r .runtime.applicationPort "$CAPSULE_CONFIG_PATH")
  CAPSULE_HEALTH_PATH=$(jq -r .runtime.healthPath "$CAPSULE_CONFIG_PATH")
  CAPSULE_PUBLIC_PATH=$(jq -r .acceptance.publicPath "$CAPSULE_CONFIG_PATH")
  CAPSULE_LIVENESS_FILE=$(jq -r .acceptance.liveness.file "$CAPSULE_CONFIG_PATH")
  CAPSULE_LIVENESS_LANGUAGE=$(jq -r '.acceptance.liveness.language // "javascript"' "$CAPSULE_CONFIG_PATH")
  CAPSULE_IMAGE_DIGESTS_JSON=$(jq -c '.runtime.images | map({key:.name,value:.reference}) | from_entries' "$CAPSULE_CONFIG_PATH")
  CAPSULE_RUNTIME_REVISION="sha256:$(jq -cS .runtime "$CAPSULE_CONFIG_PATH" | sha256sum | cut -d' ' -f1)"
  export CAPSULE_CONFIG_PATH CAPSULE_SOURCE_REPOSITORY CAPSULE_SOURCE_REVISION
  export CAPSULE_RUNTIME_STRATEGY CAPSULE_RESET_STRATEGY CAPSULE_APPLICATION_PORT CAPSULE_HEALTH_PATH
  export CAPSULE_PUBLIC_PATH CAPSULE_LIVENESS_FILE CAPSULE_LIVENESS_LANGUAGE
  export CAPSULE_IMAGE_DIGESTS_JSON CAPSULE_RUNTIME_REVISION
}

capsule_config_get() {
  jq -er "$1" "$CAPSULE_CONFIG_PATH"
}

capsule_image() {
  jq -er --arg name "$1" '.runtime.images[] | select(.name == $name) | .reference' \
    "$CAPSULE_CONFIG_PATH"
}

capsule_clone_source() {
  [ ! -e "$CAPSULE_WORKSPACE" ] || {
    echo "author workspace already exists: $CAPSULE_WORKSPACE" >&2
    return 1
  }
  mkdir -p "$(dirname "$CAPSULE_WORKSPACE")"

  local cache=${CAPSULE_SOURCE_CACHE_ROOT:-}/$SITE
  if [ -n "${CAPSULE_SOURCE_CACHE_ROOT:-}" ] && [ -d "$cache/.git" ] &&
    [ "$(git -C "$cache" rev-parse HEAD 2>/dev/null)" = "$CAPSULE_SOURCE_REVISION" ]; then
    git clone --quiet --no-hardlinks "$cache" "$CAPSULE_WORKSPACE"
    git -C "$CAPSULE_WORKSPACE" remote set-url origin "$CAPSULE_SOURCE_REPOSITORY"
  else
    git init --quiet "$CAPSULE_WORKSPACE"
    git -C "$CAPSULE_WORKSPACE" remote add origin "$CAPSULE_SOURCE_REPOSITORY"
    git -C "$CAPSULE_WORKSPACE" fetch --quiet --depth 1 origin "$CAPSULE_SOURCE_REVISION"
    git -C "$CAPSULE_WORKSPACE" checkout --quiet --detach FETCH_HEAD
  fi
  [ "$(git -C "$CAPSULE_WORKSPACE" rev-parse HEAD)" = "$CAPSULE_SOURCE_REVISION" ] || {
    echo "source checkout does not match pinned revision" >&2
    return 1
  }
}

capsule_write_runbook() {
  local runbook="$CAPSULE_AUTHOR_DIR/RUNBOOK.md" actors capsule_bin env_prefix
  actors=$(jq -r '
    if (.actors // [] | length) == 0 then "- anonymous only"
    else .actors[] | "- `\(.id)`: \(.description)"
    end
  ' "$CAPSULE_CONFIG_PATH")
  capsule_bin="$ROOT/harness/bin/capsule"
  local package_cache_root
  package_cache_root=$(capsule_package_cache_root) || return
  # Bake the roots this run was prepared under into every lifecycle command so
  # the block is copy-paste-safe from any shell. Without them a fresh shell
  # defaults CAPSULE_RUNTIME_ROOT to /tmp, targets a different (freshly cloned)
  # workspace, and — before the runtime-root-scoped Compose project name — could
  # collide with this prepared run's containers. The package-cache root is baked
  # too so any rebuild a lifecycle command triggers hits the same (disk-backed,
  # not /tmp) cache. CAPSULE_DEFINITIONS_ROOT is baked so the command reloads THIS
  # run's site adapter; a fresh shell would otherwise default it to the built-in
  # capsules/ tree and, for a custom-definitions-root prepare, fail the run's
  # config/adapter-hash integrity check. %q keeps each value shell-safe.
  env_prefix=$(printf '%s=%q %s=%q %s=%q %s=%q %s=%q %s=%q %s=%q' \
    CAPSULE_DEFINITIONS_ROOT "${CAPSULE_DEFINITIONS_ROOT:-$ROOT/capsules}" \
    CAPSULE_RUNTIME_ROOT "$CAPSULE_RUNTIME_ROOT" \
    CAPSULE_PORT_REGISTRY_ROOT "$CAPSULE_PORT_REGISTRY_ROOT" \
    CAPSULE_LOCK_ROOT "$CAPSULE_LOCK_ROOT" \
    CAPSULE_BROWSER_REGISTRY_ROOT "$CAPSULE_BROWSER_REGISTRY_ROOT" \
    CAPSULE_PACKAGE_CACHE_ROOT "$package_cache_root" \
    XDG_CACHE_HOME "$CAPSULE_CACHE_ROOT")
  {
    printf '# Capsule runbook: %s\n\n' "$SITE"
    printf 'Base URL: `%s`\n\n' "$CAPSULE_BASE_URL"
    printf 'Lifecycle (source edits remain across `up` and `reset`; the leading env binds each command to this prepared run — keep it intact):\n\n'
    printf '```sh\n'
    printf '%s %q %q up --run-id %q\n' "$env_prefix" "$capsule_bin" "$SITE" "$RUN_ID"
    printf '%s %q %q status --run-id %q\n' "$env_prefix" "$capsule_bin" "$SITE" "$RUN_ID"
    printf '%s %q %q reset --run-id %q\n' "$env_prefix" "$capsule_bin" "$SITE" "$RUN_ID"
    printf '%s %q %q down --run-id %q\n' "$env_prefix" "$capsule_bin" "$SITE" "$RUN_ID"
    printf '```\n\n'
    printf 'Available test identities:\n\n%s\n\n' "$actors"
    printf 'WebMCP SDK: `@nekuda/webmcp` v0.1.0 is vendored at `vendor/nekuda-webmcp` (unpublished — never install from a registry or look outside this workspace). Wire it as a local dependency (`file:`/`portal:`/`link:` per your package manager) or import `vendor/nekuda-webmcp/dist/index.js` via an import map.\n\n'
    printf 'Only the source workspace and this runbook are author-visible inputs. Expected tools, evaluator probes, and goldens are not provided.\n'
  } > "$runbook"
}

capsule_compose() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" "$@"
}

capsule_compose_down() {
  [ ! -f "$CAPSULE_PRIVATE_DIR/compose.yaml" ] ||
    capsule_compose down --volumes --remove-orphans --rmi local --timeout 15
}

# Resolve a checked-in service topology and inject the run envelope. Overlays
# may describe internal services, images, commands, dependencies, and mounts,
# but only the engine can publish a port or assign run identity.
capsule_render_compose_overlay() {
  local relative overlay raw compose_file temporary application_service
  local image_name image_reference variable
  relative=$(jq -er '.runtime.composeOverlay | select(type == "string" and length > 0)' "$CAPSULE_CONFIG_PATH") || {
    echo "Compose overlay rendering requires runtime.composeOverlay" >&2
    return 2
  }
  application_service=$(jq -r '.runtime.applicationService // "app"' "$CAPSULE_CONFIG_PATH")
  overlay=$(realpath -e "$CAPSULE_DIR/$relative") || {
    echo "Compose overlay does not exist: $relative" >&2
    return 2
  }
  capsule_path_is_below "$overlay" "$(realpath -e "$CAPSULE_DIR")" || {
    echo "Compose overlay must remain evaluator-owned under $CAPSULE_DIR" >&2
    return 2
  }
  [[ "$CAPSULE_PRIVATE_DIR" == /* && "$CAPSULE_WORKSPACE" == /* ]] || {
    echo "Compose overlay host paths must be absolute" >&2
    return 2
  }
  [[ "$CAPSULE_PORT" =~ ^[0-9]+$ ]] || {
    echo "Compose overlay rendering requires a numeric reserved port" >&2
    return 2
  }

  while IFS=$'\t' read -r image_name image_reference; do
    variable="CAPSULE_IMAGE_$(tr '[:lower:].-' '[:upper:]__' <<<"$image_name")"
    printf -v "$variable" '%s' "$image_reference"
    export "$variable"
  done < <(jq -r '.runtime.images[] | [.name,.reference] | @tsv' "$CAPSULE_CONFIG_PATH")
  CAPSULE_UID=$(id -u)
  CAPSULE_GID=$(id -g)
  export CAPSULE_UID CAPSULE_GID

  raw="$CAPSULE_PRIVATE_DIR/compose-overlay.resolved.json"
  compose_file="$CAPSULE_PRIVATE_DIR/compose.yaml"
  temporary="$compose_file.tmp.$$"
  mkdir -p "$CAPSULE_PRIVATE_DIR"
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" --file "$overlay" config --format json > "$raw" || return
  chmod 0600 "$raw"

  jq \
    --arg project "$CAPSULE_COMPOSE_PROJECT" \
    --arg workspace "$CAPSULE_WORKSPACE" \
    --arg applicationService "$application_service" \
    --arg site "$SITE" \
    --arg runId "$RUN_ID" \
    --arg manifestId "$CAPSULE_MANIFEST_ID" \
    --argjson hostPort "$CAPSULE_PORT" \
    --argjson applicationPort "$CAPSULE_APPLICATION_PORT" '
      {
        "webmcp-kit.capsule": $site,
        "webmcp-kit.run": $runId,
        "webmcp-kit.manifest": $manifestId
      } as $labels |
      if (.services[$applicationService] // null) == null then
        error("Compose overlay has no configured application service")
      elif ([.services[] | (.ports // [])[]] | length) != 0 then
        error("Compose overlays may not publish ports")
      elif any(.services[]; (.network_mode? // "") == "host") then
        error("Compose overlays may not use host networking")
      elif any((.volumes // {})[]; .external? == true) or
        any((.networks // {})[]; .external? == true) then
        error("Compose overlays may not use external volumes or networks")
      elif (any(.services[];
        ((.build.context? // "") == $workspace) or
        any((.volumes // [])[];
          .type == "bind" and
          (.source == $workspace or (.source | startswith($workspace + "/"))))) | not) then
        error("Compose overlay does not execute or build the author workspace")
      else
        .name = $project |
        .services |= with_entries(
          .value.labels = ((.value.labels // {}) + $labels) |
          if (.value.build? // null) == null then .
          else .value.build.labels = ((.value.build.labels // {}) + $labels) end
        ) |
        .services[$applicationService].ports = [{
          target:$applicationPort,
          published:$hostPort,
          host_ip:"127.0.0.1",
          protocol:"tcp"
        }] |
        .volumes = ((.volumes // {}) | with_entries(
          .value.labels = ((.value.labels // {}) + $labels)
        )) |
        .networks = ((if ((.networks // {}) | length) == 0
          then {default:{}} else .networks end) | with_entries(
          .value.labels = ((.value.labels // {}) + $labels)
        ))
      end
    ' "$raw" > "$temporary" || {
      rm -f "$temporary"
      return 1
    }
  chmod 0600 "$temporary"
  mv -f "$temporary" "$compose_file"
}

capsule_compose_status() {
  local service container check path contains body
  while IFS= read -r service; do
    container=$(capsule_compose ps -q "$service" 2>/dev/null) || return 1
    [ -n "$container" ] &&
      [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" = true ] || return 1
  done < <(jq -r '.runtime.requiredServices //
    [(.runtime.applicationService // "app")] | .[]' "$CAPSULE_CONFIG_PATH")

  while IFS= read -r check; do
    path=$(jq -r .path <<<"$check")
    contains=$(jq -r '.contains // ""' <<<"$check")
    body=$(curl -fsS --max-time 5 "$CAPSULE_BASE_URL$path") || return 1
    [ -z "$contains" ] || [[ "$body" == *"$contains"* ]] || return 1
  done < <(jq -c '.runtime.healthChecks[]' "$CAPSULE_CONFIG_PATH")
}

capsule_compose_runtime_absent() {
  local count
  count=$(capsule_labeled_resource_count) || return
  [ "$count" -eq 0 ]
}

capsule_compose_down_and_verify() {
  # The lifecycle engine runs label-based GC immediately after this hook and
  # only then calls capsule_cleanup_verify. A source rebuild can leave older
  # run-labeled dangling images that Compose cannot remove by project name, so
  # asserting global absence here would reject a cleanup the engine is about
  # to complete correctly.
  capsule_compose_down
}

capsule_install_compose_common_hooks() {
  jq -e '.runtime.healthChecks | type == "array" and length > 0' "$CAPSULE_CONFIG_PATH" >/dev/null || {
    echo "Compose common hooks require runtime.healthChecks" >&2
    return 2
  }
  capsule_status() { capsule_compose_status "$@"; }
  capsule_down() { capsule_compose_down_and_verify "$@"; }
  capsule_cleanup_verify() { capsule_compose_runtime_absent "$@"; }
}

# Render the common, run-scoped Compose envelope for a single source-backed
# application. The site config supplies only application topology data; run
# identity, labels, host paths, port publication, and cleanup metadata remain
# evaluator-owned here.
capsule_render_single_app_compose() {
  local application image_name image compose_file temporary source
  application=$(jq -ec '.runtime.application' "$CAPSULE_CONFIG_PATH") || {
    echo "single-app Compose requires runtime.application metadata" >&2
    return 2
  }
  jq -e '.runtime.healthChecks | type == "array" and length > 0' \
    "$CAPSULE_CONFIG_PATH" >/dev/null || {
    echo "single-app Compose requires at least one runtime.healthChecks entry" >&2
    return 2
  }
  [[ "$CAPSULE_PRIVATE_DIR" == /* && "$CAPSULE_WORKSPACE" == /* ]] || {
    echo "single-app Compose host paths must be absolute" >&2
    return 2
  }
  [[ "$CAPSULE_PORT" =~ ^[0-9]+$ ]] || {
    echo "single-app Compose requires a numeric reserved port" >&2
    return 2
  }

  while IFS= read -r source; do
    [ -e "$CAPSULE_PRIVATE_DIR/$source" ] || {
      echo "single-app Compose private mount source is missing: $source" >&2
      return 1
    }
  done < <(jq -r '.privateMounts[]?.source' <<<"$application")

  image_name=$(jq -r .image <<<"$application")
  image=$(capsule_image "$image_name") || return
  compose_file="$CAPSULE_PRIVATE_DIR/compose.yaml"
  temporary="$compose_file.tmp.$$"
  mkdir -p "$CAPSULE_PRIVATE_DIR"

  jq -n \
    --arg project "$CAPSULE_COMPOSE_PROJECT" \
    --arg image "$image" \
    --arg user "$(id -u):$(id -g)" \
    --arg workspace "$CAPSULE_WORKSPACE" \
    --arg privateDir "$CAPSULE_PRIVATE_DIR" \
    --arg baseUrl "$CAPSULE_BASE_URL" \
    --arg site "$SITE" \
    --arg runId "$RUN_ID" \
    --arg manifestId "$CAPSULE_MANIFEST_ID" \
    --argjson hostPort "$CAPSULE_PORT" \
    --argjson applicationPort "$CAPSULE_APPLICATION_PORT" \
    --argjson application "$application" '
      {
        "webmcp-kit.capsule": $site,
        "webmcp-kit.run": $runId,
        "webmcp-kit.manifest": $manifestId
      } as $labels |
      (($application.environment // {}) +
        (($application.baseUrlEnvironment // []) |
          map({key:., value:$baseUrl}) | from_entries)) as $environment |
      ([{
        type:"bind", source:$workspace, target:$application.sourceTarget
      }] + (($application.privateMounts // []) | map(
        {type:"bind", source:($privateDir + "/" + .source), target:.target} +
        (if (.readOnly // false) then {read_only:true} else {} end)
      ))) as $mounts |
      {
        name:$project,
        services:{
          app:{
            image:$image,
            init:true,
            user:$user,
            working_dir:$application.workingDirectory,
            command:$application.command,
            environment:$environment,
            ports:[{
              target:$applicationPort,
              published:$hostPort,
              host_ip:"127.0.0.1",
              protocol:"tcp"
            }],
            volumes:$mounts,
            labels:$labels,
            stop_grace_period:"10s"
          }
        },
        networks:{default:{labels:$labels}}
      }
    ' > "$temporary" || {
      rm -f "$temporary"
      return 1
    }
  chmod 0600 "$temporary"
  mv -f "$temporary" "$compose_file"
}

capsule_single_app_up() {
  capsule_compose up -d --force-recreate app
}

capsule_single_app_status() {
  capsule_compose_status
}

capsule_single_app_reset() {
  capsule_single_app_up
}

capsule_single_app_runtime_absent() {
  capsule_compose_runtime_absent
}

capsule_single_app_down() {
  capsule_compose_down
  capsule_single_app_runtime_absent
}

# Hook installation is explicit so a complex adapter cannot accidentally pass
# the lifecycle contract merely by sourcing this library. Stateful reset
# strategies retain their site-specific restore hook.
capsule_install_single_app_compose_hooks() {
  jq -e '.runtime.application | type == "object"' "$CAPSULE_CONFIG_PATH" >/dev/null || {
    echo "cannot install single-app hooks without runtime.application" >&2
    return 2
  }

  capsule_install_compose_common_hooks
  capsule_up() { capsule_single_app_up "$@"; }

  case "$CAPSULE_RESET_STRATEGY" in
    stateless|browser-context)
      capsule_reset() { capsule_single_app_reset "$@"; }
      ;;
  esac
}

capsule_package_cache_root() {
  # root fs, not /tmp: package caches reach multi-GB and /tmp is a small tmpfs
  local shared_root=${CAPSULE_PACKAGE_CACHE_ROOT:-"${HOME}/.cache/webmcp-kit/package-cache"}
  [[ "$shared_root" == /* ]] || {
    echo "CAPSULE_PACKAGE_CACHE_ROOT must be absolute" >&2
    return 2
  }
  realpath -m "$shared_root"
}

capsule_package_cache_path() {
  local image=$1 cache_key shared_root
  shared_root=$(capsule_package_cache_root) || return
  # Bind the cache to this run's identity, not just the site+image. The cache is
  # mounted read-write into source-controlled build commands, so a run-agnostic
  # key would let first-run code plant state under /cache that a second run then
  # observes, breaking the independence of the two authoritative runs.
  cache_key=$(printf '%s\0%s\0%s\0%s' "$SITE" "$RUN_ID" "${CAPSULE_MANIFEST_ID:-}" "$image" |
    sha256sum | cut -d' ' -f1)
  printf '%s/%s\n' "$shared_root" "$cache_key"
}

capsule_node_run() {
  local image=$1 subdirectory=$2
  shift 2
  local working=/workspace cache_root
  [ "$subdirectory" = . ] || working="/workspace/$subdirectory"
  cache_root=$(capsule_package_cache_path "$image") || return
  mkdir -p "$cache_root/corepack" "$cache_root/npm" "$cache_root/yarn"
  docker run --rm \
    --label "$CAPSULE_SITE_LABEL" --label "$CAPSULE_RUN_LABEL" --label "$CAPSULE_MANIFEST_LABEL" \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp/home --env COREPACK_HOME=/cache/corepack --env npm_config_cache=/cache/npm \
    --env YARN_ENABLE_GLOBAL_CACHE=true --env YARN_GLOBAL_FOLDER=/cache/yarn \
    --volume "$CAPSULE_WORKSPACE:/workspace:z" \
    --volume "$cache_root:/cache:z" \
    --workdir "$working" "$image" "$@"
}

capsule_hash_file_map() {
  local result='{}' name path hash
  while [ "$#" -gt 0 ]; do
    name=$1
    path=$2
    shift 2
    [ -f "$path" ] || {
      echo "hash input is missing: $path" >&2
      return 1
    }
    hash="sha256:$(sha256sum "$path" | cut -d' ' -f1)"
    result=$(jq -c --arg name "$name" --arg hash "$hash" '. + {($name):$hash}' <<<"$result")
  done
  printf '%s\n' "$result"
}

# ---- evaluator-owned prepare cache ----
# A generation is stored as a *bundle*: a named set of one or more entries
# published together, atomically, under a single lock with a manifest (inventory +
# per-entry type/sha256). The whole staged tree is renamed into place and its
# `bundle.complete` marker flipped last, so a concurrent cold prepare with the
# same key either sees one run's finished generation or nothing — it can never
# mix, e.g., an archive from run A with a token from run B into one warm restore.
capsule_prepare_cache_enabled() { [ "${CAPSULE_PREPARE_CACHE:-on}" = on ]; }

capsule_prepare_cache_key() {
  # CAPSULE_HARNESS_ADAPTER_LIB_HASH folds the shared harness libraries (this
  # file + the lifecycle engine) into the key alongside the per-site adapter
  # hash, so a change to any shared clone/vendor/build/reset/cache helper that
  # shapes a cached output invalidates every stale generation.
  printf '%s\0' 2 "$SITE" "$CAPSULE_ADAPTER_HASH" "$CAPSULE_CONFIG_HASH" \
    "${CAPSULE_HARNESS_ADAPTER_LIB_HASH:-}" \
    "${CAPSULE_SOURCE_REVISION:-}" "$CAPSULE_IMAGE_DIGESTS_JSON" \
    "$CAPSULE_FIXTURE_HASHES_JSON" "$CAPSULE_BOOTSTRAP_HASHES_JSON" |
    sha256sum | cut -d' ' -f1
}

capsule_prepare_cache_dir() {
  local root=${CAPSULE_PREPARE_CACHE_ROOT:-"$HOME/.cache/webmcp-kit/prepare-cache"}
  printf '%s/%s/%s\n' "$root" "$SITE" "$(capsule_prepare_cache_key)"
}

capsule_prepare_cache_bundle_dir() {  # <bundle>
  printf '%s/%s\n' "$(capsule_prepare_cache_dir)" "$1"
}

# Deterministic content digest for a cache entry. Directories hash a sorted,
# metadata-flattened tar so the digest is stable across reflink copies and host
# umask/uid differences; regular files hash directly.
capsule_prepare_cache_entry_digest() {  # <path>
  if [ -d "$1" ]; then
    tar --sort=name --numeric-owner --owner=0 --group=0 --mtime=@0 \
      -cf - -C "$1" . | sha256sum | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}

# Restore one bundle all-or-nothing. Args: <bundle> <name> <target> [<name>
# <target> ...]. Restores only when the atomically published completion marker,
# the manifest, and every requested entry are present with an inventory, type,
# and — for files — sha256 that match the manifest. Any target already written is
# rolled back on a later failure, so a partial generation never lands in the run
# tree. Returns 0 on HIT, 1 on MISS.
capsule_prepare_cache_restore_bundle() {  # <bundle> <name> <target> [<name> <target> ...]
  capsule_prepare_cache_enabled || return 1
  local bundle=$1; shift
  local dir manifest; dir="$(capsule_prepare_cache_bundle_dir "$bundle")"
  manifest="$dir/bundle.json"
  [ -f "$dir/bundle.complete" ] && [ -f "$manifest" ] || {
    echo "prepare-cache: MISS $bundle" >&2; return 1; }

  local names=() targets=()
  while [ "$#" -ge 2 ]; do names+=("$1"); targets+=("$2"); shift 2; done
  [ "$#" -eq 0 ] || { echo "prepare-cache: MISS $bundle (odd entry/target arity)" >&2; return 1; }

  # Inventory must match the manifest exactly: the same set of entry names.
  local requested manifest_names
  requested=$(printf '%s\n' "${names[@]}" | sort)
  manifest_names=$(jq -r '.entries | keys[]' "$manifest" 2>/dev/null | sort)
  [ "$requested" = "$manifest_names" ] || {
    echo "prepare-cache: MISS $bundle (inventory mismatch)" >&2; return 1; }

  # Validate presence, type, and (for files) digest before touching any target.
  local i name type want got source
  for i in "${!names[@]}"; do
    name=${names[$i]}; source="$dir/$name"
    type=$(jq -r --arg n "$name" '.entries[$n].type // ""' "$manifest")
    [ -e "$source" ] || { echo "prepare-cache: MISS $bundle (missing $name)" >&2; return 1; }
    if [ "$type" = dir ]; then
      [ -d "$source" ] || { echo "prepare-cache: MISS $bundle (type drift $name)" >&2; return 1; }
    else
      [ -f "$source" ] || { echo "prepare-cache: MISS $bundle (type drift $name)" >&2; return 1; }
      want=$(jq -r --arg n "$name" '.entries[$n].sha256 // ""' "$manifest")
      got=$(sha256sum "$source" | cut -d' ' -f1)
      [ "$want" = "$got" ] || { echo "prepare-cache: MISS $bundle (digest mismatch $name)" >&2; return 1; }
    fi
  done

  # All validated -> materialize every target, rolling back all on any failure.
  local target restored=()
  for i in "${!names[@]}"; do
    name=${names[$i]}; target=${targets[$i]}; source="$dir/$name"
    rm -rf "$target"; mkdir -p "$(dirname "$target")"
    if ! cp -a --reflink=auto "$source" "$target"; then
      rm -rf "$target"
      [ "${#restored[@]}" -eq 0 ] || rm -rf "${restored[@]}"
      echo "prepare-cache: MISS $bundle (restore failed $name)" >&2
      return 1
    fi
    restored+=("$target")
  done
  echo "prepare-cache: HIT $bundle" >&2
}

# Store one bundle. Args: <bundle> <name> <source> [<name> <source> ...].
# Best-effort: a store failure never fails prepare. Every entry is staged and
# hashed under one lock into a temp dir, the manifest is written, the staged tree
# is renamed into the keyed cache dir, and the completion marker is flipped last.
capsule_prepare_cache_store_bundle() {  # <bundle> <name> <source> [<name> <source> ...]
  capsule_prepare_cache_enabled || return 0
  local bundle=$1; shift
  local names=() sources=()
  while [ "$#" -ge 2 ]; do names+=("$1"); sources+=("$2"); shift 2; done
  [ "$#" -eq 0 ] || { echo "prepare-cache: store $bundle skipped (odd entry/source arity)" >&2; return 0; }

  local key_dir dir site_root code=0
  key_dir=$(capsule_prepare_cache_dir); dir="$key_dir/$bundle"
  site_root=$(dirname "$key_dir")
  mkdir -p "$key_dir"
  # exit 10 signals an already-published bundle (a warm-path re-store is a no-op),
  # kept distinct from a real store (0) and a failure (other) so the no-op emits
  # no "stored" line a warm-path speed gate would misread as an uncached run.
  ( exec 8>"$site_root/.lock"; flock -x 8
    [ ! -f "$dir/bundle.complete" ] || exit 10
    local staging="$key_dir/.staging-$bundle.$$"
    rm -rf "$staging" "$dir"
    mkdir -p "$staging" || exit 1
    local entries='{}' i name source type digest
    for i in "${!names[@]}"; do
      name=${names[$i]}; source=${sources[$i]}
      [ -e "$source" ] || exit 1
      cp -a --reflink=auto "$source" "$staging/$name" || exit 1
      if [ -d "$source" ]; then type=dir; else type=file; fi
      digest=$(capsule_prepare_cache_entry_digest "$source") || exit 1
      entries=$(jq -c --arg n "$name" --arg t "$type" --arg h "$digest" \
        '.[$n]={type:$t,sha256:$h}' <<<"$entries") || exit 1
    done
    jq -n --arg bundle "$bundle" --arg site "$SITE" --arg rev "${CAPSULE_SOURCE_REVISION:-}" \
      --arg at "$(capsule_timestamp)" --argjson entries "$entries" \
      '{bundle:$bundle,site:$site,sourceRevision:$rev,createdAt:$at,entries:$entries}' \
      > "$staging/bundle.json" || exit 1
    mv "$staging" "$dir" || exit 1
    : > "$dir/bundle.complete" || exit 1
    [ -f "$key_dir/meta.json" ] || jq -n --arg site "$SITE" --arg rev "${CAPSULE_SOURCE_REVISION:-}" \
      --arg at "$(capsule_timestamp)" '{site:$site,sourceRevision:$rev,createdAt:$at}' > "$key_dir/meta.json"
    find "$site_root" -mindepth 1 -maxdepth 1 -type d ! -path "$key_dir" -exec rm -rf {} +
  ) || code=$?
  case "$code" in
    0) echo "prepare-cache: stored $bundle" >&2 ;;
    10) : ;;  # bundle already published (warm-path re-store) — stay silent
    *) echo "prepare-cache: store failed for $bundle (continuing)" >&2 ;;
  esac
  return 0
}

# Single-entry convenience wrappers: a lone entry is just a one-member bundle,
# published through the same atomic manifest path. The bundle name is the entry
# name, so single-entry adapters and the cache log strings are unchanged.
capsule_prepare_cache_restore() {  # <entry> <target>; 0 = restored
  capsule_prepare_cache_restore_bundle "$1" "$1" "$2"
}

capsule_prepare_cache_store() {  # <entry> <source>; best-effort, never fails prepare
  capsule_prepare_cache_store_bundle "$1" "$1" "$2"
}

# ---- unpublished @nekuda/webmcp SDK vendoring ----
capsule_vendor_sdk() {
  local tarball="$ROOT/fixtures/sdk/nekuda-webmcp-0.1.0.tgz" golden detail golden_hashes
  [ -f "$tarball" ] || { echo "missing SDK tarball: $tarball" >&2; return 1; }
  rm -rf "$CAPSULE_WORKSPACE/vendor/nekuda-webmcp"
  mkdir -p "$CAPSULE_WORKSPACE/vendor/nekuda-webmcp"
  tar -xzf "$tarball" -C "$CAPSULE_WORKSPACE/vendor/nekuda-webmcp" || return

  # WINDTUNNEL: webmcp golden-apply
  [ "${WT_WEBMCP:-}" = 1 ] || return 0
  golden="$ROOT/goldens/$SITE.reference.patch"
  [ -f "$golden" ] || return 0
  golden_hashes=$(capsule_hash_file_map "webmcp:golden" "$golden") || return
  CAPSULE_BOOTSTRAP_HASHES_JSON=$(jq -c --argjson golden "$golden_hashes" \
    '. + $golden' <<<"$CAPSULE_BOOTSTRAP_HASHES_JSON") || return
  export CAPSULE_BOOTSTRAP_HASHES_JSON
  if ! detail=$(git -C "$CAPSULE_WORKSPACE" apply --check "$golden" 2>&1); then
    printf 'WebMCP golden check failed for %s:\n%s\n' "$SITE" "$detail" >&2
    return 1
  fi
  if ! detail=$(git -C "$CAPSULE_WORKSPACE" apply "$golden" 2>&1); then
    printf 'WebMCP golden apply failed for %s:\n%s\n' "$SITE" "$detail" >&2
    return 1
  fi
}
