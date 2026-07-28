#!/usr/bin/env bash

# The observe harness runs this oracle under `set -e`, so a curl/jq failure
# mid-probe aborts before the per-branch `rm -f "$body"` runs. Track temp
# response files and clean them on subshell exit so none leak.
_oracle_tmpfiles=()
trap '[ "${#_oracle_tmpfiles[@]}" -eq 0 ] || rm -f "${_oracle_tmpfiles[@]}"' EXIT

compose_exec() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" exec -T "$@"
}

hi_fixture() {
  [ -f "$CAPSULE_PRIVATE_DIR/fixture.json" ] || {
    echo "Hi.Events fixture metadata is missing" >&2
    return 1
  }
  jq -er "$1" "$CAPSULE_PRIVATE_DIR/fixture.json"
}

observe() {
  local probe=$1 arguments=$2 path body status event_id event_slug sql token
  event_id=$(hi_fixture '.event.id')
  event_slug=$(hi_fixture '.event.slug')
  case "$probe" in
    page)
      path=$(jq -r '.path // "/auth/login"' <<<"$arguments")
      case "$path" in
        /auth/login|/auth/register|/manage/events|"/event/$event_id/$event_slug") ;;
        *) echo "unsupported page observation: $path" >&2; return 2 ;;
      esac
      body=$(mktemp); _oracle_tmpfiles+=("$body")
      status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "$CAPSULE_BASE_URL$path")
      jq -n --arg path "$path" --argjson status "$status" --rawfile body "$body" \
        '{path:$path,status:$status,ssrRoot:($body | contains("id=\"app\"")),bytes:($body | length)}'
      rm -f "$body"
      ;;
    public_event)
      body=$(mktemp); _oracle_tmpfiles+=("$body")
      status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' \
        "$CAPSULE_BASE_URL/api/public/events/$event_id")
      jq -n --argjson status "$status" --slurpfile response "$body" \
        '{status:$status,event:{id:$response[0].data.id,title:$response[0].data.title,
          slug:$response[0].data.slug,status:$response[0].data.status,
          currency:$response[0].data.currency,
          products:([$response[0].data.product_categories[]?.products[]?] | length)}}'
      rm -f "$body"
      ;;
    actor_login)
      body=$(mktemp); _oracle_tmpfiles+=("$body")
      status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' \
        -H 'content-type: application/json' \
        --data '{"email":"organizer@webmcp-eval.test","password":"WebmcpEval123!"}' \
        "$CAPSULE_BASE_URL/api/auth/login")
      jq -n --argjson status "$status" --slurpfile response "$body" \
        '{status:$status,authenticated:($response[0].token_type == "bearer"),
          actor:{email:$response[0].user.email,accounts:($response[0].accounts | length)}}'
      rm -f "$body"
      ;;
    hide_event)
      sql="UPDATE events SET status = 'DRAFT', updated_at = NOW() WHERE id = $event_id RETURNING json_build_object('eventId', id, 'status', status);"
      body=$(compose_exec postgres psql --username postgres --dbname hi_events \
        --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --command "$sql")
      compose_exec redis redis-cli FLUSHALL >/dev/null
      status=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
        "$CAPSULE_BASE_URL/api/public/events/$event_id")
      jq -c --argjson publicStatus "$status" '. + {publicStatus:$publicStatus}' <<<"$body"
      ;;
    database)
      sql="SELECT json_build_object('event', json_build_object('id', e.id, 'title', e.title, 'status', e.status, 'currency', e.currency), 'organizer', json_build_object('id', o.id, 'name', o.name, 'email', o.email), 'products', (SELECT count(*) FROM products p WHERE p.event_id = e.id), 'free_products', (SELECT count(*) FROM products p WHERE p.event_id = e.id AND p.type = 'FREE')) FROM events e JOIN organizers o ON o.id = e.organizer_id WHERE e.id = $event_id;"
      compose_exec postgres psql --username postgres --dbname hi_events \
        --tuples-only --no-align --command "$sql" | jq -c .
      ;;
    orders)
      token=$(tr -d '\r\n' < "$CAPSULE_PRIVATE_DIR/evaluator/organizer-token")
      [ -n "$token" ] || { echo "Hi.Events evaluator token is missing" >&2; return 1; }
      body=$(mktemp); _oracle_tmpfiles+=("$body")
      curl -fsS --max-time 10 -H "authorization: Bearer $token" \
        "$CAPSULE_BASE_URL/api/events/$event_id/orders?limit=100" > "$body"
      jq '{orders:(.data // .orders // []) | length}' "$body"
      rm -f "$body"
      ;;
    reset_boundary)
      jq -n --argjson eventId "$event_id" \
        '{strategy:"database-dump",database:"PostgreSQL",eventId:$eventId,
          browserState:"fresh verifier browser context",actor:"organizer",
          actorSetup:"actors/organizer.js",authenticatedPath:"/manage/events"}'
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
