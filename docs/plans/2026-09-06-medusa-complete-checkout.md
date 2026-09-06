# Medusa `complete_checkout` WebMCP Tool — Board v1.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let WebMCP agents finish guest checkout on the Medusa store (task `md-8`) through a single `complete_checkout` tool, re-measure `md-8` for the eight WebMCP configurations, and publish the change as board **v1.1** with a changelog.

**Architecture:** The store's WebMCP tools live in a golden patch (`goldens/nextjs-starter-medusa.reference.patch`) that the capsule applies to the pinned storefront (`medusajs/nextjs-starter-medusa@9818886f`). We add one server action (`completeCheckout`) that calls the storefront's *own* checkout code path — `updateCart` (addresses + email) → `setShippingMethod` → `initiatePaymentSession` → `sdk.store.cart.complete` — and one client-side tool that wraps it and navigates to the confirmation page. Only WebMCP arms see tools, so only their `md-8` cells are re-run; `combined-explorer` lets the new dirs win those 8 cells.

**Tech Stack:** unified diff (regenerated with `git diff`, never hand-edited), Next.js server actions, Medusa JS SDK, Node 20+ `node --test`, Docker Desktop for the one live check, existing scripts `combined-explorer.mjs`, `readme-charts.mjs`, `smoke-gate.mjs`.

**Branch / worktree:** continue on `bench/astra-gpt-6` at `/Users/idanlevin/In Progress/WindTunnel-astra` (the Astra work is committed; this lands in the same PR as "v1.1" — see Task 9).

**Decisions already made (2026-09-06, with Idan):** one `complete_checkout` tool (not stepwise); re-run `md-8` for WebMCP configurations only; existing rows stay in history; changelog in repo now, on webmcp.com afterwards.

---

## Context a fresh engineer needs

- The storefront is cloned by the capsule at prepare time; **its source is not in this repo.** To edit the golden patch you clone the pinned revision yourself (Task 1), apply the current patch, edit, and regenerate the patch with `git diff`. Hand-editing `.patch` hunks breaks `git apply --check`.
- Storefront checkout API (verified against `src/lib/data/cart.ts` and `payment.ts` at the pinned revision):
  - `retrieveCart(cartId?)`, `updateCart(data: HttpTypes.StoreUpdateCart)` (reads cart id from cookies), `listCartOptions()` → `{ shipping_options }`, `setShippingMethod({ cartId, shippingMethodId })`, `initiatePaymentSession(cart, { provider_id })`, `listCartPaymentMethods(regionId)` → providers sorted by id (or `null`).
  - `placeOrder()` calls `redirect()` on success and returns nothing useful, so the action uses `sdk.store.cart.complete(id, {}, headers)` directly (that is exactly what `placeOrder` wraps) and does its own `revalidateTag` + `removeCartId()`.
  - Cookie/cache helpers: `getAuthHeaders, getCacheTag, getCartId, removeCartId` from `@lib/data/cookies`; `sdk` from `@lib/config`; `medusaError` from `@lib/util/medusa-error`.
