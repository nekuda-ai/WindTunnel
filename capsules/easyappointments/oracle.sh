#!/usr/bin/env bash

compose_exec() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" exec -T "$@"
}

database_observation() {
  compose_exec db env MYSQL_PWD=easyappointments-root mysql --batch --raw --skip-column-names \
    -u root easyappointments -e "SELECT JSON_OBJECT(
      'administrators', (SELECT COUNT(*) FROM ea_users u JOIN ea_roles r ON r.id = u.id_roles WHERE r.slug = 'admin'),
      'providers', (SELECT COUNT(*) FROM ea_users u JOIN ea_roles r ON r.id = u.id_roles WHERE r.slug = 'provider'),
      'services', (SELECT COUNT(*) FROM ea_services),
      'serviceNames', (SELECT JSON_ARRAYAGG(name) FROM ea_services),
      'customers', (SELECT COUNT(*) FROM ea_users u JOIN ea_roles r ON r.id = u.id_roles WHERE r.slug = 'customer'),
      'appointments', (SELECT COUNT(*) FROM ea_appointments WHERE is_unavailability = 0)
    )"
}

observe() {
  local probe=$1 arguments=$2 id endpoint body path status
  case "$probe" in
    appointments)
      id=$(jq -er '.id // "" | select(. == "" or (type == "number" and floor == . and . > 0))' <<<"$arguments")
      endpoint="$CAPSULE_BASE_URL/index.php/api/v1/appointments"
      [ -z "$id" ] || endpoint="$endpoint/$id"
      body=$(mktemp)
      curl -fsS --max-time 15 --user administrator:administrator \
        "$endpoint?with=customer,service,provider&length=100" > "$body"
      jq '
        if type == "array" then {count:length,appointments:.}
        else {count:1,appointments:[.]}
        end |
        .appointments |= map({
          id,start:(.start // .start_datetime),end:(.end // .end_datetime),notes,
          service:(.service | if type == "object" then {id,name} else . end),
          provider:(.provider | if type == "object" then {id,firstName:(.firstName // .first_name),lastName:(.lastName // .last_name),email} else . end),
          customer:(.customer | if type == "object" then {id,firstName:(.firstName // .first_name),lastName:(.lastName // .last_name),email} else . end)
        })' "$body"
      rm -f "$body"
      ;;
    database)
      database_observation
      ;;
    rename_service)
      jq -e '.from == "Service" and .to == "WebMCP Reset Sentinel"' <<<"$arguments" >/dev/null || {
        echo "unsupported EasyAppointments service mutation" >&2
        return 2
      }
      local affected observation
      affected=$(compose_exec db env MYSQL_PWD=easyappointments-root mysql --batch --raw --skip-column-names \
        -u root easyappointments -e "UPDATE ea_services SET name = 'WebMCP Reset Sentinel' WHERE name = 'Service'; SELECT ROW_COUNT();" | tail -n 1)
      [[ "$affected" =~ ^[0-9]+$ ]] || {
        echo "EasyAppointments mutation did not return an affected-row count" >&2
        return 1
      }
      observation=$(database_observation)
      jq --argjson affectedRows "$affected" '. + {affectedRows:$affectedRows}' <<<"$observation"
      ;;
    page)
      path=$(jq -er '.path // "/" | select(. == "/" or . == "/index.php/login" or . == "/index.php/calendar")' <<<"$arguments")
      body=$(mktemp)
      status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "$CAPSULE_BASE_URL$path")
      jq -n --arg path "$path" --argjson status "$status" --rawfile body "$body" \
        '{path:$path,status:$status,hasApplication:($body | contains("Easy!Appointments")),bytes:($body | length)}'
      rm -f "$body"
      ;;
    reset_boundary)
      jq -n '{strategy:"database-dump",database:"mysql",supplementalState:"storage-directory-snapshot",serverState:["appointments","customers","services","providers","settings"],browserState:"fresh-context",actor:"administrator",authenticatedPath:"/calendar"}'
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
