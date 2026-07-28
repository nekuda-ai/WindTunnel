#!/usr/bin/env bash

observe() {
  local probe=$1 arguments=$2 path body status
  case "$probe" in
    page)
      path=$(jq -r '.path // "/"' <<<"$arguments")
      case "$path" in
        /|/auth/login|/auth/register|/app/discussions) ;;
        *) echo "unsupported page observation: $path" >&2; return 2 ;;
      esac
      body=$(mktemp)
      status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "$CAPSULE_BASE_URL$path")
      jq -n --arg path "$path" --argjson status "$status" --rawfile body "$body" \
        '{path:$path,status:$status,spaRoot:($body | contains("id=\"root\"")),bytes:($body | length)}'
      rm -f "$body"
      ;;
    reset_boundary)
      jq -n '{strategy:"browser-context",persistentServerState:false,
        actor:"member",actorSetup:"actors/member.js",authenticatedPath:"/app/discussions"}'
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