- Patch conventions (read `goldens/nextjs-starter-medusa.reference.patch` `src/lib/webmcp/tools.ts` section): tools return `ok(payload)` / `fail(message, extra)`; `cc()` gives the country prefix; `navigateSoon(nav, path)` navigates after the result is delivered; `summarizeCart(cart)` exists; tool groups are registered in `provider.tsx` via `useEffect` + `registerAll`, Group C (cart tools) is dropped on checkout pages.
- Scoring: `md-8`'s predicate is `probe: database, assert: { contains: { orders: 1 } }` — the oracle counts rows in the SQL `"order"` table (`capsules/nextjs-starter-medusa/oracle.sh`). Final text is ignored.
- WebMCP arms are told to use tools exclusively (`arms/prompts.mjs` `MECHANICS.webmcp`). Do not change that.
- **Live findings (Task 3, 2026-09-06):** the store offers **two** shipping options (Standard Shipping €10 + one more) and one payment provider, so `complete_checkout` returns the shipping choices on the first call and places the order on the second call with `shipping_option_id` — agents need two calls, which the tool description tells them. Also: `search_products` navigates ~150 ms after returning; a caller that fires `add_to_cart` before that navigation lands makes the router drop the cart refresh and the cart-conditioned tools never register. Agents never hit this (they think for seconds between calls); tests must wait for the navigation.
- **Registration race (first Task 6 iteration, discarded):** with `complete_checkout` in a cart-conditioned group, one Luna attempt called `begin_checkout` (navigates) and then `complete_checkout` ~300 ms later and got `tool "complete_checkout" is not available` — the group was being torn down/re-registered across the route change. 23/24 attempts passed anyway, but a site-side race that penalizes WebMCP is not acceptable, so the tool now registers with the always-on group (Group A) and fails cleanly on an empty cart. The eight configurations were re-run against the corrected golden; the first iteration is archived outside the repo.

---

## Task 0: Scratch clone of the storefront (no repo changes)

**Step 1: Clone the pinned revision and apply the current golden**

```bash
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
W=/private/tmp/claude-501/-Users-idanlevin-In-Progress/9a8e746e-c32c-435d-bdf2-961d64bcd033/scratchpad/medusa-storefront
rm -rf "$W" && git clone -q https://github.com/medusajs/nextjs-starter-medusa.git "$W" && git -C "$W" checkout -q 9818886f06e493cb2249733d114d339aa216ef00
git -C "$W" apply --check "$PWD/goldens/nextjs-starter-medusa.reference.patch" && git -C "$W" apply "$PWD/goldens/nextjs-starter-medusa.reference.patch" && git -C "$W" add -A && git -C "$W" commit -q -m "golden v1.0 applied" && echo applied
```

Expected: `applied`. If `--check` fails, stop — the golden no longer matches the pinned revision and that must be understood first.

**Step 2: Confirm the storefront's checkout API is what this plan assumes**

```bash
grep -n "export async function \(updateCart\|setShippingMethod\|initiatePaymentSession\|listCartOptions\|retrieveCart\)\|export const listCartPaymentMethods" "$W/src/lib/data/cart.ts" "$W/src/lib/data/payment.ts"
grep -n "export.*removeCartId\|export.*getCacheTag\|export.*getAuthHeaders" "$W/src/lib/data/cookies.ts"
```

Expected: one hit per name.

---

## Task 1: The server action `completeCheckout`

**Files:**
- Create (in the scratch clone; lands in the patch): `src/lib/webmcp/checkout-actions.ts`

**Step 1: Write the action**

