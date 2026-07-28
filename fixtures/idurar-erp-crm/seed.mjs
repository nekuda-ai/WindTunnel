const origin = process.argv[2] || 'http://backend:8888';
const now = new Date();
const invoiceDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 16, 9));
const expiredDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15, 9));

async function json(path, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok || body.success !== true) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

const login = await json('/api/login', {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({email: 'admin@admin.com', password: 'admin123', remember: true}),
});
const headers = {
  'content-type': 'application/json',
  authorization: `Bearer ${login.result.token}`,
};
const client = await json('/api/client/create', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: 'Acme Evaluation',
    email: 'billing@acme.example.test',
    phone: '+1 555 0100',
    country: 'United States',
    address: '100 Evaluation Way',
  }),
});

await json('/api/invoice/create', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    client: client.result._id,
    // The create API *requires* a `number` field (Joi validation) but assigns
    // its own sequence regardless of the value sent — omitting it 400s the
    // cold seed ("number" is required), and sending 1001 misled task authors
    // into referencing an invoice number that never exists (id-7 was
    // unwinnable because of that). Send 1: required-field-satisfied, and it
    // matches what the API actually assigns.
    number: 1,
    year: 2026,
    status: 'draft',
    notes: 'Deterministic local evaluation invoice',
    date: invoiceDate.toISOString(),
    expiredDate: expiredDate.toISOString(),
    items: [
      {
        itemName: 'WebMCP Evaluation Service',
        description: 'Local fixture item',
        quantity: 2,
        price: 125,
        total: 250,
      },
    ],
    taxRate: 0,
  }),
});

if (invoiceDate.getUTCMonth() !== now.getUTCMonth()) throw new Error('seed invoice date is not in the current month');

process.stdout.write(JSON.stringify({token: login.result.token}));
