import assert from "node:assert/strict";
import test from "node:test";
import { costFor, PRICES } from "../harness/lib.mjs";

test("gpt-6-astra is priced at list: $10 in, $50 out, $1 cached, $12.50 cache write", () => {
  assert.ok(PRICES.some(([prefix]) => prefix === "gpt-6-astra"), "no PRICES row for gpt-6-astra");
  const usd = costFor("gpt-6-astra", { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_input_tokens: 1_000_000, cache_creation_tokens: 1_000_000 });
  assert.equal(usd, 10 + 50 + 1 + 12.5);
});