```ts
"use server"

import { sdk } from "@lib/config"
import medusaError from "@lib/util/medusa-error"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import {
  initiatePaymentSession,
  listCartOptions,
  retrieveCart,
  setShippingMethod,
  updateCart,
} from "@lib/data/cart"
import { getAuthHeaders, getCacheTag, removeCartId } from "@lib/data/cookies"
import { listCartPaymentMethods } from "@lib/data/payment"

export type CheckoutInput = {
  email: string
  first_name: string
  last_name: string
  address_1: string
  address_2?: string
  city: string
  postal_code: string
  province?: string
  country_code: string
  phone?: string
  shipping_option_id?: string
  payment_provider_id?: string
}

export type CheckoutResult =
  | {
      ok: true
      order: {
        order_id: string
        display_id: number | undefined
        total: number | undefined
        currency_code: string | undefined
        items: { title: string; variant: string | undefined; quantity: number }[]
        shipping_address: Record<string, unknown> | undefined
        payment_provider: string | undefined
        confirmation_path: string
      }
    }
  | { ok: false; step: string; error: string; choices?: unknown }

/**
 * Guest checkout through the storefront's own data path — the same calls the
 * checkout page makes (updateCart → setShippingMethod → initiatePaymentSession
 * → cart.complete). Shipping and payment are chosen automatically only when
 * there is exactly one option; otherwise the choices are returned so the
 * caller can pick.
 */
export async function completeCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const cart = await retrieveCart()
  if (!cart?.items?.length) return { ok: false, step: "cart", error: "The cart is empty — add items before checking out." }
  if (cart.completed_at) return { ok: false, step: "cart", error: "This cart was already completed." }

  const address = {
    first_name: input.first_name,
    last_name: input.last_name,
    address_1: input.address_1,
    address_2: input.address_2 ?? "",
    city: input.city,
    postal_code: input.postal_code,
    province: input.province ?? "",
    country_code: input.country_code.toLowerCase(),
    phone: input.phone ?? "",
  }
  try {
    await updateCart({ email: input.email, shipping_address: address, billing_address: address })
  } catch (e: any) {
    return { ok: false, step: "address", error: e?.message ?? "could not set addresses" }
  }

  const { shipping_options: options = [] } = await listCartOptions()
  const shippingId = input.shipping_option_id ?? (options.length === 1 ? options[0].id : undefined)
  if (!shippingId) {
    return { ok: false, step: "shipping", error: "Choose a shipping option and call again with shipping_option_id.", choices: options.map((o) => ({ id: o.id, name: o.name, amount: o.amount })) }
  }
  try {
    await setShippingMethod({ cartId: cart.id, shippingMethodId: shippingId })
  } catch (e: any) {
    return { ok: false, step: "shipping", error: e?.message ?? "could not set shipping method" }
  }

  const providers = (await listCartPaymentMethods(cart.region_id ?? "")) ?? []
  const providerId = input.payment_provider_id ?? (providers.length === 1 ? providers[0].id : undefined)
  if (!providerId) {
    return { ok: false, step: "payment", error: "Choose a payment provider and call again with payment_provider_id.", choices: providers.map((p) => ({ id: p.id })) }
  }
  try {
    const fresh = (await retrieveCart(cart.id)) ?? cart
    await initiatePaymentSession(fresh, { provider_id: providerId })
  } catch (e: any) {
    return { ok: false, step: "payment", error: e?.message ?? "could not start payment session" }
  }

  const headers = { ...(await getAuthHeaders()) }
  const res = await sdk.store.cart
    .complete(cart.id, {}, headers)
    .then(async (r) => { revalidateTag(await getCacheTag("carts")); return r })
    .catch(medusaError)
  if (res?.type !== "order") {
    return { ok: false, step: "place_order", error: (res as any)?.error?.message ?? "the store did not accept the order" }
  }
  revalidateTag(await getCacheTag("orders"))
  removeCartId()
  const o = res.order as HttpTypes.StoreOrder
  const country = o.shipping_address?.country_code?.toLowerCase() ?? input.country_code.toLowerCase()
  return {
    ok: true,
    order: {
      order_id: o.id,
      display_id: o.display_id,
      total: o.total,
      currency_code: o.currency_code,
      items: (o.items ?? []).map((i) => ({ title: i.product_title ?? i.title, variant: i.variant_title ?? undefined, quantity: i.quantity })),
      shipping_address: o.shipping_address as Record<string, unknown> | undefined,
      payment_provider: providerId,
      confirmation_path: `/${country}/order/${o.id}/confirmed`,
    },
  }
}
```

**Step 2: Type-check inside the clone** (the storefront has its own toolchain)

```bash
cd "$W" && (test -d node_modules || yarn install --frozen-lockfile --silent 2>/dev/null || npm ci --silent) && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "checkout-actions|error TS" | head -20
```

Expected: no lines mentioning `checkout-actions.ts`. Fix type errors here (field names come from `@medusajs/types` `StoreOrder`/`StoreCartShippingOption`); this is the cheapest place to catch them.

---

