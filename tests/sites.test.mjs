import assert from "node:assert/strict";
import test from "node:test";

import { loadSites, resolveProfile } from "../harness/sites.mjs";

test("site profiles come from the registry", () => {
  assert.deepEqual(resolveProfile("lite"), [
    "tailwind-nextjs-blog",
    "bulletproof-react",
    "directory-9d8",
  ]);
  assert.equal(resolveProfile("full").length, 8);
  assert.deepEqual(resolveProfile("*"), loadSites().map(({ id }) => id));
});

test("unknown site profile is rejected", () => {
  assert.throws(() => resolveProfile("missing"), /unknown site profile: missing/);
});
