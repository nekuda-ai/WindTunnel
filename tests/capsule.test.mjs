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
