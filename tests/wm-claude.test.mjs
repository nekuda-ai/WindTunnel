import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { installModelContextBridge } from "../arms/wm-claude.mjs";
import { claudeSampling } from "../arms/prompts.mjs";

test("Opus 5 uses provider-default sampling without changing older Claude models", () => {
  assert.deepEqual(claudeSampling("claude-opus-5"), { temperature: "default", request: {} });
  assert.deepEqual(claudeSampling("claude-opus-5-20260801"), { temperature: "default", request: {} });
  assert.deepEqual(claudeSampling("claude-sonnet-4-6"), { temperature: "0", request: { temperature: 0 } });
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
