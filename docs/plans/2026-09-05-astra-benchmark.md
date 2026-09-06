# GPT-6 Astra Benchmark Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OpenAI's GPT-6 Astra (`gpt-6-astra`, API-available since 2026-09-04) to the WindTunnel leaderboard as three configurations — native computer use, native WebMCP, and OpenAI's recommended code-execution path — measured under the canonical rules (49 tasks × 8 sites × 3 attempts, 600 s cap).

**Architecture:** One new arm plus the two existing OpenAI arms. Astra runs through `cu-openai` (Responses API `computer` tool) and `wm-gpt` (Responses API function calling over the WebMCP bridge), selected with `--model`, exactly how Luna and SOL were added — plus a new `code-openai` arm (Responses API function tool `exec_js`: the model writes Playwright code, the harness runs it) because OpenAI recommends that path for Astra and publishing only the non-recommended mode invites a "you handicapped it" objection. It is reported as its own interface class, never under "screenshots". The harness needs four small corrections so Astra is measured honestly: a price row, no `temperature` probe (Astra rejects it and today's fallback doubles every request), cache-write token accounting (Astra bills cache writes at 1.25×), and recording effort/truncation for the smoke gate. Results merge into `results/canonical` via the existing `combined-explorer.mjs` flow.

**Tech Stack:** Node 20.11+, Playwright, OpenAI Responses API via raw `fetch` (no SDK), `node --test`, Docker Desktop (site capsules), existing scripts: `verify-model.mjs`, `smoke-gate.mjs`, `watchdog.mjs`, `combined-explorer.mjs`, `readme-charts.mjs`.

**Branch / worktree:** `bench/astra-gpt-6` at `/Users/idanlevin/In Progress/WindTunnel-astra`, based on `origin/main` @ `5d598fd`. `.env` (copied, git-ignored) already holds a working `OPENAI_API_KEY`.

---

## Research summary (what we verified, 2026-09-05)

Probed directly against the API with the repo's key unless a source is cited.

| Fact | Value | How verified |
|---|---|---|
| Model id / served snapshot | `gpt-6-astra` → served `gpt-6-astra` | `GET /v1/models` lists it; Responses call returns `model: "gpt-6-astra"` |
| Endpoints | Responses + Chat Completions + Batch | [model page](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| Pricing (per 1M tokens, ≤272K context) | input $10 · cached $1 · cache write $12.50 · output $50 | model page, [pricing](https://developers.openai.com/api/docs/pricing) |
| Context / max output | 1,050,000 / 128,000 | model page |
| `temperature` | **rejected**: `Unsupported parameter: 'temperature' is not supported with this model.` (400) | probe |
| Reasoning effort | `low, medium, high, xhigh, max`; `none` unsupported; **default is `medium`** | probe (`response.reasoning.effort = "medium"` when unset) |
| Computer use | `tools: [{ type: "computer" }]` accepted; returns `computer_call` with an `actions` array (`screenshot`, `click`, `type`, …) — identical to the gpt-5.5/5.6 shape the arm already handles | probe |
| OpenAI's CU recommendation | "For GPT-6 Astra, we recommend code execution. The `computer` tool remains supported as an alternative." Code execution = a function tool (`exec_js` running Playwright / `exec_py` running PyAutoGUI) the model writes code for | [computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use) |
| Function calling | `type: "function"` tools with `parallel_tool_calls: false`, `max_output_tokens` accepted; returns `function_call` | probe (matches `wm-gpt` request shape) |
| Prompt caching | automatic; 1,024-token minimum prefix; `cache_write_tokens` appears in `usage.input_tokens_details` and **is included in `input_tokens`** (3,761 input = 3,758 write + 3 uncached); second identical call → 3,758 `cached_tokens` | probe; [caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) |
| Rate limits on this key | 10,000 RPM · 4,000,000 TPM (same as gpt-5.5) | response headers |
| Knowledge cutoff | 2026-04-30 | model page |
| Public computer-use benchmark | OSWorld 2.0: 72.6% at ~40 min/task vs GPT-5.6 SOL 65.7% at ~75 min | [Vellum](https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained), [DataCamp](https://www.datacamp.com/blog/gpt-6-astra) |
| Latency | p95 time-to-first-token ~18 s reported by a third party — watch the 600 s cap on long CU tasks | [llm-stats](https://llm-stats.com/models/gpt-6-astra) |
| Safety gating | Only advanced cyber capabilities are gated (Daybreak); irrelevant to these tasks | [TechCrunch](https://techcrunch.com/2026/09/03/openai-launches-astra-its-powerful-and-controversial-new-model/) |

### Decision: how Astra enters the benchmark

**Run all three approaches as one flight** — `cu-openai=gpt-6-astra`, `wm-gpt=gpt-6-astra`, and the new `code-openai=gpt-6-astra`. The first two are the benchmark's core claim (same model, two interfaces) and how every other model got onto the board; the third is OpenAI's recommended Astra path, added so the board cannot be accused of showing Astra only in its second-best mode. Three new configurations → the leaderboard goes 16 → 19.

**Run OpenAI's "code execution" computer-use path too, as its own interface class.** The model writes JavaScript with Playwright's `page` in scope and sees the result (stdout and any `display()`-ed screenshot). That is neither "screenshots" (it can query selectors) nor "page structure" (it can screenshot), so it gets a new arm id `code-openai` — deliberately *not* prefixed `cu-` because `build_explorer.mjs`, `readme-charts.mjs` and `combined-explorer.mjs` classify arms by prefix and would silently file it under Screenshots. Astra's native `computer` tool (`cu-openai`) stays the like-for-like comparison with the other five CU configurations; `code-openai` answers "what is the strongest thing OpenAI says Astra can do on a screen?". Both ship, both labeled. Security note: the model's code runs in a fresh `node:vm` context that exposes only `page`, `context`, `browser`, `console` and `display` — no `process`, `fetch`, `require` or `import()` — so a snippet cannot casually read the API key or the filesystem. This is hygiene, not a hard boundary: host objects (`page`) carry host prototypes, so a deliberately hostile author could escape. Threat model here is a vendor model on pinned local capsules, same trust the CU and WebMCP arms already extend; a Worker/subprocess sandbox is the upgrade path if untrusted models or public sites are ever run. Disclosed in SPEC §6.

**Reasoning effort: provider default (`medium`), not set explicitly.** That is how Luna and SOL were measured (the arms never send `reasoning`). Record what the provider reports so the row is auditable.

**Harness fixes that ship with this change (all disclosed in PROVENANCE):**

1. `PRICES` gains `gpt-6-astra`.
2. The OpenAI arms stop probing `temperature: 0`. Today `respondAtZero` sends it, gets a 400 from every GPT-5.x/6 reasoning model, then re-sends — two HTTP round trips per model turn. The 400 is not billed and never reaches the model, so removing it does not change model behavior; it removes ~0.1–0.5 s of harness overhead per turn from `agent_s`. `samplingFor(model)` in `arms/prompts.mjs` already returns `{}` for OpenAI — use it.
3. Cache-write accounting. Both OpenAI arms compute `uncached = input_tokens − cached_tokens` and leave `cache_creation_tokens` at 0. Astra (and GPT-5.6) bill cache writes at 1.25× input, so that understates cost. Split `cache_write_tokens` out of `input_tokens` into `cache_creation_tokens`.
4. Record `effort` (from `response.reasoning.effort`) and `truncated` (from `response.status === "incomplete"`) so `smoke-gate.mjs` can see them. `wm-gpt` sends `max_output_tokens: 4096` and Astra's reasoning tokens count against it — the smoke decides whether 4096 holds.
5. **(found by the IDURAR smoke)** `cu-openai` `keypress` is one chord. OpenAI's action carries a key *combination*; the arm pressed keys one at a time, so Ctrl+A never selected text and models retried spellings for turns. Also normalizes xdotool (`Control_L`) and DOM-code (`KeyA`) names Astra emits. Exposure on the canonical board: 13/13 failed Luna and 10/13 failed SOL `cu-openai` rows contain a multi-key keypress, but only one of the 23 is a select-all (Ctrl+A); the rest are other shortcuts whose failure may not have decided the task. Exposure, not proven cause. Those rows are **not** re-run in this change (disclose; a matched re-fly is a separate decision).
6. **(found by the IDURAR smoke)** `smoke-gate.mjs` applied its request-error regex (which includes `400`) to scoring failures too; a predicate expecting `"price":400` blocked the flight. Scoped to `harness-` failures.
7. **(found by the first full-flight attempt)** `bootCapsule` lifecycle steps have hard ceilings (prepare 45 min, up 10, status 1, reset/down 5). A timed-out step is classified as **infrastructure** (`isInfraRow`; message matches lib.mjs `INFRA`) so it is excluded from scores and trips the consecutive-infra abort, and `execFile`'s own timeout kills the stuck child so attempts cannot pile up (seen on hi-events in attempt 2 after its app container exited).
8. **(found by the second full-flight attempt)** `runBatch` records a failed capsule teardown (`teardown_error`) instead of throwing from `finally`; throwing made `cli.mjs` drop every finished row of the batch (hi-events: 30 rows incl. 22 valid, re-run in the remainder pass). A learnhouse image build stalled behind a locked-keychain Docker pull; the 30-min build timeout fired but the lifecycle promise never settled and the harness idled 45 minutes instead of recording "Batch failed" and moving on. Also operational: **the Mac's screen must stay unlocked** (or Docker's `credsStore` disabled) for the flight — `docker-credential-desktop` blocks behind a locked keychain and every image pull hangs.

**Cost projection.** SOL's paired run cost $32.47 (CU ≈ $30, WebMCP ≈ $2.5) at $5/$30. Astra is $10/$50 (≈1.9×) and may reason longer: expect **$50–75**, CU ≈ 90% of it. The code-execution arm is a third paid configuration; OpenAI reports Astra finishes OSWorld tasks in about half the time, so expect it to cost less than `cu-openai` — budget **$25–40** more. Whole flight: **$75–115**. Cap the flight at `--budget 130` and run the watchdog at `--cap 140`.

---

## Task 0: Preconditions (no code)

**Step 1: Confirm the worktree and key**

Run (from `/Users/idanlevin/In Progress/WindTunnel-astra`):

```bash
git status -sb && git log --oneline -1
node --env-file=.env scripts/verify-model.mjs gpt-6-astra
```

Expected: `## bench/astra-gpt-6...origin/main`, HEAD `5d598fd`, and
`✅ gpt-6-astra -> served "gpt-6-astra" status=completed`.

**Step 2: Install and run the suite once, clean**

```bash
npm ci && npx playwright install chromium && npm test 2>&1 | tail -8
```

Expected: `pass` equals `tests`, `fail 0`.

**Step 3: Start Docker Desktop** (the daemon was down on this Mac at planning time) and confirm the macOS prerequisites the README names:

```bash
docker version --format '{{.Server.Os}}/{{.Server.Arch}}' && which gtar gdate | head -2
```

Expected: `linux/arm64` and two Homebrew paths (`brew install gnu-tar coreutils` otherwise). **Every capsule-booting command below (Tasks 5–6) must run with GNU coreutils first on PATH** — the capsule script uses `realpath -m`, which macOS's `realpath` lacks and fails with `realpath: illegal option -- m` (zero attempts, no spend). Prefix each command with:

```bash
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gnu-tar/libexec/gnubin:$PATH"
```

---

## Task 1: Price row for Astra

**Files:**
- Modify: `harness/lib.mjs` (the `PRICES` array, ~line 49)
- Test: `tests/astra.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/astra.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { costFor, PRICES } from "../harness/lib.mjs";

test("gpt-6-astra is priced at list: $10 in, $50 out, $1 cached, $12.50 cache write", () => {
  assert.ok(PRICES.some(([prefix]) => prefix === "gpt-6-astra"), "no PRICES row for gpt-6-astra");
  const usd = costFor("gpt-6-astra", { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_input_tokens: 1_000_000, cache_creation_tokens: 1_000_000 });
  assert.equal(usd, 10 + 50 + 1 + 12.5);
});
```

**Step 2: Run it, expect failure**

```bash
node --test tests/astra.test.mjs
```

Expected: FAIL — `no PRICES row for gpt-6-astra` (the Sonnet fallback also prints `unknown model pricing`).

**Step 3: Add the row**

In `harness/lib.mjs`, insert above the `gpt-5.6-sol` row:

```js
  // GPT-6 Astra list rates (≤272K context; longer prompts are 2× — never
  // reached here). Cache writes are billed at 1.25× input, so the arms must
  // report cache_write_tokens as cache_creation_tokens for this to bind.
  ["gpt-6-astra", [10, 50, 1, 12.5]],
```

**Step 4: Run it, expect pass**

```bash
node --test tests/astra.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add harness/lib.mjs tests/astra.test.mjs
git commit -m "feat(pricing): add gpt-6-astra list rates"
```

---

## Task 2: OpenAI arms — no temperature probe, cache-write split, effort + truncation

Both arms have identical `respond`/`respondAtZero` helpers and identical usage arithmetic. Fix each in place (two files, same three edits); do not introduce a shared module for two call sites.

**Files:**
- Modify: `arms/cu-openai.mjs` (`respondAtZero`, the usage block inside the loop, the `return`)
- Modify: `arms/wm-gpt.mjs` (same three places)
- Test: `tests/astra.test.mjs` (extend)

**Step 1: Write the failing tests**

Append to `tests/astra.test.mjs`:

```js
import { run as runWM } from "../arms/wm-gpt.mjs";
import { run as runCU } from "../arms/cu-openai.mjs";

// A fake Responses API: records every request body, answers once with a
// final message. Usage mimics Astra's real shape (cache_write inside input_tokens).
function fakeOpenAI(usage, extra = {}) {
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { body }) => {
    bodies.push(JSON.parse(body));
    return new Response(JSON.stringify({
      model: "gpt-6-astra", status: "completed",
      reasoning: { effort: "medium" },
      output: [{ type: "message", content: [{ type: "output_text", text: "Final answer: ok" }] }],
      usage, ...extra,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { bodies, restore: () => { globalThis.fetch = originalFetch; } };
}

const ASTRA_USAGE = {
  input_tokens: 3761, input_tokens_details: { cache_write_tokens: 3000, cached_tokens: 700 },
  output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 },
};

// WebMCP arm: stub exactly what prepareWebMCPPage / listLiveTools touch
// (arms/wm-claude.mjs:50-65): context().addInitScript, goto, waitForFunction,
// evaluate (returns the live tool list), waitForTimeout. One tool the model never calls.
const wmContext = { async addInitScript() {} };
const wmPage = {
  context() { return wmContext; },
  async goto() {}, async waitForFunction() {}, async waitForTimeout() {},
  async evaluate() { return [{ name: "noop", description: "", inputSchema: { type: "object", properties: {} } }]; },
};
// CU arm: enough Playwright surface for setup + one screenshot-free turn.
const cuPage = {
  async setViewportSize() {}, async goto() {}, async waitForLoadState() {}, async waitForTimeout() {},
  async screenshot() { return Buffer.from("png"); },
};
const task = { id: "t", prompt: "do the thing", tier: "answer" };
const capsule = { baseUrl: "http://fake", meta: {} };

for (const [name, run, page] of [["wm-gpt", runWM, wmPage], ["cu-openai", runCU, cuPage]]) {
  test(`${name}: never sends temperature to an OpenAI model`, async () => {
    const api = fakeOpenAI(ASTRA_USAGE);
    try {
      const result = await run({ task, capsule, page, model: "gpt-6-astra" });
      assert.equal(api.bodies.length, 1, "one request per turn — the temperature probe used to make two");
      assert.ok(!("temperature" in api.bodies[0]));
      assert.equal(result.temperature, "default");
    } finally { api.restore(); }
  });

  test(`${name}: splits cache writes out of input and prices them`, async () => {
    const api = fakeOpenAI(ASTRA_USAGE);
    try {
      const { usage, cost } = await run({ task, capsule, page, model: "gpt-6-astra" });
      assert.equal(usage.input_tokens, 3761 - 3000 - 700);
      assert.equal(usage.cached_input_tokens, 700);
      assert.equal(usage.cache_creation_tokens, 3000);
      assert.equal(cost, (61 * 10 + 700 * 1 + 3000 * 12.5 + 5 * 50) / 1e6);
    } finally { api.restore(); }
  });

  test(`${name}: records effort and truncation for the smoke gate`, async () => {
    const api = fakeOpenAI(ASTRA_USAGE, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    try {
      const result = await run({ task, capsule, page, model: "gpt-6-astra" });
      assert.equal(result.effort, "medium");
      assert.equal(result.truncated, true);
    } finally { api.restore(); }
  });
}
```

Note: `wm-gpt` reaches the bridge through `prepareWebMCPPage`/`listLiveTools` in `arms/wm-claude.mjs`; the stub above covers every page method they call today. If a helper grows a new call, add the async no-op to `wmPage` — do **not** change `wm-claude.mjs`.

**Step 2: Run, expect failures**

```bash
node --test tests/astra.test.mjs
```

Expected: the six new tests FAIL (two requests recorded; `cache_creation_tokens` 0; `effort` undefined).

**Step 3: Edit `arms/cu-openai.mjs`**

a) Import sampling: change the prompts import to
```js
import { BASE_SYSTEM, MECHANICS, samplingFor } from "./prompts.mjs";
```

b) Delete `respondAtZero` entirely.

c) In `run`, replace the call site:
```js
    const sampling = samplingFor(model);
    const outcome = await respond({
      model,
      instructions: withToday(SYSTEM),
      tools,
      input: windowed(),
      ...sampling.request,
    });
    const response = outcome.response;
    model_snapshot = response.model ?? model_snapshot;
    temperature = sampling.temperature;
    effort = response.reasoning?.effort ?? effort;
    if (response.status === "incomplete") truncated = true;
```
and declare `let effort = "", truncated = false;` next to the other `let`s (drop the `temperature = "0"` initializer; initialize `temperature = "default"`).

d) Replace the three usage lines with:
```js
    const details = response.usage?.input_tokens_details ?? {};
    const cached = details.cached_tokens ?? 0, written = details.cache_write_tokens ?? 0;
    // OpenAI's input_tokens INCLUDES cache reads and cache writes; split them
    // so each is priced at its own rate (Astra: $1 read, $12.50 write, $10 fresh).
    usage.input_tokens += (response.usage?.input_tokens ?? 0) - cached - written;
    usage.cached_input_tokens += cached;
    usage.cache_creation_tokens += written;
    usage.output_tokens += response.usage?.output_tokens ?? 0;
```

e) Add `effort, truncated,` to the returned object.

