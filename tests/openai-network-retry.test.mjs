import assert from "node:assert/strict";
import test from "node:test";
import { respond as respondCU } from "../arms/cu-openai.mjs";
import { respond as respondWM } from "../arms/wm-gpt.mjs";

test("OpenAI arms retry a thrown network error", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const respond of [respondCU, respondWM]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ id: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      const result = await respond({});
      assert.equal(result.response.id, "ok");
      assert.equal(result.retries, 1);
      assert.equal(result.retry_wait_ms, 2_000);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
