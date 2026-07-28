#!/usr/bin/env bash

compose_exec() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" exec -T app "$@"
}

observe() {
  local probe=$1 arguments=$2 slug
  case "$probe" in
    catalog)
      compose_exec node /evaluator/inspect-db.mjs /state/local.db
      ;;
    bookmark)
      slug=$(jq -er '.slug | select(type == "string" and test("^[a-z0-9-]+$"))' <<<"$arguments")
      compose_exec node /evaluator/inspect-db.mjs /state/local.db "$slug"
      ;;
    delete_bookmark)
      slug=$(jq -er '.slug | select(type == "string" and test("^[a-z0-9-]+$"))' <<<"$arguments")
      compose_exec node /evaluator/mutate-db.mjs /state/local.db "$slug" >/dev/null
      compose_exec node /evaluator/inspect-db.mjs /state/local.db
      ;;
    page)
      local path body status
      path=$(jq -r '.path // "/"' <<<"$arguments")
      case "$path" in
        /|/github|'/?category=development') ;;
        *) echo "unsupported page observation: $path" >&2; return 2 ;;
      esac
      body=$(mktemp)
      status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "$CAPSULE_BASE_URL$path")
      jq -n --arg path "$path" --argjson status "$status" --rawfile body "$body" \
        '{path:$path,status:$status,hasGitHub:($body | contains("GitHub")),bytes:($body | length)}'
      rm -f "$body"
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
