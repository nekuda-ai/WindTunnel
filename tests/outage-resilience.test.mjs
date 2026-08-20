// A provider outage must not be charged to the model's task ability, and must
// not be allowed to quietly fill a flight with cells that measure the outage.
import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { classifyFailure, isInfraRow } from "../harness/lib.mjs";
import { parseArgs, runBenchmark } from "../harness/cli.mjs";

test("provider outage signatures are classified as infrastructure, not model failure", () => {
  // Real Anthropic/OpenAI incident shapes. Several carry no HTTP status at all,
  // so a status-code-only rule scored them against the model.
  for (const message of [
    "rate_limit_error", "overloaded_error", "api_error", "service_unavailable",
    "529 overloaded", "500 Internal server error",
    "Connection error.", "APIConnectionError: Connection error",
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
    "socket hang up", "upstream connect error", "fetch failed",
  ]) assert.equal(classifyFailure(message), "infra", `${message} must not count against the model`);
});

test("genuine model outcomes stay charged to the model", () => {
  // The 600s cap is a declared benchmark rule — timing out under it is a real
  // result, not an outage, and must never be excluded from the verdict.
  for (const message of [
    "attempt timeout: 600s agent budget",
    "attempt timeout: 300s agent budget",
    "no live WebMCP tools registered",
    "browser-use returned no result",
  ]) assert.equal(classifyFailure(message), "agent", `${message} must remain a model failure`);
});

test("isInfraRow keeps infrastructure rows out of the verdict", () => {
  assert.equal(isInfraRow({ failure_category: "harness-infra: rate_limit_error" }), true);
  assert.equal(isInfraRow({ failure_category: "harness-agent: attempt timeout: 600s agent budget" }), false);
  assert.equal(isInfraRow({ failure_category: "" }), false);
});

test("--max-consecutive-infra defaults to 2 and is configurable", () => {
  assert.equal(parseArgs([]).maxConsecutiveInfra, 2);
  assert.equal(parseArgs(["--max-consecutive-infra", "5"]).maxConsecutiveInfra, 5);
  assert.equal(parseArgs(["--max-consecutive-infra", "0"]).maxConsecutiveInfra, 0);
});

test("a sustained outage aborts the whole flight, not just the current site", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "windtunnel-outage-"));
  const booted = [];
  const methods = {
    outage: {
      id: "outage", model: "claude-sonnet-5", paid: false,
      run: async () => { throw new Error("Connection error."); },
    },
  };
  // TWO sites on purpose. onResult returning false only breaks the CURRENT
  // batch; without a flight-level check the harness boots the next capsule and
  // keeps spending straight through the outage. A single-site test cannot see
  // that, which is exactly how the bug survived its first test.
  const { rows, options } = await runBenchmark(
    ["--preset", "full", "--sites", "directory-9d8,tailwind-nextjs-blog", "--arms", "outage", "--n", "3"],
    {
      env: { WT_FAKE_LIFECYCLE: "1" }, outputRoot, log: () => {}, methods,
      boot: async (siteId, opts) => {
        booted.push(siteId);
        const { bootCapsule } = await import("../harness/capsule.mjs");
        return bootCapsule(siteId, opts);
      },
    },
  );

  assert.equal(rows.length, options.maxConsecutiveInfra, "abort on the configured consecutive count");
  assert.ok(rows.every(isInfraRow), "every recorded row should be infrastructure-classified");
  assert.equal(booted.length, 1, `only the first capsule should boot, booted: ${booted.join(", ")}`);
});
