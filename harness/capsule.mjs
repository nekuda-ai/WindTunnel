import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile); // execFile (arg array, no shell) — not exec()
// Repo root — the site-boot tooling is vendored in-repo (WindTunnel is standalone;
// it does not depend on any external project at runtime).
const ROOT = path.resolve(import.meta.dirname, "..");
const healthy = (status) => status === true || status === "healthy" || status?.healthy === true || status?.status === "healthy";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hard ceiling per lifecycle step. A capsule build that stalls (2026-09-05: a
// Docker pull blocked behind a locked keychain) must surface as a rejected
// boot — which the flight loop records as "Batch failed" and skips — never as
// an idle harness. Generous: image builds legitimately take tens of minutes.
const STEP_TIMEOUT_MS = { prepare: 45 * 60_000, up: 10 * 60_000, status: 60_000, reset: 5 * 60_000, down: 5 * 60_000 };
const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`capsule ${label} timed out: did not finish within ${ms} ms`)), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

// Real lifecycle = webmcp-kit's bash CLIs. Contracts (from harness/bin/*):
//   capsule <site> <prepare|up|status|reset|down|gc> [--run-id ID] [--port PORT]
//   observe <site> <probe> [arguments-json] [--run-id ID]
// Note: there is no --seed flag; fixture seeding is a capsule-definition concern
// upstream, not a CLI arg. --run-id isolates concurrent instances of a site.
// Exact status/observe output shapes are verified when the vendored tooling is
// first wired against real Docker; parsing here is deliberately tolerant.
function shellLifecycle(directory, env) {
  const capsuleBin = path.join(directory, "harness/bin/capsule");
  if (!fs.existsSync(capsuleBin)) throw new Error(`site-boot tooling not found at ${capsuleBin} — vendor the capsule recipes, or set WT_FAKE_LIFECYCLE=1 for a dry run`);
  const observeBin = path.join(directory, "harness/bin/observe");
  const run = async (bin, args, timeout) => {
    // run from the kit root so its scripts resolve ROOT/capsules correctly.
    // `timeout` kills the child (SIGTERM) so a stuck step cannot pile up behind
    // the next attempt; it sits 5 s above the step ceiling so bootCapsule's
    // own, infra-classified error is the one that surfaces.
    const { stdout } = await execFileAsync(bin, args, { cwd: directory, env, ...(timeout ? { timeout: timeout + 5_000 } : {}) });
    const text = stdout.trim();
    try { return text ? JSON.parse(text) : undefined; } catch { return text; }
  };
  const cap = (action, ctx) => run(capsuleBin, [ctx.siteId, action, "--run-id", ctx.runId, "--port", String(ctx.port)], STEP_TIMEOUT_MS[action]);
  return {
    prepare: (ctx) => cap("prepare", ctx),
    up: (ctx) => cap("up", ctx),
    status: (ctx) => cap("status", ctx),
    reset: (ctx) => cap("reset", ctx),
    down: (ctx) => cap("down", ctx),
    observe: (probe, args, ctx) => run(observeBin, [ctx.siteId, probe, JSON.stringify(args ?? {}), "--run-id", ctx.runId]),
  };
}

function fakeLifecycle() {
  return {
    async prepare() {},
    async up({ port }) { return { baseUrl: `http://localhost:${port}`, versions: { app: "fake" } }; },
    async status() { return "healthy"; },
    async reset() {},
    async down() {},
    // Emulates the real oracles (capsules/*/oracle.sh) per probe name so
    // WT_FAKE_LIFECYCLE=1 dry runs exercise the same predicates as real runs.
    async observe(probe, args = {}) {
      switch (probe) {
        case "catalog": // directory-9d8
          return { categoryCount: 4, bookmarkCount: 6, categories: [{ id: "development", name: "Development" }], bookmarks: [{ slug: "github", title: "GitHub", category_id: "development" }] };
        case "bookmark": // directory-9d8
          return { bookmark: { slug: args.slug, title: "GitHub", is_favorite: 1, category_id: "development", category_name: "Development" } };
        case "delete_bookmark": // directory-9d8
          return { categoryCount: 4, bookmarkCount: 5, categories: [{ id: "development", name: "Development" }], bookmarks: [] };
        case "page": // ponytail: union of the three sites' page shapes — contains-asserts ignore extra keys
          return { path: args.path ?? "/", status: 200, bytes: 4096, hasGitHub: true, hasLatest: true, hasCodeSample: true, spaRoot: true };
        case "content": // tailwind-nextjs-blog
          return {
            home: { path: "/", status: 200, bytes: 4096, hasLatest: true, hasCodeSample: false },
            article: { path: "/blog/code-sample/", status: 200, bytes: 4096, hasLatest: false, hasCodeSample: true },
          };
        case "reset_boundary": // bulletproof-react
          return { strategy: "browser-context", persistentServerState: false, actor: "member", actorSetup: "actors/member.js", authenticatedPath: "/app/discussions" };
        default: // mirror the real oracles' unknown-probe failure
          throw new Error(`unknown probe: ${probe}`);
      }
    },
  };
}

function manualLifecycle(baseUrl) {
  return {
    async prepare() {},
    async up() { return { baseUrl, versions: { app: "manual" } }; },
    async status() { return "healthy"; },
    async reset() {},
    async down() {},
    async observe() { throw new Error("manual mode has no state probes"); },
  };
}

export async function bootCapsule(siteId, {
  seed = 1,
  port = 3215,
  runId,
  toolingRoot = ROOT,
  lifecycle,
  observe,
  timeoutMs = 30_000,
  pollMs = 250,
  stepTimeoutMs = {},
  env = process.env,
} = {}) {
  // Standalone: real boot uses the in-repo vendored tooling; fake lifecycle for
  // dry runs and tests. No external project is required at runtime.
  lifecycle ??= env.WT_MANUAL_BASEURL
    ? manualLifecycle(env.WT_MANUAL_BASEURL)
    : env.WT_FAKE_LIFECYCLE === "1"
      ? fakeLifecycle()
      : shellLifecycle(toolingRoot, env);

  const context = { siteId, seed, port, runId: runId ?? `wt-${port}` };
  const limits = { ...STEP_TIMEOUT_MS, ...stepTimeoutMs };
  const step = (name) => withTimeout(lifecycle[name](context), limits[name], `${name} for ${siteId}`);
  let stopped = false;
  const down = async () => {
    if (stopped) return;
    stopped = true;
    await step("down");
  };

  try {
    await step("prepare");
    const started = await step("up") ?? {};
    const deadline = Date.now() + timeoutMs;
    while (!healthy(await step("status"))) {
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${siteId} to become healthy`);
      await wait(pollMs);
    }
    return {
      baseUrl: started.baseUrl ?? `http://localhost:${port}`,
      reset: () => step("reset"),
      observe: (probe, args = {}) => (observe ?? lifecycle.observe)?.(probe, args, context),
      down,
      meta: { siteId, seed, versions: started.versions ?? {} },
    };
  } catch (error) {
    // Teardown must not mask the boot error, and must not hang either.
    await down().catch(() => {});
    throw error;
  }
}
