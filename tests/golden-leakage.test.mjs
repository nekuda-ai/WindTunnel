import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("golden answer leakage checker is green", () => {
  assert.equal(spawnSync(process.execPath, ["scripts/check-golden-leakage.mjs"], { encoding: "utf8" }).status, 0);
});