**Step 4: Edit `arms/wm-gpt.mjs`** — the same five edits (import `samplingFor`, delete `respondAtZero`, spread `...sampling.request` into the `respond` body, same usage block, return `effort, truncated`).

**Step 5: Run the whole suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all pass, including `tests/openai-network-retry.test.mjs` (it imports `respond`, which is unchanged) and `tests/provider-routing.test.mjs`.

**Step 6: Commit**

```bash
git add arms/cu-openai.mjs arms/wm-gpt.mjs tests/astra.test.mjs
git commit -m "fix(openai arms): drop the temperature probe, price cache writes, record effort/truncation"
```

---

## Task 3: `wm-gpt` timeout keeps its usage (small, optional but cheap)

Known and unchanged: every arm checks the 600 s deadline *between* turns, so one in-flight request can overrun it. Tightening that changes the measurement for all 16 existing configurations, so it is out of scope for an additive change; it stays disclosed in the results notes as before.

`cu-openai` already ends a timed-out attempt with `failure = "attempt timeout…"` and returns its usage. `wm-gpt` still `throw`s, which is the "accounting anomaly" the SOL report disclosed (timeouts drop their tokens and cost). Astra's slower first token makes this more likely to bite.

**Files:**
- Modify: `arms/wm-gpt.mjs` (the deadline check at the top of the loop, the `return`)

