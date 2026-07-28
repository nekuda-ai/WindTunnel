#!/usr/bin/env bash

compose_exec() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" exec -T "$@"
}

course_state() {
  local row seeded public_published
  row=$(compose_exec db psql -At -U learnhouse -d learnhouse -F '|' -c \
    "select count(*) filter (where name = 'Evaluation Foundations'), count(*) filter (where name = 'Evaluation Foundations' and public is true and published is true) from course;")
  IFS='|' read -r seeded public_published <<<"$row"
  jq -n --argjson seeded "$seeded" --argjson publicPublished "$public_published" \
    '{seeded:$seeded,publicPublished:$publicPublished,courseName:"Evaluation Foundations"}'
}

observe() {
  local probe=$1
  case "$probe" in
    courses)
      course_state
      ;;
    hide_course)
      compose_exec db psql -v ON_ERROR_STOP=1 -q -U learnhouse -d learnhouse -c \
        "update course set published = false where name = 'Evaluation Foundations';" >/dev/null
      compose_exec redis redis-cli FLUSHALL >/dev/null
      course_state
      ;;
    page)
      local body status
      body=$(mktemp)
      status=$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' \
        "$CAPSULE_BASE_URL/orgs/phase-one/courses")
      jq -n --argjson status "$status" --rawfile body "$body" \
        '{status:$status,hasSeedCourse:($body | contains("Evaluation Foundations")),bytes:($body | length)}'
      rm -f "$body"
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
