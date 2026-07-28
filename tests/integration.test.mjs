import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runBenchmark } from "../harness/cli.mjs";

test("full fake dispatcher renders a report with real numbers", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "windtunnel-"));
  const result = await runBenchmark(["--preset", "smoke", "--sites", "lite", "--arms", "scripted", "--n", "1"], {
    env: { WT_FAKE_LIFECYCLE: "1" }, outputRoot, log: () => {},
  });
  const report = await readFile(path.join(result.outputDir, "report.md"), "utf8");
  // All lite tasks are answer-scored; the fake page's fixed final text passes none.
  assert.match(report, /0\/7/);
  assert.match(report, /0\.0%/);
  assert.match(report, /\| scripted \| none \| 0\/7 \| 0\.0% \|/);
  assert.doesNotMatch(report, /Screenshots \(computer use\)/);
  assert.doesNotMatch(report, /<n>|<%>|<total>/);
  // a fake-lifecycle run must be unmistakably marked as a dry run
  assert.match(path.basename(result.outputDir), /^dry-/);
  assert.match(report, /DRY RUN — fake lifecycle/);
  assert.match(report, /WT_FAKE_LIFECYCLE=1 npm run bench/);
});