**Step 1: Edit**

Replace
```js
    if (performance.now() >= deadline) throw new Error("attempt timeout: 600s agent budget");
```
with
```js
    if (performance.now() >= deadline) { failure = `attempt timeout: ${ATTEMPT_MS / 1000}s agent budget`; break; }
```
declare `let failure = "";` and add `failure,` to the returned object. `harness/run.mjs` already turns `result.failure` into a failed verdict (line ~43).

**Step 2: Run tests, commit**

```bash
npm test 2>&1 | tail -4
git add arms/wm-gpt.mjs && git commit -m "fix(wm-gpt): a timed-out attempt keeps its usage and cost"
```

---

## Task 3b: New arm `code-openai` — OpenAI's recommended code-execution path for Astra

Shape, per OpenAI's computer-use guide (verified 2026-09-05): one function tool `exec_js` with `{ code: string }`; the model's JavaScript runs with Playwright `page` (and `context`, `browser`) in scope, `console.log` for text, `display(base64Png)` for an image, top-level `await`; results go back as `function_call_output`; the guide's own loop stops at 20 responses, but this arm uses the task's `cu` step budget (up to 30 on IDURAR) so it is measured under the same turn rules as `cu-openai` — disclose. Viewport 1440×900 per the guide — but we keep this repo's 1280×800 so screenshots are comparable across arms (disclose).

