#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

CAPSULE_HEALTH_TIMEOUT_SECONDS=180
CAPSULE_BASELINE_EXCLUDES=()
CAPSULE_FIXTURE_HASHES_JSON=$(capsule_hash_file_map \
  seed "$ROOT/fixtures/hi-events/seed.mjs")
CAPSULE_BOOTSTRAP_HASHES_JSON=$(capsule_hash_file_map \
  compatibility "$CAPSULE_DIR/patches/source-dev.patch")
capsule_install_compose_common_hooks

wait_for_application() {
  local container deadline=$((SECONDS + CAPSULE_HEALTH_TIMEOUT_SECONDS))
  container=$(capsule_compose ps -q app) || return
  [ -n "$container" ] || return 1
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null)" = healthy ] &&
    curl -fsS --max-time 3 "$CAPSULE_BASE_URL/auth/login" | grep -F 'id="app"' >/dev/null; do
    [ "$SECONDS" -lt "$deadline" ] || {
      capsule_compose logs --no-color app >&2 || true
      return 1
    }
    sleep 1
  done
}

wait_for_postgres() {
  # On a fresh volume the postgres image first runs a temporary init server
  # (socket only, listen_addresses='') to create POSTGRES_DB, then restarts as
  # the real server. A socket pg_isready answers OK during that temp phase, so a
  # caller could connect mid-restart and hit "the database system is starting
  # up". Gate on the real server: pg_isready over TCP (which only the real server
  # opens) plus a trivial trusted-socket query that succeeds only once it is up.
  local deadline=$((SECONDS + 90))
  until capsule_compose exec -T postgres pg_isready -h 127.0.0.1 -U postgres -d hi_events >/dev/null 2>&1 &&
    capsule_compose exec -T postgres psql -U postgres -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "Hi.Events postgres did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

record_application_image() {
  local image_id image_reference
  image_reference=$(capsule_compose config --images | grep -Fx "$CAPSULE_COMPOSE_PROJECT-app") || {
    echo "Hi.Events build did not resolve its Compose application image" >&2
    return 1
  }
  image_id=$(docker image inspect --format '{{.Id}}' "$image_reference") || return
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "Hi.Events build did not produce a content-addressed application image" >&2
    return 1
  }
  CAPSULE_IMAGE_DIGESTS_JSON=$(jq -c --arg image "$image_id" '. + {application:$image}' \
    <<<"$CAPSULE_IMAGE_DIGESTS_JSON")
  CAPSULE_RUNTIME_REVISION=$image_id
  export CAPSULE_IMAGE_DIGESTS_JSON CAPSULE_RUNTIME_REVISION
}

# The oracle reads $CAPSULE_PRIVATE_DIR/fixture.json (seeded event identity) for
# every probe. The cold path writes it via seed.mjs; a warm restore recovers it
# as a bundle member. Validate its schema and the pinned, deterministic event
# identifiers (seed.mjs asserts the same 1/webmcp-community-workshop identity)
# before accepting warm, so a stale or malformed cached fixture forces a full
# cold seed instead of a run that reaches "prepared" but cannot be observed.
hi_events_fixture_valid() {  # <fixture.json>; 0 = schema + identity OK
  jq -e '
    .schemaVersion == 1 and
    .event.id == 1 and .event.slug == "webmcp-community-workshop" and
    .event.title == "WebMCP Community Workshop" and .event.status == "LIVE" and
    .actor.email == "organizer@webmcp-eval.test" and
    (.organizer.id | type == "number") and
    (.category.id | type == "number") and (.product.id | type == "number")
  ' "$1" >/dev/null 2>&1 || {
    echo "Hi.Events cached fixture failed schema/identity validation" >&2
    return 1
  }
}

