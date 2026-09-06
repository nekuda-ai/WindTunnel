import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, readFile } from "node:fs/promises";

import { parseArgs, planRuns, runBenchmark } from "../harness/cli.mjs";

test("CLI plans lite scripted runs", () => {
  const options = parseArgs(["--sites", "lite", "--arms", "scripted"]);
  assert.equal(planRuns(options, {}).runs.length, 3);
});

test("CLI skips arms with missing keys", () => {
  const plan = planRuns(parseArgs(["--sites", "lite", "--arms", "cu-claude"]), {});
  assert.equal(plan.runs.length, 0);
  assert.match(plan.notices[0], /ANTHROPIC_API_KEY/);
});

test("CLI registers Gemini arms", () => {
  const plan = planRuns(
    parseArgs(["--sites", "directory-9d8", "--arms", "cu-gemini,wm-gemini,wm-stagehand-v4-gemini"]),
    { GEMINI_API_KEY: "x" },
  );
  assert.deepEqual(plan.runs.map(({ method }) => [method.id, method.model, Boolean(method.webmcp)]), [
    ["cu-gemini", "gemini-3.6-flash", false],
    ["wm-gemini", "gemini-3.6-flash", true],
    ["wm-stagehand-v4-gemini", "gemini-3.6-flash", true],
  ]);
});

test("zero budget stops paid methods", () => {
  const plan = planRuns(parseArgs(["--sites", "lite", "--arms", "cu-claude", "--budget", "0.00"]), { ANTHROPIC_API_KEY: "x" });
  assert.equal(plan.runs.length, 0);
  assert.match(plan.notices[0], /budget/i);
});

test("CLI validates odd repeats", () => {
  assert.throws(() => parseArgs(["--n", "2"]), /positive odd integer/);
});

test("CLI accepts a task file override", () => {
  assert.equal(parseArgs(["--tasks", "tasks/calibration-directory.yaml"]).tasks, "tasks/calibration-directory.yaml");
});

test("CLI preserves repeated task ids for targeted reruns", () => {
  assert.deepEqual(parseArgs(["--task-ids", "id-2,id-2,id-3"]).taskIds, ["id-2", "id-2", "id-3"]);
});

test("targeted reruns execute repeated task ids", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "windtunnel-targeted-"));
  const result = await runBenchmark([
    "--sites", "directory-9d8", "--arms", "fake", "--task-ids", "directory-search,directory-search", "--n", "1",
  ], {
    env: { WT_FAKE_LIFECYCLE: "1" }, outputRoot, log: () => {},
    methods: { fake: { id: "fake", paid: false, async run() { return { finalText: "done" }; } } },
  });
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(({ task_id }) => task_id === "directory-search"));
});

test("CLI rejects unimplemented perturbations", () => {
  assert.throws(() => parseArgs(["--perturbed"]), /perturbations are not implemented/);
});

test("runtime budget stops later paid attempts", async () => {
  const logs = [];
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "windtunnel-budget-"));
  const result = await runBenchmark([
    "--sites", "directory-9d8", "--arms", "paid-fake", "--n", "1", "--budget", "0.01",
  ], {
    env: { WT_FAKE_LIFECYCLE: "1" },
    outputRoot,
    log: (line) => logs.push(line),
    methods: {
      "paid-fake": {
        id: "paid-fake",
        paid: true,
        async run() { return { finalText: "done", cost: 0.02 }; },
      },
    },
  });
  assert.equal(result.rows.length, 1);
  assert.ok(logs.some((line) => /budget hard stop reached/i.test(line)));
});

test("every finished attempt streams to live.jsonl mid-run", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "windtunnel-live-"));
  const result = await runBenchmark([
    "--sites", "directory-9d8", "--arms", "fake", "--n", "1",
  ], {
    env: { WT_FAKE_LIFECYCLE: "1" },
    outputRoot,
    log: () => {},
    methods: { fake: { id: "fake", paid: false, async run() { return { finalText: "done", transcript: [{ big: "blob" }] }; } } },
  });
  const lines = (await readFile(path.join(outputRoot, "live.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, result.rows.length);
  const row = JSON.parse(lines[0]);
  assert.equal(row.arm, "fake");
  assert.ok(!("transcript" in row) && !("final_text" in row));
});

test("a batch whose capsule fails to boot is skipped, not fatal", async () => {
  const logs = [];
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "windtunnel-bootfail-"));
  const result = await runBenchmark([
    "--sites", "directory-9d8,tailwind-nextjs-blog", "--arms", "fake", "--n", "1",
  ], {
    env: { WT_FAKE_LIFECYCLE: "1" },
    outputRoot,
    log: (line) => logs.push(line),
    boot: async (siteId, opts) => {
      if (siteId === "directory-9d8") throw new Error("capsule_prepare failed with exit code 1");
      const { bootCapsule } = await import("../harness/capsule.mjs");
      return bootCapsule(siteId, opts);
    },
    methods: { fake: { id: "fake", paid: false, async run() { return { finalText: "ok" }; } } },
  });
  assert.ok(logs.some((line) => /Batch failed, skipping fake × directory-9d8/.test(line)));
  assert.ok(result.rows.length > 0, "the healthy site's batch still produced rows");
  assert.ok(result.rows.every((row) => row.site === "tailwind-nextjs-blog"));
});

test("a failed capsule teardown is persisted on the run record, not just logged", async () => {
  const logs = [];
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "windtunnel-teardown-"));
  await runBenchmark(["--sites", "tailwind-nextjs-blog", "--arms", "fake", "--n", "1"], {
    env: { WT_FAKE_LIFECYCLE: "1" },
    outputRoot,
    log: (line) => logs.push(line),
    boot: async (siteId, opts) => {
      const { bootCapsule } = await import("../harness/capsule.mjs");
      const capsule = await bootCapsule(siteId, opts);
      return { ...capsule, down: async () => { throw new Error("capsule down for blog timed out"); } };
    },
    methods: { fake: { id: "fake", paid: false, async run() { return { finalText: "ok" }; } } },
  });
  const dir = (await readdir(outputRoot)).find((d) => !d.endsWith(".jsonl"));
  const run = JSON.parse(await readFile(path.join(outputRoot, dir, "run.json"), "utf8"));
  assert.match(run.capsules[0].teardown_error, /timed out/);
  assert.match(await readFile(path.join(outputRoot, "live.jsonl"), "utf8"), /teardown_failed/);
  assert.ok(logs.some((line) => /Teardown failed for fake × tailwind-nextjs-blog/.test(line)));
});