**Files:**
- Create: `arms/code-openai.mjs` (~120 lines)
- Modify: `harness/cli.mjs` (import + one `ARMS` row)
- Test: `tests/code-openai.test.mjs` (new)

**Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../arms/code-openai.mjs";

// Scripted fake Responses API: turn 1 asks to run code, turn 2 answers.
function fakeOpenAI(code) {
  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, { body }) => {
    bodies.push(JSON.parse(body));
    const first = bodies.length === 1;
    return new Response(JSON.stringify({
      model: "gpt-6-astra", status: "completed", reasoning: { effort: "medium" },
      output: first
        ? [{ type: "function_call", call_id: "c1", name: "exec_js", arguments: JSON.stringify({ code }) }]
        : [{ type: "message", content: [{ type: "output_text", text: "Final answer: ok" }] }],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { bodies, restore: () => { globalThis.fetch = original; } };
}
const page = {
  async setViewportSize() {}, async goto() {}, async waitForLoadState() {}, async waitForTimeout() {},
  async title() { return "Hello Capsule"; }, async screenshot() { return Buffer.from("png"); },
  context() { return { browser() { return {}; } }; },
};
const task = { id: "t", prompt: "do the thing", tier: "answer" };
const capsule = { baseUrl: "http://fake", meta: {} };

test("code-openai: runs the model's code with page in scope and returns stdout", async () => {
  const api = fakeOpenAI("console.log(await page.title())");
  try {
    const result = await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.equal(api.bodies.length, 2);
    assert.equal(api.bodies[0].tools[0].name, "exec_js");
    assert.ok(!("temperature" in api.bodies[0]));
    const out = api.bodies[1].input.find((i) => i.type === "function_call_output");
    assert.equal(out.call_id, "c1");
    assert.match(JSON.stringify(out.output), /Hello Capsule/);
    assert.equal(result.finalText, "Final answer: ok");
    assert.equal(result.turns, 2);
    assert.equal(result.effort, "medium");
  } finally { api.restore(); }
});

test("code-openai: display() attaches a screenshot", async () => {
  const api = fakeOpenAI("display((await page.screenshot()).toString('base64'))");
  try {
    await run({ task, capsule, page, model: "gpt-6-astra" });
    const out = api.bodies[1].input.find((i) => i.type === "function_call_output");
    assert.ok(out.output.some((part) => part.type === "input_image" && part.image_url.startsWith("data:image/png;base64,")));
  } finally { api.restore(); }
});

test("code-openai: a hanging snippet times out and ENDS the attempt (the snippet may still be running)", async () => {
  process.env.WT_CODE_EXEC_MS = "50";
  const api = fakeOpenAI("await new Promise(() => {})");
  try {
    const result = await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.equal(api.bodies.length, 1, "no second model turn after a timed-out snippet");
    assert.match(result.failure, /exec_js timeout/);
  } finally { api.restore(); delete process.env.WT_CODE_EXEC_MS; }
});

test("code-openai: a synchronous infinite loop is killed by the vm timeout and ends the attempt", async () => {
  process.env.WT_CODE_EXEC_MS = "50";
  const api = fakeOpenAI("while (true) {}");
  try {
    const result = await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.equal(api.bodies.length, 1);
    assert.match(result.failure, /exec_js timeout/);
  } finally { api.restore(); delete process.env.WT_CODE_EXEC_MS; }
});

test("code-openai: model code cannot see process, fetch or import", async () => {
  const api = fakeOpenAI("console.log(typeof process, typeof fetch, typeof require)");
  try {
    await run({ task, capsule, page, model: "gpt-6-astra" });
    const out = api.bodies[1].input.find((i) => i.type === "function_call_output");
    assert.match(out.output[0].text, /undefined undefined undefined/);
  } finally { api.restore(); }
});

test("code-openai: a throwing snippet returns the error text, not a crash", async () => {
  const api = fakeOpenAI("throw new Error('boom')");
  try {
    await run({ task, capsule, page, model: "gpt-6-astra" });
    const out = api.bodies[1].input.find((i) => i.type === "function_call_output");
    assert.match(JSON.stringify(out.output), /boom/);
  } finally { api.restore(); }
});
```

Run `node --test tests/code-openai.test.mjs` — expected: FAIL (module not found).

**Step 2: Write `arms/code-openai.mjs`**

Reuse, do not copy: `respond` from `./cu-openai.mjs` (retries/backoff), `samplingFor`/`BASE_SYSTEM`/`withToday`, `costFor`, `stepBudget`. Structure mirrors `cu-openai.run`:

```js
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { BASE_SYSTEM, samplingFor } from "./prompts.mjs";
import { respond } from "./cu-openai.mjs";

export const TOOL_VERSION = "exec_js";
const MODEL = "gpt-6-astra";
const MAX_TURNS = 25;                    // fallback only; task YAML `max_steps.cu` is authoritative (same rule as cu-openai).
                                         // OpenAI's guide suggests 20 for its own loop; we keep the CU budget so the two OpenAI screen arms are comparable.
const VIEWPORT = { width: 1280, height: 800 };
const ATTEMPT_MS = Number(process.env.WT_CODE_OPENAI_ATTEMPT_MS ?? 600_000);
const SCREENSHOT_WINDOW = 3;
const STDOUT_CAP = 8_000;
const execMs = () => Number(process.env.WT_CODE_EXEC_MS ?? 60_000);   // per exec_js call; read per call so tests can vary it
const SYSTEM = `${BASE_SYSTEM} You operate a web browser by writing JavaScript that runs with Playwright's page, context and browser objects in scope. console.log(value) returns text to you; display(base64Png) returns a screenshot to you. Top-level await is supported. Inspect the screen with display((await page.screenshot()).toString("base64")) before acting and after a short group of actions.`;
const TOOL = { type: "function", name: "exec_js", strict: true,
  description: "Run JavaScript in a persistent browser. Available: Playwright's browser, context, and page objects; console.log(value); display(base64Image); top-level await.",
  parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false } };
import vm from "node:vm";

// ponytail: node:vm context with only page/context/browser/console/display in
// scope — blocks casual process/fetch/import access from model code. Not a
// boundary against a hostile author (host-object prototype escape); threat model
// is a vendor model on pinned local capsules. Upgrade path: Worker/subprocess.
// Returns { output, timedOut } — a timed-out snippet may still be running and the
// attempt must end (the caller breaks), never hand the page back to the model.
// Timeout coverage: the vm `timeout` covers the synchronous part of the snippet
// up to its first `await` (so `while (true) {}` is killed); the Promise.race
// timer covers awaited work. A sync loop AFTER an await is the known gap —
// same ceiling as the sandbox, fixed by the Worker upgrade path if ever needed.
async function execute(page, code) {
  const logs = [], images = [];
  const log = (...xs) => logs.push(xs.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "));
  const display = (b64) => images.push(String(b64).replace(/^data:image\/png;base64,/, ""));
  const sandbox = { page, context: page.context(), browser: page.context().browser(), console: { log, error: log, warn: log, info: log }, display };
  let timer, timedOut = false;
  try {
    // Invoke INSIDE the vm so the sync prelude runs under `timeout`; the script has no access to this module's scope.
    const pending = vm.runInNewContext(`(async () => {\n${code}\n})()`, vm.createContext(sandbox), { timeout: execMs() });
    await Promise.race([
      pending,
      new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error(`exec_js timed out after ${execMs()} ms`)); }, execMs()); }),
    ]);
  } catch (error) { if (/Script execution timed out/.test(error.message)) timedOut = true; log(`Error: ${error.message}`); }
  finally { clearTimeout(timer); }
  const text = logs.join("\n").slice(0, STDOUT_CAP) || "(no output)";
  return { timedOut, output: [{ type: "input_text", text }, ...images.map((b64) => ({ type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "original" }))] };
}

