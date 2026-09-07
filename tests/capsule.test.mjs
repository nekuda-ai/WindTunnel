import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { bootCapsule } from "../harness/capsule.mjs";

test("capsule prepares, boots, waits, resets, observes, and downs once", async () => {
  const calls = [];
  let checks = 0;
  const lifecycle = {
    async prepare(ctx) { calls.push(["prepare", ctx.siteId]); },
    async up(ctx) { calls.push(["up", ctx.port]); return { baseUrl: "http://localhost:4444", versions: { app: "abc" } }; },
    async status() { calls.push(["status"]); return ++checks === 2 ? "healthy" : "starting"; },
    async reset() { calls.push(["reset"]); },
    async down() { calls.push(["down"]); },
  };
  const capsule = await bootCapsule("example", {
    seed: 7,
    port: 4444,
    lifecycle,
    observe: async (probe, args) => ({ probe, ...args }),
    pollMs: 0,
  });

  assert.equal(capsule.baseUrl, "http://localhost:4444");
  assert.deepEqual(capsule.meta, { siteId: "example", seed: 7, versions: { app: "abc" } });
  await capsule.reset();
  assert.deepEqual(await capsule.observe("api", { query: "items" }), { probe: "api", query: "items" });
  await capsule.down();
  await capsule.down();
  assert.deepEqual(calls.map(([name]) => name), ["prepare", "up", "status", "status", "reset", "down"]);
});

test("capsule tears down after health timeout", async () => {
  let downs = 0;
  const lifecycle = {
    async prepare() {}, async up() { return {}; }, async status() { return false; },
    async reset() {}, async down() { downs++; },
  };
  await assert.rejects(
    bootCapsule("broken", { lifecycle, observe: async () => null, timeoutMs: 0, pollMs: 0 }),
    /timed out waiting for broken/,
  );
  assert.equal(downs, 1);
});

test("capsule gives a clear error when the vendored boot tooling is absent", async () => {
  const fake = process.env.WT_FAKE_LIFECYCLE;
  delete process.env.WT_FAKE_LIFECYCLE;
  const emptyRoot = await mkdtemp(path.join(os.tmpdir(), "wt-notooling-"));
  await assert.rejects(bootCapsule("example", { toolingRoot: emptyRoot }), /site-boot tooling not found/);
  if (fake === undefined) delete process.env.WT_FAKE_LIFECYCLE; else process.env.WT_FAKE_LIFECYCLE = fake;
});

test("manual lifecycle uses the supplied URL without shelling out", async () => {
  const capsule = await bootCapsule("directory-9d8", {
    toolingRoot: "/definitely/not/present",
    env: { WT_MANUAL_BASEURL: "http://localhost:3210" },
  });
  assert.equal(capsule.baseUrl, "http://localhost:3210");
  await capsule.reset();
  await assert.rejects(capsule.observe("anything"), /manual mode has no state probes/);
  await capsule.down();
});

// 2026-09-05 Astra flight: a learnhouse `prepare` failed after a 30-minute
// image-build timeout and the harness then sat idle for 45 minutes — the
// lifecycle call never settled, so the per-batch "Batch failed, skipping"
// path was never reached. Every lifecycle step now has a hard ceiling.
test("capsule: a lifecycle step that never settles is failed and torn down", async () => {
  let downs = 0;
  const lifecycle = {
    prepare: () => new Promise(() => {}),        // never resolves
    async up() { return {}; }, async status() { return "healthy"; },
    async reset() {}, async down() { downs++; },
  };
  await assert.rejects(
    bootCapsule("stuck", { lifecycle, observe: async () => null, stepTimeoutMs: { prepare: 20 } }),
    /capsule prepare for stuck timed out/,
  );
  assert.equal(downs, 1);
});

test("capsule: a stuck step is classified as infrastructure, not a model failure", async () => {
  const { classifyFailure } = await import("../harness/lib.mjs");
  assert.equal(classifyFailure("capsule reset for hi-events timed out: did not finish within 300000 ms"), "infra");
});

test("capsule: a teardown that never settles does not hang the caller either", async () => {
  const lifecycle = {
    async prepare() { throw new Error("build failed"); },
    async up() { return {}; }, async status() { return "healthy"; }, async reset() {},
    down: () => new Promise(() => {}),
  };
  await assert.rejects(
    bootCapsule("stuck", { lifecycle, observe: async () => null, stepTimeoutMs: { down: 20 } }),
    /build failed/,
  );
});
