import assert from "node:assert/strict";
import test from "node:test";

import { loadTasks, resolveTask } from "../harness/tasks.mjs";

test("resolveTask fills prompt and nested predicate params", () => {
  const task = resolveTask({
    id: "cart",
    prompt: "Add {params.qty} of {params.sku}",
    params: { sku: ["A", "B"], qty: 2 },
    predicate: { assert: { contains: { sku: "{params.sku}", qty: "{params.qty}" } } },
  }, 1);
  assert.equal(task.prompt, "Add 2 of B");
  assert.deepEqual(task.predicate.assert.contains, { sku: "B", qty: 2 });
});

test("loadTasks reads each lite site task file", () => {
  for (const site of ["directory-9d8", "tailwind-nextjs-blog", "bulletproof-react"])
    assert.ok(loadTasks(site).length >= 2);
});

test("loadTasks excludes retired tasks", () => {
  assert.ok(!loadTasks("learnhouse").some(({ id }) => id === "lh-4"));
});
