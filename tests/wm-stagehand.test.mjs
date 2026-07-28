import assert from "node:assert/strict";
import test from "node:test";

import { serialToolUse } from "../arms/wm-stagehand.mjs";

// The arm relies on this middleware to get one tool call per turn, matching
// wm-claude/wm-gpt. It must add the flag without dropping the anthropic
// provider options stagehand assembles itself (thinking, fallbacks).
test("serialToolUse adds disableParallelToolUse and keeps stagehand's own options", async () => {
  const out = await serialToolUse.transformParams({
    type: "generate",
    params: {
      prompt: [],
      providerOptions: { anthropic: { thinking: { type: "adaptive" }, effort: "medium" }, openai: { store: false } },
    },
  });
  assert.deepEqual(out.providerOptions.anthropic, {
    thinking: { type: "adaptive" },
    effort: "medium",
    disableParallelToolUse: true,
  });
  assert.deepEqual(out.providerOptions.openai, { store: false }, "other providers must pass through untouched");
});

test("serialToolUse works when there are no provider options yet", async () => {
  const out = await serialToolUse.transformParams({ type: "generate", params: { prompt: [] } });
  assert.deepEqual(out.providerOptions, { anthropic: { disableParallelToolUse: true } });
});