## Task 2: The `complete_checkout` tool + registration

**Files (in the scratch clone):**
- Modify: `src/lib/webmcp/tools.ts` — add `buildCheckoutTools`, update `begin_checkout`'s note
- Modify: `src/lib/webmcp/provider.tsx` — Group D registration

**Step 1: In `tools.ts`, import the action and add the tool group at the end of the file**

```ts
import { completeCheckout } from "./checkout-actions"

// ---------------------------------------------------------------------------
// Group D — checkout (registered whenever the cart has items, including on the
// checkout page). v1.1: before this, the tools handed off at begin_checkout and
// no WebMCP agent could finish a purchase.
// ---------------------------------------------------------------------------

export function buildCheckoutTools(nav: Navigator): WebMcpTool[] {
  return [
    {
      name: "complete_checkout",
      description:
        "Complete guest checkout for the current cart in one step: sets the contact email and shipping/billing address, picks the shipping option and payment provider (automatically when the store offers exactly one of each, otherwise returns the choices so you can pass shipping_option_id / payment_provider_id), places the order, and returns the order confirmation (order id, display number, total, items). Use after add_to_cart; begin_checkout is not required.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          email: { type: "string" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          address_1: { type: "string", description: "Street address" },
          address_2: { type: "string" },
          city: { type: "string" },
          postal_code: { type: "string" },
          province: { type: "string", description: "State / province / county, if any" },
          country_code: { type: "string", description: "ISO 3166-1 alpha-2, e.g. 'gb'" },
          phone: { type: "string" },
          shipping_option_id: { type: "string", description: "Only needed when the store offers several shipping options" },
          payment_provider_id: { type: "string", description: "Only needed when the store offers several payment providers" },
        },
        required: ["email", "first_name", "last_name", "address_1", "city", "postal_code", "country_code"],
      },
      annotations: { readOnlyHint: false },
      async execute(args: Parameters<typeof completeCheckout>[0]) {
        try {
          const result = await completeCheckout(args)
          if (!result.ok) return fail(result.error, { step: result.step, ...(result.choices ? { choices: result.choices } : {}) })
          navigateSoon(nav, result.order.confirmation_path)
          return ok({ order: result.order, note: "Order placed. The page is navigating to the confirmation." })
        } catch (e: any) {
          return fail(e?.message ?? "complete_checkout failed")
        }
      },
    },
  ]
}
```

**Step 2: Update `begin_checkout`'s result note** (same file) — replace
`note: "Checkout opened with the cart preserved. The user completes address, delivery and payment steps in the page UI.",`
with
`note: "Checkout opened with the cart preserved. Call complete_checkout with the buyer's details to place the order.",`
and in its `description` append: ` To place the order use complete_checkout.`

**Step 3: In `provider.tsx`, import and register Group D**

Add `buildCheckoutTools` to the import from `./tools`, and after the Group C effect:

```tsx
  // Group D — checkout, available whenever the cart has items (also inside checkout)
  useEffect(() => {
    const ctx = getModelContext()
    if (!ctx?.registerTool || !hasCartItems) return
    const controller = new AbortController()
    registerAll(ctx, buildCheckoutTools(navRef.current), controller.signal)
    return () => controller.abort()
  }, [hasCartItems])
```

**Step 4: Type-check again** — same command as Task 1 Step 2. Expected: clean.

**Step 5: Regenerate the golden patch and verify it applies to a pristine clone**

```bash
cd "$W" && git add -A && git diff --no-color HEAD~1 > "/Users/idanlevin/In Progress/WindTunnel-astra/goldens/nextjs-starter-medusa.reference.patch"
cd "/Users/idanlevin/In Progress/WindTunnel-astra"
V=$(mktemp -d) && git clone -q https://github.com/medusajs/nextjs-starter-medusa.git "$V" && git -C "$V" checkout -q 9818886f06e493cb2249733d114d339aa216ef00 && git -C "$V" apply --check goldens/nextjs-starter-medusa.reference.patch && echo "golden applies cleanly" && rm -rf "$V"
grep -c "complete_checkout" goldens/nextjs-starter-medusa.reference.patch
```

