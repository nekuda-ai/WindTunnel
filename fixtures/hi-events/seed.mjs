import {writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

const [baseUrl, outputPath] = process.argv.slice(2);
if (!baseUrl || !outputPath) {
  throw new Error('usage: seed.mjs BASE_URL OUTPUT_PATH');
}

async function request(path, {method = 'GET', token, body} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : {'content-type': 'application/json'}),
      ...(token ? {authorization: `Bearer ${token}`} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {raw: text};
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return {payload, headers: response.headers};
}

const registration = await request('/api/auth/register', {
  method: 'POST',
  body: {
    first_name: 'WebMCP',
    last_name: 'Organizer',
    email: 'organizer@webmcp-eval.test',
    password: 'WebmcpEval123!',
    password_confirmation: 'WebmcpEval123!',
    timezone: 'UTC',
    currency_code: 'USD',
    locale: 'en',
    marketing_opt_in: false,
  },
});
const token = registration.headers.get('x-auth-token');
if (!token) throw new Error('registration returned no X-Auth-Token');

const organizer = (await request('/api/organizers', {
  method: 'POST',
  token,
  body: {
    name: 'WebMCP Community',
    email: 'organizer@webmcp-eval.test',
    description: 'A deterministic local organizer for WebMCP tool evaluation.',
    timezone: 'UTC',
    currency: 'USD',
  },
})).payload.data;

// Publish the organizer's public homepage. A newly created organizer defaults to
// DRAFT, so GET /api/public/organizers/{id} returns 404 and the public organizer
// page — the site's only event-listing surface — renders "not found". Set it LIVE
// (same account-verified status endpoint the event uses) so the organizer homepage
// and its listing are publicly reachable.
await request(`/api/organizers/${organizer.id}/status`, {
  method: 'PUT',
  token,
  body: {status: 'LIVE'},
});

const event = (await request('/api/events', {
  method: 'POST',
  token,
  body: {
    title: 'WebMCP Community Workshop',
    description: `<p>The WebMCP Community Workshop is a free, hands-on meetup for developers exploring the WebMCP browser-tooling standard. Doors open thirty minutes before the first session.</p><h2>Schedule</h2><p>10:00 welcome and introductions. 10:15 live-coding a WebMCP tool from scratch. 11:00 short break. 11:15 building state-conditioned tools and the false-negative battery. 11:50 open questions. 12:00 wrap-up.</p><h2>Venue and directions</h2><p>The workshop runs online and is streamed to the WebMCP Community hall. A calendar link with the join URL is emailed with every ticket, so there is no physical address — join from any browser.</p><h2>Tickets and pricing</h2><p>General admission is free. One ticket admits one attendee, and you may book up to four per order for a group.</p><h2>Refund and transfer policy</h2><p>Free tickets carry no charge, so there is nothing to refund. If you cannot attend, release your ticket so the seat returns to the pool; tickets are transferable by forwarding your confirmation email.</p><h2>Accessibility</h2><p>Live captions are enabled for every session and a recording is shared afterward. Email the organizer for any specific accommodation.</p><h2>Age policy</h2><p>All ages are welcome; attendees under sixteen should join with a parent or guardian.</p><h2>Recording policy</h2><p>Sessions are recorded and shared with registered attendees only. Cameras are optional.</p>`,
    start_date: '2035-06-15 10:00:00',
    end_date: '2035-06-15 12:00:00',
    timezone: 'UTC',
    organizer_id: organizer.id,
    currency: 'USD',
    category: 'TECH',
  },
})).payload.data;
if (event.id !== 1 || event.slug !== 'webmcp-community-workshop') {
  throw new Error(`non-deterministic event identity: expected 1/webmcp-community-workshop, got ${event.id}/${event.slug}`);
}

// Keep the structured venue consistent with the description prose. Without
// is_online_event the API reports venue "TBA" while the description says the
// workshop runs online — an agent reading the structured field faithfully
// answers TBA and fails hev-1 for it. PATCH is the partial-update route; PUT
// replaces the whole settings object.
await request(`/api/events/${event.id}/settings`, {
  method: 'PATCH',
  token,
  body: {is_online_event: true},
});

const category = (await request(`/api/events/${event.id}/product-categories`, {
  method: 'POST',
  token,
  body: {
    name: 'Workshop tickets',
    description: 'Admission to the WebMCP workshop.',
    is_hidden: false,
    no_products_message: null,
  },
})).payload.data;

const product = (await request(`/api/events/${event.id}/products`, {
  method: 'POST',
  token,
  body: {
    title: 'General admission',
    description: 'One free workshop ticket.',
    type: 'FREE',
    product_type: 'TICKET',
    initial_quantity_available: 100,
    prices: [{price: 0, initial_quantity_available: 100, is_hidden: false}],
    min_per_order: 1,
    max_per_order: 4,
    product_category_id: category.id,
    is_hidden: false,
    hide_when_sold_out: true,
    show_quantity_remaining: true,
  },
})).payload.data;

const liveEvent = (await request(`/api/events/${event.id}/status`, {
  method: 'PUT',
  token,
  body: {status: 'LIVE'},
})).payload.data;

const publicEvent = (await request(`/api/public/events/${event.id}`)).payload.data;
if (publicEvent.status !== 'LIVE' || publicEvent.title !== 'WebMCP Community Workshop') {
  throw new Error('seeded event is not publicly observable as LIVE');
}

const fixture = {
  schemaVersion: 1,
  actor: {
    accountId: registration.payload.data.id,
    email: 'organizer@webmcp-eval.test',
  },
  organizer: {
    id: organizer.id,
    name: organizer.name,
    slug: organizer.slug,
  },
  event: {
    id: liveEvent.id,
    title: liveEvent.title,
    slug: liveEvent.slug,
    status: liveEvent.status,
    currency: liveEvent.currency,
  },
  category: {id: category.id, name: category.name},
  product: {id: product.id, title: product.title, type: product.type},
};
await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, {mode: 0o600});
await writeFile(join(dirname(outputPath), 'evaluator', 'organizer-token'), `${token}\n`, {mode: 0o600});