capsule_prepare() {
  local warm=false
  capsule_clone_source
  capsule_vendor_sdk
  mkdir -p "$CAPSULE_PRIVATE_DIR/evaluator" "$CAPSULE_PRIVATE_DIR/reset-state"
  cp "$ROOT/fixtures/hi-events/seed.mjs" "$CAPSULE_PRIVATE_DIR/evaluator/seed.mjs"
  chmod 0500 "$CAPSULE_PRIVATE_DIR/evaluator/seed.mjs"
  git -C "$CAPSULE_WORKSPACE" apply --check "$CAPSULE_DIR/patches/source-dev.patch"
  git -C "$CAPSULE_WORKSPACE" apply "$CAPSULE_DIR/patches/source-dev.patch"
  capsule_write_runbook
  capsule_render_compose_overlay
  capsule_compose config --quiet
  # The upstream multi-stage Dockerfile runs both the strict frontend production
  # build and Composer's optimized production install. This is the final gate;
  # the resulting image is then run with evaluator-patched source-dev mounts.
  capsule_compose build app
  record_application_image
  # The harness clones under a private umask, while PHP and its workers use
  # www-data. Restore repository read/traverse semantics on PHP source mounts.
  chmod -R u=rwX,go=rX \
    "$CAPSULE_WORKSPACE/backend/app" \
    "$CAPSULE_WORKSPACE/backend/config" \
    "$CAPSULE_WORKSPACE/backend/database" \
    "$CAPSULE_WORKSPACE/backend/public" \
    "$CAPSULE_WORKSPACE/backend/resources" \
    "$CAPSULE_WORKSPACE/backend/routes"

  # Warm path only when both baked reset artifacts restore from the prepare
  # cache: the seeded PostgreSQL dump and the storage/framework-cache tar. A
  # partial hit mixes artifact generations, so wipe the restored pieces and fall
  # back to the full cold boot + seed.
  #
  # Exclude the built application image's config id from the cache key. BuildKit
  # stamps a fresh `created` timestamp on every image export, so two fully-cached
  # builds of identical layers still export different config ids (verified: cold
  # and warm builds of the same source differ). That id is a redundant,
  # non-reproducible output — the image content is already pinned in the key by
  # the source revision, the base-image digests, and the evaluator fixtures. The
  # engine keeps the full digests (with `application`) for its own per-phase
  # image validation; only this cache lookup drops it. capsule_capture_reset_state
  # strips it identically on the store side so restore and store resolve the same
  # stable key across runs.
  # fixture.json is the seeded event identity every oracle probe reads. It is a
  # member of the seeded-state bundle (all three restore atomically or none do)
  # AND its schema + pinned event identifiers are validated before warm is
  # accepted, so a warm restore can never reach "prepared" while leaving the
  # oracle unable to observe the seeded event.
  local full_digests=$CAPSULE_IMAGE_DIGESTS_JSON
  CAPSULE_IMAGE_DIGESTS_JSON=$(jq -c 'del(.application)' <<<"$full_digests")
  if capsule_prepare_cache_restore_bundle seeded-state \
    seeded-db.sql "$CAPSULE_PRIVATE_DIR/reset-warm/database.sql" \
    seeded-storage.tar "$CAPSULE_PRIVATE_DIR/reset-warm/storage.tar" \
    fixture.json "$CAPSULE_PRIVATE_DIR/fixture.json" \
    organizer-token "$CAPSULE_PRIVATE_DIR/evaluator/organizer-token" &&
    hi_events_fixture_valid "$CAPSULE_PRIVATE_DIR/fixture.json"; then
    warm=true
  else
    rm -rf "$CAPSULE_PRIVATE_DIR/reset-warm" "$CAPSULE_PRIVATE_DIR/fixture.json"
  fi
  CAPSULE_IMAGE_DIGESTS_JSON=$full_digests

  if [ "$warm" = true ]; then
    # Load the cached golden state into the fresh per-run volumes; the engine's
    # capsule_capture_reset_state then re-snapshots it into the reset artifacts.
    # Skips the app boot + seed.mjs. The app service is never started here, so
    # capsule_capture_reset_state's `stop app` is a no-op on it.
    capsule_compose up -d postgres redis
    wait_for_postgres
    hi_events_load_reset_state \
      "$CAPSULE_PRIVATE_DIR/reset-warm/database.sql" \
      "$CAPSULE_PRIVATE_DIR/reset-warm/storage.tar"
  else
    capsule_compose up -d app
    wait_for_application
    node "$CAPSULE_PRIVATE_DIR/evaluator/seed.mjs" \
      "$CAPSULE_BASE_URL" "$CAPSULE_PRIVATE_DIR/fixture.json"
  fi
}

