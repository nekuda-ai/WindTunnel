#!/usr/bin/env bash

fetch_page_observation() {
  local path=$1 body status
  body=$(mktemp)
  status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "$CAPSULE_BASE_URL$path")
  jq -n --arg path "$path" --argjson status "$status" --rawfile body "$body" '{
    path:$path,
    status:$status,
    bytes:($body | length),
    hasLatest:($body | contains("Latest")),
    hasCodeSample:($body | contains("Sample .md file"))
  }'
  rm -f "$body"
}

observe() {
  local probe=$1 arguments=$2 path
  case "$probe" in
    page)
      path=$(jq -r '.path // "/"' <<<"$arguments")
      case "$path" in
        /|/blog/code-sample/) fetch_page_observation "$path" ;;
        *) echo "unsupported page observation: $path" >&2; return 2 ;;
      esac
      ;;
    content)
      jq -n \
        --slurpfile home <(fetch_page_observation /) \
        --slurpfile article <(fetch_page_observation /blog/code-sample/) \
        '{home:$home[0],article:$article[0]}'
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