export async function run({ task, capsule, page, model = MODEL }) {
  // setup identical to cu-openai (viewport, goto, networkidle, 2 s settle)
  // usage/transcript/limit/deadline identical to cu-openai after Task 2 (samplingFor, cache-write split, effort, truncated)
  // history = [{ role: "user", content: task.prompt }]; windowed() blanks input_image parts
  //   in all but the last SCREENSHOT_WINDOW function_call_output items to
  //   { type: "input_text", text: "[stale screenshot removed]" }
  // loop: respond({ model, instructions: withToday(SYSTEM), tools: [TOOL], input: windowed(), parallel_tool_calls: false, ...sampling.request })
  //   push response.output to history; for each function_call named exec_js:
  //     const { code } = JSON.parse(call.arguments ?? "{}");
  //     transcript.push({ turn, code });
  //     const { output, timedOut } = await execute(page, code);
  //     history.push({ type: "function_call_output", call_id: call.call_id, output });
  //     if (timedOut) { failure = `exec_js timeout: ${execMs()} ms — snippet may still be running, attempt ended`; break; }
  //   no function_call → break
  // return the same shape as cu-openai.run plus effort/truncated; caching: "provider-managed"
}
```

Write the elided parts by reading `arms/cu-openai.mjs` `run` after Task 2 and transcribing — not by importing it. Probe before trusting the `function_call_output.output` array shape: run one real Responses call with an `input_text` + `input_image` array as `output` against `gpt-6-astra` (`node --env-file=.env -e ...`, ~$0.01). If the API rejects the array, fall back to `output: text` and put the screenshot in a following `{ role: "user", content: [{ type: "input_image", ... }] }` item; record which in a comment.

**Step 3: Register the arm**

`harness/cli.mjs`: add `import { run as runCodeOpenAI, TOOL_VERSION as CODE_OPENAI_VERSION } from "../arms/code-openai.mjs";` and the row
```js
  "code-openai": { id: "code-openai", run: runCodeOpenAI, model: "gpt-6-astra", version: CODE_OPENAI_VERSION, key: "OPENAI_API_KEY", paid: true },
```
Grep `harness/run.mjs`, `harness/lib.mjs`, `scoring/` for any allow-list of arm ids or `cu-`/`wm-` prefix logic that decides budgets (`stepBudget(task, "cu", …)`: the new arm passes `"cu"` so it gets the screen-driving step budget — the fair choice, disclose it).

**Step 4: Run tests, commit**

```bash
node --test tests/code-openai.test.mjs && npm test 2>&1 | tail -4
git add arms/code-openai.mjs harness/cli.mjs tests/code-openai.test.mjs
git commit -m "feat(arms): code-openai — OpenAI's code-execution computer-use path (exec_js over Playwright)"
```

---

## Task 4: Chart labels and merge expectations for a 19-configuration board

**Files:**
- Modify: `scripts/readme-charts.mjs` (`MODEL_LABEL`, `NATIVE_WM`, `NATIVE_CU`, lines ~34–52)
- Modify: `harness/build_explorer.mjs` (group by arm × model; `code` class; cache writes in `tok`)

**Step 1: Edit `scripts/readme-charts.mjs`**

```js
const MODEL_LABEL = {
  "claude-sonnet-5": "Sonnet 5", "claude-opus-5": "Opus 5",
  "gpt-5.6-luna": "Luna", "gpt-5.6-sol": "SOL", "gpt-6-astra": "Astra", "gemini-3.6-flash": "Gemini 3.6",
};
```
and add `"gpt-6-astra": "wm-gpt"` to `NATIVE_WM`, `"gpt-6-astra": "cu-openai"` to `NATIVE_CU` (the native pair stays CU vs WebMCP; `code-openai` is a third bar, not part of the pair). Add `"code-openai": "code exec"` to `ARM_LABEL`. `KIND`/`fill`/legend get an explicit `code` kind (Step 1a below) — the default would silently draw it in the amber the legend captions "DOM / accessibility tree", which is wrong.

**Step 1b: `harness/build_explorer.mjs` — three fixes, two of them pre-existing bugs the Astra rows would make worse**

1. *Aggregate by configuration, not arm* (pre-existing: the canonical explorer already pools Luna and SOL into one `cu-openai` and one `wm-gpt` row; Astra would make it three models in one row). One shape everywhere: `const cfgKey = (r) => `${r.arm}\u0000${r.model}`;` and every aggregate is `{ key, arm, model, label, n, pass, cost, ms, tk }` with `label = `${METHOD_LABEL[arm] ?? arm} · ${MODEL_LABEL[model] ?? model}`` (add a `MODEL_LABEL` map matching `readme-charts.mjs`). Apply to all four places that currently group on `r.arm`: `allMethods`/`methodAgg` (~line 82), `taskCard`'s `byMethod` (~line 91), the tier solved-count cells (~line 219–225, key `site|task|arm` → `site|task|arm|model`), and `flatCells` (~line 240, same). `CLASS`/`IFACE` take `.arm`. `GROUPS` (~line 148) pools per interface on purpose; change `aggOf(arm)` → `methodAgg.filter((a) => a.arm === arm)` and `g.arms.map(aggOf).filter(Boolean)` → `g.arms.flatMap(aggsOf)`. Grep for any other `r.arm ===`/`.m ===` equality after these edits; there must be none left that is meant per-configuration.
2. *Code-execution class*: `METHOD_LABEL["code-openai"] = "Code execution · GPT"`; `IFACE`: `a === "code-openai" ? "Code execution (Playwright)"`; `CLASS`: `a.startsWith("code") ? "code"` before the `struct` fallback, plus a `.code`/`--code` CSS color in the page's stylesheet (grep `--struct` and mirror it); `GROUPS`: add `{ label: "Code execution (Playwright)", arms: ["code-openai"], cls: "code" }` after Screenshots. Update the lead prose (~line 195–199): "three ways it can see and act" → "four", and add the fourth interface sentence.
3. *Token totals include cache writes*: `tok` (~line 50) sums input + cached + output; `readme-charts.mjs` already adds `cache_write_tokens`. Add `(+r.cache_write_tokens || 0)` so the two artifacts agree (affects only rows that report writes — the OpenAI arms after Task 2).

Add `tests/explorer.test.mjs`: feed `renderExplorerHTML` six rows — same arm, two models, three rows each with different `est_cost_usd` and pass values — and assert (a) two distinct config labels appear, (b) each label's row shows its own pass count (e.g. `3/3` vs `1/3`), (c) the flat table has two entries for that site/task, (d) the tier count is not pooled. Regex against the HTML is fine. 

`expansionAgg` (~line 49) iterates every `NATIVE_WM` key; with Astra mapped but no rows yet, `aggregate([])` yields `NaN` (`0/0`, `median([])`) and the SVG changes. Guard it: `const has = (arm, model) => canonRows.some((r) => r.arm === arm && r.model === model);` and iterate `Object.keys(NATIVE_WM).filter((model) => has(NATIVE_WM[model], model) && has(NATIVE_CU[model], model))` — both halves of the pair must have rows, or the pair is skipped. Then the pre-results render stays byte-identical.

Add a fourth kind so code execution is not drawn and captioned as "DOM / accessibility tree": `KIND`: `arm.startsWith("code") ? "code"` before the `structured` fallback; a `code` color in both `THEME` palettes (pick a distinct hue, e.g. green `#1a7f37` light / `#3fb950` dark); `fill`: `a.kind === "code" ? t.code`; and a fourth legend swatch "code execution" at `PAD + 340` (check it fits `W`; widen if the script's overflow guard throws).

