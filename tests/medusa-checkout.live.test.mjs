import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { bootCapsule } from "../harness/capsule.mjs";
import { executeBridgeTool, listLiveTools, prepareWebMCPPage } from "../arms/wm-claude.mjs";

// Boots the real Medusa capsule with the WebMCP golden applied and completes a
// guest checkout through complete_checkout — the md-8 journey — then checks the
// oracle sees exactly one order. Needs Docker; skipped unless WT_LIVE_CAPSULE=1.
const live = process.env.WT_LIVE_CAPSULE === "1";
const text = (result) => JSON.parse(result.content[0].text);

test("medusa: complete_checkout places one order that the database probe sees", { skip: !live, timeout: 15 * 60_000 }, async () => {
  const capsule = await bootCapsule("nextjs-starter-medusa", { port: 3299, runId: "wt-live-checkout", env: { ...process.env, WT_WEBMCP: "1" } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await prepareWebMCPPage(page, capsule.baseUrl);
    const before = await capsule.observe("database");
    assert.equal(before.orders, 0, `fresh capsule should have no orders: ${JSON.stringify(before)}`);

    const found = text(await executeBridgeTool(page, "search_products", { query: "Medusa T-Shirt" }));
    const product = found.products[0];
    const variant = product.variants.find((v) => /\bL\b/.test(v.title) && /black/i.test(v.title)) ?? product.variants[0];
    await executeBridgeTool(page, "add_to_cart", { variant_id: variant.variant_id, quantity: 1 });
    await page.waitForFunction(() => globalThis.__wtModelContextBridge.list().some((t) => t.name === "complete_checkout"), null, { timeout: 15_000 });
    assert.ok((await listLiveTools(page)).some((t) => t.name === "complete_checkout"), "complete_checkout must register once the cart has items");

    const done = text(await executeBridgeTool(page, "complete_checkout", {
      email: "jane.tester@example.test", first_name: "Jane", last_name: "Tester", address_1: "1 High Street",
      city: "London", postal_code: "N1 9GU", country_code: "gb", phone: "+44 20 7946 0000",
    }));
    assert.ok(done.order?.order_id, `complete_checkout did not return an order: ${JSON.stringify(done)}`);
    assert.equal(done.order.items?.[0]?.quantity, 1);

    const after = await capsule.observe("database");
    assert.equal(after.orders, 1, JSON.stringify(after));
  } finally {
    await browser.close();
    await capsule.down();
  }
});
