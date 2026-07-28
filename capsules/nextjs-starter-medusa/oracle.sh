#!/usr/bin/env bash

compose_exec() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" exec -T "$@"
}

publishable_key() {
  tr -d '\r\n' < "$CAPSULE_PRIVATE_DIR/fixture/publishable-key"
}

store_api() {
  local endpoint=$1 key
  key=$(publishable_key)
  compose_exec backend node -e '
    const [endpoint, key] = process.argv.slice(1);
    fetch(`http://127.0.0.1:9000${endpoint}`, {headers:{"x-publishable-api-key":key}})
      .then(async response => {
        const body = await response.text();
        if (!response.ok) throw new Error(`${response.status}: ${body}`);
        process.stdout.write(body);
      })
      .catch(error => { console.error(error.message); process.exit(1); });
  ' "$endpoint" "$key"
}

database_state() {
  compose_exec db psql -U medusa -d medusa -At -v ON_ERROR_STOP=1 -c \
    "SELECT json_build_object(
      'products', (SELECT count(*) FROM product WHERE deleted_at IS NULL),
      'carts', (SELECT count(*) FROM cart WHERE deleted_at IS NULL),
      'orders', (SELECT count(*) FROM \"order\"),
      'publishableKeys', (SELECT count(*) FROM api_key WHERE type = 'publishable' AND deleted_at IS NULL)
    )"
}

observe() {
  local probe=$1 arguments=$2 path handle body status
  case "$probe" in
    catalog)
      store_api '/store/products?limit=100' |
        jq '{count:(.products | length),products:[.products[] | {id,title,handle}] | sort_by(.handle)}'
      ;;
    product)
      handle=$(jq -er '.handle | select(type == "string" and test("^[a-z0-9-]+$"))' <<<"$arguments")
      store_api "/store/products?handle=$handle" |
        jq --arg handle "$handle" '{handle:$handle,count:(.products | length),products:.products}'
      ;;
    database)
      database_state
      ;;
    soft_delete_product)
      handle=$(jq -er '.handle | select(type == "string" and test("^[a-z0-9-]+$"))' <<<"$arguments")
      compose_exec db psql -U medusa -d medusa -v ON_ERROR_STOP=1 -q -c \
        "UPDATE product SET deleted_at = NOW() WHERE handle = '$handle' AND deleted_at IS NULL" >/dev/null
      database_state
      ;;
    page)
      path=$(jq -r '.path // "/gb/store"' <<<"$arguments")
      case "$path" in
        /gb/store|/gb/products/t-shirt|/gb/cart) ;;
        *) echo "unsupported page observation: $path" >&2; return 2 ;;
      esac
      body=$(mktemp)
      status=$(curl -sS --max-time 15 -o "$body" -w '%{http_code}' "$CAPSULE_BASE_URL$path")
      jq -n --arg path "$path" --argjson status "$status" --rawfile body "$body" \
        '{path:$path,status:$status,hasStoreChrome:($body | contains("Store")),hasTShirt:($body | contains("T-Shirt")),bytes:($body | length)}'
      rm -f "$body"
      ;;
    reset_boundary)
      jq -n '{strategy:"database-dump",database:"postgresql",serverState:["catalog","carts","customers","orders"],browserState:"fresh-context",browserStateReason:"Medusa cart identity is held in an HTTP cookie",actor:"anonymous"}'
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
