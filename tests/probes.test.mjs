import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { load } from "js-yaml";

const ROOT = path.resolve(import.meta.dirname, "..");

test("every non-answer predicate names a probe its site's oracle implements", () => {
  for (const file of fs.readdirSync(path.join(ROOT, "tasks")).filter((name) => name.endsWith(".yaml"))) {
    const parsed = load(fs.readFileSync(path.join(ROOT, "tasks", file), "utf8"));
    for (const task of Array.isArray(parsed) ? parsed : parsed.tasks) {
      if (!task.predicate || task.predicate.type === "answer") continue;
      const site = task.site ?? path.basename(file, ".yaml");
      const oracle = path.join(ROOT, "capsules", site, "oracle.sh");
      assert.ok(fs.existsSync(oracle), `${file}:${task.id}: no oracle for site ${site}`);
      // probe names are top-level case arms like `catalog)` or `page|content)`
      const arms = [...fs.readFileSync(oracle, "utf8").matchAll(/^\s*([a-z0-9_|-]+)\)/gm)]
        .flatMap(([, arm]) => arm.split("|"));
      assert.ok(arms.includes(task.predicate.probe),
        `${file}:${task.id}: probe "${task.predicate.probe}" not in ${site} oracle (${arms.join(", ")})`);
    }
  }
});