Expected: `golden applies cleanly`, count ≥ 3 (tool name, description, provider import). The diff is against the *pristine* revision (HEAD~1 is the pristine checkout; HEAD is "golden v1.0 applied"), so the new patch contains v1.0 + v1.1 in one.

**Step 6: Commit**

```bash
git add goldens/nextjs-starter-medusa.reference.patch
git commit -m "feat(medusa golden): complete_checkout tool — WebMCP agents can finish guest checkout (board v1.1)"
```

---

## Task 3: Live check against the real capsule (Docker, ~3 min, $0)

There is no unit-testable surface for a golden patch; the one runnable check boots the capsule and drives the tool through the same bridge the arms use.

**Files:**
- Create: `tests/medusa-checkout.live.test.mjs` (skipped unless `WT_LIVE_CAPSULE=1`)

**Step 1: Write the test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { bootCapsule } from "../harness/capsule.mjs";
import { executeBridgeTool, listLiveTools, prepareWebMCPPage } from "../arms/wm-claude.mjs";

// Boots the real Medusa capsule with the WebMCP golden applied and completes a
// guest checkout through complete_checkout — the md-8 journey — then checks the
// oracle sees exactly one order. Needs Docker; skipped by default.
const live = process.env.WT_LIVE_CAPSULE === "1";
test("medusa: complete_checkout places one order that the database probe sees", { skip: !live, timeout: 15 * 60_000 }, async () => {
  const capsule = await bootCapsule("nextjs-starter-medusa", { port: 3299, runId: "wt-live-checkout", env: { ...process.env, WT_WEBMCP: "1" } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await prepareWebMCPPage(page, capsule.baseUrl);
    const found = await executeBridgeTool(page, "search_products", { query: "Medusa T-Shirt" });
    const product = JSON.parse(found.content[0].text).products[0];
    const variant = product.variants.find((v) => /L/.test(v.title) && /Black/i.test(v.title)) ?? product.variants[0];
    await executeBridgeTool(page, "add_to_cart", { variant_id: variant.variant_id, quantity: 1 });
    await page.waitForFunction(() => globalThis.__wtModelContextBridge.list().some((t) => t.name === "complete_checkout"), null, { timeout: 15_000 });
    assert.ok((await listLiveTools(page)).some((t) => t.name === "complete_checkout"));
    const done = JSON.parse((await executeBridgeTool(page, "complete_checkout", {
      email: "jane.tester@example.test", first_name: "Jane", last_name: "Tester", address_1: "1 High Street",
      city: "London", postal_code: "N1 9GU", country_code: "gb", phone: "+44 20 7946 0000",
    })).content[0].text);
    assert.ok(done.order?.order_id, JSON.stringify(done));
    const db = await capsule.observe("database");
    assert.equal(db.orders, 1, JSON.stringify(db));
  } finally {
    await browser.close();
    await capsule.down();
  }
});
```

Read `capsules/nextjs-starter-medusa/oracle.sh` first: confirm the `database` probe's JSON key for the order count is `orders` and adjust the assertion if not. Read `search_products`'s result shape in the golden (`products[].variants[].variant_id`) and adjust the two property paths if they differ.

**Step 2: Run it** (Docker Desktop running, coreutils on PATH, Mac unlocked or `credsStore` disabled)

```bash
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
WT_LIVE_CAPSULE=1 WT_WEBMCP=1 node --test tests/medusa-checkout.live.test.mjs 2>&1 | tail -15
```

Expected: `pass 1`. If `complete_checkout` never appears in the tool list, the provider registration is wrong; if it appears but fails at a step, the result's `step` + `error` say where.

**Step 3: Run the normal suite (the live test is skipped there) and commit**

```bash
npm test 2>&1 | tail -4
git add tests/medusa-checkout.live.test.mjs && git commit -m "test(medusa): live check that complete_checkout places one order"
```

---

## Task 4: Task file, spec, changelog

**Files:**
- Modify: `tasks/nextjs-starter-medusa.yaml` (md-8 comment)
- Modify: `docs/SPEC.md` §6 (Medusa tool list / hand-off sentence)
- Create: `CHANGELOG.md`
- Modify: `README.md` (link the changelog; fix the coverage-boundary sentence at ~line 144–146)

**Step 1: `tasks/nextjs-starter-medusa.yaml`** — replace the three comment lines under md-8 with:

```yaml
    # v1.0 tools handed off at begin_checkout, so no WebMCP configuration could
    # finish this task while screen-driving agents could (community feedback,
    # 2026-09-06). v1.1 adds complete_checkout; WebMCP md-8 cells re-measured.
```

**Step 2: `CHANGELOG.md`**

```markdown
# WindTunnel changelog

## v1.1 — 2026-09-06

**Feedback we received:** the Medusa store's WebMCP tools stopped at `begin_checkout`, so none of the eight WebMCP configurations could complete task `md-8` (guest checkout), while screenshot and code-execution agents could finish it on the page. That made 48/49 the ceiling for WebMCP by construction — a limitation of one demo store's tool surface, not of the approach.

**What changed:** the store now exposes `complete_checkout` (address + contact → shipping → payment → place order, through the storefront's own checkout code). `md-8` was re-run, three attempts each, for all eight WebMCP configurations: <fill after Task 6: before → after per configuration>. No other cell changed. Screen-driving rows are untouched (they never see tools).

**Also in this release:** GPT-6 Astra added as three configurations (WebMCP, screenshots, and OpenAI's recommended code-execution path, a new interface class); harness fixes disclosed in `results/canonical/PROVENANCE.md` (keypress chords, cache-write pricing, capsule step timeouts).

## v1.0 — 2026-08-20

Initial canonical board: 16 configurations, 2,352 attempts.
```

**Step 3: `docs/SPEC.md` §6** — in the Medusa row / tools paragraph, list `complete_checkout` and add: *"v1.1: `complete_checkout` added after feedback; see CHANGELOG.md."*

**Step 4: `README.md`** — the sentence *"today's WebMCP tools hand guest checkout back to the page before the final purchase, so computer use completes that one task more often"* becomes *"until v1.1 the store's WebMCP tools handed guest checkout back to the page (see CHANGELOG.md)"* — and the numbers in that paragraph are refreshed in Task 8. Add a `CHANGELOG.md` link next to the canonical-artifacts links.

**Step 5: Commit**

```bash
git add tasks/nextjs-starter-medusa.yaml CHANGELOG.md docs/SPEC.md README.md
git commit -m "docs: v1.1 changelog — complete_checkout on the Medusa store; md-8 history"
```

---

## Task 5: Smoke one WebMCP configuration on md-8 ($0.10)

```bash
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
node --env-file=.env harness/cli.mjs --preset smoke --sites nextjs-starter-medusa --arms wm-gpt --model wm-gpt=gpt-5.6-luna --task-ids md-8 --n 1 --budget 1 --label v11-smoke-md8
node scripts/smoke-gate.mjs $(ls -d results/*-v11-smoke-md8 | tail -1) --model gpt-5.6-luna
```

Expected: gate passes and the row **passes** (`success=true`); the transcript shows `search_products → add_to_cart → complete_checkout` and a final answer with the order number. If the agent never calls `complete_checkout`, read its discovery entries — the tool must be listed after `add_to_cart`. Commit the smoke dir with `git add -f` + a `PROVENANCE.md` line, per repo convention.

---

## Task 6: Re-run md-8 for the eight WebMCP configurations (~$3, ~40 min)

One flight per configuration (the CLI takes one `--model arm=model` per arm). Sequential; Docker; Mac unlocked.

```bash
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
for cfg in "wm-gpt gpt-5.6-luna" "wm-gpt gpt-5.6-sol" "wm-gpt gpt-6-astra" "wm-claude claude-sonnet-5" "wm-claude claude-opus-5" "wm-gemini gemini-3.6-flash" "wm-stagehand-v4 claude-sonnet-5" "wm-stagehand-v4-gemini gemini-3.6-flash"; do
  set -- $cfg
  node --env-file=.env harness/cli.mjs --preset full --sites nextjs-starter-medusa --arms $1 --model $1=$2 --task-ids md-8 --n 3 --budget 3 --label v11-md8-$1-$2 || echo "FAILED $cfg"
done
```

Post-flight: for each dir, `node scripts/smoke-gate.mjs <dir> --model <model>`; confirm 3 rows, 0 infra. Record pass counts. Commit all eight dirs:

```bash
git add results/*-v11-md8-* && git commit -m "results: v1.1 md-8 re-measured for the eight WebMCP configurations (complete_checkout)"
```

Fill the CHANGELOG "before → after" line (before is 0/3 for every configuration) and commit.

---

## Task 7: Merge into the canonical board and regenerate charts

Same ordering rule as the Astra plan: old sources, Astra dirs, **v1.1 dirs**, then `2026-08-20-scorer-corrections` last.

```bash
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
OLD=($(sed -n 's/^[0-9]*\. //p' results/canonical/PROVENANCE.md))          # now 46 entries: 41 old + 3 astra + ... check
# Build explicitly from the current PROVENANCE: everything except scorer-corrections, then the v1.1 dirs, then scorer-corrections.
SRC=($(sed -n 's/^[0-9]*\. //p' results/canonical/PROVENANCE.md | grep -v scorer-corrections))
V11=($(find results -maxdepth 1 -name '*-v11-md8-*' -exec basename {} \; | sort))
[ ${#V11[@]} -eq 8 ] || { echo "expected 8 v1.1 dirs"; exit 1; }
node scripts/combined-explorer.mjs --out canonical --expect-configs 19 "${SRC[@]}" "${V11[@]}" 2026-08-20-scorer-corrections
node scripts/readme-charts.mjs
```

Expected: PROVENANCE shows the eight `wm-* × model` configurations sourcing their `md-8` cell from a `v11-md8-*` dir; still 19 configurations, 2,793 rows. Charts regenerate (the 48/49 tie should become a 49/49 group if all eight pass). Commit:

```bash
git add results/canonical assets/charts && git commit -m "results: canonical board v1.1 — md-8 WebMCP cells re-measured with complete_checkout"
```

---

## Task 8: Documentation with v1.1 numbers

Follow the Astra plan's Task 8 (`docs/plans/2026-09-05-astra-benchmark.md`) — README leaderboard (19 rows), counts (19 / 2,793 / 931), model-comparison, results index, SPEC, HF rebuild — computing every number from `results/canonical/results.csv` after Task 7. Add the sentence the md-8 review asked for: name `md-8`, say the v1.0 ceiling was by construction and what v1.1 changed. Note in the README "Eight configurations tie at 48/49" is now stale — rewrite from the data.

---

## Task 9: PR

One PR on `bench/astra-gpt-6`: "GPT-6 Astra (3 configurations) + board v1.1: Medusa complete_checkout" — body from the Astra plan's Task 9 plus the CHANGELOG v1.1 entry. **Ask before pushing.** Do not upload to Hugging Face without an explicit go-ahead.

---

## After the PR (not in this repo)

webmcp.com benchmark page: add a "Changelog / feedback we received" section with the v1.1 entry verbatim, refresh the table (19 rows, new scores), and the Astra rows. Hand Idan the exact text and the score table from Task 8.