**Step 2: Verify the README charts still render the current board unchanged** (the explorer is *expected* to change — Luna and SOL split into separate rows — so regenerate it in Task 7, not here)

```bash
node scripts/readme-charts.mjs && git status --short assets/
```

Expected: `wrote the model-comparison and leaderboard panels…` and **no diff** under `assets/` (Astra has no rows yet, so output is byte-identical).

**Step 3: Commit**

```bash
npm test 2>&1 | tail -4
git add scripts/readme-charts.mjs harness/build_explorer.mjs tests/ && git commit -m "charts+explorer: Astra labels, code-execution class, explorer keyed by arm×model, cache writes in token totals"
```

---

## Task 5: Smoke test (paid, ~$2–5) — the gate before any flight

Mirror the house convention: one answer task on the control blog + one long action on IDURAR, one attempt each, then `smoke-gate.mjs`. Scoring is **not** a criterion; the gate checks model identity, usage, no unsupported-parameter error, no truncation, no infra failure.

**Step 1: Near-free dry run of the whole pipeline with the Astra overrides**

```bash
WT_FAKE_LIFECYCLE=1 node --env-file=.env harness/cli.mjs --preset smoke --sites lite \
  --arms cu-openai,wm-gpt,code-openai --model cu-openai=gpt-6-astra --model wm-gpt=gpt-6-astra --model code-openai=gpt-6-astra --label astra-dry
```

