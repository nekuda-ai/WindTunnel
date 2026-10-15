import assert from "node:assert/strict";
import test from "node:test";
import { runBatch } from "../harness/run.mjs";
import { runBenchmark } from "../harness/cli.mjs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as routing from "../harness/openrouter.mjs";
import fs from "node:fs";
import { spawn } from "node:child_process";

test("native Anthropic workspace selection is explicit and rejects malformed IDs", () => {
  assert.equal(typeof routing.nativeAnthropicOptions, "function");
  const options = routing.nativeAnthropicOptions({ ANTHROPIC_WORKSPACE_ID: "wrkspc_test123" });
  assert.equal(options.baseURL, "https://api.anthropic.com");
  assert.equal(options.defaultHeaders["anthropic-workspace-id"], "wrkspc_test123");
  assert.throws(() => routing.nativeAnthropicOptions({ ANTHROPIC_WORKSPACE_ID: "oops\r\ninject" }), /workspace/i);
});

const task = { id: "t", tier: "answer", prompt: "ok", predicate: { type: "answer", contains: ["ok"] } };
const boot = async () => ({ reset: async () => {}, down: async () => {}, meta: {}, baseUrl: "http://fake" });

test("resume preserves a scored failure and executes only missing repeats", async () => {
  let calls = 0;
  const method = { id: "fake", model: "none", run: async () => ({ finalText: ++calls === 1 ? "wrong" : "ok", cost: 0.01 }) };
  const first = await runBatch({ siteId: "demo", method, tasks: [task], n: 3, boot, page: {}, onResult: () => false });
  assert.equal(first.rows[0].pass, false);
  const second = await runBatch({ siteId: "demo", method, tasks: [task], n: 3, boot, page: {}, resumeRows: first.rows });
  assert.equal(calls, 3, "a resume must not rerun an already scored failure");
  assert.equal(second.rows.length, 3);
  assert.equal(second.rows[0].run_id, first.rows[0].run_id);
  assert.deepEqual(second.rows.map(row => row.attempt_index), [0, 1, 2]);
  assert.equal(second.verdicts[0].attempts, 3);
});

test("stop flag pauses between attempts", async () => {
  let calls = 0;
  const result = await runBatch({ siteId: "demo", method: { id: "fake", run: async () => { calls++; return { finalText: "ok" }; } }, tasks: [task], n: 3, boot, page: {}, shouldStop: () => calls > 0 });
  assert.equal(calls, 1);
  assert.equal(result.rows.length, 1);
});

test("CLI resume skips a complete site without booting it again", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "wt-resume-"));
  let calls = 0;
  const settings = { outputRoot, env: { WT_FAKE_LIFECYCLE: "1" }, log: () => {}, methods: { fake: { id: "fake", model: "none", run: async () => { calls++; return { finalText: "ok" }; } } } };
  const args = ["--sites", "directory-9d8", "--arms", "fake", "--task-ids", "directory-search", "--n", "3"];
  const first = await runBenchmark(args, settings);
  const second = await runBenchmark(args, { ...settings, resumeRows: first.rows, boot: async () => { throw new Error("must not boot completed site"); } });
  assert.equal(calls, 3);
  assert.equal(second.rows.length, 3);
  assert.equal(second.verdicts[0].attempts, 3);
});

test("durable checkpoint keeps infrastructure spending, preserves model failures and rejects changed harness", async () => {
  const module = await import("../scripts/native-flight.mjs").catch(() => null);
  assert.ok(module, "native resumable flight must exist");
  const directory = await mkdtemp(path.join(os.tmpdir(), "wt-checkpoint-"));
  const file = path.join(directory, "attempts.jsonl");
  module.appendCheckpoint(file, "frozen", { event: "attempt", row: { site: "x", arm: "a", model: "m", task_id: "t", attempt_index: 0, run_id: "infra", failure_category: "harness-infra: fetch failed", est_cost_usd: 0.02 } });
  module.appendCheckpoint(file, "frozen", { event: "attempt", row: { site: "x", arm: "a", model: "m", task_id: "t", attempt_index: 0, run_id: "screenshot", failure_category: "harness-agent: page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot", est_cost_usd: 0.01 } });
  module.appendCheckpoint(file, "frozen", { event: "attempt", row: { site: "x", arm: "a", model: "m", task_id: "t", attempt_index: 0, run_id: "scored", pass: false, failure_category: "wrong answer", est_cost_usd: 0.03 } });
  fs.appendFileSync(file, '{"event":"attempt"');
  const recovered = module.readCheckpoint(file, "frozen");
  assert.equal(recovered.spend, 0.06);
  assert.equal(recovered.rows.length, 1);
  assert.equal(recovered.rows[0].run_id, "scored");
  assert.throws(() => module.readCheckpoint(file, "changed"), /changed|fingerprint/i);
  module.appendCheckpoint(file, "frozen", { event: "start", cell: { task_id: "next" } });
  const reopened = module.readCheckpoint(file, "frozen");
  assert.equal(reopened.spend, 0.06);
  assert.equal(reopened.inflight.task_id, "next");
});

test("SIGKILL followed by a new process resumes only unfinished attempts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wt-kill-resume-"));
  const source = `
    import { runBenchmark } from './harness/cli.mjs';
    import { appendCheckpoint, readCheckpoint } from './scripts/native-flight.mjs';
    const directory = process.env.CHECKPOINT_TEST_DIR, file = directory + '/attempts.jsonl';
    const resume = process.env.CHECKPOINT_TEST_RESUME === '1';
    const saved = readCheckpoint(file, 'frozen');
    let calls = 0;
    const result = await runBenchmark(['--sites','directory-9d8','--arms','fake','--task-ids','directory-search','--n','3'], {
      env: { WT_FAKE_LIFECYCLE: '1' }, outputRoot: directory, log: () => {}, resumeRows: saved.rows,
      methods: { fake: { id: 'fake', model: 'none', run: async () => { calls++; return { finalText: 'wrong', cost: 0.01 }; } } },
      onStart: async cell => {
        appendCheckpoint(file, 'frozen', { event: 'start', cell });
        if (!resume && cell.attempt_index === 1) { console.log('READY'); await new Promise(() => {}); }
      },
      onAttempt: row => appendCheckpoint(file, 'frozen', { event: 'attempt', row }),
    });
    console.log(JSON.stringify({ calls, rows: result.rows.length, spend: readCheckpoint(file, 'frozen').spend }));
  `;
  const options = { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, CHECKPOINT_TEST_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] };
  const first = spawn(process.execPath, ['--input-type=module', '-e', source], options);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { first.kill('SIGKILL'); reject(new Error('first process did not reach second attempt')); }, 10000);
    first.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timer); resolve(); } });
    first.on('error', reject);
  });
  const closed = new Promise(resolve => first.once('close', resolve));
  first.kill('SIGKILL'); await closed;
  const second = spawn(process.execPath, ['--input-type=module', '-e', source], { ...options, env: { ...options.env, CHECKPOINT_TEST_RESUME: '1' } });
  let output = '', errors = '';
  second.stdout.on('data', chunk => { output += chunk; }); second.stderr.on('data', chunk => { errors += chunk; });
  const code = await new Promise(resolve => second.once('close', resolve));
  assert.equal(code, 0, errors);
  assert.deepEqual(JSON.parse(output.trim()), { calls: 2, rows: 3, spend: 0.03 });
});