capsule_capture_reset_state() {
  # Quiesce queue and scheduler writers before taking the canonical dump.
  capsule_compose stop app || return 1
  # Snapshot the persistent storage and framework-cache volumes. The database
  # dump alone leaves these untouched across reset, so uploaded assets and
  # derived caches written during a run would otherwise survive reset. A one-off
  # container from the app image (no deps) mounts the same named volumes to tar
  # them into an evaluator-private reset artifact.
  capsule_compose run --rm --no-deps -T --entrypoint sh app \
    -c 'cd /app/backend && tar -cf - storage bootstrap/cache' \
    > "$CAPSULE_PRIVATE_DIR/reset-state/storage.tar" || return 1
  chmod 0400 "$CAPSULE_PRIVATE_DIR/reset-state/storage.tar" || return 1
  capsule_compose exec -T postgres pg_dump \
    --username postgres --dbname hi_events --clean --if-exists \
    --no-owner --no-privileges > "$CAPSULE_PRIVATE_DIR/reset-state/database.sql" || return 1
  chmod 0400 "$CAPSULE_PRIVATE_DIR/reset-state/database.sql" || return 1
  # A prepared capsule is an inert artifact. Preserve the seeded volumes and
  # dump, but leave no publicly reachable app until the explicit `up` phase.
  capsule_compose stop postgres redis
  # Bake the seeded reset artifacts for warm prepare. This hook runs after
  # capsule_prepare on both paths; the store is a no-op when the entry already
  # exists (warm path). Stored only after the dump + tar above succeed, so a
  # failed capture never plants a warm cache; the store is best-effort and never
  # fails the capture. Strip the non-reproducible built-app image config id from
  # the key exactly as the restore side does (see capsule_prepare), so both
  # resolve the same stable cache key across runs.
  local full_digests=$CAPSULE_IMAGE_DIGESTS_JSON
  CAPSULE_IMAGE_DIGESTS_JSON=$(jq -c 'del(.application)' <<<"$full_digests")
  capsule_prepare_cache_store_bundle seeded-state \
    seeded-db.sql "$CAPSULE_PRIVATE_DIR/reset-state/database.sql" \
    seeded-storage.tar "$CAPSULE_PRIVATE_DIR/reset-state/storage.tar" \
    fixture.json "$CAPSULE_PRIVATE_DIR/fixture.json" \
    organizer-token "$CAPSULE_PRIVATE_DIR/evaluator/organizer-token"
  CAPSULE_IMAGE_DIGESTS_JSON=$full_digests
}

capsule_up() {
  # Reconcile dependency changes through the same final build gate while the
  # source mounts keep normal frontend/backend edits live in the dev runtime.
  capsule_compose build app
  record_application_image
  capsule_compose up -d --force-recreate app
}

# Shared reset-state loader: terminates connections, drops and recreates the
# database from the dump, flushes redis, then restores the storage and
# framework-cache volumes from the tar. Postgres and redis must already be up.
# Used by per-run reset (capsule_restore_reset_state) and by the warm prepare
# path, which loads the cached golden state so the engine can re-snapshot it.
hi_events_load_reset_state() {  # <database.sql> <storage.tar>
  capsule_compose exec -T postgres psql --username postgres --dbname postgres \
    --set ON_ERROR_STOP=1 --command \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'hi_events' AND pid <> pg_backend_pid();"
  capsule_compose exec -T postgres dropdb --username postgres --if-exists hi_events
  capsule_compose exec -T postgres createdb --username postgres hi_events
  capsule_compose exec -T postgres psql --username postgres --dbname hi_events \
    --set ON_ERROR_STOP=1 < "$1"
  capsule_compose exec -T redis redis-cli FLUSHALL >/dev/null
  # Restore the persistent storage and framework-cache volumes to their seeded
  # snapshot before the app comes up, clearing any run-written assets so they
  # cannot survive reset. A one-off container mounts the same named volumes.
  capsule_compose run --rm --no-deps -T --entrypoint sh app \
    -c 'set -e; cd /app/backend; find storage bootstrap/cache -mindepth 1 -delete 2>/dev/null || true; tar -xf -' \
    < "$2"
}

capsule_restore_reset_state() {
  [ -s "$CAPSULE_PRIVATE_DIR/reset-state/database.sql" ] || {
    echo "missing Hi.Events database reset dump" >&2
    return 1
  }
  [ -s "$CAPSULE_PRIVATE_DIR/reset-state/storage.tar" ] || {
    echo "missing Hi.Events storage reset snapshot" >&2
    return 1
  }
  capsule_compose stop app
  capsule_compose up -d postgres redis
  hi_events_load_reset_state \
    "$CAPSULE_PRIVATE_DIR/reset-state/database.sql" \
    "$CAPSULE_PRIVATE_DIR/reset-state/storage.tar"
  capsule_up
}

capsule_reset() {
  capsule_restore_reset_state
}
