#!/usr/bin/env bash

compose_exec() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" exec -T "$@"
}

database_observation() {
  compose_exec db mongo --quiet idurar --eval '
    print(JSON.stringify({
      administrators: db.admins.countDocuments({removed:false}),
      clients: db.clients.countDocuments({removed:false}),
      clientNames: db.clients.find({removed:false},{_id:0,name:1}).sort({name:1}).toArray().map(function(client) { return client.name; }),
      invoices: db.invoices.countDocuments({removed:false}),
      payments: db.payments.countDocuments({removed:false})
    }))
  '
}

invoice_api() {
  local selector=$1 token
  token=$(tr -d '\r\n' < "$CAPSULE_PRIVATE_DIR/evaluator/api-token")
  [ -n "$token" ] || {
    echo "IDURAR evaluator API token is missing" >&2
    return 1
  }
  compose_exec gateway node --input-type=module -e '
    const selector = JSON.parse(process.argv[1]);
    const token = process.argv[2];
    const origin = "http://backend:8888";
    const response = await fetch(`${origin}/api/invoice/list?items=100&page=1`, {
      headers:{authorization:`Bearer ${token}`}
    });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(`invoice list failed: ${response.status}`);
    let invoices = body.result || [];
    if (selector.id) invoices = invoices.filter(item => item._id === selector.id);
    if (selector.number !== null) invoices = invoices.filter(item => item.number === selector.number);
    const normalized = invoices.map(item => ({
      id:item._id, number:item.number, year:item.year, status:item.status,
      client:item.client ? {id:item.client._id,name:item.client.name,email:item.client.email} : null,
      total:item.total, taxTotal:item.taxTotal, paymentStatus:item.paymentStatus,
      items:(item.items || []).map(line => ({name:line.itemName,quantity:line.quantity,price:line.price,total:line.total}))
    }));
    process.stdout.write(JSON.stringify({httpStatus:response.status,count:normalized.length,invoices:normalized}));
  ' "$selector" "$token"
}

observe() {
  local probe=$1 arguments=$2 path body status selector
  case "$probe" in
    invoices)
      selector=$(jq -ec '{id:(.id // null),number:(.number // null)} |
        select((.id == null or (.id | type == "string" and test("^[0-9a-f]{24}$"))) and
          (.number == null or (.number | type == "number" and floor == .)))' <<<"$arguments")
      invoice_api "$selector"
      ;;
    database)
      database_observation
      ;;
    rename_client)
      jq -e '.from == "Acme Evaluation" and .to == "WebMCP Reset Sentinel"' <<<"$arguments" >/dev/null || {
        echo "unsupported IDURAR client mutation" >&2
        return 2
      }
      local affected observation
      affected=$(compose_exec db mongo --quiet idurar --eval '
        var result = db.clients.updateOne(
          {name:"Acme Evaluation",removed:false},
          {$set:{name:"WebMCP Reset Sentinel"}}
        );
        print(result.modifiedCount !== undefined ? result.modifiedCount : result.nModified);
      ' | tail -n 1)
      [[ "$affected" =~ ^[0-9]+$ ]] || {
        echo "IDURAR mutation did not return an affected-row count" >&2
        return 1
      }
      observation=$(database_observation)
      jq --argjson affectedRows "$affected" '. + {affectedRows:$affectedRows}' <<<"$observation"
      ;;
    page)
      path=$(jq -er '.path // "/login" | select(. == "/login" or . == "/invoice" or . == "/invoice/create" or . == "/customer")' <<<"$arguments")
      body=$(mktemp)
      status=$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "$CAPSULE_BASE_URL$path")
      jq -n --arg path "$path" --argjson status "$status" --rawfile body "$body" \
        '{path:$path,status:$status,spaRoot:($body | contains("id=\"root\"")),bytes:($body | length)}'
      rm -f "$body"
      ;;
    reset_boundary)
      jq -n '{strategy:"database-dump",database:"mongodb",serverState:["administrators","clients","invoices","payments"],browserState:"fresh-context",actor:"administrator",authenticatedPath:"/invoice"}'
      ;;
    *)
      echo "unknown probe: $probe" >&2
      return 2
      ;;
  esac
}
