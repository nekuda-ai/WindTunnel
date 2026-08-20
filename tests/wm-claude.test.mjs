import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { installModelContextBridge } from "../arms/wm-claude.mjs";
import { claudeSampling, maxTokensFor } from "../arms/prompts.mjs";

test("Opus 5 uses provider-default sampling without changing older Claude models", () => {
  assert.deepEqual(claudeSampling("claude-opus-5"), { temperature: "default", request: {} });
  assert.deepEqual(claudeSampling("claude-opus-5-20260801"), { temperature: "default", request: {} });
  assert.deepEqual(claudeSampling("claude-sonnet-4-6"), { temperature: "0", request: { temperature: 0 } });
  // Claude 4.7+ reject non-default sampling with a 400, which fails the whole
  // request — every Sonnet 5 configuration would have recorded 100% infra
  // failures. Unknown/new models must default to provider defaults, not to
  // temperature 0.
  for (const model of ["claude-sonnet-5", "claude-fable-5", "claude-opus-4-7", "claude-opus-4-8"])
    assert.deepEqual(claudeSampling(model), { temperature: "default", request: {} }, `${model} must not send temperature`);
  // max_tokens bounds thinking + text on Sonnet 5, whose adaptive thinking is on
  // by default; Opus 5 keeps 4096 because its rows are retained from runs at that value.
  assert.equal(maxTokensFor("claude-sonnet-5"), 16384);
  assert.equal(maxTokensFor("claude-opus-5"), 4096);
});

test("WebMCP bridge keeps only live re-registrations", async () => {
  const context = vm.createContext({
    document: {},
    navigator: {},
    AbortController,
    DOMException,
  });
  vm.runInContext(`(${installModelContextBridge.toString()})()`, context);

  const first = new AbortController();
  const registration = context.document.modelContext.registerTool(
    { name: "get_bookmark", description: "generic", execute: () => "old" },
    { signal: first.signal },
  );
  registration.catch(() => {});
  assert.deepEqual(
    Array.from(context.document.modelContext.list(), ({ description }) => description),
    ["generic"],
  );

  first.abort();
  await Promise.allSettled([registration]);
  context.document.modelContext.registerTool(
    { name: "get_bookmark", description: "contextual", execute: () => "new" },
    { signal: new AbortController().signal },
  ).catch(() => {});
  assert.deepEqual(
    Array.from(context.document.modelContext.list(), ({ description }) => description),
    ["contextual"],
  );
  assert.equal(await context.document.modelContext.execute("get_bookmark", {}), "new");
});
