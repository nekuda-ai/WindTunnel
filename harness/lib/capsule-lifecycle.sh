#!/usr/bin/env bash

# Shared evaluator-owned lifecycle primitives. This file is sourced by
# harness/bin/capsule before the site adapter.

capsule_timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

capsule_atomic_phase_write() {
  local value=$1 temporary
  mkdir -p "$(dirname "$PHASE_FILE")"
  temporary="$PHASE_FILE.tmp.$$"
  printf '%s\n' "$value" > "$temporary"
  mv -f "$temporary" "$PHASE_FILE"
}

capsule_remove_runtime_dir() {
  rm -rf "$CAPSULE_RUNTIME_DIR"
}

capsule_path_is_below() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    function canonical(candidate) {
      let current = path.resolve(candidate);
      const suffix = [];
      while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) break;
        suffix.unshift(path.basename(current));
        current = parent;
      }
      return path.resolve(fs.realpathSync(current), ...suffix);
    }
    const child = canonical(process.argv[1]);
    const parent = canonical(process.argv[2]);
    process.exit(child === parent || child.startsWith(`${parent}${path.sep}`) ? 0 : 1);
  ' "$1" "$2"
}

capsule_protect_baseline() {
  [ -d "$CAPSULE_WORKSPACE" ] || {
    echo "capsule did not create the author workspace: $CAPSULE_WORKSPACE" >&2
    return 1
  }

  local directory archive temporary
  directory="$CAPSULE_PRIVATE_DIR/baseline"
  archive="$directory/source.tar"
  temporary="$archive.tmp.$$"
  mkdir -p "$directory"

  local -a excludes=(
    --exclude=./.git
    --exclude='*/.git'
    --exclude=./node_modules
    --exclude='*/node_modules'
    --exclude=./.next
    --exclude='*/.next'
    --exclude=./dist
    --exclude='*/dist'
    --exclude=./build
    --exclude='*/build'
    --exclude=./.cache
    --exclude='*/.cache'
  )
  if declare -p CAPSULE_BASELINE_EXCLUDES >/dev/null 2>&1; then
    local item
    for item in "${CAPSULE_BASELINE_EXCLUDES[@]}"; do
      [[ "$item" != /* ]] && [[ "$item" != *..* ]] || {
        echo "invalid baseline exclude: $item" >&2
        return 1
      }
      excludes+=("--exclude=./$item")
    done
  fi

  tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
    "${excludes[@]}" -cf "$temporary" -C "$CAPSULE_WORKSPACE" .
  mv -f "$temporary" "$archive"
  chmod 0400 "$archive"
  CAPSULE_BASELINE_PATH=$archive
  CAPSULE_BASELINE_HASH="sha256:$(sha256sum "$archive" | cut -d' ' -f1)"
  export CAPSULE_BASELINE_PATH CAPSULE_BASELINE_HASH
}

capsule_verify_baseline() {
  [ -f "${CAPSULE_BASELINE_PATH:-}" ] || {
    echo "protected baseline is missing: ${CAPSULE_BASELINE_PATH:-unset}" >&2
    return 1
  }
  local actual
  actual="sha256:$(sha256sum "$CAPSULE_BASELINE_PATH" | cut -d' ' -f1)"
  [ "$actual" = "${CAPSULE_BASELINE_HASH:-}" ] || {
    echo "protected baseline hash mismatch" >&2
    return 1
  }
}

capsule_collect_reset_artifact_hashes() {
  local result='{}' directory file relative hash
  for directory in "$CAPSULE_PRIVATE_DIR/reset" "$CAPSULE_PRIVATE_DIR/reset-state" \
    "$CAPSULE_PRIVATE_DIR/reset-snapshots"; do
    [ ! -e "$directory" ] || [ -d "$directory" ] || {
      echo "reset artifact root is not a directory: $directory" >&2
      return 1
    }
    [ -d "$directory" ] || continue
    if find "$directory" -type l -print -quit | grep -q .; then
      echo "reset artifacts must not contain symlinks: $directory" >&2
      return 1
    fi
    while IFS= read -r -d '' file; do
      relative=${file#"$CAPSULE_PRIVATE_DIR/"}
      # Avoid the sha256sum|cut pipe: its exit status is cut's, so an unreadable
      # artifact would be silently recorded as the empty digest "sha256:" and
      # would then "verify" against another empty digest. Propagate the failure.
      hash=$(sha256sum "$file") || {
        echo "failed to hash reset artifact: $file" >&2
        return 1
      }
      result=$(jq -c --arg path "$relative" --arg hash "sha256:${hash%% *}" \
        '. + {($path):$hash}' <<<"$result")
    done < <(find "$directory" -type f -print0 | sort -z)
  done
  printf '%s\n' "$result"
}

capsule_record_reset_artifact_hashes() {
  CAPSULE_RESET_ARTIFACT_HASHES_JSON=$(capsule_collect_reset_artifact_hashes) || return 1
  export CAPSULE_RESET_ARTIFACT_HASHES_JSON
}

capsule_verify_reset_artifacts() {
  local actual
  [ -n "${CAPSULE_RESET_ARTIFACT_HASHES_JSON:-}" ] || {
    echo "evaluator reset artifact hashes are missing" >&2
    return 1
  }
  actual=$(capsule_collect_reset_artifact_hashes) || return 1
  jq -en --argjson expected "$CAPSULE_RESET_ARTIFACT_HASHES_JSON" \
    --argjson actual "$actual" '$expected == $actual' >/dev/null || {
      echo "evaluator reset artifact hash mismatch" >&2
      return 1
    }
}

capsule_snapshot_directory() {
  local name=$1 source=$2 directory archive temporary
  [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || {
    echo "invalid reset snapshot name: $name" >&2
    return 2
  }
  [ -d "$source" ] || {
    echo "reset snapshot source is not a directory: $source" >&2
    return 1
  }
  if capsule_path_is_below "$source" "$CAPSULE_AUTHOR_DIR"; then
    echo "reset snapshots must not be captured from the author workspace: $source" >&2
    return 1
  fi

  directory="$CAPSULE_PRIVATE_DIR/reset-snapshots"
  archive="$directory/$name.tar"
  temporary="$archive.tmp.$$"
  [ ! -e "$archive" ] || {
    echo "reset snapshot already exists: $name" >&2
    return 1
  }
  mkdir -p "$directory"
  tar --sort=name --numeric-owner -cf "$temporary" -C "$source" .
  mv -f "$temporary" "$archive"
  chmod 0400 "$archive"
}

capsule_restore_directory_snapshot() {
  local name=$1 target=$2 archive parent temporary
  [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || {
    echo "invalid reset snapshot name: $name" >&2
    return 2
  }
  if capsule_path_is_below "$target" "$CAPSULE_AUTHOR_DIR"; then
    echo "reset snapshots must not restore into the author workspace: $target" >&2
    return 1
  fi
  archive="$CAPSULE_PRIVATE_DIR/reset-snapshots/$name.tar"
  [ -f "$archive" ] || {
    echo "reset snapshot is missing: $name" >&2
    return 1
  }

  parent=$(dirname "$target")
  temporary="$parent/.capsule-restore-$(basename "$target").$$"
  rm -rf "$temporary"
  mkdir -p "$temporary"
  tar -xf "$archive" -C "$temporary"
  rm -rf "$target"
  mv "$temporary" "$target"
}

capsule_port_available() {
  node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.unref();
    server.once("error", () => process.exit(1));
    server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close());
  ' "$1"
}

capsule_reserve_port() {
  local port=$1 reservation temporary
  mkdir -p "$CAPSULE_PORT_REGISTRY_ROOT"
  chmod 0700 "$CAPSULE_PORT_REGISTRY_ROOT"
  exec 8>"$CAPSULE_PORT_REGISTRY_ROOT/.lock"
  flock -x 8
  reservation="$CAPSULE_PORT_REGISTRY_ROOT/$port.env"

  if [ -f "$reservation" ]; then
    local RESERVED_SITE= RESERVED_RUN_ID= RESERVED_MANIFEST_ID= RESERVED_RUNTIME_DIR=
    # shellcheck source=/dev/null
    source "$reservation"
    if [ "$RESERVED_SITE" = "$SITE" ] && [ "$RESERVED_RUN_ID" = "$RUN_ID" ] &&
      [ "$RESERVED_MANIFEST_ID" = "$CAPSULE_MANIFEST_ID" ]; then
      flock -u 8
      return 0
    fi
    if [ -n "$RESERVED_RUNTIME_DIR" ] && [ -d "$RESERVED_RUNTIME_DIR" ]; then
      echo "port $port is reserved by $RESERVED_SITE/$RESERVED_RUN_ID" >&2
      flock -u 8
      return 1
    fi
    rm -f "$reservation"
  fi

  if ! capsule_port_available "$port"; then
    echo "port is already occupied: $port" >&2
    flock -u 8
    return 1
  fi

  temporary="$reservation.tmp.$$"
  {
    printf 'RESERVED_SITE=%q\n' "$SITE"
    printf 'RESERVED_RUN_ID=%q\n' "$RUN_ID"
    printf 'RESERVED_MANIFEST_ID=%q\n' "$CAPSULE_MANIFEST_ID"
    printf 'RESERVED_RUNTIME_DIR=%q\n' "$CAPSULE_RUNTIME_DIR"
  } > "$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$reservation"
  if ! mkdir -p "$CAPSULE_RUNTIME_DIR"; then
    rm -f "$reservation"
    flock -u 8
    return 1
  fi
  flock -u 8
}

capsule_release_port() {
  local port=${CAPSULE_PORT:-} reservation
  mkdir -p "$CAPSULE_PORT_REGISTRY_ROOT"
  exec 8>"$CAPSULE_PORT_REGISTRY_ROOT/.lock"
  flock -x 8
  if [ -z "$port" ]; then
    local candidate RESERVED_SITE= RESERVED_RUN_ID= RESERVED_MANIFEST_ID= RESERVED_RUNTIME_DIR=
    for candidate in "$CAPSULE_PORT_REGISTRY_ROOT"/*.env; do
      [ -f "$candidate" ] || continue
      RESERVED_SITE= RESERVED_RUN_ID= RESERVED_MANIFEST_ID= RESERVED_RUNTIME_DIR=
      # shellcheck source=/dev/null
      source "$candidate"
      if [ "$RESERVED_SITE" = "$SITE" ] && [ "$RESERVED_RUN_ID" = "$RUN_ID" ] &&
        { [ -z "${CAPSULE_MANIFEST_ID:-}" ] || [ "$RESERVED_MANIFEST_ID" = "$CAPSULE_MANIFEST_ID" ]; }; then
        rm -f "$candidate"
      fi
    done
    flock -u 8
    return 0
  fi
  reservation="$CAPSULE_PORT_REGISTRY_ROOT/$port.env"
  if [ -f "$reservation" ]; then
    local RESERVED_SITE= RESERVED_RUN_ID= RESERVED_MANIFEST_ID= RESERVED_RUNTIME_DIR=
    # shellcheck source=/dev/null
    source "$reservation"
    if [ "$RESERVED_SITE" = "$SITE" ] && [ "$RESERVED_RUN_ID" = "$RUN_ID" ] &&
      { [ -z "${CAPSULE_MANIFEST_ID:-}" ] || [ "$RESERVED_MANIFEST_ID" = "$CAPSULE_MANIFEST_ID" ]; }; then
      rm -f "$reservation"
    else
      echo "refusing to release port $port reserved by $RESERVED_SITE/$RESERVED_RUN_ID" >&2
      flock -u 8
      return 1
    fi
  fi
  flock -u 8
  rmdir "$CAPSULE_PORT_REGISTRY_ROOT" 2>/dev/null || true
}

capsule_labeled_resource_count() {
  [ "${CAPSULE_USES_DOCKER:-true}" = true ] || {
    printf '0\n'
    return 0
  }
  docker info >/dev/null 2>&1 || return 1
  local count=0 output
  output=$(docker ps -aq --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL") || return 1
  [ -z "$output" ] || count=$((count + $(wc -l <<<"$output")))
  output=$(docker network ls -q --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL") || return 1
  [ -z "$output" ] || count=$((count + $(wc -l <<<"$output")))
  output=$(docker volume ls -q --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL") || return 1
  [ -z "$output" ] || count=$((count + $(wc -l <<<"$output")))
  output=$(docker image ls -q --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL") || return 1
  [ -z "$output" ] || count=$((count + $(wc -l <<<"$output")))
  printf '%s\n' "$count"
}

capsule_gc_labeled_resources() {
  [ "${CAPSULE_USES_DOCKER:-true}" = true ] || return 0
  docker info >/dev/null 2>&1 || {
    echo "cannot verify labeled cleanup because Docker is unavailable" >&2
    return 1
  }

  local -a ids=()
  mapfile -t ids < <(docker ps -aq --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL")
  [ "${#ids[@]}" -eq 0 ] || docker rm -f "${ids[@]}" >/dev/null
  mapfile -t ids < <(docker network ls -q --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL")
  [ "${#ids[@]}" -eq 0 ] || docker network rm "${ids[@]}" >/dev/null
  mapfile -t ids < <(docker volume ls -q --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL")
  [ "${#ids[@]}" -eq 0 ] || docker volume rm -f "${ids[@]}" >/dev/null
  mapfile -t ids < <(docker image ls -q --filter "label=$CAPSULE_SITE_LABEL" --filter "label=$CAPSULE_RUN_LABEL" | sort -u)
  [ "${#ids[@]}" -eq 0 ] || docker image rm -f "${ids[@]}" >/dev/null

  [ "$(capsule_labeled_resource_count)" -eq 0 ] || {
    echo "run-labeled Docker resources remain for $SITE/$RUN_ID" >&2
    return 1
  }
}

capsule_validate_compose_contract() {
  local compose_file="$CAPSULE_PRIVATE_DIR/compose.yaml"
  [ -f "$compose_file" ] || return 0

  local contract="$CAPSULE_PRIVATE_DIR/compose-contract.json"
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$compose_file" config --format json > "$contract"
  chmod 0600 "$contract"
  jq -e \
    --arg site "$SITE" \
    --arg runId "$RUN_ID" \
    --arg manifestId "$CAPSULE_MANIFEST_ID" \
    --arg port "$CAPSULE_PORT" \
    --arg applicationPort "${CAPSULE_APPLICATION_PORT:-}" '
      ([.services[] | (.ports // [])[]] | length) == 1 and
      ([.services[] | (.ports // [])[]][0] |
        .host_ip == "127.0.0.1" and
        (.published | tostring) == $port and
        ($applicationPort == "" or (.target | tostring) == $applicationPort)) and
      all(.services[];
        .labels["webmcp-kit.capsule"] == $site and
        .labels["webmcp-kit.run"] == $runId and
        .labels["webmcp-kit.manifest"] == $manifestId) and
      all((.volumes // {})[];
        .labels["webmcp-kit.capsule"] == $site and
        .labels["webmcp-kit.run"] == $runId and
        .labels["webmcp-kit.manifest"] == $manifestId) and
      all((.networks // {})[];
        .labels["webmcp-kit.capsule"] == $site and
        .labels["webmcp-kit.run"] == $runId and
        .labels["webmcp-kit.manifest"] == $manifestId)
    ' "$contract" >/dev/null || {
      echo "Compose contract requires one loopback-published application port and run labels on every service, volume, and network" >&2
      return 1
    }
}

capsule_validate_generated_images() {
  [ "${CAPSULE_USES_DOCKER:-true}" = true ] || return 0
  local image_id inspected
  while IFS= read -r image_id; do
    [ -n "$image_id" ] || continue
    inspected=$(docker image inspect "$image_id") || return 1
    jq -e \
      --arg site "$SITE" \
      --arg runId "$RUN_ID" \
      --arg manifestId "$CAPSULE_MANIFEST_ID" '
        length == 1 and
        .[0].Config.Labels["webmcp-kit.capsule"] == $site and
        .[0].Config.Labels["webmcp-kit.run"] == $runId and
        .[0].Config.Labels["webmcp-kit.manifest"] == $manifestId
      ' <<<"$inspected" >/dev/null || {
        echo "generated image $image_id is missing the capsule run labels" >&2
        return 1
      }
  done < <(jq -r '.[] | select(test("^sha256:[0-9a-f]{64}$"))' <<<"$CAPSULE_IMAGE_DIGESTS_JSON")
}

capsule_validate_running_images() {
  [ "${CAPSULE_USES_DOCKER:-true}" = true ] || return 0
  local declared='[]' reference image_id inspected
  local -a running=()
  while IFS= read -r reference; do
    [ -n "$reference" ] || continue
    if [[ "$reference" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      image_id=$reference
    else
      image_id=$(docker image inspect --format '{{.Id}}' "$reference" 2>/dev/null || true)
    fi
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || continue
    declared=$(jq -c --arg id "$image_id" '. + [$id] | unique' <<<"$declared")
  done < <(jq -r '.[]' <<<"$CAPSULE_IMAGE_DIGESTS_JSON")

  mapfile -t running < <(docker ps -q --filter "label=$CAPSULE_SITE_LABEL" \
    --filter "label=$CAPSULE_RUN_LABEL")
  [ "${#running[@]}" -gt 0 ] || {
    echo "no run-labeled application containers are running for $SITE/$RUN_ID" >&2
    return 1
  }
  inspected=$(docker inspect "${running[@]}") || return 1
  jq -e --arg site "$SITE" --arg runId "$RUN_ID" --arg manifestId "$CAPSULE_MANIFEST_ID" \
    --argjson declared "$declared" '
      length > 0 and all(.[]; . as $container |
        $container.Config.Labels["webmcp-kit.capsule"] == $site and
        $container.Config.Labels["webmcp-kit.run"] == $runId and
        $container.Config.Labels["webmcp-kit.manifest"] == $manifestId and
        ($declared | index($container.Image) != null))
    ' <<<"$inspected" >/dev/null || {
      echo "a running capsule container uses an undeclared image artifact" >&2
      return 1
    }
}

capsule_register_browser_manifest() {
  [[ "$CAPSULE_MANIFEST_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || return 2
  local key=${CAPSULE_MANIFEST_ID#sha256:} directory record temporary actor_hashes
  directory="$CAPSULE_BROWSER_REGISTRY_ROOT/manifests"
  record="$directory/$key.json"
  temporary="$record.tmp.$$"
  mkdir -p "$CAPSULE_BROWSER_REGISTRY_ROOT"
  chmod 0700 "$CAPSULE_BROWSER_REGISTRY_ROOT"
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  mkdir -p "$directory" "$CAPSULE_BROWSER_REGISTRY_ROOT/sessions/$key"
  chmod 0700 "$directory" "$CAPSULE_BROWSER_REGISTRY_ROOT/sessions" \
    "$CAPSULE_BROWSER_REGISTRY_ROOT/sessions/$key"
  actor_hashes=$(jq -c 'to_entries | map(select(.key | startswith("actor:"))) |
    map({key:(.key | ltrimstr("actor:")),value:.value}) | from_entries' \
    <<<"$CAPSULE_FIXTURE_HASHES_JSON")
  jq -n --arg manifestId "$CAPSULE_MANIFEST_ID" --arg site "$SITE" --arg runId "$RUN_ID" \
    --arg baseUrl "$CAPSULE_BASE_URL" --argjson actorSetupHashes "$actor_hashes" \
    '{manifestId:$manifestId,site:$site,runId:$runId,baseUrl:$baseUrl,
      actorSetupHashes:$actorSetupHashes,active:false,ready:false,execution:null}' > "$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$record"
  flock -u 7
}

capsule_activate_browser_manifest() {
  [[ "$CAPSULE_MANIFEST_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || return 2
  local key=${CAPSULE_MANIFEST_ID#sha256:} record temporary
  record="$CAPSULE_BROWSER_REGISTRY_ROOT/manifests/$key.json"
  temporary="$record.tmp.$$"
  jq -e --arg identity "$CAPSULE_MANIFEST_ID" '
    .identity == $identity and .phase == "prepared" and
    (.timestamps.preparedAt | type == "string" and length > 0)
  ' "$MANIFEST_FILE" >/dev/null || return 1
  mkdir -p "$CAPSULE_BROWSER_REGISTRY_ROOT"
  chmod 0700 "$CAPSULE_BROWSER_REGISTRY_ROOT"
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  if ! jq -e --arg manifestId "$CAPSULE_MANIFEST_ID" --arg baseUrl "$CAPSULE_BASE_URL" '
    .manifestId == $manifestId and .baseUrl == $baseUrl and .active == false and
    (.actorSetupHashes | type == "object")
  ' "$record" >/dev/null; then
    flock -u 7
    return 1
  fi
  jq '.active=true | .ready=false | .execution=null' "$record" > "$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$record"
  flock -u 7
}

capsule_mark_browser_manifest_not_ready() {
  [[ "$CAPSULE_MANIFEST_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || return 2
  local key=${CAPSULE_MANIFEST_ID#sha256:} record temporary
  record="$CAPSULE_BROWSER_REGISTRY_ROOT/manifests/$key.json"
  temporary="$record.tmp.$$"
  mkdir -p "$CAPSULE_BROWSER_REGISTRY_ROOT"
  chmod 0700 "$CAPSULE_BROWSER_REGISTRY_ROOT"
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  if ! jq -e --arg manifestId "$CAPSULE_MANIFEST_ID" \
    '.manifestId == $manifestId' "$record" >/dev/null 2>&1; then
    flock -u 7
    return 1
  fi
  jq '.ready=false | .execution=null' "$record" > "$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$record"
  flock -u 7
}

capsule_quiesce_browser_manifest() {
  capsule_mark_browser_manifest_not_ready || return 1
  local key=${CAPSULE_MANIFEST_ID#sha256:} directory deadline record found owner_pid stale
  directory="$CAPSULE_BROWSER_REGISTRY_ROOT/sessions/$key"
  deadline=$((SECONDS + CAPSULE_BROWSER_QUIESCE_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    found=false
    stale=false
    exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
    flock -x 7
    for record in "$directory"/*.json; do
      [ -f "$record" ] || continue
      found=true
      # New verifier records identify their owner. A malformed/legacy record,
      # or one whose owner has exited, cannot make forward progress on its own;
      # return immediately so teardown can use the safe GC fallback instead of
      # burning the entire grace period.
      owner_pid=$(jq -er '
        select(.state == "starting" or .state == "started") |
        .ownerPid | select(type == "number" and floor == . and . > 1)
      ' "$record" 2>/dev/null || true)
      if [ -z "$owner_pid" ] || ! kill -0 "$owner_pid" 2>/dev/null; then
        stale=true
      fi
      break
    done
    flock -u 7
    [ "$found" = true ] || return 0
    if [ "$stale" = true ]; then
      echo "stale or malformed browser session requires registry reclamation: $record" >&2
      return 1
    fi
    sleep 0.1
  done
  echo "timed out waiting for active verifier sessions to finish" >&2
  return 1
}

capsule_quiesce_or_reclaim_browser_sessions() {
  if capsule_quiesce_browser_manifest; then
    return 0
  fi
  echo "graceful browser-session quiescence failed; reclaiming registered sessions" >&2
  capsule_gc_browser_sessions
}

capsule_mark_browser_manifest_ready() {
  [[ "$CAPSULE_MANIFEST_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || return 2
  local key=${CAPSULE_MANIFEST_ID#sha256:} record temporary execution
  record="$CAPSULE_BROWSER_REGISTRY_ROOT/manifests/$key.json"
  temporary="$record.tmp.$$"
  execution=$(jq -ce '.execution.current | select(
    (.sequence | type == "number" and . >= 1) and
    (.operation == "up" or .operation == "reset") and
    (.runtimeRevision | type == "string" and length > 0) and
    (.imageDigests | type == "object"))' "$MANIFEST_FILE") || return 1
  mkdir -p "$CAPSULE_BROWSER_REGISTRY_ROOT"
  chmod 0700 "$CAPSULE_BROWSER_REGISTRY_ROOT"
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  if ! jq -e --arg manifestId "$CAPSULE_MANIFEST_ID" '
    .manifestId == $manifestId and .active == true
  ' "$record" >/dev/null 2>&1; then
    flock -u 7
    return 1
  fi
  jq --argjson execution "$execution" '.ready=true | .execution=$execution' \
    "$record" > "$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$record"
  flock -u 7
}

capsule_browser_manifest_ready() {
  capsule_browser_manifest_active || return 1
  local key=${CAPSULE_MANIFEST_ID#sha256:} record expected
  record="$CAPSULE_BROWSER_REGISTRY_ROOT/manifests/$key.json"
  expected=$(jq -ce '.execution.current' "$MANIFEST_FILE") || return 1
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  if jq -e --argjson expected "$expected" '.ready == true and .execution == $expected' \
    "$record" >/dev/null 2>&1; then
    flock -u 7
    return 0
  fi
  flock -u 7
  echo "capsule browser manifest is not ready for the current execution" >&2
  return 1
}

capsule_browser_manifest_active() {
  [[ "$CAPSULE_MANIFEST_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || return 2
  local key=${CAPSULE_MANIFEST_ID#sha256:} record actor_hashes
  record="$CAPSULE_BROWSER_REGISTRY_ROOT/manifests/$key.json"
  actor_hashes=$(jq -c 'to_entries | map(select(.key | startswith("actor:"))) |
    map({key:(.key | ltrimstr("actor:")),value:.value}) | from_entries' \
    <<<"$CAPSULE_FIXTURE_HASHES_JSON")
  mkdir -p "$CAPSULE_BROWSER_REGISTRY_ROOT"
  chmod 0700 "$CAPSULE_BROWSER_REGISTRY_ROOT"
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  if jq -e --arg manifestId "$CAPSULE_MANIFEST_ID" --arg site "$SITE" \
    --arg runId "$RUN_ID" --arg baseUrl "$CAPSULE_BASE_URL" \
    --argjson actorSetupHashes "$actor_hashes" '
      .manifestId == $manifestId and .site == $site and .runId == $runId and
      .baseUrl == $baseUrl and .actorSetupHashes == $actorSetupHashes and .active == true
    ' "$record" >/dev/null 2>&1; then
    flock -u 7
    return 0
  fi
  flock -u 7
  echo "capsule browser manifest is missing, inactive, or changed" >&2
  return 1
}

capsule_gc_browser_sessions() {
  local manifests="$CAPSULE_BROWSER_REGISTRY_ROOT/manifests"
  local sessions="$CAPSULE_BROWSER_REGISTRY_ROOT/sessions"
  local reclaim="$CAPSULE_BROWSER_REGISTRY_ROOT/reclaim"
  local quarantine="$CAPSULE_BROWSER_REGISTRY_ROOT/quarantine"
  local -a keys=()
  local mapping key record claimed quarantined session cli runtime xdg expected_runtime
  local key_ok stop_ok record_name record_valid overall_ok=true
  mkdir -p "$CAPSULE_BROWSER_REGISTRY_ROOT"
  chmod 0700 "$CAPSULE_BROWSER_REGISTRY_ROOT"
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  if [[ "${CAPSULE_MANIFEST_ID:-}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    keys+=("${CAPSULE_MANIFEST_ID#sha256:}")
  elif [ -d "$manifests" ]; then
    for mapping in "$manifests"/*.json; do
      [ -f "$mapping" ] || continue
      if jq -e --arg site "$SITE" --arg runId "$RUN_ID" \
        '.site == $site and .runId == $runId' "$mapping" >/dev/null 2>&1; then
        keys+=("$(basename "$mapping" .json)")
      fi
    done
  fi
  flock -u 7

  for key in "${keys[@]}"; do
    if ! [[ "$key" =~ ^[0-9a-f]{64}$ ]]; then
      overall_ok=false
      continue
    fi
    key_ok=true
    mapping="$manifests/$key.json"
    exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
    flock -x 7
    mkdir -p "$sessions/$key"
    chmod 0700 "$sessions" "$sessions/$key"
    # Recover claims left behind if an earlier GC process was interrupted
    # after moving the record but before completing the bounded stop.
    for claimed in "$reclaim/$key"/*.json; do
      [ -f "$claimed" ] || continue
      record="$sessions/$key/$(basename "$claimed")"
      [ -e "$record" ] || mv -f "$claimed" "$record"
    done
    rmdir "$reclaim/$key" 2>/dev/null || true
    flock -u 7
    while :; do
      record=
      exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
      flock -x 7
      for record in "$sessions/$key"/*.json; do
        [ -f "$record" ] || { record=; continue; }
        break
      done
      if [ -z "$record" ]; then
        flock -u 7
        break
      fi

      record_name=$(basename "$record")
      record_valid=true
      if ! jq -e --arg manifestId "sha256:$key" '
        .manifestId == $manifestId and
        (.sessionId | type == "string" and test("^webmcp-[0-9]+-[0-9]+$")) and
        (.chromeCli | type == "string" and startswith("/")) and
        (.runtimeDir | type == "string" and startswith("/")) and
        (.xdgRuntimeDir | type == "string") and
        (.state == "starting" or .state == "started")
      ' "$record" >/dev/null 2>&1; then
        record_valid=false
      fi

      if [ "$record_valid" = true ]; then
        session=$(jq -r .sessionId "$record")
        cli=$(jq -r .chromeCli "$record")
        runtime=$(jq -r .runtimeDir "$record")
        xdg=$(jq -r .xdgRuntimeDir "$record")
        if [ -n "$xdg" ]; then
          expected_runtime="$(realpath -m "$xdg")/chrome-devtools-mcp-$session"
        else
          expected_runtime="/tmp/chrome-devtools-mcp-$session-${UID}"
        fi
        if [ ! -x "$cli" ] || [ "$runtime" != "$expected_runtime" ] ||
          [ "$(realpath -m "$runtime")" != "$runtime" ]; then
          record_valid=false
        fi
      fi

      if [ "$record_valid" != true ]; then
        mkdir -p "$quarantine/$key"
        chmod 0700 "$quarantine" "$quarantine/$key"
        quarantined="$quarantine/$key/${record_name}.invalid.$$.$RANDOM"
        mv -f "$record" "$quarantined"
        chmod 0600 "$quarantined"
        # A malformed record may still name a live browser daemon we cannot
        # parse and therefore cannot stop. Quarantine preserves the evidence,
        # but cleanup must not report success or drop the manifest mapping:
        # fail this key so teardown surfaces the possible leak. A later GC pass
        # no longer sees the quarantined record and can complete, so cleanup is
        # flagged once rather than wedged forever.
        key_ok=false
        overall_ok=false
        flock -u 7
        echo "quarantined invalid browser session registry record: $quarantined" >&2
        continue
      fi

      # Claim the record atomically, then release the registry lock before the
      # bounded external stop command. The manifest is already not-ready when
      # lifecycle teardown calls this function, so no new verifier can join.
      mkdir -p "$reclaim/$key"
      chmod 0700 "$reclaim" "$reclaim/$key"
      claimed="$reclaim/$key/$record_name"
      mv -f "$record" "$claimed"
      flock -u 7

      stop_ok=false
      if [ -n "$xdg" ]; then
        if timeout --signal=TERM --kill-after=5s "${CAPSULE_BROWSER_STOP_TIMEOUT_SECONDS}s" \
          env XDG_RUNTIME_DIR="$xdg" "$cli" stop --sessionId "$session" >/dev/null 2>&1; then
          stop_ok=true
        fi
      elif timeout --signal=TERM --kill-after=5s "${CAPSULE_BROWSER_STOP_TIMEOUT_SECONDS}s" \
        env -u XDG_RUNTIME_DIR "$cli" stop --sessionId "$session" >/dev/null 2>&1; then
        stop_ok=true
      fi

      # A non-zero stop for an already-absent runtime is idempotent success.
      # When stop succeeds, remove any stale runtime directory ourselves.
      if [ "$stop_ok" = true ]; then
        rm -rf "$runtime"
      fi
      if [ ! -e "$runtime" ]; then
        rm -f "$claimed"
      else
        key_ok=false
        overall_ok=false
        exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
        flock -x 7
        mkdir -p "$sessions/$key"
        chmod 0700 "$sessions" "$sessions/$key"
        [ -e "$record" ] || mv -f "$claimed" "$record"
        flock -u 7
        break
      fi
    done

    exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
    flock -x 7
    if [ "$key_ok" = true ]; then
      rmdir "$sessions/$key" "$reclaim/$key" 2>/dev/null || true
      if [ ! -d "$sessions/$key" ] && [ ! -d "$reclaim/$key" ]; then
        rm -f "$mapping"
      else
        key_ok=false
        overall_ok=false
      fi
    fi
    flock -u 7
  done
  exec 7>"$CAPSULE_BROWSER_REGISTRY_ROOT/.lock"
  flock -x 7
  rmdir "$sessions" "$manifests" "$reclaim" 2>/dev/null || true
  flock -u 7
  [ "$overall_ok" = true ]
}
