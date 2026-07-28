#!/usr/bin/env bash

CAPSULE_CONFIG_PATH=capsule.yaml
# shellcheck source=../../harness/lib/site-adapter.sh
source "$ROOT/harness/lib/site-adapter.sh"
capsule_config_load

EASY_RESET_DUMP="$CAPSULE_PRIVATE_DIR/reset/easyappointments.sql"
EASY_STORAGE_DIR="$CAPSULE_PRIVATE_DIR/application-state/storage"
CAPSULE_HEALTH_TIMEOUT_SECONDS=120
CAPSULE_BASELINE_EXCLUDES=(vendor assets/vendor)
CAPSULE_FIXTURE_HASHES_JSON=$(capsule_hash_file_map \
  configuration "$ROOT/fixtures/easyappointments/config.php.template" \
  services-seed "$ROOT/fixtures/easyappointments/seed-services.sql")
CAPSULE_BOOTSTRAP_HASHES_JSON='{}'
capsule_install_compose_common_hooks

copy_pinned_dependencies() {
  local image
  image=$(capsule_image application)
  docker run --rm \
    --label "$CAPSULE_SITE_LABEL" --label "$CAPSULE_RUN_LABEL" --label "$CAPSULE_MANIFEST_LABEL" \
    --user "$(id -u):$(id -g)" \
    --entrypoint /bin/sh \
    --volume "$CAPSULE_WORKSPACE:/workspace:z" \
    "$image" -ec '
      test -f /workspace/composer.lock
      test -f /var/www/html/vendor/composer/installed.json
      test -f /var/www/html/vendor/autoload.php
      test -d /var/www/html/assets/vendor
      php -r '\''
        $lock = json_decode(file_get_contents("/workspace/composer.lock"), true, 512, JSON_THROW_ON_ERROR);
        $installed = json_decode(file_get_contents("/var/www/html/vendor/composer/installed.json"), true, 512, JSON_THROW_ON_ERROR);
        $packageSet = static function (array $packages): array {
          $result = array_map(static fn (array $package): array => [
            $package["name"],
            $package["version"],
            $package["source"]["reference"] ?? null,
          ], $packages);
          sort($result);
          return $result;
        };
        exit($packageSet($lock["packages"]) === $packageSet($installed["packages"]) ? 0 : 1);
      '\''
      mkdir -p /workspace/vendor
      cp -R /var/www/html/vendor/. /workspace/vendor/
      # The source checkout intentionally omits generated CSS and third-party
      # assets. Add only files absent from the author workspace so the pinned
      # image supplies build outputs without replacing editable source files.
      cp -Rn /var/www/html/assets/. /workspace/assets/
    '
}

wait_for_database() {
  local deadline=$((SECONDS + 90))
  until capsule_compose exec -T db env MYSQL_PWD=easyappointments-root \
    mysqladmin ping -h 127.0.0.1 -u root --silent >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "EasyAppointments MySQL did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

wait_for_application_process() {
  local deadline=$((SECONDS + 60))
  until capsule_compose exec -T app php --version >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "EasyAppointments application container did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

wait_for_application_http() {
  local deadline=$((SECONDS + 60))
  until curl -fsS --max-time 5 "$CAPSULE_BASE_URL/" | grep -F 'Easy!Appointments' >/dev/null; do
    [ "$SECONDS" -lt "$deadline" ] || {
      echo "EasyAppointments HTTP endpoint did not become ready" >&2
      return 1
    }
    sleep 1
  done
}

capsule_prepare() {
  capsule_clone_source
  capsule_vendor_sdk
  mkdir -p "$CAPSULE_PRIVATE_DIR/application-state" "$CAPSULE_PRIVATE_DIR/reset"
  cp -a "$CAPSULE_WORKSPACE/storage" "$EASY_STORAGE_DIR"
  sed "s|{{BASE_URL}}|$CAPSULE_BASE_URL|g" \
    "$ROOT/fixtures/easyappointments/config.php.template" > "$CAPSULE_WORKSPACE/config.php"
  chmod -R a+rX "$CAPSULE_WORKSPACE"
  chmod -R a+rwX "$EASY_STORAGE_DIR"
  copy_pinned_dependencies

  capsule_write_runbook
  capsule_render_compose_overlay
  capsule_compose config --quiet
  capsule_compose up -d db
  wait_for_database
  capsule_compose up -d app
  wait_for_application_process
  if capsule_prepare_cache_restore installed-db.sql "$CAPSULE_PRIVATE_DIR/reset/installed-db.sql"; then
    capsule_compose exec -T db env MYSQL_PWD=easyappointments-root \
      mysql -u root easyappointments < "$CAPSULE_PRIVATE_DIR/reset/installed-db.sql"
  else
    capsule_compose exec -T app php index.php console install
    # WINDTUNNEL: enrich fixture with a named business + 3 real services
    capsule_compose exec -T db env MYSQL_PWD=easyappointments-root \
      mysql -u root easyappointments < "$ROOT/fixtures/easyappointments/seed-services.sql"
    # Cache-only staging: the installed-db dump that feeds the warm cache is
    # created and stored only when the prepare cache is enabled, so proof-mode
    # (cache off) stays byte-identical to pre-cache behavior and seals no extra
    # reset artifact under reset/.
    if capsule_prepare_cache_enabled; then
      capsule_compose exec -T db env MYSQL_PWD=easyappointments-root \
        mysqldump -u root --single-transaction --routines --triggers easyappointments \
        > "$CAPSULE_PRIVATE_DIR/reset/installed-db.sql"
      capsule_prepare_cache_store installed-db.sql "$CAPSULE_PRIVATE_DIR/reset/installed-db.sql"
    fi
  fi
  wait_for_application_http
}

capsule_capture_reset_state() {
  capsule_compose stop app >/dev/null
  # PHP creates cache/session files as www-data with owner-only modes. The
  # evaluator snapshots this private bind mount as the host user after the app
  # is stopped, so use the pinned application image as root to make the
  # completed state tree readable before archiving it.
  capsule_compose run --rm --no-deps --entrypoint /bin/chmod app \
    -R a+rX /var/www/html/storage >/dev/null
  capsule_compose exec -T db env MYSQL_PWD=easyappointments-root \
    mysqldump -u root --single-transaction --routines --triggers easyappointments > "$EASY_RESET_DUMP"
  [ -s "$EASY_RESET_DUMP" ] || {
    echo "EasyAppointments reset dump is empty" >&2
    return 1
  }
  chmod 0400 "$EASY_RESET_DUMP"
  capsule_compose stop db >/dev/null
  capsule_snapshot_directory easyappointments-storage "$EASY_STORAGE_DIR"
}

capsule_up() {
  capsule_compose up -d --force-recreate db
  wait_for_database
  capsule_compose up -d --force-recreate app
}

capsule_restore_reset_state() {
  [ -s "$EASY_RESET_DUMP" ] || {
    echo "EasyAppointments reset dump is missing" >&2
    return 1
  }
  capsule_compose_down
  capsule_restore_directory_snapshot easyappointments-storage "$EASY_STORAGE_DIR"
  chmod -R a+rwX "$EASY_STORAGE_DIR"
  capsule_compose up -d db
  wait_for_database
  capsule_compose exec -T db env MYSQL_PWD=easyappointments-root \
    mysql -u root easyappointments < "$EASY_RESET_DUMP"
  capsule_compose up -d --force-recreate app
}

capsule_reset() {
  capsule_restore_reset_state
}