`fakePage()` in `harness/cli.mjs` (~line 124) only has `goto`, `title`, `locator`, so today this dry run crashes inside every arm before reaching the API. First extend it with the shared Playwright surface as async no-ops: `setViewportSize`, `waitForLoadState`, `waitForTimeout`, `waitForFunction`, `screenshot` (returns a 1×1 PNG buffer), `evaluate` (returns `[]`), `context()` returning `{ addInitScript: async () => {}, browser: () => ({}) }`, and `mouse`/`keyboard` objects whose `click/move/down/up/wheel/dblclick` and `type/press/down/up` are async no-ops (`cu-openai`'s `executeAction` uses all of them; without them every action errors into the transcript and the run still "completes"). Commit that as `test(harness): fake page covers the CU/WebMCP/code arms' setup surface`. Then the expected result is: a report under `results/…-astra-dry/`; rows show `model: gpt-6-astra` for all three arms; `wm-gpt` rows fail with `no live WebMCP tools registered` (the fake `evaluate` returns no tools); the CU and code rows hit the real API and exercise the request/response plumbing end to end (each may take a few turns since the fake page never changes — that is fine, `--budget` bounds it). This checks setup + API shape + accounting, not task behaviour. Costs cents. Delete the folder afterwards: `rm -rf results/*-astra-dry`.

**Step 2: Real smoke, blog (answer tier)**

```bash
node --env-file=.env harness/cli.mjs --preset smoke --sites tailwind-nextjs-blog \
  --arms cu-openai,wm-gpt,code-openai --model cu-openai=gpt-6-astra --model wm-gpt=gpt-6-astra --model code-openai=gpt-6-astra \
  --budget 5 --label astra-smoke
node scripts/smoke-gate.mjs $(ls -d results/*-astra-smoke | tail -1) --model gpt-6-astra
```

Expected: `GATE PASSED`, `models: gpt-6-astra (served gpt-6-astra)`, `effort: medium`, `temperature: default`, cache line shows non-zero `write` tokens on the CU rows (screenshots exceed the 1,024-token minimum). Open the `code-openai` transcript and read the code Astra wrote: it should be Playwright against `page` with at least one `display()` screenshot; if it never screenshots or never queries the page, the system prompt is off — fix and re-smoke.

**Step 3: Real smoke, IDURAR long action (the multi-field form `id-6`)**

```bash
node --env-file=.env harness/cli.mjs --preset smoke --sites idurar-erp-crm \
  --arms cu-openai,wm-gpt,code-openai --model cu-openai=gpt-6-astra --model wm-gpt=gpt-6-astra --model code-openai=gpt-6-astra \
  --task-ids id-6 --n 1 --budget 6 --label astra-smoke-idurar
node scripts/smoke-gate.mjs $(ls -d results/*-astra-smoke-idurar | tail -1) --model gpt-6-astra
```

Expected: `GATE PASSED`. Also eyeball the CU row's `agent_s` against the 600 s cap and `model_turns` against the task's CU budget (`id-6` is 30 — see `tasks/idurar-erp-crm.yaml`); if Astra is within 20% of either on a single long task, say so in the flight notes but do **not** change budgets (a changed budget is a new benchmark generation).

**Step 4: Decide `max_output_tokens` for `wm-gpt`**

If the gate reports `response hit max_tokens` on any `wm-gpt` row, raise `max_output_tokens` in `arms/wm-gpt.mjs` to `16384` **for `gpt-6-astra` only** (mirror `maxTokensFor` in `arms/prompts.mjs`: add an `openaiMaxOutputFor(model)` returning 16384 for `gpt-6-` prefixes, 4096 otherwise), re-run Step 2, and record the change in the PROVENANCE. If no truncation: leave it.

**Step 5: Commit the smoke artifacts**

```bash
git add results/*-astra-smoke* && git commit -m "results: gpt-6-astra smokes (blog answer + IDURAR id-6) — gate passed"
```

---

## Task 6: Full flight, three arms (paid, expect $75–115)

Serial, on this Mac/Docker host, nothing else benchmarking concurrently (timing contamination). Never change a timeout, prompt, model setting, or harness mid-flight; abort, fix, restart the complete flight instead.

**Step 1: Start the independent spend watchdog in a second pane**

```bash
node scripts/watchdog.mjs --cap 140 --poll 15
```

**Step 2: Launch**

```bash
node --env-file=.env harness/cli.mjs --preset full --sites full \
  --arms cu-openai,wm-gpt,code-openai --model cu-openai=gpt-6-astra --model wm-gpt=gpt-6-astra --model code-openai=gpt-6-astra \
  --n 3 --budget 130 --label astra-full 2>&1 | tee results/astra-full.log
```

Expected duration: SOL's paired flight was roughly a working day on this host; a third arm plus Astra's slower first token means plan on ~1.5 days. Leave the Mac awake and plugged in. `results/live.jsonl` is the mid-flight scoreboard.

**Step 3: Post-flight checks**

```bash
DIR=$(ls -d results/*-astra-full | tail -1)
node scripts/smoke-gate.mjs "$DIR" --model gpt-6-astra          # same gate, full run: identity + accounting on every row
python3 - "$DIR" <<'EOF'
import csv, sys, collections
rows = list(csv.DictReader(open(f"{sys.argv[1]}/results.csv")))
by = collections.Counter((r["arm"]) for r in rows); print(dict(by))              # expect 147 each, three arms
infra = [r for r in rows if r["failure_category"].startswith("harness-infra")]; print("infra rows:", len(infra))
to = [r for r in rows if "attempt timeout" in r["failure_category"]]; print("timeouts:", len(to))
EOF
```

Expected: 147 rows per each of the three arms (441 total); infra rows 0 (each one must be re-run as a complete 3-attempt cell — see Step 4); timeouts counted as failures, not re-run.

**Step 4: Targeted re-runs for infrastructure rows only**

For each cell with an infra row (provider 429/5xx, capsule boot), re-run the **whole cell** so `combined-explorer.mjs` accepts it:

```bash
node --env-file=.env harness/cli.mjs --preset full --sites <site> --arms <arm> --model <arm>=gpt-6-astra \
  --task-ids <task-id> --n 3 --budget 5 --label rerun-<arm>-gpt-6-astra-<site>
```

**Step 5: Report + commit**

Fill `$DIR/report.md` from the generated one (it is auto-written; add the Notes: timeouts, turn-cap counts, host = macOS/Docker Desktop, harness fixes 1–4 above). Commit:

```bash
git add results/*-astra-full* results/*rerun-*gpt-6-astra* && git commit -m "results: gpt-6-astra full run (cu-openai + wm-gpt + code-openai), N=3, 600s cap"
```

---

## Task 7: Merge into the canonical board and regenerate charts

**Files:**
- Regenerate: `results/canonical/*` (via script), `assets/charts/*.svg` (via script)

**Step 1: Re-run the canonical merge with the Astra dirs appended**

The 42 source dirs are listed in `results/canonical/PROVENANCE.md` in precedence order. Append the new ones and raise the expected configuration count:

```bash
# Order matters: 41 old sources, then the Astra dirs, then the scorer-corrections
# overlay LAST so it keeps precedence over everything (read combined-explorer.mjs's
# header comment first and confirm entry 42 is still `2026-08-20-scorer-corrections`).
OLD=($(sed -n 's/^[0-9]*\. //p' results/canonical/PROVENANCE.md | head -42))
# find, not a glob: zsh aborts the whole command on an unmatched pattern. ${OLD[-1]}, not
# ${OLD[41]}: zsh arrays are 1-indexed, bash 0-indexed; the negative index means "last" in both.
ASTRA=($(find results -maxdepth 1 \( -name '*-astra-full' -o -name '*rerun-*gpt-6-astra*' \) -exec basename {} \; | sort))
[ ${#ASTRA[@]} -ge 1 ] && [ ${#OLD[@]} -eq 42 ] || { echo "expected 42 old dirs and ≥1 astra dir"; exit 1; }
node scripts/combined-explorer.mjs --out canonical --expect-configs 19 \
  "${OLD[@]:0:41}" "${ASTRA[@]}" "${OLD[-1]}"
```

Expected: `PROVENANCE.md` now lists 19 `arm × model` configurations including `cu-openai × gpt-6-astra`, `wm-gpt × gpt-6-astra` and `code-openai × gpt-6-astra`, each 49 cells; no `partial replacement rejected` lines. The command above already places `2026-08-20-scorer-corrections` (entry 42) last; verify that in the regenerated PROVENANCE ordering.

**Step 2: Regenerate the README charts**

```bash
node scripts/readme-charts.mjs
```

Expected: success; the script throws if the new "Astra · CU"/"Astra · WebMCP"/"Astra · code exec" labels overflow their column. Open both SVGs and check the code-exec bar is visibly not in the WebMCP color.

**Step 3: Commit**

```bash
git add results/canonical assets/charts && git commit -m "results: canonical board with GPT-6 Astra (19 configurations)"
```

---

## Task 8: Documentation

Every number below comes from `results/canonical/results.csv` after Task 7 — never from memory. Compute with the same definitions the README already uses (majority of 3; medians over non-infra rows; tokens = uncached + cached + write + output).

**Files:**
- Modify: `README.md`
- Modify: `docs/SPEC.md` (§6 table, the "canonical run uses…" sentence, the price-table paragraph)
- Modify: `results/README.md`
- Modify: `results/model-comparison.md`
- Modify: `hf/build_dataset.py` (`EXPECTED_ROWS` → attempts 2793, verdicts 931, transcripts 2793; `interface()` gains `code-openai → "code execution (Playwright)"`), `hf/verify_package.py` (expected dims → attempts 2793, verdicts 931, configurations 19; the 784 duplicate-cell check → 931)
- Modify: `hf/dataset/README.md`, `hf/space/README.md` (counts), and rebuild parquet (see Step 5)
- Modify: `CONTEXT.md` — add `code-openai` to the arm glossary (one line: OpenAI code-execution path, own interface class). Its "ships seven" count line is already stale; fix it while there.

**Step 1: `README.md`**

- Badge: `results-16%20configurations%20%C2%B7%202%2C352%20attempts` → `19 … 2,793`.
- "Canonical run: 2026-08-20 — 16 configurations … 2,352 attempt rows and 784 majority verdicts" → new date, 19, 2,793, 931.
- Leaderboard table: insert the three Astra rows in their sorted positions (`GPT-6 Astra · native | WebMCP | …`, `GPT-6 Astra | computer use | …`, `GPT-6 Astra | code execution (Playwright) | …`). Re-check the "Eight configurations tie at 48/49" sentence and the headline multiples paragraph — if Astra changes either (e.g. a ninth tie, or a new max same-model ratio), rewrite those sentences from the data.
- "The methods": "10 implementations and 16 model-interface configurations across Sonnet 5, Opus 5, GPT-5.6 Luna, GPT-5.6 SOL, and Gemini 3.6 Flash. Seven … WebMCP and nine …" → "11 implementations and 19 model-interface configurations", add GPT-6 Astra, eight WebMCP / eleven screen-driving. Add one sentence: *GPT-6 Astra also runs OpenAI's recommended code-execution path, where the model writes Playwright code against the page; it is reported as its own interface, not as computer use.*
- "Cost" per-task medians table: WebMCP configurations 7→8, Computer use 5→6, and a new one-row "Code execution" line; update the min/max ranges; update "full canonical leaderboard (measured)" total (previous $175.62 + tracked Astra spend).
- "Keys" comment: `# cu-openai, wm-gpt, code-openai (gpt-5.6-*, gpt-6-astra)`.
- "Switching models" example: add
  `npm run bench -- --preset smoke --sites lite --arms cu-openai,wm-gpt,code-openai --model cu-openai=gpt-6-astra --model wm-gpt=gpt-6-astra --model code-openai=gpt-6-astra`.

**Step 2: `docs/SPEC.md` §6**

- Table rows `cu-openai` and `wm-gpt`: canonical models `gpt-5.6-luna, gpt-5.6-sol, gpt-6-astra`. New row: `| \`code-openai\` | code execution (Playwright) | OpenAI function tool \`exec_js\`; model-written JS runs in the harness with Playwright \`page\` in scope; stdout + display() screenshots returned | gpt-6-astra | built · measured |`. Add a short paragraph under the table: what it is, why it is a separate interface class (can both query selectors and screenshot), that it runs at the screen-driving step budget, 1280×800, and that the code executes in-process against local capsules.
- "The canonical run uses Sonnet 5, Opus 5, GPT-5.6 Luna, GPT-5.6 SOL, and Gemini 3.6 Flash" → add GPT-6 Astra.
- "Model prices" paragraph: add one sentence — *OpenAI reports cache writes inside `input_tokens`; the OpenAI arms split them out and price them at the provider's cache-write rate (1.25× input on GPT-5.6+/Astra).*
- Sampling note: the OpenAI arms send no `temperature` (reasoning models reject it); rows record `temperature: default` and the provider-reported `effort`.

**Step 3: `results/README.md` and `results/model-comparison.md`**

- `results/README.md` run table: add `2026-09-XX-astra-smoke*`, `2026-09-XX-astra-full` ("GPT-6 Astra paired full run") and any `rerun-*-gpt-6-astra-*` rows; extend the model-comparison sentence to name GPT-6 Astra.
- `model-comparison.md`: add `Computer use | GPT-6 Astra`, `Code execution | GPT-6 Astra` and `WebMCP | GPT-6 Astra` rows to the main table, an Astra column to "Majority-task success", a "GPT-6 Astra | $x" row to "Tracked run cost", and 2–3 Takeaway bullets written from the numbers (attempt success vs SOL and Opus; cost per task vs SOL given the 2× price; code execution vs native computer use on the same model — did OpenAI's recommended path actually win, and at what cost; turn-cap and timeout counts).

**Step 4: Commit docs**

```bash
git add README.md docs/SPEC.md results/README.md results/model-comparison.md
git commit -m "docs: GPT-6 Astra on the leaderboard — README, spec, results index, model comparison"
```

**Step 5: Hugging Face package (rebuild; upload is a separate, confirmed step)**

```bash
sed -n 1,40p hf/UPLOAD.md      # follow the $HFPY venv instructions there
$HFPY hf/build_dataset.py && $HFPY hf/verify_package.py
cp results/canonical/explorer.html hf/space/index.html
```

Update the "16 configurations / 2,352 attempts / 784 verdicts" counts to 19 / 2,793 / 931 and the leaderboard table in `hf/dataset/README.md` and `hf/space/README.md`. Commit:

```bash
git add hf && git commit -m "hf: rebuild dataset + space for the 19-configuration board (builder/verifier expect 19 / 2,793 / 931; code-openai interface)"
```

Do **not** push to the Hub without the user's go-ahead (external publish).

---

## Task 9: Open the PR

```bash
npm test 2>&1 | tail -4 && WT_FAKE_LIFECYCLE=1 npm run bench >/dev/null && echo dry-run-ok
git push -u origin bench/astra-gpt-6
gh pr create --title "Benchmark GPT-6 Astra: paired computer-use + WebMCP configurations (16 → 19)" --body-file - <<'EOF'
## What
Adds OpenAI GPT-6 Astra (`gpt-6-astra`) to the canonical leaderboard as three configurations: `cu-openai` (native `computer` tool), `wm-gpt` (native WebMCP loop), and the new `code-openai` arm — OpenAI's recommended code-execution path for Astra, where the model writes Playwright JavaScript via an `exec_js` function tool. `code-openai` is reported as its own interface class (it can both screenshot and query the page), never under "screenshots". 49 tasks × 8 sites × 3 attempts each, 600 s cap, provider-default reasoning (`medium`).

## Harness corrections shipped with it (disclosed in PROVENANCE)
- `gpt-6-astra` price row ($10 / $50 / $1 cached / $12.50 cache write).
- OpenAI arms no longer probe `temperature: 0` (rejected with a 400 by every GPT-5.x/6 reasoning model; the fallback doubled every request).
- Cache-write tokens are split out of `input_tokens` and priced at the write rate.
- Rows record provider-reported `effort` and `truncated`.
- `wm-gpt` keeps usage on a timeout (parity with `cu-openai`).
- `cu-openai` keypress is a chord (Ctrl+A now works); xdotool/DOM key names normalized. Existing Luna/SOL CU rows measured before this fix are retained and flagged in PROVENANCE.
- Smoke gate no longer mistakes a predicate's `400` for an HTTP 400.

## Results
<paste the three leaderboard rows + tracked cost; one line on code execution vs native computer use>

## Disclosed choices for `code-openai`
Runs at the screen-driving step budget, 1280×800 viewport (OpenAI's guide uses 1440×900), 60 s per `exec_js` call, stdout capped at 8 KB, last 3 screenshots kept in context (same window as the CU arms). Model code executes in the harness process against pinned local capsules.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Ask before pushing: pushing publishes the branch.

---
