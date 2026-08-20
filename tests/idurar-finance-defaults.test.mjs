// Guards the IDURAR compatibility repair (fixtures/idurar-erp-crm/compatibility.patch).
//
// Pinned revision 5b2cf28 is internally inconsistent: it deletes the Taxes and
// PaymentMode models — which is what registers their API routes — while
// setup.js still seeds them, and it swapped the invoice tax field from
// SelectAsync to a plain antd Select that never calls the API. Either defect
// alone makes the visible create-invoice flow unsubmittable, which is why the
// 2026-08-18 audit saw every non-WebMCP arm fail id-6 and id-7.
//
// These are static checks on the shipped fixture; the live proof is the capsule
// acceptance assertion exercised when the capsule boots.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const patch = fs.readFileSync(path.join(root, "fixtures/idurar-erp-crm/compatibility.patch"), "utf8");
const capsule = JSON.parse(fs.readFileSync(path.join(root, "capsules/idurar-erp-crm/capsule.yaml"), "utf8"));
const oracle = fs.readFileSync(path.join(root, "capsules/idurar-erp-crm/oracle.sh"), "utf8");

test("the compatibility patch restores both deleted finance models", () => {
  for (const model of ["Taxes", "PaymentMode"]) {
    assert.match(patch, new RegExp(`new file mode \\d+\\nindex [^\\n]*\\n--- /dev/null\\n\\+\\+\\+ b/backend/src/models/appModels/${model}\\.js`),
      `${model}.js must be added as a new file — without the model, IDURAR never registers /api/${model.toLowerCase()}/*`);
    assert.match(patch, new RegExp(`\\+module\\.exports = mongoose\\.model\\('${model}',`), `${model}.js must export the ${model} model`);
  }
});

test("the compatibility patch leaves upstream's own seeding alone", () => {
  // With the models restored, setup.js runs as upstream wrote it. If a hunk
  // ever reappears here, the seeding was disabled again.
  assert.doesNotMatch(patch, /b\/backend\/src\/setup\/setup\.js/, "setup.js must not be patched — its Tax 0% / Default Payment seeding is the fix");
  assert.doesNotMatch(patch, /b\/backend\/src\/setup\/reset\.js/, "reset.js must not be patched once the models exist");
});

test("the invoice tax field calls the API instead of rendering an empty Select", () => {
  assert.match(patch, /-\s*<Select\n\+\s*<SelectAsync\n/, "the tax field must be restored to the SelectAsync the file already imports");
  // The SelectAsync-only props stay: they are what the plain Select ignored.
  assert.match(patch, /entity=\{'taxes'\}/);
});

test("the tax and payment-mode administration surfaces stay out of task scope", () => {
  // Assert the ROUTE deletions specifically — a nav-link removal alone would
  // otherwise satisfy this while the route quietly came back.
  for (const removed of ["/taxes", "/payment/mode", "/quote"]) {
    assert.ok(patch.includes(`-      path: '${removed}',`), `the ${removed} route deletion must be preserved`);
  }
  assert.match(patch, /-\s*element: <Taxes \/>,/);
  assert.match(patch, /-\s*element: <PaymentMode \/>,/);
  assert.match(patch, /-\s*element: <Quote \/>,/);
});

test("capsule acceptance proves both list endpoints serve the seeded defaults", () => {
  const { assert: accept, resetAssert } = capsule.acceptance.observation;
  for (const [name, expression] of Object.entries({ assert: accept, resetAssert })) {
    for (const clause of [
      ".taxListStatus == 200", ".taxOptions == 1", '.defaultTaxName == "Tax 0%"', ".defaultTaxValue == 0",
      ".paymentModeListStatus == 200", ".paymentModeOptions == 1", '.defaultPaymentModeName == "Default Payment"',
    ]) assert.ok(expression.includes(clause), `${name} must require ${clause}`);
  }
});

test("the oracle probes the endpoint and spelling the UI actually uses", () => {
  // SelectAsync -> request.list -> GET <entity>/list. listAll is a different
  // route and would not prove the dropdown can populate.
  assert.match(oracle, /\$\{entity\}\/list\?/);
  // The route registers lowercase ("paymentmode"); the frontend sends camelCase
  // and relies on Express's case-insensitive routing. Keep that under test.
  assert.match(oracle, /fetchList\("paymentMode"\)/);
});

// ---------------------------------------------------------------------------
// id-6 / id-7 were tightened after the fixture repair: the loose forms accepted
// outcomes that did not match the task. These score the shipped predicates
// against the oracle's real output shapes.
import { loadTasks } from "../harness/tasks.mjs";
import { score } from "../scoring/predicates.mjs";

const predicateFor = (id) => loadTasks("idurar-erp-crm").find((t) => t.id === id).predicate;
const capsuleFor = (observed) => ({ observe: async () => observed });
const invoice = (over = {}) => ({
  count: 1,
  invoices: [{
    id: "a".repeat(24), number: 2, year: 2026, status: "draft",
    client: { id: "b".repeat(24), name: "Acme Evaluation", email: "billing@acme.example.test" },
    total: 400, taxTotal: 0, paymentStatus: "unpaid",
    items: [{ name: "Quarterly Retainer", quantity: 1, price: 400, total: 400 }],
    ...over,
  }],
});
const payments = (over = {}) => ({
  httpStatus: 200, found: true, number: 1, paymentStatus: "partially",
  credit: 100, total: 250, count: 1,
  payments: [{ number: 1, amount: 100, ref: "EVAL-100", description: "" }],
  ...over,
});

test("id-6 requires the client, status and quantity the task names", async () => {
  const p = predicateFor("id-6");
  assert.equal((await score(p, capsuleFor(invoice()))).pass, true, "the correct invoice must pass");
  for (const [label, observed] of [
    ["wrong client", invoice({ client: { name: "Someone Else" } })],
    ["wrong status", invoice({ status: "pending" })],
    ["wrong quantity", invoice({ items: [{ name: "Quarterly Retainer", quantity: 5, price: 400, total: 2000 }] })],
    ["wrong item name", invoice({ items: [{ name: "Retainer", quantity: 1, price: 400, total: 400 }] })],
    ["no invoice created", { count: 0, invoices: [] }],
  ]) assert.equal((await score(p, capsuleFor(observed))).pass, false, `id-6 must reject: ${label}`);
});

test("id-7 requires the payment amount and reference the task names", async () => {
  const p = predicateFor("id-7");
  assert.equal(p.probe, "payments", "id-7 must use the payments probe — invoice fields cannot see a reference");
  assert.equal((await score(p, capsuleFor(payments()))).pass, true, "the correct payment must pass");
  for (const [label, observed] of [
    ["wrong amount", payments({ payments: [{ number: 1, amount: 50, ref: "EVAL-100" }], credit: 50 })],
    ["reference skipped", payments({ payments: [{ number: 1, amount: 100, ref: "" }] })],
    ["wrong reference", payments({ payments: [{ number: 1, amount: 100, ref: "WRONG" }] })],
    ["no payment recorded", payments({ paymentStatus: "unpaid", credit: 0, count: 0, payments: [] })],
  ]) assert.equal((await score(p, capsuleFor(observed))).pass, false, `id-7 must reject: ${label}`);
});
