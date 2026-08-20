#!/usr/bin/env bash

compose_exec() {
  "$ROOT/harness/bin/compose" --project-name "$CAPSULE_COMPOSE_PROJECT" \
    --file "$CAPSULE_PRIVATE_DIR/compose.yaml" exec -T "$@"
}

mongo_observation() {
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

# The two dropdowns the visible create-invoice and record-payment flows cannot
# be submitted without. Both are fed by SelectAsync -> request.list, i.e.
# GET <entity>/list — NOT listAll — so this asserts the endpoint the UI really
# calls. `paymentMode` is spelled exactly as the frontend spells it: the route
# is registered lowercase ("paymentmode", from the model filename via
# models/utils) and only Express's default case-insensitive routing makes the
# camelCase request match. Asserting the camelCase path keeps that assumption
# under test instead of leaving it to chance. Counting rows in mongo would not
# prove any of this — before the compatibility repair the rows could not exist
# and the routes were never registered at all.
ui_defaults_api() {
  local token
  token=$(tr -d '\r\n' < "$CAPSULE_PRIVATE_DIR/evaluator/api-token")
  [ -n "$token" ] || {
    echo "IDURAR evaluator API token is missing" >&2
    return 1
  }
  compose_exec gateway node --input-type=module -e '
    const token = process.argv[1];
    const origin = "http://backend:8888";
    const fetchList = async (entity) => {
      const response = await fetch(`${origin}/api/${entity}/list?items=100&page=1`, {
        headers:{authorization:`Bearer ${token}`}
      });
      let body = null;
      try { body = await response.json(); } catch { /* non-JSON means a missing route */ }
      const rows = (body && body.success && Array.isArray(body.result)) ? body.result : [];
      const enabled = rows.filter(row => row.removed !== true && row.enabled !== false);
      // Count the isDefault flag rather than treating a lone enabled row as the
      // default: acceptance claims "exactly one seeded default", so assert that
      // and not merely "one usable option".
      const defaults = enabled.filter(row => row.isDefault === true);
      return {status: response.status, options: enabled.length, defaults: defaults.length, default: defaults[0] ?? null};
    };
    const taxes = await fetchList("taxes");
    // camelCase on purpose — this is the spelling SelectAsync sends.
    const paymentModes = await fetchList("paymentMode");
    process.stdout.write(JSON.stringify({
      taxListStatus: taxes.status,
      taxOptions: taxes.options,
      taxDefaults: taxes.defaults,
      defaultTaxName: taxes.default ? taxes.default.taxName : null,
      defaultTaxValue: taxes.default ? Number(taxes.default.taxValue) : null,
      paymentModeListStatus: paymentModes.status,
      paymentModeOptions: paymentModes.options,
      paymentModeDefaults: paymentModes.defaults,
      defaultPaymentModeName: paymentModes.default ? paymentModes.default.name : null
    }));
  ' "$token"
}

database_observation() {
  local mongo_json api_json
  mongo_json=$(mongo_observation) || return 1
  api_json=$(ui_defaults_api) || return 1
  jq -es '.[0] * .[1]' <<<"$mongo_json"$'\n'"$api_json"
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

# id-7 names an amount (100) and a reference (EVAL-100). The invoice record
# carries neither — paymentStatus flips to "partially" for any payment from 1 to
# 249, and the reference lives on the payment. Resolve the invoice by number,
# then return its payments so the predicate can assert what the task asked for.
payments_api() {
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
    const headers = {authorization:`Bearer ${token}`};
    const invoiceResponse = await fetch(`${origin}/api/invoice/list?items=100&page=1`, {headers});
    const invoiceBody = await invoiceResponse.json();
    if (!invoiceResponse.ok || !invoiceBody.success) throw new Error(`invoice list failed: ${invoiceResponse.status}`);
    const invoice = (invoiceBody.result || []).find(item => item.number === selector.number);
    if (!invoice) {
      process.stdout.write(JSON.stringify({httpStatus:invoiceResponse.status,found:false,number:selector.number,count:0,payments:[]}));
    } else {
      const paymentResponse = await fetch(`${origin}/api/payment/list?items=100&page=1`, {headers});
      const paymentBody = await paymentResponse.json();
      if (!paymentResponse.ok || !paymentBody.success) throw new Error(`payment list failed: ${paymentResponse.status}`);
      // payment.invoice is an id, or a populated invoice object depending on the list shape.
      const idOf = (value) => (value && typeof value === "object") ? String(value._id) : String(value);
      const payments = (paymentBody.result || [])
        .filter(payment => payment.removed !== true && idOf(payment.invoice) === String(invoice._id))
        .map(payment => ({number:payment.number, amount:payment.amount, ref:payment.ref ?? "", description:payment.description ?? ""}));
      process.stdout.write(JSON.stringify({
        httpStatus:paymentResponse.status, found:true, number:invoice.number,
        paymentStatus:invoice.paymentStatus, credit:invoice.credit ?? 0, total:invoice.total,
        count:payments.length, payments
      }));
    }
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
    payments)
      selector=$(jq -ec '{number:(.number // null)} |
        select(.number != null and (.number | type == "number" and floor == .))' <<<"$arguments")
      payments_api "$selector"
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
