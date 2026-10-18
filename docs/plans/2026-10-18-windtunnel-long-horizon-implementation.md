# WindTunnel Long Horizon — implementation plan

Updated 2026-10-18 · short id `lh` · for: the coding agent that builds it and the engineer supervising it

## 1. Purpose

WindTunnel Long Horizon (lh) gives WebMCP agents long jobs (about 10 to about 250 tool calls) on four Classic sites filled with much more data. It answers three questions:

- **Q1:** how long a job each model can do before it fails half the time (its horizon).
- **Q2:** whether a site map (`webmcp.json`) helps an agent find the right tool.
- **Q3:** whether code mode with self-healing cuts cost without lowering success.

This document says how to build it in this repo. The source of truth for the reasons behind the design is [`docs/plans/2026-10-18-windtunnel-long-horizon.md`](2026-10-18-windtunnel-long-horizon.md). If this plan and that document disagree on a design decision, stop and ask.

## 2. Ground rules for the coding agent

1. **No paid model calls without the human's explicit go-ahead.**
   - Get a go-ahead for each paid command, with its budget written down.
   - Every script that can reach a model API refuses to start without `--budget <usd>`.
   - All spend goes through one ledger (task B4) with a hard cap of **$300** for the whole project.
   - Unit tests mock every network call.
2. **Do not modify v1.3 artifacts.** Never edit:
   - `tasks/`, `goldens/`, `results/canonical/` or any other existing `results/*` directory
   - `capsules/`, `fixtures/`, `sites/sites.yaml`, `configs/model-refresh.json`
   - any top-level `*.mjs` in `arms/`, `harness/` or `scoring/`
   - `scripts/model-refresh.mjs`, `scripts/native-flight.mjs`, `scripts/check-golden-leakage.mjs`
   - `package.json`, `package-lock.json`, `.gitignore`, `.github/`
   - `harness/lib/*.sh`, `harness/lib/*.mjs`

   Why: `configHash()` (`scripts/model-refresh.mjs:14-17`) hashes `package-lock.json`, those two scripts, `configs/model-refresh.json` and every top-level `.mjs` in `arms/`, `harness/`, `scoring/`; the v1 fingerprint (`native-flight.mjs:27`) and `validateRun` (`model-refresh.mjs:31`) depend on it. `site-adapter.sh` and `capsule-lifecycle.sh` are in every prepare-cache key (`harness/bin/capsule:160-162`). Subdirectories are not hashed, so new code goes under `harness/lh/`, `scoring/lh/`, `scripts/lh/`.

   **The only edit allowed to an existing file** is the env-gated one-line change to `harness/bin/observe:37` (task D1). Any other change to an existing file needs the human's approval first.
3. **Keep v1.3 green.** `npm test` must pass after every commit. Do not break these pins:
   - `tests/wm-claude.test.mjs:20-21` (`maxTokensFor`)
   - `tests/model-refresh.test.mjs:26`, `:42-51`, `:55`, `:273-275` (22 configs, `costFor` values, infra strings)
   - `tests/outage-resilience.test.mjs:24-32` (agent-failure strings)
   - `tests/sites.test.mjs:12`
4. **Test discovery and CI.**
   - `npm test` is a bare `node --test`, which picks up `**/*.test.mjs`, `**/test-*.mjs` and anything under a directory named `test/`, across the whole repo. Put lh tests in `tests/lh/*.test.mjs`. Never create a `test/` directory or a `test-*.mjs` file anywhere, and never clone upstream apps inside the repo.
   - CI (`.github/workflows/test.yml`) runs `npm ci && npm test` on Node 20.11 and 22, with no browser and no Docker. Code that unit tests import must run on Node 20.11.
   - Tests that launch Chromium skip unless `WT_BROWSER_TESTS=1`. Tests that need Docker capsules skip unless `WT_LIVE_CAPSULE=1` (pattern: `tests/medusa-checkout.live.test.mjs:9-13`).
   - To run only lh tests, use a quoted glob, which needs Node 21 or later: `node --test 'tests/lh/**/*.test.mjs'`. `node --test tests/lh/` fails on Node 22.
5. **Work in small steps on a branch.**
   - Branch `long-horizon` from `claude/windtunnel-long-horizon-plan` (commit `c65aafe`), which holds the design doc. `main` (`0983d0e`) does not have it.
   - One sub-branch per milestone, merged into `long-horizon` when its "Done when" checks pass. Small commits, each with its tests.
   - Push and open PRs only when the human asks.
6. **Dry-run first.** Use `WT_FAKE_LIFECYCLE=1`, the replay adapter (L5) and the `lh-scripted` arm (H10) before any live or paid run.
7. **Verify, don't guess.** Facts marked **verify** come from reading code or docs, not from a live check. Check each one before you build on it.
   - If a fact is wrong and the fix stays inside one task, record it in `docs/plans/lh-decisions.md` (date, finding, choice) and carry on.
   - If the fix changes the design, the budget or a frozen artifact, stop and ask.
8. **Stop at every human checkpoint** in §5.
9. **Never repair a job during scored runs.** A broken job is dropped and listed in the report.
10. **Scoring must be deterministic.** Everything that affects a score follows from the seed id and the job file: no wall-clock dates and no unseeded randomness.
11. **Output locations.** Everything that changes during runs (ledger, checkpoints, status, STOP file, live rows, transcripts, check sidecars, probe output) goes under `results/long-horizon/raw/`. `.gitignore` already ignores `results/**/raw/`. Only final reports are written to `results/long-horizon/<campaign>/` and committed.

## 3. Repo map

### Existing files to read and reuse (do not edit)

| File | Why it matters |
|---|---|
| `docs/plans/2026-10-18-windtunnel-long-horizon.md` | Design and rationale |
| `docs/plans/2026-09-06-medusa-complete-checkout.md:40,285-287` | How to build a golden patch against a pinned revision |
| `arms/wm-claude.mjs` | v1 bridge `installModelContextBridge` :19-49, `listLiveTools` :51, `prepareWebMCPPage` :55-66, `executeBridgeTool` :68-71 |
| `arms/wm-gpt.mjs` | `respond()` :14-47: OpenAI transport with backoff. It cuts error bodies to 300 characters (:21) |
| `arms/cu-gemini.mjs` | `respond()` :50-82: Gemini Interactions transport; error bodies cut to 500 characters (:70). `geminiUsage` :34-41 |
| `arms/code-openai.mjs` | `node:vm` sandbox pattern in `execute()` :41-61 (not exported; copy the pattern) |
| `arms/wm-stagehand.mjs:54-80` | Precedent for `list_site_tools` / `call_site_tool` meta-tools |
| `arms/prompts.mjs` | `BASE_SYSTEM`, `MECHANICS` :1-2, `providerFor` :16, `withCacheBreakpoint` :36-41 |
| `harness/run.mjs` | v1 `runBatch`: model for the lh runner (reset :44, context :48, scoring :55-57, rows :75-124) |
| `harness/cli.mjs` | v1 CLI: ARMS :29-50, fake page :147-162, flight abort on a 400 :274-277 |
| `harness/capsule.mjs` | `STEP_TIMEOUT_MS` :17, `shellLifecycle` :30-53, `fakeLifecycle` :54, `bootCapsule` :98 (`lifecycle ??=` at :112-116; `observe` override at :139) |
| `harness/tasks.mjs` | `resolveTask` :29-42, `withToday` :55 (real date), `stepBudget` :61-66 |
| `harness/lib.mjs` | `CSV_COLUMNS` :4, infra regex :21-28, `classifyFailure` :37, `isInfraRow` :40-45, `PRICES` :59, `costFor` :82-90 |
| `harness/openrouter.mjs` | `nativeAnthropicOptions` :14-19, `responseRefused` :21 |
| `harness/lib/webmcp-verify.mjs` | `validateTools` :189-245. Annotation keys at :6 lack the `*Hint` suffix the goldens use |
| `harness/lib/site-adapter.sh:690-712` | `capsule_vendor_sdk`; golden path hard-coded at :699, applied only when `WT_WEBMCP=1` (:698) |
| `harness/bin/capsule` | Lifecycle CLI. Absolute `CAPSULE_DEFINITIONS_ROOT` (:23-36); timeouts from env (:231-239) |
| `harness/bin/observe` | Probe runner. Oracle path hard-coded at :37; oracle hash check at :74 |
| `scoring/predicates.mjs`, `scoring/report.mjs` | v1 grammar (not used by lh); v1 `hashes()` :19-24 |
| `scripts/native-flight.mjs` | `readCheckpoint` :19, `appendCheckpoint` :49 (both exported), v1 `cellKey` :17, STOP and `ACCOUNTING_HOLD` handling, lock :16 |
| `capsules/<site>/`, `fixtures/<site>/`, `goldens/<site>.reference.patch` | v1 capsule definitions, seeders and tools to copy from |
| `experiments/jev/webmcp/readiness.mjs:13-120`, `readiness-check.mjs:25-61` | Tool-polling wait and a Chromium test fixture |

### New trees

| Path | Contents |
|---|---|
| `configs/long-horizon.json` | Prices, aliases, configs, seed sets, stages, locked settings, frozen hashes |
| `harness/lh/` | config, bridge, tool-result, page session, budget, pricing, transcript, rows, world, runner, CLI, clock, agent loop, context policy, transports, manifest, world-change controller, code sandbox |
| `harness/lh/adapters/`, `harness/lh/surfaces/`, `harness/lh/arms/` | `anthropic`, `openai`, `gemini`, `replay`; `native`, `fixed3`, `code`; `scripted` |
| `scoring/lh/` | `path`, `assert`, `schema`, `diff`, `checker`, `q2-metrics`, `custom/<family>.mjs` |
| `capsules-lh/<site>/`, `capsules-lh/lib/lh-adapter.sh` | lh capsule definitions (4 sites plus learnhouse) |
| `fixtures-lh/` | `universe/generate.mjs` and per-site seeders |
| `seeds-lh/<seed-id>/` | Generated `universe.json`, `manifest.json`, `expect/<job-id>.json` |
| `goldens-lh/` | `<site>.reference.patch` (full patch against the pinned revision) and `<site>.delta.patch` (diff from v1.3, for review) |
| `manifests-lh/` | `sites/<site>.yaml` crawl recipes, crawled `<site>.<role>.webmcp.json`, `fake/`, `wrong/` |
| `tasks-lh/` | `families/<family>/{family.yaml,prompt.md,expect.mjs,recipe.mjs}`, `q2/<site>.yaml` |
| `scripts/lh/` | probes, ledger, golden build, crawler, depth, leakage checks, fault injection, red-team, flight, analysis, report, rescore |
| `tests/lh/`, `tests/fixtures-lh/` | Unit, browser and live tests; canned pages, states and manifests |
| `results/long-horizon/raw/` (ignored) and `results/long-horizon/<campaign>/` (committed reports) | All lh output |

## 4. Milestones

Lanes: **A** harness, loop, code mode, parallel runs · **B** data, capsules, tools · **C** scoring, jobs, maps, analysis. Sizes: S = a day or less, M = 2–5 days, L = 1–3 weeks.

| Milestone | Weeks | Lane | Depends on |
|---|---|---|---|
| M0 Baseline, predictions, guardrails, ledger | W0–W1 | A | none |
| M1 Week-1 API probes (paid, ≤ $2) | W1 | A | B3, B4, CP1 |
| M2 Harness core | W1–W3 | A | M0 |
| M3 Agent loop, adapters, context policy, tool surfaces | W1–W3 (live wiring W5, after C2) | A | M1, M2 |
| M4 Scoring v2 | W1–W4 | C | M0 |
| M5 Seed universe, lh capsules, probes, world changes | W1–W4 (critical path) | B | M0 |
| M6 goldens-lh tools (frozen end of W4) | W1–W4 | B | D1, D3–D6, C1a |
| M7 Map crawler and Q2 arms | C1a W2–W4; C1b–C4 W5 | C | H3, H7, D7; T4 for C1b |
| M8 Code mode | W2–W4 | A | H3, H11, L1 |
| M9 Jobs (~75) | W3–W6 (critical path) | C | M4, M5, M6, C4 |
| M10 Parallel runs and flight runner | W4–W6 | A | B4, H7, H8 |
| M11 Analysis and report | W5–W9 | C | H6 |
| M12 Trial run and settings lock | W6 | all | M2–M8, M10, J4 (X2 also needs J5b) |

Order of the job pipeline: J1 → J2/J3 drafts → J4 replay → J5a red-team and review, in parallel with the X1 trial (which accepts `replayed` jobs) → J5b length lock and approval → X2 settings lock → scored stages.

### M0: Baseline, predictions, guardrails, ledger

**B0. Predictions** (S, human-owned, W0)
- **Goal:** write expectations down before any run.
- **Files:** new `docs/plans/lh-predictions.md` (written by the human), `configs/long-horizon.json` field `frozen.predictions_commit`.
- **Change:**
  - The human writes numeric predictions where possible, for example: Haiku@high's horizon is at most half of Fable's; Haiku and Luna have the lowest cost per success on L1–L3; the real map raises success on depth-2+ Q2 jobs by at least N points and changes nothing on idurar; code-heal cuts cost 3–5× on L3–L5 with success within ±10 points.
  - The agent commits the file and records the commit hash in `frozen.predictions_commit`.
  - R2's flight runner refuses scored stages if `frozen.predictions_commit` is empty or the file changed after that commit. Probes, red-team and trial are exempt.
- **Done when:** the file is committed and the hash is recorded, before X2.
- **Depends on:** none.

**B1. Baseline, branch and tag** (S)
- **Goal:** a known-good starting point.
- **Files:** none edited.
- **Change:**
  - `git switch -c long-horizon claude/windtunnel-long-horizon-plan`. Check `test -f docs/plans/2026-10-18-windtunnel-long-horizon.md`.
  - Run `npm ci`. Without it, about half the tests fail with `ERR_MODULE_NOT_FOUND`. Then run `npm test` and note the counts in the first commit message.
  - After CP0, create a local annotated tag `v1.3` at `0983d0e` ("Publish WindTunnel v1.3 results (#28)"). Do not push it.
- **Done when:** `npm test` reports 0 failures (the live test is skipped), `git tag -l v1.3` prints `v1.3`, and the design doc is present.
- **Depends on:** CP0.

**B2. v1.3 invariance guard** (S)
- **Goal:** catch any accidental change to v1.3 inputs.
- **Files:** new `tests/lh/v13-invariance.test.mjs`, new `tests/lh/fixtures/v13-hashes.json`.
- **Change:** pin and assert:
  - `configHash()` (`scripts/model-refresh.mjs:14-17`)
  - `hashes()` (`scoring/report.mjs:19-24`)
  - one sha256 over the sorted paths and contents of `tasks/`, `goldens/`, `capsules/`, `fixtures/`, `sites/sites.yaml`, `harness/lib/`, `configs/model-refresh.json` and `results/canonical/`
  - no file in `tasks/` has a top-level `schema:` key
- **Done when:** the test passes. A temporary edit to `goldens/learnhouse.reference.patch` makes it fail; revert the edit.
- **Depends on:** B1.

**B3. lh config, aliases and loader** (S)
- **Goal:** one validated config file for everything lh.
- **Files:** new `configs/long-horizon.json`; new `harness/lh/config.mjs` with `loadLhConfig()`, `configById(id)`, `parseConfigId(id)`, `stageById(id)`.
- **Change:** create the file with this full shape. The loader rejects unknown keys at every level.
  ```json
  {"schema":"wt-lh-config/1","locked":false,"lock_hash":null,"campaign_cap_usd":300,
   "max_tokens":32768,"result_char_cap":20000,"surface":"native",
   "context_policy":{"default":{"trigger_tokens":40000,"target_tokens":30000,"clear_at_least_tokens":10000},
                     "variants":{"clear@25k":{"trigger_tokens":25000,"target_tokens":18000,"clear_at_least_tokens":7000}}},
   "settle_ms":{"read":150,"mutate":1000,"navigate":400,"cap_call":5000,"cap_navigate":30000},
   "capsule_timeouts_s":{"prepare":10800,"reset":900},
   "aliases":{"haiku55":"claude-haiku-5-5","sonnet55":"claude-sonnet-5-5","opus55":"claude-opus-5-5","fable51":"claude-fable-5-1",
              "luna":"gpt-6-luna","sol61":"gpt-6.1-sol","gem38f":"gemini-3.8-flash"},
   "prices":{"claude-haiku-5-5":{"base":[0.1,0.5,0.01,0.125],"tiers":[{"min_prompt_tokens":100000,"rates":[0.5,2.5,0.05,0.625]}]},
             "claude-sonnet-5-5":{"base":[2,10,0.2,2.5]},"claude-fable-5-1":{"base":[10,50,0.25,12.5]}},
   "configs":[{"id":"q1.haiku55@high","question":"q1","alias":"haiku55","adapter":"anthropic","effort":"high",
               "map":"none","code":"off","context_policy":"default","max_usd_per_try":{"1":0.05,"2":0.1,"3":0.3,"4":0.6,"5":1.5}}],
   "seed_sets":{"dev":["dev-1","dev-2"],"public":["public-1","public-2","public-3"],"holdout":["holdout-1"],"crawl":["crawl"]},
   "job_sets":{},
   "stages":[{"id":"s1a-small-ladder","priority":1,"configs":["q1.haiku55@high"],"jobs":"level:1-4",
              "seed_ids":["public-1","public-2","public-3"],"tries_per_seed":1,"estimate_usd":38,"budget_usd":46,
              "window":"W7-8","requires_status":"approved","cells":null}],
   "frozen":{"predictions_commit":null,"goldens_lh":{},"manifests":{},"seeds":{},"jobs":{}}}
  ```
  - Copy every other price from `configs/model-refresh.json` as-is.
  - **Config id format:** `<question>.<alias>@<effort>[.map-<variant>][.code-<mode>]`, for example `q2.luna@low.map-fake` or `q3.opus55@high.code-heal`. Aliases match `^[a-z0-9]+$`, so ids never contain the dots of real model ids. The surface is global (`surface`), chosen at CP2.
  - **Reserved ids:** `replay` and `scripted` (adapters `replay` / `scripted`, price 0, exempt from the price check, never paid).
  - **Tries:** a "try" is one run of one job on one seed. Each seed in `seed_ids` gets `tries_per_seed` runs (default 1).
- **Done when:** `tests/lh/config.test.mjs` loads the file and rejects an unknown key, a duplicate id, an unknown alias, a paid config with no price, and a malformed id.
- **Depends on:** B1.

**B4. Spend ledger** (M)
- **Goal:** enforce the $300 cap from the first paid call.
- **Files:** new `scripts/lh/ledger.mjs` with `reserve({kind, stage, cell, usd})`, `commit(id, actualUsd)`, `release(id)`, `totalSpent()`, `outstanding()`, `requireBudget(argv)`; CLI subcommands `status` and `reconcile --id <id> --usd <n>`.
- **Change:**
  - Append-only `results/long-horizon/raw/ledger.jsonl`; each line is fsynced.
  - Cross-process lock: `ledger.lock` opened with `wx`, holding the pid, with a stale-pid check (pattern `native-flight.mjs:104-109`).
  - `reserve` refuses if `totalSpent + outstanding + usd > campaign_cap_usd`.
  - A reservation that was never committed (process killed) keeps counting at its reserved amount until `reconcile`.
  - Every paid path uses it: probes, red-team, token counting, flights.
  - `requireBudget` refuses to start a paid command without a positive `--budget`.
- **Done when:** tests show that 4 concurrent processes reserving in a loop never exceed the cap, a killed process leaves its reservation counted, and a reserve over the cap is refused.
- **Depends on:** B3.

### M1: Week-1 API probes (needs CP1; total ≤ $2)

All probes live in `scripts/lh/probes/`. Each requires `--budget`, reserves and commits through B4, and writes `results/long-horizon/raw/probes/<date>-<name>.json` with raw request bodies, raw usage and HTTP status.

**P1. Claude mid-conversation tool changes and deferred-tool visibility** (S)
- **Goal:** decide between the native surface and the fixed 3-tool surface for every vendor.
- **Files:** new `scripts/lh/probes/claude-tool-changes.mjs`.
- **Change:**
  - The Claude API reference lists `mid-conversation-tool-changes-2026-07-01` for Opus 5, Opus 5.5, Opus 4.8, Fable 5, Fable 5.1, Mythos 5, Mythos 5.1 and Sonnet 5.5. It does **not** list Haiku 5.5, although Haiku 5.5 supports mid-conversation system messages.
  - Run on `claude-haiku-5-5` and on `claude-sonnet-5-5` (positive control). `tools[]` = `navigate` (not deferred) plus 2 tools with `defer_loading: true`.
  - Turn 2: append `{role:"system", content:[{type:"tool_addition", tool:{type:"tool_reference", name}}]}` after the `tool_result` user message. Then test a `tool_removal` placed directly before an assistant turn or last.
  - Visibility check: before any addition, ask the model to name every tool it can call (3 samples). It must name no deferred tool.
- **Done when:** the result JSON has `{model, status, addition_ok, removal_ok, added_tool_called, deferred_names_leaked}` for both models.
- **Depends on:** B4, CP1.

**P2. Claude server-side context clearing** (S)
- **Files:** new `scripts/lh/probes/claude-context-mgmt.mjs`.
- **Change:**
  - Read https://platform.claude.com/docs/en/build-with-claude/context-editing and confirm the field names for `clear_tool_uses_20250919` under beta `context-management-2025-06-27`. The bundled reference confirms only the type and `clear_tool_inputs`. `trigger`, `keep` and `clear_at_least` are **verify**.
  - Send one multi-turn Haiku 5.5 request sequence with about 45k tokens of synthetic tool results and a 40k trigger, at effort `high`.
  - Record cost with and without clearing. The Claude API reference warns that each clear rewrites the cached prefix and in one measured run cost more than it saved.
- **Done when:** the response shows cleared tool uses > 0, no 400, a follow-up turn with preserved thinking succeeds, and the cost comparison is in the report.
- **Depends on:** B4, CP1.

**P3. Gemini caching** (S)
- **Files:** new `scripts/lh/probes/gemini-cache.mjs` (calls `respond()` from `arms/cu-gemini.mjs:50`).
- **Change:** send the same prefix of at least 5k tokens twice to `gemini-3.8-flash`, in two variants: `store:false`, and `store:true` with `previous_interaction_id`. Dump the raw usage.
- **Done when:** the report names the cached-token field, which variant caches, the minimum prefix size, and whether the caching variant still lets the client send a trimmed history (input to L4 and L6).
- **Depends on:** B4, CP1.

**P4. Effort, 32k output, one call per turn, no-tool turn** (S)
- **Files:** new `scripts/lh/probes/settings.mjs`.
- **Change:** for every Q1 model, send a minimal tool request with:
  - candidate effort values: Claude `output_config.effort` (`low`–`max`; Haiku 5.5 and Opus 5.5 default to `medium`, Sonnet 5.5 and Fable 5.1 to `high`, so always send it), OpenAI `reasoning.effort`, Gemini `thinking_level` (values **verify**)
  - a 32768 output cap (streaming for Claude)
  - one call per turn: Claude `tool_choice:{type:"auto", disable_parallel_tool_use:true}`, OpenAI `parallel_tool_calls:false`
  - a no-tool turn for pure code mode: Claude `tool_choice:{type:"none"}`, OpenAI `tool_choice:"none"`, Gemini function-calling mode none (**verify** on the Interactions API)
  - Claude only: confirm the pinned SDK (`@anthropic-ai/sdk` 0.110.0) passes `context_management`, `output_config` and the betas through `client.beta.messages.stream` (**verify**).
  - Forced `tool_choice` (`any`/`tool`) returns 400 on Fable 5.1, Opus 5.5 and Sonnet 5.5 per the API reference. lh never forces a tool, so this is not probed.
- **Done when:** a table of accepted values per model is written. It feeds CP2.
- **Depends on:** B4, CP1.

**P5. Probe runner** (S)
- **Files:** new `scripts/lh/probes/run-all.mjs`.
- **Change:** runs P1–P4 in order under one shared `--budget`, stops at the first failure, and prints the paths of the result files.
- **Done when:** `node scripts/lh/probes/run-all.mjs --budget 2` with mocked transports (test) runs all four and stops at a simulated failure.
- **Depends on:** P1–P4.

### M2: Harness core

**H1. LH bridge** (S)
- **Files:** new `harness/lh/bridge.mjs`, `installModelContextBridgeLH()` exposed as `globalThis.__wtLhBridge`.
- **Change:**
  - Same semantics as `arms/wm-claude.mjs:19-49`: keyed by name, last registration wins, abort only if the id matches, `execute` throws `tool "<name>" is not available`.
  - Add `describe()` → `[{name, description, inputSchema, annotations, order}]` with raw annotations.
  - Add a `version` counter that increments on every register and abort.
  - Keep `list()` as today.
  - Annotations are harness-only: no surface ever sends them to a model.
- **Done when:** `tests/lh/bridge.test.mjs` (browser test, fixture pattern from `readiness-check.mjs:25-61`) covers register, re-register, stale abort, version bump and kept annotations.
- **Depends on:** B1.

**H2. Tool-result normalizer** (S)
- **Files:** new `harness/lh/tool-result.mjs`, `normalizeToolResult(raw, thrown)` → `{ok, data, error, code, outcome_unknown}`.
- **Change:** rules in order:
  1. Thrown `Execution context was destroyed`, `Target closed` or a navigation error → `NAV_DURING_CALL`, `outcome_unknown:true`.
  2. Thrown `/tool ".*" is not available/` → `TOOL_NOT_AVAILABLE`.
  3. Per-call timeout (30 s) → `CALL_TIMEOUT`, `outcome_unknown:true`.
  4. Any other throw → `TOOL_THREW`.
  5. Unwrap `content[type=text].text` and parse JSON if possible.
  6. `isError === true`, `ok === false`, or a non-empty `error` string → `ok:false`, `code = payload.code ?? "TOOL_ERROR"`.
  7. Otherwise `ok:true`.

  The model always receives the unwrapped payload (not double-encoded), capped at 20,000 characters.
- **Done when:** tests cover one fixture per site's error shape (easyappointments `goldens/easyappointments.reference.patch:223-229`, medusa `:626-631`, hi-events `:553-561`, idurar `:572-633`), plus `isError` and a thrown navigation.
- **Depends on:** none.

**H3. PageSession: settle, navigate, list** (M)
- **Files:** new `harness/lh/page-session.mjs`, `PageSession({page, origins, settleMs, emit, hooks})`.
- **Methods:** `prepare(startUrl)`, `tools()`, `describe()`, `settle(kind)`, `call(name, args)`, `navigate({url})`, `currentUrl()`.
- **Change:**
  - **One operation at a time:** a FIFO mutex.
  - **Navigation tracking:** `navSeq` from `page.on("framenavigated")` on the main frame.
  - **Settle:** poll `{navSeq, bridge.version}` every 50 ms until both are unchanged for the quiet window, and either the tool list is non-empty or the document has loaded. Quiet windows: `read` 150 ms when the called tool has `readOnlyHint === true`; `mutate` 1000 ms otherwise (covers easyappointments' 800 ms deferred redirect, `goldens/easyappointments.reference.patch:986-988`); `navigate` 400 ms. Hard cap 30 s after navigate, 5 s after a call. At the cap return `{tools: [], outcome: "empty-timeout"}`. **Never throw on an empty list.**
  - **Navigation during a call:** wait for load, settle, return `{navigated_to: url}` with `outcome_unknown:true`.
  - **`navigate({url})`:** one signature on every surface. `url` is a path on the current site or a full URL on one of the job's sites. Other origins return `{ok:false, error:"origin not allowed"}`. Returns `{ok, url, title, tools:[names]}`.
  - **Hooks:** `hooks.afterCall({name, mutating, callIndex})` (used by D9). Default no-op.
  - **Events:** `settle`, `call`, `nav`.
  - Replaces the fixed 300 ms sleep (`wm-claude.mjs:157`) and the empty-list throw (`:108`).
- **Done when:** browser tests show that a tool which navigates and re-registers 200 ms or 800 ms later is followed by a successful call; an empty page returns `tools: []`; a foreign origin is refused; `Promise.all` calls run one at a time; and whether `framenavigated` fires on `pushState` (**verify**; if not, settle on `version` alone and record it).
- **Depends on:** H1, H2.

**H4. Task budgets and failure strings** (M)
- **Files:** new `harness/lh/budget.mjs`.
- **Change:**
  - `taskBudget(job, config)` → `{tool_calls, turns, seconds, usd}`; `usd` from `config.max_usd_per_try[level]`.
  - `Budget.check()` runs before every request and returns `null` or a failure string.
  - `reserve(maxCostUsd)` / `commit(actualUsd)` against the try cap and the B4 ledger.
  - The runner starts a try only if the stage's remaining money is at least the try cap. If a ledger reservation still fails, the try ends `harness-infra: flight-budget` (excluded from results).
  - **lh failure strings contain no digits and none of the infra words** in `harness/lib.mjs:21-28` (for example `quota`, `rate limit`, `timed out`, any `5xx` number). Use exactly: `budget-exhausted:calls`, `budget-exhausted:turns`, `budget-exhausted:time`, `budget-exhausted:usd`, `agent-context-overflow`, `agent-max-tokens`, `agent-refusal`. Numbers go in row fields (`stop_detail`), not in the string.
  - Do not edit `stepBudget`.
- **Done when:** a test shows every agent failure string classifies `agent` through `classifyFailure` (`harness/lib.mjs:37`), and `harness-infra: flight-budget`, `harness-infra: manifest-drift` and `harness-infra: probe-error: …` are excluded by `isInfraRow`.
- **Depends on:** B3, B4.

**H5. Per-request pricing with fixes** (S)
- **Files:** new `harness/lh/pricing.mjs`, `costForLh(model, oneRequestUsage, table)`.
- **Change:**
  - Table from `configs/long-horizon.json`. Normalise names with `/^(claude-(?:sonnet|opus|haiku|fable)-5)\.(\d)/ → "$1-$2"`.
  - The tier applies per request: input + cached + cache_write ≥ `min_prompt_tokens`.
  - An unknown model throws (no Sonnet fallback).
  - OpenAI: split cached tokens out of `input_tokens` before pricing (pattern `wm-gpt.mjs:108-112`).
  - **Fixes** (confirmed in the Claude API reference): Fable 5.1 cache read $0.25/M and cache write $12.50/M (1.25× input, 5-minute TTL); Sonnet 5.5 cache read $0.20/M; Haiku 5.5 $0.10/$0.50 up to 100k prompt tokens and $0.50/$2.50 above.
- **Done when:** tests cover Haiku at 99,999 and at 100,000 prompt tokens; a 2-request try totalling 150k tokens with each request under 100k, priced at base rates; and the Fable 5.1 cache read. `tests/model-refresh.test.mjs:42-51` still passes.
- **Depends on:** B3.

**H6. Transcript streaming and row schema** (M)
- **Files:** new `harness/lh/transcript.mjs` (`openTranscript(path)` appends JSONL and fsyncs each turn; `close()` → `{sha256, events}`); new `harness/lh/rows.mjs` (`LH_COLUMNS`, `toRow()`, `writeCsv()`).
- **Change:**
  - Transcript path: `results/long-horizon/raw/<campaign>/transcripts/<run_id>.jsonl`.
  - Event types: `request` (usage, cost, ms), `response`, `call` (`via` = `direct|script|harness`, name, args, normalized result, url before and after, tools changed), `settle`, `nav`, `tool_surface`, `context_clear`, `world_change`, `script`.
  - Row columns (new CSV; v1 `CSV_COLUMNS` untouched):
    - identity: `config_id`, `alias`, `model`, `effort`, `surface`, `map_variant`, `map_sha256`, `map_tokens`, `code_mode`, `question`, `family`, `job_id`, `level`, `n`, `depth`, `seed_set`, `seed_id`, `try_index`
    - score: `pass`, `partial`, `weighted`, `critical_failed`, `forbidden_hits`, `diff_unclean`, `answer_valid`
    - world change: `world_changes_fired`, `world_change_at_call`
    - tool calls: `tool_calls` (page direct plus scripted), `page_tool_calls_scripted`, `harness_tool_calls`, `run_code_calls`, `failed_tool_calls`, `outcome_unknown_calls`, `discovery_events`
    - navigation: `nav_calls`, `wasted_navigations`, `unshown_url_navs`
    - code mode: `scripts_run`, `scripts_failed`, `script_fixes`, `duplicate_writes`
    - run conditions: `context_clears`, `stop_cause`, `stop_detail`, `budget_kind`, `budget_exhausted`, `turns`, `refusal`
    - tokens and cost: `input_tokens`, `output_tokens`, `cached_tokens`, `cache_write_tokens`, `est_cost_usd`
    - timing: `wall_s`, `reset_s`, `settle_ms_total`
    - transcript: `transcript_path`, `transcript_sha256`, `transcript_events`
    - `failure_category`
  - The full final text goes into the check sidecar, without the 4000-character cut at `run.mjs:123`. `run.json` holds no inline transcripts.
- **Done when:** a test writes 300 events, kills the writer mid-way, and the file still parses up to the last complete line.
- **Depends on:** B3.

**H7. World: multi-capsule lifecycle** (M)
- **Files:** new `harness/lh/world.mjs`, `bootWorld({sites, slot, portBase, seedIds, fake})`.
- **Change:**
  - For each site, `bootCapsule(site, {runId: \`lh-w${slot}-${site}\`, port, lifecycle, observe, stepTimeoutMs})`. Do not edit `harness/capsule.mjs`.
  - **Live mode:** `lifecycle` is a copy of `shellLifecycle` (`harness/capsule.mjs:30-53`, not exported) that builds env per call, so the seed can change between tries. Env: `CAPSULE_DEFINITIONS_ROOT=<absolute>/capsules-lh`, `WT_WEBMCP=1`, `WT_LH_SEEDS=<comma list>` (prepare), `WT_LH_SEED=<id>` (reset), `CAPSULE_PREPARE_TIMEOUT_SECONDS` and `CAPSULE_RESET_TIMEOUT_SECONDS` from `capsule_timeouts_s`. Its child-process kill timeouts and `stepTimeoutMs` use the same values. v1's defaults are 1800 s prepare in the CLI (`harness/bin/capsule:231`) and 45 min / 5 min in `bootCapsule` (`capsule.mjs:17`), too short for multi-seed prepare.
  - **Fake mode (`WT_FAKE_LIFECYCLE=1`):** pass **no** `lifecycle`, so `bootCapsule` uses its built-in `fakeLifecycle` (`capsule.mjs:112-116`), and inject `observe` that serves `tests/fixtures-lh/<site>/<probe>.json`. Passing a lifecycle copy would still call Docker.
  - API: `baseUrls`, `setSeed(id)`, `resetAll()` (parallel), `observe(site, probe, args)`, `down()`.
  - learnhouse ignores `WT_LH_SEED` (one `static` snapshot, see D7).
- **Done when:** in fake mode a test boots 4 sites, switches the seed and gets canned states. Live (`WT_LIVE_CAPSULE=1`), one slot boots and resets.
- **Depends on:** B3; D1 for the live check.

**H8. Attempt runner with hooks** (M)
- **Files:** new `harness/lh/run.mjs` with `runAttempt(...)` and `runJobs(...)`.
- **Change:** each attempt runs:
  1. `setSeed`, `resetAll`.
  2. Before snapshots for each `job.state` probe, then `hooks.checkResetDrift(before)` (no-op until D8).
  3. New 1280×800 context; LH bridge init script; clock (H11); `hooks.prepareContext(context, job, config)` (map route, no-op until C3).
  4. `PageSession` with `hooks.worldController(job, world, session)` (no-op until D9).
  5. Run the surface through `runAgent` (L1), or the scripted arm.
  6. After snapshots.
  7. `scoreJob` (S5) **always**, unless the failure is infra.
  8. Write the row and `results/long-horizon/raw/<campaign>/checks/<run_id>.json` (with evidence).
  - `failure_category` is `harness-agent: <msg>` or `harness-infra: <msg>`, using `classifyFailure` for model messages and writing lh infra strings directly.
  - Resume key `(config_id, job_id, seed_id, try_index)`, which fixes the Haiku@high / Haiku@max collision of the v1 key (`run.mjs:32`). An unfinished attempt reruns from reset. Do not touch `harness/run.mjs`.
- **Done when:** a fake-mode end-to-end test with the replay adapter gives `pass:true`, `partial:1`. Kill and resume skips finished cells and reruns the unfinished attempt from reset. D8, D9 and C3 each add their hook in their own Done-when.
- **Depends on:** H3–H7, H11, L1, L5, S5.

**H9. lh CLI and fake mode** (M)
- **Files:** new `harness/lh/cli.mjs`.
- **Change:**
  - Subcommands `run`, `replay`, `lint`, `dry`.
  - Flags: `--config <id>`, `--jobs <selector>`, `--seed-set dev|public|holdout`, `--seed-ids a,b`, `--tries-per-seed <n>`, `--budget <usd>`, `--campaign <name>`, `--slot <k>`, `--port-base <n>`, `--output-root` (default `results/long-horizon`), `--label`.
  - Selectors: `all`, `level:2-4`, `family:a,b`, `ids:a,b`, `set:<name>`, `question:q2`, `status:replayed+`.
  - A paid config without `--budget` is refused (B4 `requireBudget`).
  - With `WT_FAKE_LIFECYCLE=1`: a fake browser whose pages serve tool lists and canned results from `tests/fixtures-lh/pages/*.json`, with stubs for `context.route`, `page.url` and `page.clock`.
- **Done when:** `WT_FAKE_LIFECYCLE=1 node harness/lh/cli.mjs dry --config replay --jobs family:example --seed-set dev` exits 0 with passing rows.
- **Depends on:** H8, L5.

**H10. `lh-scripted` arm** (S)
- **Files:** new `harness/lh/arms/scripted.mjs`.
- **Change:** runs `recipe.steps(universe, job, expect)` (`{tool, args, expect?}`, `{navigate}`, `{wait_tools}`, `{final}`) through `PageSession`, so settle and world changes behave as for models. Records the true tool-call count. The v1 `arms/scripted.mjs` is DOM-only and is not used.
- **Done when:** a fake-mode replay test passes and reports `tool_calls`.
- **Depends on:** H3.

**H11. Frozen clock** (S)
- **Files:** new `harness/lh/clock.mjs`.
- **Change:**
  - T0 comes from `seeds-lh/<seed>/manifest.json`. The prompt line is `Today's date is <T0>` (replaces `withToday`, `harness/tasks.mjs:55`).
  - Set the browser clock with Playwright's clock API at context creation. The sandbox `Date` (K1) uses the same T0.
  - **Verify** the clock API does not stall site timers (easyappointments' 800 ms redirect, medusa's 150 ms `router.push`). If it does, use `setSystemTime` only.
  - Server clocks keep real time; jobs must not depend on server-side "overdue" or "upcoming" logic.
- **Done when:** a browser test shows `new Date()` in the page within 1 minute of T0 and `setTimeout` still fires.
- **Depends on:** H3.

### M3: Agent loop, adapters, context policy, tool surfaces

**L1. Shared agent loop** (M)
- **Files:** new `harness/lh/agent-loop.mjs`, `runAgent({adapter, surface, system, firstUser, budget, transcript, contextPolicy})`.
- **Change:** each turn:
  1. `budget.check()`.
  2. `adapter.buildRequest(state)`; reserve the request's maximum cost (prompt estimate plus `max_tokens` at output price).
  3. `adapter.send` → `adapter.parse` → `{calls, text, usage, stopCause, refusal}`.
  4. Price with H5 and commit.
  5. No calls → finish.
  6. Otherwise `surface.dispatch` the **first** call only, append the result, and apply `surface.pageToolDelta` through the adapter.
  - **System text, the same for every model:** `BASE_SYSTEM` + `MECHANICS.webmcp` + the lh mechanics line + the sites header (site name → base URL and the job's credentials, from the seed manifest) + the map block (Q2) + the T0 date line.
  - **Model-side outcomes are returned, never thrown:** the H4 strings. Raw provider text goes to the transcript.
  - **Transport failures** (429, 5xx, network) still throw and classify as infra.
- **Done when:** replay-adapter tests cover all four outcomes (overflow, max tokens, refusal, each budget kind) and each classifies `agent`.
- **Depends on:** H4, H5, H6.

**L2. Anthropic adapter** (M)
- **Files:** new `harness/lh/adapters/anthropic.mjs`.
- **Change:**
  - Direct transport only (`nativeAnthropicOptions`, `openrouter.mjs:14-19`); `client.beta.messages.stream(...).finalMessage()`.
  - Request: `max_tokens: 32768`; `output_config:{effort}`; no `thinking` and no temperature; `tool_choice:{type:"auto", disable_parallel_tool_use:true}`; system blocks with `cache_control` plus `withCacheBreakpoint`; betas `context-management-2025-06-27`, plus `mid-conversation-tool-changes-2026-07-01` on the native surface.
  - Thinking blocks are kept in history byte for byte. History is append-only.
  - Record `stop_reason`, `stop_details`, refusal. No server-side `fallbacks` (they would swap the model under test).
  - Overflow: `BadRequestError` whose message contains "prompt is too long" → `agent-context-overflow`, token count in `stop_detail`.
- **Done when:** mocked-client tests assert `tools[]` is byte-identical across turns, effort is set, no temperature, streaming is used, and the history prefix is byte-identical turn to turn.
- **Depends on:** L1, P1, P2, P4.

**L3. OpenAI adapter and transport** (S)
- **Files:** new `harness/lh/transport/openai.mjs` (copy of the `respond()` pattern at `arms/wm-gpt.mjs:14-47`, but keeping the full error body and adding a request timeout); new `harness/lh/adapters/openai.mjs`.
- **Change:**
  - Responses API with `reasoning:{effort}`, `max_output_tokens:32768`, `parallel_tool_calls:false`.
  - Tools from frozen manifest bytes, sorted by name.
  - `status:"incomplete"` for output tokens → `agent-max-tokens`.
  - Catch errors in the adapter: a 400 whose full body contains `context_length_exceeded` → `agent-context-overflow`; any other 400 stays infra. The imported v1 `respond()` cuts bodies to 300 characters (:21), so do not import it.
- **Done when:** mocked-fetch tests pass, including an overflow 400 that becomes agent and another 400 that stays infra.
- **Depends on:** L1, P4.

**L4. Gemini adapter and transport** (S)
- **Files:** new `harness/lh/transport/gemini.mjs` (copy of `arms/cu-gemini.mjs:50-82` with the full error body); new `harness/lh/adapters/gemini.mjs`.
- **Change:**
  - `max_output_tokens:32768` and `thinking_level`.
  - Caching variant chosen at CP2 from P3; usage parsing fixed per P3 (v1.3 recorded 0 cached tokens).
  - Execute only the first function call; answer any others with `{error:"one tool call per turn"}`.
  - Catch errors (`wm-gemini.mjs:61` does not). Overflow text (**verify** the input-token-limit wording) → `agent-context-overflow`.
- **Done when:** mocked tests pass, including cached tokens > 0 on the second request under the chosen variant.
- **Depends on:** L1, P3.

**L5. Replay adapter** (S)
- **Files:** new `harness/lh/adapters/replay.mjs`.
- **Change:** a model stub that emits the reference recipe's calls, one per turn, with synthetic usage. Used by `--config replay`.
- **Done when:** used by `dry` and by H8's end-to-end test.
- **Depends on:** L1, H10.

**L6. Context policy** (M)
- **Files:** new `harness/lh/context-policy.mjs`.
- **Change:**
  - **Claude:** only server-side `context_management.edits:[{type:"clear_tool_uses_20250919", …}]` with the policy's trigger and the parameters confirmed in P2. **Never** edit history on the client: 5.5-generation models and Fable 5.1 drop preserved thinking when earlier history changes, and server-side clearing does not count as an edit.
  - **OpenAI and Gemini:** once the estimated prompt passes `trigger_tokens`, replace the oldest function outputs with `"[cleared by harness; call the tool again if needed]"` until under `target_tokens`, clearing at least `clear_at_least_tokens` at a time.
  - **Gemini with `store:true` (if CP2 picks it):** the server holds history, so the client cannot replace outputs. CP2 chooses either (a) start a new interaction chain with the trimmed full history at each clear (one cache miss per clear), or (b) no clearing for Gemini, recorded as a known difference.
  - Record `context_clears` and cleared tokens. Variant `clear@25k` for stage `s3c`.
- **Done when:** tests show the Claude request body never changes earlier messages, OpenAI/Gemini clears batch correctly, and L4 plus L6 work together under the CP2 variant.
- **Depends on:** L2–L4.

**L7. Native surface** (M)
- **Files:** new `harness/lh/surfaces/native.mjs` with `staticTools()`, `pageToolDelta()`, `dispatch(call)`.
- **Change:**
  - **Static tools:** `navigate`, `current_url`, `list_page_tools` (plus `run_code` from K2), never deferred. At least one tool must be non-deferred or the API returns 400.
  - `list_page_tools` returns `{url, tools:[{name, description, inputSchema}]}` (no annotations).
  - **Claude:** declare every manifest tool for the job's roles with `defer_loading:true`, using frozen manifest bytes. Each turn, diff the settled live names against the announced set and append `tool_addition` / `tool_removal` system messages. Placement: a system message follows a user message and is last or followed by an assistant turn; a `tool_removal` sits directly before an assistant message or last. Write `validateMessageOrder()`.
  - **GPT and Gemini:** send the live list each turn, sorted by name, with frozen manifest bytes.
  - **Drift:** a live tool missing from the manifest, or with a different `defHash`, ends the try as `harness-infra: manifest-drift`.
  - Calling a removed tool gives the normal "not available" error.
  - Until C2 exists, tests use `tests/fixtures-lh/manifests/*.json`. Live runs need C1b/C2.
- **Done when:** mocked tests pass `validateMessageOrder` across 50 random add/remove sequences.
- **Depends on:** L2; C2 for live use.

**L8. Fixed 3-tool surface** (S)
- **Files:** new `harness/lh/surfaces/fixed3.mjs`.
- **Change:** tools `navigate {url}`, `list_page_tools {}`, `call_page_tool {name, arguments}` with the exact text in Appendix A. `current_url` is folded into every response. `strict:false` on GPT for `arguments`. A name not on the page returns `{error, code:"TOOL_NOT_AVAILABLE", available:[…]}`. Every vendor uses this surface if CP2 picks it.
- **Done when:** tests pass and `tools[]` stays byte-identical for a whole attempt.
- **Depends on:** H3.

### M4: Scoring v2 (pure modules, no Docker)

**S1. Path selector** (S)
- **Files:** new `scoring/lh/path.mjs`, `select(root, path, ctx)`.
- **Grammar:** `path := step ('.' step)*`; `step := key | key[] | key[filter, …]` (`[]` flattens; filters are ANDed); operators `= != in ~ < <= > >=`; dotted fields; values may be literals or `{seed.*}`, `{expect.*}`, `{params.*}`. Always returns a node list anchored at the root; a trailing `.field` maps over the list.
- **Done when:** a test per operator, plus a test that nothing outside the path can match.
- **Depends on:** none.

**S2. Assertions and normalizers** (M)
- **Files:** new `scoring/lh/assert.mjs`, `evaluate(nodes, assertion, ctx)`.
- **Change:**
  - **Exactly one op key** per assertion object; unknown keys are a load error (fixes the silent ignore at `predicates.mjs:12-15`).
  - **Ops:**
    - `count: N | {eq|gt|gte|lt|lte|between}` (size of the node list)
    - `equals: V` (the node list has exactly 1 node, deep-equal after normalising; the only equality op)
    - `set_equals`, `superset_of`, `subset_of`, `disjoint_from`, `bag_equals` (value: a list, a placeholder, or `{ref:{on, path}}`)
    - `unique_by: field | [fields]`
    - `every: A`, `none: A`, `some: A` (apply A to each node); `all: [A…]`, `any: [A…]`
    - `group_by: field` with arguments `each: A` (required) and `keys: A` (optional)
    - `sum: {field, eq|gt|gte|lt|lte|between, tol?}`
    - scalar: `lt`, `lte`, `gt`, `gte`, `between`, `one_of`, `matches` (node list must have 1 node; wrap in `every` otherwise)
    - `custom: ns.fn` with optional `args`
  - **Modifiers** allowed next to the op: `normalize`, `tol`, and `path` (only in sub-assertions under `every`/`none`/`some`/`each`, relative to each node).
  - Normalizers: `email` (trim, lowercase), `name` (NFKC, casefold, collapse whitespace, strip punctuation), `money` (integer cents), `text` (v1 normalizer; never for emails or SKUs, since it rewrites `-` and `_`).
- **Done when:** a test per op and modifier, plus the `_capsule` echo trap (`harness/bin/observe:126-135` merges probe arguments into results).
- **Depends on:** S1.

**S3. Answer extraction and schema subset** (S)
- **Files:** new `scoring/lh/schema.mjs`, `extractAnswer(text)`, `validate(schema, value)`.
- **Change:** take the last fenced `json` block, else the last balanced top-level `{…}`. Supported keywords: `type` (string or array of types), `required`, `properties`, `items`, `enum`, `additionalProperties`, `pattern`, `minimum`, `maximum`, `minItems`. Reject any other keyword at load. Add no npm dependency (`package-lock.json` is in `configHash`).
- **Done when:** tests pass.
- **Depends on:** none.

**S4. State diff** (S)
- **Files:** new `scoring/lh/diff.mjs`, `diffState(before, after, ignore)`, `unclean(diff, allow, touched)`.
- **Change:** diff per site and table, keyed by row `id`, into `added`, `removed`, `changed{id, before, after, fields}`. A soft delete is a `deleted` field change.
- **Done when:** tests pass.
- **Depends on:** none.

**S5. Checker** (M)
- **Files:** new `scoring/lh/checker.mjs` (`scoreJob`, `rescore(sidecar)`); new `scoring/lh/custom/` (pure `(ctx) => {pass, detail}` functions, each unit-tested).
- **Change:**
  - `observe` memoised by `site|probe|args`; strips `_capsule`.
  - A checkpoint passes only if its assertion holds and every `requires` target passed; otherwise it is `gated` (and counts as failed).
  - `weighted = Σ w·pass / Σ w`.
  - **Forbidden items:** the assertion describes the allowed state. A hit means the assertion is false.
  - **Answer:** if the job has `answer_schema` and extraction or validation fails, `answer.valid = false` and every `on: answer` checkpoint fails.
  - `pass = every critical checkpoint passes ∧ no forbidden hit ∧ diff clean ∧ (answer.valid, when answer_schema exists)`. The diff is clean when every diff row matches `allow`, `ignore`, or a fired world change's `touched` rows.
  - `partial = 0.5·weighted + 0.5·pass`.
  - Agent failures are scored too; only infra failures are skipped. A probe error throws `probe-error: …`.
  - Sidecar shape: Appendix D.
- **Done when:** the correct state gives `pass:true`, `partial:1`; each single fault fails the intended item (missing person, duplicate order, wrong tier, extra client, edited old invoice, invalid JSON answer, missing answer, `_capsule` echo); `rescore` of every sidecar reproduces its verdict.
- **Depends on:** S1–S4.

**S6. Job loader, resolver, linter** (M)
- **Files:** new `harness/lh/tasks.mjs`, `loadJobs`, `resolveJob(job, seedId)`, `lintJobs`.
- **Change:**
  - Resolve `{seed.*}`, `{expect.*}`, `{params.*}`; an exact-match placeholder returns the non-string value (as `harness/tasks.mjs:33-34`).
  - Lint rules:
    - known keys only; no `contains` and no `predicate` anywhere
    - each checkpoint has an `id`, weight > 0, and exactly one of `assert` / `custom`
    - at least one critical checkpoint
    - every `requires` target exists
    - every placeholder resolves for every seed in dev, public and holdout
    - no literal emails or ids
    - `answer_schema` uses supported keywords only
    - every probe in `state`, `trigger`, `action` or a `ref` exists in `capsules-lh/<site>/oracle.sh` (regex over case arms, as `tests/probes.test.mjs:9-24`)
    - every item in `impossible:` names a forbidden guard that catches faking it
    - `review.status` is one of `draft|replayed|redteamed|approved|dropped`
- **Done when:** `node harness/lh/cli.mjs lint` exits non-zero on a set of broken fixtures; the J1 examples are lint fixtures and pass.
- **Depends on:** S1–S3.

### M5: Seed universe, lh capsules, probes, world changes (critical path)

**D1. capsules-lh tree, oracle path, goldens-lh apply** (M)
- **Files:**
  - new `capsules-lh/<site>/` (copies of `capsules/<site>/` for nextjs-starter-medusa, hi-events, easyappointments, idurar-erp-crm, learnhouse)
  - new `capsules-lh/lib/lh-adapter.sh`
  - new `goldens-lh/<site>.reference.patch` for all 5 sites, **byte copies** of `goldens/<site>.reference.patch` (T1/T2 overwrite them later)
  - edit `harness/bin/observe:37`
- **Change:**
  - In each lh `capsule.sh`, replace the `capsule_vendor_sdk` call (medusa :169, hi-events :88, easyappointments :90, idurar :49, learnhouse :101) with `WT_WEBMCP=0 capsule_vendor_sdk && lh_apply_golden`. **Verify** that the bash prefix assignment is scoped to the function call (it is in non-POSIX bash).
  - `lh_apply_golden` applies `$ROOT/goldens-lh/$SITE.reference.patch` with `git apply --check` then `git apply`, **fails closed** if the file is missing, and adds the hash `webmcp:golden-lh` to `CAPSULE_BOOTSTRAP_HASHES_JSON` (pattern `site-adapter.sh:701-704`). The post-golden fixture patches in each `capsule.sh` (idurar :52-53, medusa :174-175, hi-events :92-93, learnhouse :106) still apply after it.
  - `harness/bin/observe:37` becomes `ORACLE="${CAPSULE_DEFINITIONS_ROOT:-$ROOT/capsules}/$SITE/oracle.sh"`. With the variable unset, behaviour is identical. `harness/bin/observe` is not in any v1 hash.
- **Done when:** `tests/lh/observe-path.test.mjs` passes for unset and set cases; `npm test` and B2 pass; live, `CAPSULE_DEFINITIONS_ROOT=$PWD/capsules-lh WT_WEBMCP=1 harness/bin/capsule idurar-erp-crm prepare --run-id lh-w0-idurar-erp-crm --port 3400` succeeds.
- **Depends on:** B2.

**D2. Universe generator** (L)
- **Files:** new `fixtures-lh/universe/generate.mjs --seed-id <id>` → `seeds-lh/<id>/{universe.json,manifest.json}`.
- **Change:**
  - Deterministic PRNG seeded from `sha256(seed-id)`.
  - **People and companies:** 40 customers (name, email, company, role, size, address). About 12 companies; some deliberately missing from idurar.
  - **idurar:** clients are companies: the universe companies minus the missing ones, plus filler companies, 40 clients in all; 150 invoices (draft, pending, paid, partial; dates relative to T0) and payments.
  - **Store:** 80 products, about 300 variants (Size × Colour), prices in EUR (the Medusa region is EUR, `medusa-starter-default@8a45ee3:src/scripts/seed.ts:66`), some variants out of stock, shipping options with distinct prices.
  - **Events:** 6 free events with 2–3 capacity-limited tiers each, plus existing registrations.
  - **Bookings:** 4 providers × 8 services, a qualification matrix, working plans, 80 non-overlapping bookings inside working hours.
  - **Look-alikes:** pairs of similar names and emails.
  - **Join keys:** medusa customer email; hi-events order/attendee email; easyappointments customer email; idurar client company name plus billing email.
  - **Accounts:** per seed and role (shopper, attendee, idurar admin, easyappointments customer and staff), written to `manifest.json` for the prompt's credentials line.
  - **Stock and capacity rule:** 0, or at least N+5, unless a world change targets it.
  - IDs, names and T0 rotate per seed; T0 is a far-future date per seed set (CP3). No regex metacharacters in names (idurar search builds `new RegExp(q)`).
  - **Seed ids:** `dev-1`, `dev-2`, `public-1..3`, `holdout-1`, `crawl` (final list at CP3).
  - `manifest.json` holds T0, id offsets, accounts and stable keys (emails, handles, SKUs, invoice `{number, year}`). Checkers key only on these, never on DB-generated ids.
- **Done when:** tests show the same seed gives byte-identical output, two seeds have disjoint names and ids, and all invariants hold (no overlaps, stock rule, unique emails, look-alikes present).
- **Depends on:** B3, CP3.

**D3. Medusa seed** (M)
- **Files:** new `fixtures-lh/nextjs-starter-medusa/lh-seed.ts`; `capsules-lh/nextjs-starter-medusa/capsule.sh`.
- **Change:**
  - Copy the seed into the private backend and run `medusa exec ./src/scripts/lh-seed.ts` after `yarn seed` (equivalent of :213-214) and before the dump and cache step (:248-256).
  - Use `createProductCategoriesWorkflow`, `createProductsWorkflow`, inventory levels (`manage_inventory:true`, `allow_backorder:false`), shipping options with distinct prices, `createCustomersWorkflow`.
  - Remove the 4 starter products, or prove no job sees them (**verify**).
  - Add the seed files and seed ids to `CAPSULE_FIXTURE_HASHES_JSON`.
- **Done when:** live `lh_state` shows 80 products, about 300 variants and 40 customers.
- **Depends on:** D1, D2.

**D4. Hi.Events seed** (M)
- **Files:** new `fixtures-lh/hi-events/seed.mjs`; lh `capsule.sh` and `compose.overlay.yaml`.
- **Change:**
  - API pattern of `fixtures/hi-events/seed.mjs:34-166`: one organizer, 6 events.
  - Each tier is a separate FREE product (the golden reads `prices[0]`, `goldens/hi-events.reference.patch:1164,1213`), with small `initial_quantity_available`, `hide_when_sold_out:false`, `show_quantity_remaining:true`, `waitlist_enabled` on some tiers.
  - Existing registrations through the public order API, so `quantity_sold` stays correct.
  - Raise `APP_API_RATE_LIMIT_PER_MINUTE` in the overlay.
  - `fixture.json` keeps `.event` (read unconditionally at `oracle.sh:24-25`) and adds `.events[]`. Replace `hi_events_fixture_valid` (`capsule.sh:71-83`) with a check against the seed manifest. Run `ALTER SEQUENCE … RESTART` per seed.
- **Done when:** live `lh_state` shows 6 events, the planned tiers and registrations.
- **Depends on:** D1, D2.

**D5. easyappointments seed** (M)
- **Files:** new `fixtures-lh/easyappointments/seed-sql.mjs` (writes SQL); a bootstrap patch that disables rate limiting in upstream `application/config/config.php:491` at revision `bf7e4d2` (**verify** the line), hashed into `CAPSULE_BOOTSTRAP_HASHES_JSON`. (The workspace's root `config.php` comes from the 13-line `fixtures/easyappointments/config.php.template`; that is a different file.)
- **Change:** SQL for `ea_settings` (with `future_booking_limit` covering T0), 8 services, 4 providers with `ea_user_settings`, `ea_services_providers`, 40 customers, 80 `ea_appointments` (columns per `Appointments_model.php:25-45`). `AUTO_INCREMENT` offsets per seed; hashes from the PRNG. SQL, not the API, because of the rate limiter.
- **Done when:** live `lh_state` matches the universe.
- **Depends on:** D1, D2.

**D6. idurar seed** (M)
- **Files:** new `fixtures-lh/idurar-erp-crm/seed.mjs`.
- **Change:** seed through the app API after the golden is applied: `client/create`, `invoice/create` with explicit `date`, `expiredDate` and `year` from T0 (v1 hard-codes 2026 at `fixtures/idurar-erp-crm/seed.mjs:54`), `payment/create` for paid and partial invoices.
- **Done when:** live `lh_state` has 40 clients, 150 invoices and the planned payment statuses.
- **Depends on:** D1, D2.

**D7. Per-seed snapshots and reset selection** (M)
- **Files:** each `capsules-lh/<site>/capsule.sh`.
- **Change:**
  - At prepare, loop over `WT_LH_SEEDS`: restore the base, seed, capture `private/reset-snapshots/<seed>.*`, and record the canonical `lh_state` hash in `private/lh-canonical/<seed>.sha256`. All snapshots exist at prepare, so the artifact checks pass (`capsule-lifecycle.sh:102-148`).
  - At reset, restore the snapshot named by `WT_LH_SEED`; a missing seed fails.
  - learnhouse keeps its v1 fixture, one snapshot named `static`, and ignores `WT_LH_SEED`.
  - Hi.Events: skip the image rebuild on restore if safe (`capsule.sh:200-206`, **verify**).
- **Done when:** live, reset to seed A then seed B gives each canonical hash. Record per-site prepare and reset times in `docs/plans/lh-decisions.md` and set `capsule_timeouts_s` from them.
- **Depends on:** D3–D6.

**D8. `lh_state` probes and reset drift** (M)
- **Files:** each `capsules-lh/<site>/oracle.sh`; new `tests/lh/probes-lint.test.mjs`, `tests/lh/probes.live.test.mjs`.
- **Change:**
  - One `lh_state` probe per site returning every table lh checks, as normalised rows with stable ids, sorted, with empty aggregates wrapped in `COALESCE`, soft-deleted rows marked `deleted:true`, and **no paging** (every v1 probe stops at 100 rows). Fields and patterns: Appendix E. Table and column names are **verify-live**.
  - Probe `lh_canonical_hash`. Wire `hooks.checkResetDrift` into H8: a mismatch with the before snapshot's hash throws `probe-error: reset drift` (infra).
  - Validate every argument with `jq -er` before using it in a query.
- **Done when:** the lint passes; live, each `lh_state` returns valid JSON and equals the canonical state after reset; H8's drift hook is wired and tested in fake mode.
- **Depends on:** D7.

**D9. World changes** (M)
- **Files:** the lh oracles; new `harness/lh/world-change.mjs`, `worldController(job, world, session)`.
- **Change:**
  - **Trigger probes** (single-row counts): hi-events `tier_sold`, medusa `stock_of`, others as jobs need them.
  - **Mutations**, each returning `{affectedRows, touched:[{table,id}]}`:
    - hi-events `sell_out_tier` (sets `initial_quantity_available` to `quantity_sold`). **Do not `FLUSHALL`**: the capsule's Laravel queue runs on redis (`capsules/hi-events/compose.overlay.yaml:31`). Clear only the cache store (`php artisan cache:clear`, after checking which redis database the cache uses versus queue and sessions), or delete the event/product keys.
    - medusa `set_stock`, `discontinue_product` (stock reads must bypass the storefront cache, T2)
    - idurar `archive_client`, `record_external_payment` (through the app API)
    - easyappointments `block_provider`, `unlink_service`
  - **Hook:** `PageSession` `afterCall`, so direct and scripted calls both count. Check only after calls whose `readOnlyHint` is false. Fire once; on `then: reregister`, `page.reload()` and settle.
  - A mutation that does not apply → `probe-error:` (infra). Fired changes go to the transcript (never shown to the model) and the row.
- **Done when:** a fake test fires after the k-th write regardless of work order; live, after `sell_out_tier`, `get_event` shows the tier sold out once tools re-register, a registration started before the change still completes, and the agent's session survives.
- **Depends on:** D8, H3.

### M6: goldens-lh tools (frozen at the end of W4)

**T1. Golden build pipeline** (S)
- **Files:** new `scripts/lh/golden-build.sh <site>`.
- **Change:**
  - Work directory **outside the repo**: `${LH_WORK_DIR:-$HOME/.cache/wt-lh-work}/<site>`. The script refuses a path inside the repo.
  - Clone the pinned revision from `capsules/<site>/capsule.yaml` (medusa: the storefront revision at `capsule.yaml:6` is the golden base; the backend at `:12` is separate), apply the v1.3 golden, commit. Engineers edit there.
  - Write `goldens-lh/<site>.reference.patch` (`git diff <rev>`) and `<site>.delta.patch`.
  - Check on a fresh clone: apply the lh golden, then each post-golden fixture patch in `capsule.sh` order (idurar `compatibility.patch`, medusa `container-host.patch`, hi-events `patches/source-dev.patch`, learnhouse `nginx.runtime.patch`).
- **Done when:** running the script twice gives identical patches for all 5 sites and the fresh-clone check passes.
- **Depends on:** D1.

**T2. Tool contract and per-site tool work** (L)
- **Files:** `goldens-lh/*.reference.patch`.
- **Contract:**
  - One definition per name per role, with no baked titles or seed values.
  - One error shape: `{ok:false, error, code}`, `code` in `SOLD_OUT|NOT_FOUND|INVALID_INPUT|NOT_SIGNED_IN|LIMIT|CONFLICT`. Searches return `{ok:true, results:[]}`, not an error.
  - Accurate `readOnlyHint` on every tool. Post-call navigation deferred until after the result returns.
  - Paging with `limit`/`offset`, returning `total`/`next_offset`.
  - Generic descriptions: no brand, no sample data, no harness tool names.
- **Per site** (patch line refs are into `goldens/<site>.reference.patch`):
  - **medusa:** `search_products` takes `offset` and `limit` up to 100 and returns `total`. Uncached stock reads (product reads use `force-cache` with a tag that is never refreshed, `nextjs-starter-medusa@9818886:src/lib/data/products.ts:53,71`). Remove apparel wording (`:541-555`, `:906`, `:925`, `:932`, `:1009`). One definition per group-B tool.
  - **hi-events:** paging on `search_events` and `event_sales_summary`; generic text (`:934`, `:1092`, `:1184`, `:1499-1501`); `get_event` without the baked title (`:1023-1024`); deterministic re-registration instead of the 15 s poll (`:661-665`). Decide `max_per_order:1` against the multi-attendee shortcut.
  - **easyappointments:** new `list_appointments`; new `reschedule_appointment` that checks availability through `booking/get_available_hours` with `manage_mode=1` and derives the end time from the service duration, replacing the manage-mode `book_appointment` variant (`:187-190`); `offset` on `list_customers`; decouple the `sign_in` text (`:672-673`, `:716`).
  - **idurar:** `create_client` (refuses a duplicate email), `update_client`, `void_invoice` (paid invoices → `CONFLICT`), `list_payments`; paging and `total` on `list_invoices` and `find_clients` (move to `/client/list`); "no match" returns empty results (`:577`); remove `:804`, `:842`, `:1057`.
- **Done when:** the C1a inventory shows one `defHash` per name per role, and `tests/lh/tool-contract.live.test.mjs` exercises each tool's error path and checks its shape.
- **Depends on:** T1, D3–D6, C1a.

**T3. Route-leak removal** (S)
- **Files:** `goldens-lh/*`; new `tests/lh/ask-site-no-routes.live.test.mjs`.
- **Change:** remove `source` / `source_url` fields, route lists, route-naming text and "source page paths" from descriptions:
  - medusa `:524-536`, `:812`, `:852`, `:882`, `:894`, `:906`, `:914`
  - hi-events `:160-328`, `:377-383`, `:881`
  - easyappointments `:434-489`, `:534`, `:552`
  - idurar `:378-426`, `:487`, `:642`, `:657-659`
  - learnhouse `:306`, `:330`, `:509-510`

  Paths returned by action tools (cart, confirmation) stay; they count as shown URLs.
- **Done when:** about 20 fixed queries per site return no prefix of any route template in `manifests-lh/sites/<site>.yaml` and no match for `(^|\s)/[a-z]`.
- **Depends on:** T2.

**T4. Tool freeze** (S, CP4)
- **Change:** record the sha256 of each `goldens-lh` patch in `frozen.goldens_lh`. The flight runner refuses a mismatch. Any later change needs CP4 approval, then all replays (J4) and the crawl (C1b) run again.
- **Done when:** hashes recorded and the refusal tested.
- **Depends on:** T2, T3.

### M7: Map crawler and Q2 arms

**C1a. Inventory crawler** (M)
- **Files:** new `scripts/lh/crawl-manifest.mjs` (mode `--inventory`); new `manifests-lh/sites/<site>.yaml` (state recipes and route templates; tools are never hand-written).
- **Change:**
  - Seed `crawl`. Enter each state through WebMCP recipe calls on `PageSession`. BFS over route templates (depth ≤ 4, ≤ 200 pages per state). At each node record `describe()` and `document.title`; harvest same-origin `a[href]` (harness code, DOM reads allowed); map links to templates.
  - Call no tool except recipe tools.
  - Output `results/long-horizon/raw/inventory/<site>.<role>.json`: nodes, tools per node, names with more than one `defHash`, seed tokens found, unmatched links.
  - Runs on unfrozen goldens-lh, so T2 can use it.
- **Done when:** `tests/lh/manifest.test.mjs` (browser test: 2 routes × 2 states, one tool registered only after `sign_in`) passes, and all 5 sites produce an inventory.
- **Depends on:** H3, H7, D7.

**C1b. Frozen manifests** (S)
- **Change:** same crawler, mode `--build`, after T4. Writes `manifests-lh/<site>.<role>.webmcp.json` (format `lh-1`, Appendix C). **Build fails if:** any name has more than one `defHash`; `validateTools` fails after mapping `*Hint` keys to base keys in a wrapper (do not edit `webmcp-verify.mjs`); any seed token of 4+ characters from any seed set appears in any string (case-insensitive); a link matches no template and is not allow-listed; two crawls give different `toolsetHash`. Record hashes in `frozen.manifests`.
- **Done when:** all 5 sites build cleanly twice with identical hashes.
- **Depends on:** C1a, T4.

**C2. Manifest library** (M)
- **Files:** new `harness/lh/manifest.mjs` (`loadManifest`, `renderForPrompt`, `defHash`, `perturb`, `fakeFor`); new `manifests-lh/wrong/<site>.yaml`, `manifests-lh/fake/index.json`; new `scripts/lh/count-map-tokens.mjs`.
- **Change:**
  - **Fake map** source rotation, all lh sites: medusa→idurar→easyappointments→hi-events→medusa; learnhouse→easyappointments (customer role). Remove tool names that also exist on the target site.
  - **Token matching:** count tokens per arm model (Anthropic `count_tokens`, free; OpenAI's input-token count endpoint if available, **verify**, else a `max_output_tokens:16` request through the ledger, needs CP8 with `--budget 1`). If the fake is longer than the real map by more than 5%, drop whole tools from the fake, fewest exposures first; if shorter, add whole tools or screens from the same source in manifest order. Stop when within ±5%. Store both counts in `fake/index.json`.
  - **Wrong map (Haiku only):** one renamed tool, one phantom tool, one wrong precondition (`exposure` in the wrong state). Chosen so about one third of Q2 jobs touch exactly one perturbation; record `perturbation_touched` per job. Token count within ±2%.
- **Done when:** tests cover the three perturbation kinds, collision removal and the token window.
- **Depends on:** C1b.

**C3. Map serving and prompt** (S)
- **Files:** new `harness/lh/manifest-serve.mjs`, `serveManifest(context, baseUrl, body|null)`.
- **Change:**
  - `context.route` on `**/.well-known/webmcp.json`: 404 for no map, the body otherwise. Capsule images do not change.
  - After `prepare`, fetch the map through the page and put the exact bytes into a system block after `MECHANICS`: `The site publishes a tool map at /.well-known/webmcp.json:` + `<webmcp_json>…</webmcp_json>`, or `The site publishes no tool map.` On Claude the block has its own cache breakpoint.
  - Scoped to the job's role; no seed values. Rows record `map_variant`, `map_sha256`, `map_tokens`.
  - Wire it into H8 as `hooks.prepareContext`.
- **Done when:** a test shows 404 for no map and byte-identical injection for map arms.
- **Depends on:** C2.

**C4. Hidden-tool depth and Q2 metrics** (S)
- **Files:** new `scripts/lh/tool-depth.mjs`; new `scoring/lh/q2-metrics.mjs`.
- **Change:**
  - **Depth** from static data, no replay needed: required tools = the tool names in `recipe.steps(universe, job, expect)` for `dev-1`. `d = max` over those tools of the minimum hops from `(start, initial state)` to a node exposing the tool, over the C1b graph (nodes `(urlPattern, state)`; navigate edges and state-changing recipe edges, cost 1). Write `meta.depth` (bucket 0, 1, 2+). J4 checks the depth is the same on every seed.
  - **Metrics:** `discovery_calls` (`list_page_tools`, plus navigates not followed by a page call), `wasted_navs` (off every shortest path to the next tool used), `wrong_tool_calls` (`TOOL_NOT_AVAILABLE`), `excess_steps` (calls minus reference length), `unshown_url_navs` (URL patterns never shown in the prompt, map or any tool result), wrong-map extras (renamed calls, phantom calls, wrong-state attempts, calls until recovery).
- **Done when:** fixture tests pass, and idurar `record_payment` from `/login` signed out gives `d=1`.
- **Depends on:** C1b, J1.

### M8: Code mode

**K1. Worker sandbox** (M)
- **Files:** new `harness/lh/code-worker.mjs`, `harness/lh/code-sandbox.mjs`.
- **Change:**
  - `worker_threads` Worker hosting a `vm` context (pattern `code-openai.mjs:41-61`), `resourceLimits.maxOldGenerationSizeMb:128`. `worker.terminate()` kills a stuck script without ending the attempt (unlike `code-openai.mjs:145`).
  - Host↔worker RPC carries JSON strings only.
  - The prelude builds, inside the context: `tools` (a Proxy resolved against the live page at call time), `navigate(url)`, `list_page_tools()`, `console.*` (to the log buffer), a `Date` frozen to T0 plus elapsed time, `ToolError`. Then it deletes `__rpc` from `globalThis`.
  - Nothing else, per the design: no `current_url`, no `sleep`, no `page`, `process`, `fetch`, `require` or `setTimeout`, no network or files. `navigate` and `list_page_tools` return the current URL.
  - Inner calls go through `PageSession.call`, so settle, world changes and counts apply.
  - The first `ok:false` latches `failed_call`, terminates the worker and refuses queued operations. It cannot be caught.
  - Limits: 80 calls per script; 180 s per script (or less if the task has less time); 2 s synchronous prelude; 20,000 characters of code; 4k stdout / 8k return value; 30 s per call; inner calls count toward the task's `tool_calls`.
  - Result shape and log rules: Appendix B.
- **Done when:** the tests in Appendix B pass. In particular `try/catch` does not rescue a failed call; `await x; while(true){}` is killed and **the attempt continues**; the `constructor.constructor` escape reaches nothing on the host.
- **Depends on:** H3, H11.

**K2. Code surface (heal and pure)** (M)
- **Files:** new `harness/lh/surfaces/code.mjs`, `withCode(surface, {mode})`.
- **Change:**
  - **heal:** the Q1 surface plus `run_code` (not deferred), description exactly as in Appendix A. Do not hint at checking what is already done before retrying.
  - **pure** (Haiku only): `run_code` is the only tool; the first user message lists the start page's tools (names, descriptions, schemas). After one run, the next request uses the no-tool setting from P4. Any further tool call gets "no more programs" and ends the attempt.
  - Metrics: `scripts_run`, `scripts_failed_{tool,script,timeout,limit}`, `script_fixes` (a failed script followed later by a successful call to the same tool). `duplicate_writes` comes from the checker's forbidden hits.
- **Done when:** replay-adapter tests cover heal (fail, fix, continue) and pure.
- **Depends on:** K1, L7 or L8.

### M9: Jobs

**J1. tasks-lh format** (S)
- **Files:** `tasks-lh/families/<family>/`, `tasks-lh/q2/<site>.yaml`, linted by S6.
- **Each family has:** `prompt.md` (rendered with placeholders); `expect.mjs` (`expect(universe, job)` → `seeds-lh/<seed>/expect/<job-id>.json`); `recipe.mjs` (`steps(universe, job, expect)`); `family.yaml` (one job per level).
- **Full example:**

```yaml
schema: wt-lh/1
family: northwind-merch
size_knob: customers
prompt: prompt.md                 # "You run logistics for {seed.company.name}… {expect.cohort_table}"
expect: expect.mjs
recipe: recipe.mjs
jobs:
  - id: nwm-L4
    level: 4
    n: 18
    question: q1
    sites: [hi-events, nextjs-starter-medusa, idurar-erp-crm]
    roles: { hi-events: attendee, nextjs-starter-medusa: shopper, idurar-erp-crm: administrator }
    start: { site: hi-events, path: "/event/{seed.events.conf.id}/{seed.events.conf.slug}" }
    budget: { tool_calls: 260, turns: 300, seconds: 3600 }   # set at lock (X2)
    ref_tool_calls: null                                     # filled by replay (J4)
    impossible: [{ id: missing-company, guard: no-new-clients }]
    review: { status: draft, reviewer: null, date: null, notes: "" }
    state:
      hi-events:             { probe: lh_state }
      nextjs-starter-medusa: { probe: lh_state }
      idurar-erp-crm:        { probe: lh_state }
    answer_schema:
      type: object
      additionalProperties: false
      required: [registered, moved, orders, skipped, missing_companies]
      properties:
        registered:        { type: array, items: { type: string } }
        moved:             { type: array, items: { type: string } }
        orders:            { type: array, items: { type: object, required: [company, order],
                             properties: { company: { type: string }, order: { type: [string, integer] } } } }
        skipped:           { type: array, items: { type: string } }
        missing_companies: { type: array, items: { type: string } }
    world_changes:
      - id: workshop-sells-out
        trigger: { site: hi-events, probe: tier_sold, args: { event_id: "{seed.events.conf.id}", tier: Workshop },
                   path: sold, assert: { gte: "{expect.workshop_trigger}" } }
        check: after_mutating_call
        action: { site: hi-events, probe: sell_out_tier, args: { event_id: "{seed.events.conf.id}", tier: Workshop },
                  expect: { path: affectedRows, assert: { gte: 1 } } }
        then: reregister
        once: true
    checkpoints:
      - { id: all-registered, critical: true, weight: 3, on: hi-events,
          path: "attendees[event_id={seed.events.conf.id},deleted=false,status=ACTIVE].email",
          assert: { superset_of: "{expect.cohort_emails}", normalize: email } }
      - { id: one-ticket-each, weight: 1, on: hi-events,
          path: "attendees[event_id={seed.events.conf.id},deleted=false,status=ACTIVE,email in {expect.cohort_emails}]",
          assert: { unique_by: email } }
      - { id: non-engineers-general, weight: 1, on: hi-events,
          path: "attendees[event_id={seed.events.conf.id},status=ACTIVE,email in {expect.others}].tier",
          assert: { every: { equals: General } } }
      - id: moved-reported
        weight: 2
        requires: [all-registered]
        on: answer
        path: "moved[]"
        assert: { set_equals: { ref: { on: hi-events,
                  path: "attendees[event_id={seed.events.conf.id},status=ACTIVE,tier=General,email in {expect.engineers}].email" } },
                  normalize: email }
      - id: one-order-per-company
        critical: true
        weight: 3
        on: diff
        path: "nextjs-starter-medusa.orders.added[canceled=false]"
        assert: { group_by: shipping_address.company,
                  keys: { set_equals: "{expect.shippable_companies}", normalize: name }, each: { count: 1 } }
      - { id: right-items, critical: true, weight: 3, custom: nwm.itemsFollowSizeRule }
      - { id: cap-per-person, critical: true, weight: 2, custom: nwm.perPersonCap, args: { max_eur: 120 } }
      - id: draft-invoice-per-company
        critical: true
        weight: 3
        on: diff
        path: "idurar-erp-crm.invoices.added"
        assert: { group_by: clientName, keys: { set_equals: "{expect.known_companies}", normalize: name },
                  each: { all: [ { count: 1 }, { every: { path: status, equals: draft } } ] } }
      - { id: invoice-lines-match-orders, weight: 2,
          requires: [one-order-per-company, draft-invoice-per-company], custom: nwm.invoiceLinesMatchOrders }
      - { id: missing-companies-reported, weight: 1,
          requires: [all-registered, one-order-per-company, draft-invoice-per-company],
          on: answer, path: "missing_companies[]",
          assert: { set_equals: "{expect.missing_companies}", normalize: name } }
    forbidden:                     # each assert is the allowed state; a hit = assert is false
      - { id: no-new-clients,          on: diff, path: "idurar-erp-crm.clients.added",   assert: { count: 0 } }
      - { id: no-other-invoice-change, on: diff, path: "idurar-erp-crm.invoices.changed", assert: { count: 0 } }
      - { id: no-duplicate-orders,     on: diff, path: "nextjs-starter-medusa.orders.added[canceled=false]",
          assert: { group_by: shipping_address.company, each: { count: { lte: 1 } } } }
      - { id: no-duplicate-attendees,  on: hi-events, path: "attendees[deleted=false,status=ACTIVE]",
          assert: { unique_by: [event_id, email] } }
      - { id: no-wrong-address, custom: nwm.shippedToCompanyAddress }
    business_diff:
      ignore:
        nextjs-starter-medusa: { tables: [carts], fields: [updated_at] }
        hi-events:             { fields: [updated_at] }
      allow:
        - { site: hi-events, table: orders, op: added }
        - { site: hi-events, table: attendees, op: added, where: "event_id={seed.events.conf.id}" }
        - { site: hi-events, table: tiers, op: changed, fields: [sold] }
        - { site: nextjs-starter-medusa, table: orders, op: added }
        - { site: nextjs-starter-medusa, table: customers, op: added }
        - { site: nextjs-starter-medusa, table: inventory, op: changed, fields: [stocked, reserved] }
        - { site: idurar-erp-crm, table: invoices, op: added, where: "status=draft" }
```

  A short Q2 job:

```yaml
  - id: q2-ea-07
    question: q2
    sites: [easyappointments]
    roles: { easyappointments: customer }
    start: { site: easyappointments, path: / }
    budget: { tool_calls: 30, turns: 40, seconds: 600 }
    meta: { depth: null }            # computed by C4, never shown to the model
    review: { status: draft }
    state: { easyappointments: { probe: lh_state } }
    checkpoints:
      - { id: booked, critical: true, weight: 2, on: diff,
          path: "easyappointments.appointments.added[customer={expect.email},service={expect.service}]", assert: { count: 1 } }
      - { id: morning, critical: true, weight: 1, on: diff,
          path: "easyappointments.appointments.added[customer={expect.email}].startMinute", assert: { every: { lt: 720 } } }
    forbidden: []
    business_diff:
      allow:
        - { site: easyappointments, table: appointments, op: added }
        - { site: easyappointments, table: customers, op: added }
```

- **Done when:** both examples lint clean (they are S6 fixtures) and score correctly against fixture states.
- **Depends on:** S6.

**J2. Six long-job families × 5 levels** (L)
- **Change:**
  - 6 families, jobs at N = 1, 3, 8, 18, 40 (30 jobs); target lengths about 10, 25, 60, 125, 250 tool calls.
  - L1 multi-page; L2 look-alikes plus one impossible request that must be reported; L3 rules across sites; L4 a structured JSON summary at scale; L5 everything.
  - About one third of jobs have a world change (at least 2 per level, spread over families).
  - Rules in € (the Medusa region is EUR). Record this change from the design's "$120" example in `docs/plans/lh-decisions.md`.
  - The agent proposes family themes; the human approves (CP5).
- **Done when:** all 30 jobs lint and reach `replayed` (J4).
- **Depends on:** J1, D2, D9, T4.

**J3. 45 Q2 jobs** (M)
- **Change:** draft about 60 short candidates (≤ 10 reference calls each) with recipes, compute depth with C4, then keep 15 per bucket (0, 1, 2+). At least 6 idurar and at least 3 learnhouse control jobs; learnhouse jobs may be answer-only.
- **Done when:** the buckets are full and every kept job lints and reaches `replayed`.
- **Depends on:** J1, C4.

**J4. Reference replay and fault injection** (M)
- **Files:** new `scripts/lh/fault-inject.mjs`.
- **Change:**
  - `node harness/lh/cli.mjs replay --jobs all --seed-set dev`, then `public` and `holdout`. Every job on every seed must give `pass:true`, `partial:1`. Record `ref_tool_calls`; set status `replayed`.
  - Generate faults from recipe mutations (skip a person, duplicate an order, wrong tier, extra client, fake an impossible request). Each fault must fail its intended item.
  - Lengths within ±30% of the level target, else adjust the job.
  - Check C4 depth is identical on every seed.
- **Done when:** the replay report under `results/long-horizon/replays/` is all green.
- **Depends on:** J2, J3, H10.

**J5a. Red-team and human review** (M)
- **Files:** new `scripts/lh/redteam.mjs`.
- **Change:**
  - Mode decided at CP5. Default: a paid analysis run (`--budget 12`, through the ledger, CP8). For each job, one request to `opus55@high` with the job prompt (rendered on `dev-1`), the real map and the tool docs, asking for the smallest correct sequence of tool calls as JSON. Alternative: the supervising engineer does it by hand with no harness spend.
  - Any plan under 60% of the level target is turned into a recipe variant and replayed with `lh-scripted`. If the checker passes it, fix the job or move it to another level.
  - Known risks: idurar `list_invoices` returns per-client totals; Hi.Events `register_for_event` takes `attendees[]`.
  - A person reviews each job (prompt clarity, checker, fairness). Status `redteamed`, with reviewer, date and notes.
- **Done when:** every job is `redteamed` or `dropped` with a reason.
- **Depends on:** J4, C1b.

**J5b. Length lock and approval** (S)
- **Change:** after X1, job length = `min(ref_tool_calls, shortest successful trial run, shortest verified red-team plan)`. A job under 60% of its level target is fixed or moved before the lock. The human approves; status `approved` or `dropped`. Scored stages accept only `approved`.
- **Done when:** all 75 jobs are `approved` or `dropped` with reasons.
- **Depends on:** J5a, X1.

### M10: Parallel runs and flight runner

**R1. World slots** (S)
- **Change:**
  - `--slot k` gives run ids `lh-w<k>-<site>` and ports `portBase + 10·k + i`, default `portBase` 3400 (**verify** it is clear of v1's `3215+i` and of the capsule port registry).
  - Each slot writes `results/long-horizon/raw/<campaign>/live-w<k>.jsonl`.
  - Lock per campaign: `results/long-horizon/raw/<campaign>/.lock`, not `/tmp/windtunnel-model-refresh.lock`. lh never uses the module-global `boundedRequest` meter (`native-request.mjs:4`).
  - A world boots the union of sites its stage needs (learnhouse only for Q2).
- **Done when:** 3 slots run at once in fake mode with no collisions; live, the memory check passes with 3 and 4 worlds (else stop and ask).
- **Depends on:** H7.

**R2. Flight runner** (M)
- **Files:** new `scripts/lh/flight.mjs`, new `scripts/lh/checkpoint.mjs`.
- **Change:**
  - `--campaign --stage --budget --workers`. Plans cells from the stage in `configs/long-horizon.json`.
  - **Testable core:** export `planCells`, `allowedSpend`, `resumeState`, `shouldStop` with injected lifecycle and git-status functions. All refusals live in `main()` only.
  - **Refuses to start when:** the config is unlocked (except stage `trial`); `git status --porcelain -- . ':(exclude)results/long-horizon'` is non-empty; `WT_FAKE_LIFECYCLE` is set; frozen hashes (goldens, manifests, seeds, jobs, lock) do not match; a job's status is below the stage's `requires_status` (`trial` accepts `replayed` and later; scored stages need `approved`); `frozen.predictions_commit` is missing (scored stages only); `ACCOUNTING_HOLD` exists.
  - **Allowed spend** = `min(--budget, 300 − totalSpent − outstanding − Σ max(0, estimate_i − spent_i))`, the sum over stages with higher priority that are not complete.
  - **Checkpoints:** reuse `appendCheckpoint` from `scripts/native-flight.mjs:49` as-is. Do not reuse `readCheckpoint`: it keys rows with the v1 `cellKey` (`:17`) and would throw "Duplicate scored checkpoint attempt". Copy it into `scripts/lh/checkpoint.mjs`, keyed on `(config_id, job_id, seed_id, try_index)`, using lh `est_cost_usd`. Fingerprint over the lh code tree, the frozen hashes and the config entry.
  - STOP file, `status.json` and checkpoints under `results/long-horizon/raw/<campaign>/`. `ACCOUNTING_HOLD` after an uncertain bill.
  - Retry an infra failure at most 2 times per cell; abort after 5 infra failures in a row.
- **Done when:** fake-mode tests of the exported functions cover the cap, the priority reservation, resume, STOP, and the status gate.
- **Depends on:** B4, H8, R1.

### M11: Analysis and report

**A1. Horizon fit** (M)
- **Files:** new `scripts/lh/analysis/horizon.mjs`.
- **Change:**
  - Per config, logistic regression of try success on `log2(L_j)` (locked job length). `h50 = 2^(−b0/b1)`.
  - Bootstrap, 2000 resamples: families with replacement, then jobs within family, then tries within job. 95% percentile CI.
  - Degenerate fits (separation, or `b1 ≥ 0`) are reported as bounds (`> max L` or `< min L`) and flagged.
  - Paired bootstrap on shared jobs gives `P(h_A > h_B)`; "co-leaders" when under 0.9.
  - Per-level success with Wilson CIs.
- **Done when:** tests on synthetic data recover a known horizon within its CI.
- **Depends on:** H6.

**A2. Per-model tables** (S)
- **Change:** per config and level: pass@1, pass^3, mean partial, mean turns, mean tool calls, cost per try, cost per success (spend ÷ passes), context clears. pass^3 means "passed on all 3 seeded tries" (each try is a different seed, so it measures reliability across seeds); label it that way in the report.
- **Depends on:** A1.

**A3. Q2 and Q3 tables** (S)
- **Change:**
  - **Q2:** model × arm × depth: success, steps, discovery calls, wasted navigations, wrong-tool calls, cost, paired difference from no-map (paired on job and seed). idurar and learnhouse controls reported separately. Wrong-map metrics.
  - **Q3:** model × mode × level: success, partial, turns, cost, cost ratio against one-at-a-time paired on `(job_id, seed_id)`, scripts run/failed/fixed, duplicate writes.
- **Depends on:** C4, K2.

**A4. Report and provenance** (M)
- **Files:** new `scripts/lh/report.mjs`, `scripts/lh/rescore.mjs`.
- **Outputs** under `results/long-horizon/<campaign>/` (committed): `REPORT.md`, `rows.csv`, `horizons.json`, `PROVENANCE.md` (git revision; hashes of `tasks-lh`, `goldens-lh`, `seeds-lh`, `manifests-lh`, `capsules-lh/*/oracle.sh`, `scoring/lh`; price table; model snapshots; dropped jobs; predictions commit; ledger total).
- **Done when:** `node scripts/lh/rescore.mjs --campaign <c>` reports 0 verdict differences.
- **Depends on:** A1–A3.

### M12: Trial run and settings lock

**X1. Trial run** (CP6, $20)
- **Change:** stage `trial`, seed `dev-1`, jobs with status `replayed` or later. Cells (write the exact list and a per-cell estimate into the `trial` stage's `cells` before CP6):
  - q1 small (haiku55@high, haiku55@max, luna, gem38f): 1 job per level L1–L4 from one family; haiku55@high also 1 L5 job.
  - q1 sonnet55, sol61, opus55: 1 L2 and 1 L3 job each. fable51: 1 L3 job. No L4 on big models.
  - q2: all 7 arm configs × 5 jobs.
  - q3: haiku55 and luna code-heal, 1 L3 + 1 L4 each; haiku55 code-pure, 1 L3; sonnet55 code-heal, 1 L3.
  - Measure: cost per try by level and model (extrapolate big-model L4 from L2/L3), true lengths, wall time, settle overhead, infra rate, clears, shortest successful runs.
- **Done when:** the trial report is out and the estimates in `configs/long-horizon.json` are updated.
- **Depends on:** M2–M8, M10, J4.

**X2. Settings lock** (CP7)
- **Lock:** job lengths, task budgets, per-try USD caps; effort per config; context policy; settle windows; surface; big-model job subsets (4 jobs per level for sonnet55/sol61/opus55, 3 for fable51, chosen by a recorded fixed-seed random draw of families); stage estimates and budgets.
- **How:** `locked:true` and `lock_hash` in `configs/long-horizon.json`.
- **Done when:** the predictions doc is committed before this lock commit, and `flight.mjs` refuses to run on a changed lock.
- **Depends on:** X1, J5b, B0.

## 5. Human checkpoints (stop and ask)

| ID | When | Decision | The agent provides |
|---|---|---|---|
| CP0 | W0 | Confirm `0983d0e` is the v1.3 release; allow the local tag; human writes predictions (B0) | Baseline test counts |
| CP1 | Before M1 | Go-ahead for the probes (≤ $2) | Probe list and request bodies |
| CP2 | After P1–P4 | Native or fixed-3 surface (if Haiku fails P1 or deferred names leak, every vendor gets fixed-3); context-clearing parameters; Gemini caching variant and how Gemini clears; effort per model | Probe JSONs and a recommendation |
| CP3 | Before D2 | T0 per seed set; seed ids per set; whether holdout universes are committed or kept private; whether stage `s3d-holdout` runs | Universe sample and prepare-time estimate |
| CP4 | End of W4 | Tool freeze; any later tool change | Delta patches, C1a inventory |
| CP5 | W3–W6 | Family themes; red-team mode (paid ≤ $12 or by hand); whether reporting an impossible request is critical; approve or drop each job | Replay, fault and red-team records |
| CP6 | W6 | Trial go-ahead ($20) | Exact cell list with per-cell estimates |
| CP7 | After trial | Settings lock (all X2 items); whether the per-try USD cap counts as an agent failure | Trial report and proposed values |
| CP8 | Each paid command | Go-ahead with `--budget` (red-team, token counting, each stage) | Cell count, estimate, ledger total |
| CP9 | Any time | Stop if a stage is projected over 1.5× its estimate, infra rate > 5%, or a checker bug is found after scored runs began | Diagnosis |
| CP10 | W9 | Publish results and manifests | Report, provenance |

Any edit to an existing file other than `harness/bin/observe:37` also needs approval.

## 6. Run plan

### Free steps, in order

```bash
npm ci && npm test                                          # v1.3 green
node --test 'tests/lh/**/*.test.mjs'                        # lh unit tests (Node >= 21)
WT_BROWSER_TESTS=1 node --test 'tests/lh/**/*.test.mjs'     # plus Chromium tests
node harness/lh/cli.mjs lint
WT_FAKE_LIFECYCLE=1 node harness/lh/cli.mjs dry --config replay --jobs all --seed-set dev
node scripts/lh/crawl-manifest.mjs --inventory --all        # W2-W4, unfrozen tools
node scripts/lh/crawl-manifest.mjs --build --all            # after T4 freeze
node scripts/lh/tool-depth.mjs --jobs question:q2
node harness/lh/cli.mjs replay --jobs all --seed-set dev     --label replay-dev
node harness/lh/cli.mjs replay --jobs all --seed-set public  --label replay-public
node harness/lh/cli.mjs replay --jobs all --seed-set holdout --label replay-holdout
WT_LIVE_CAPSULE=1 WT_BROWSER_TESTS=1 node --test 'tests/lh/**/*.test.mjs'
```

### Paid steps before the main campaign

Each needs a CP8 go-ahead.

```bash
node scripts/lh/probes/run-all.mjs --budget 2                                          # W1 (CP1)
node scripts/lh/count-map-tokens.mjs --budget 1                                        # W5, only if OpenAI needs a dry request
node scripts/lh/redteam.mjs --jobs all --budget 12                                     # W5-W6, if CP5 picks the paid mode
node scripts/lh/flight.mjs --campaign lh-trial --stage trial --budget 20 --workers 3   # W6 (CP6)
```

### Main campaign `lh-main`

Stages are listed in priority order. The ledger holds back the remaining estimate of every higher-priority stage that is not complete, so if costs run high the $300 cap drops the lowest stages first. Level 5 stages run in W9 but keep their priority. Small models run each job once on each of `public-1..3`; big models run once on `public-1`.

| Pri | Stage id | Configs | Jobs × seeds | Window | Est. | `--budget` |
|---|---|---|---|---|---|---|
| 1 | `s1a-small-ladder` | q1 haiku55@high, haiku55@max, luna, gem38f | L1–4, 6/level × 3 | W7 | $38 | 46 |
| 2 | `s1b-small-L5` | q1 haiku55@high, haiku55@max, luna | L5, 6 × 3 | W9 | $12 | 15 |
| 3 | `s2-maps` | q2 haiku55@high × {none, fake, real, wrong}; q2 luna × {none, fake, real} | 45 × 3 | W7 | $10 | 12 |
| 4 | `s3a-code-small` | q3 haiku55@high and luna code-heal; haiku55@high code-pure | L2–4, 6/level × 3 | W7–8 | $6 | 8 |
| 5 | `s3b-code-small-L5` | same as s3a | L5, 6 × 3 | W9 | $4 | 5 |
| 6 | `s3c-context-check` | q1 haiku55@high, luna, gem38f with `clear@25k` | L3, 6 × 1 (public-1) | W8 | $3 | 4 |
| 7 | `s3d-holdout` (CP3) | q1 haiku55@high, luna | L2–4, 6/level × 1 (holdout-1) | W8 | $2 | 3 |
| 8 | `s4-big-ladder` | q1 sonnet55, sol61, opus55 | L2–4, 4/level × 1 | W8 | $65 | 78 |
| 9 | `s5a-code-big` | q3 sonnet55, opus55 code-heal | their s4 jobs × 1 | W8 | $18 | 22 |
| 10 | `s5b-code-big-L5` | q3 sonnet55, opus55 code-heal | 2 L5 each × 1 | W9 | $12 | 15 |
| 11 | `s6-fable` | q1 fable51 | L3–4, 3/level × 1 | W8 | $55 | 60 |
| 12 | `s7a-fable-code` | q3 fable51 code-heal | its s6 jobs × 1 | W8 | $10 | 12 |
| 13 | `s7b-fable-code-L5` | q3 fable51 code-heal | 2 L5 × 1 | W9 | $10 | 12 |

Totals: stages $245, plus probes $2, token counting ≤ $1, red-team ≤ $12 and trial $20, about $280. The `--budget` column adds up to more than $300 on purpose; the ledger trims from the bottom. Each config id carries its effort (CP2/CP7), for example `q1.luna@<effort>`.

Each stage runs as:

```bash
node scripts/lh/flight.mjs --campaign lh-main --stage <stage-id> --budget <usd> --workers 4
```

Use 3 workers if the R1 memory check fails at 4. After all stages:

```bash
node scripts/lh/rescore.mjs --campaign lh-main
node scripts/lh/report.mjs  --campaign lh-main
```

## 7. Definition of done

- `npm test` and B2 pass.
- `git diff v1.3 -- tasks goldens results/canonical capsules fixtures sites configs/model-refresh.json harness/lib package.json package-lock.json .gitignore .github` is empty.
- `git diff --stat v1.3 -- ':(glob)arms/*.mjs' ':(glob)harness/*.mjs' ':(glob)scoring/*.mjs' scripts/model-refresh.mjs scripts/native-flight.mjs` is empty. (Without `:(glob)`, `*` also matches `/` and would list every new file under `harness/lh/`.)
- The only change to an existing file is `harness/bin/observe:37`.
- The 30 long jobs and 45 Q2 jobs are each `approved` or `dropped` with a reason. Every approved job passes reference replay on every public and holdout seed, has fault tests and a red-team record.
- `goldens-lh` is frozen with recorded hashes. Manifests are built with no leakage, and no `manifest-drift` occurred in scored runs.
- Every stage in §6 has run or been dropped by the ledger. Ledger total ≤ $300.
- The predictions doc was committed before the first scored stage.
- `REPORT.md` contains: horizons with bootstrap CIs (bounds marked) and co-leaders; pass@1, pass^3 (across seeds), partial, turns and cost per success; the Q2 tables with the idurar and learnhouse controls and the wrong map; the Q3 tables with script fixes and duplicates; the dropped-job list; provenance.
- `rescore.mjs` reproduces every verdict from stored evidence.

## 8. Open questions and risks to raise, not guess

1. **Haiku 5.5 and the tool-changes beta (P1).** Not on the API reference's list. A failure, or deferred names leaking, puts every vendor on fixed-3.
2. **Context clearing may cost more than it saves.** The Claude API reference says each clear rewrites the cached prefix; one measured run cost more with clearing. It is still needed to keep Haiku under its 100k tier. P2 and the trial measure it; `trigger`, `keep`, `clear_at_least` names are unconfirmed.
3. **Gemini caching (P3)** and its conflict with client-side clearing (L6).
4. **Effort values** for Luna, Gemini Flash, Sonnet, Sol, Opus and Fable (CP2). Haiku is pinned at high and max.
5. **Seed sets and holdout (CP3)**, and prepare time per seed (Medusa `medusa exec`; Hi.Events image rebuild).
6. **Q3 job sets.** Big models' Q3 jobs are their Q1 jobs plus 2 L5, so Fable has no L2 code runs.
7. **Scoring choices (CP5/CP7):** per-try USD cap as an agent failure; whether reporting an impossible request is critical.
8. **Server clocks run on real time** (H11, D5): no jobs that depend on server-side "overdue" or "upcoming".
9. **Medusa storefront cache** may hide mid-run stock changes (T2; **verify** under `next dev`).
10. **Live schema facts** (Appendix E) and easyappointments timezone, `hash`, hard delete on cancel.
11. **Rate limits:** easyappointments 100 per 120 s; Hi.Events 180 per minute (waitlist 10). The lh overlays must raise them.
12. **Host memory** for 3–4 worlds (R1).
13. **Shortcuts** may shrink job lengths after red-teaming (J5a).
14. **Big-model fits** may be degenerate with one seed on 2–3 levels; report bounds.
15. **Tool rework size** is known only after the first C1a inventory.
16. **Fairness of clearing:** Claude clears on the server, OpenAI and Gemini on the client; `s3c` is the only check.
17. **Gemini `cache_write` 0.0417** has never been exercised; confirm after P3.
18. **Pinned Anthropic SDK 0.110.0** may lag the betas (P4).

## Appendix A. Tool definitions (exact text)

**Fixed 3-tool surface (L8).**

```json
[{"name":"navigate","description":"Open a page. Pass a path on the current site (e.g. /invoice) or a full URL on one of this job's sites. Waits until the page's tools are ready and returns the URL and the names of the tools now available.",
  "input_schema":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"],"additionalProperties":false}},
 {"name":"list_page_tools","description":"List the tools the current page offers, with their descriptions and input schemas, plus the current URL. The set changes when the page or its state changes.",
  "input_schema":{"type":"object","properties":{},"additionalProperties":false}},
 {"name":"call_page_tool","description":"Call one of the current page's tools by exact name, with an arguments object that matches its input schema. Returns the tool's own result. If the call changes the page, the result also lists the new URL and tool names.",
  "input_schema":{"type":"object","properties":{"name":{"type":"string"},"arguments":{"type":"object"}},"required":["name","arguments"],"additionalProperties":false}}]
```

- `navigate` → `{ok, url, title, tools:[names]}`; other origins → `{ok:false, error:"origin not allowed"}`.
- `list_page_tools` → `{url, tools:[{name, description, inputSchema}]}`; never throws on an empty page.
- `call_page_tool` → the unwrapped tool payload, `is_error` from H2, plus `page_changed:{url, tools}` when the URL or tool set changed during the post-call settle.

**`run_code` (K2).**

```json
{"name":"run_code",
 "description":"Run a JavaScript program that calls this site's tools. Use it for repetitive work (the same steps for many records); use single tool calls for one-off steps. Inside the program: `await tools.<tool_name>({...})` calls a tool on the current page and returns its result as parsed JSON; `await navigate(url)` opens a page, waits for its tools and returns the URL and tool names; `await list_page_tools()` returns the current URL and the page's tools with input schemas; `console.log(...)`; `return <value>` sends a value back. Calls run one at a time, in order. If any tool call fails (including results that report an error, such as a sold-out ticket), the program stops immediately at that call and cannot catch it; calls before it have already taken effect. You get back the status, the return value, the failed call with its error, and every call that succeeded. No network, files, timers or page access. Limits: 80 tool calls, 180 s, 20,000 characters of code per program.",
 "input_schema":{"type":"object","properties":{"code":{"type":"string","maxLength":20000},"label":{"type":"string","description":"Optional short name for this program"}},"required":["code"],"additionalProperties":false}}
```

## Appendix B. `run_code` result and sandbox tests

**Result** (`is_error = status === "failed"`; GPT and Gemini read `status` in the JSON):

```json
{"status":"failed",
 "error":{"kind":"tool_error","message":"Workshop is sold out"},
 "failed_call":{"index":12,"tool":"register_for_event","args":{"…":"…"},"error":"Workshop is sold out","code":"SOLD_OUT","url":"/event/…","outcome_unknown":false},
 "calls_ok":11,
 "log":[{"i":1,"tool":"search_events","args":{"query":"…"},"ok":true,"result":"{…first 120 chars…}"}],
 "log_truncated":0,
 "returned":null,
 "stdout":"…≤4000 chars…",
 "url_after":"/event/…","page_tools_after":["get_event","register_for_event"],
 "elapsed_ms":14211}
```

- `error.kind` is one of `tool_error`, `script_error` (stack remapped to user-code lines by subtracting the wrapper line), `navigation_error`, `timeout`, `call_limit`, `task_budget`. Navigating to a page with zero tools is not a failure.
- `log` lists every successful call in order. Calls that change data keep full args (500 characters) and the first 200 characters of the result; read-only calls keep tool, args and 120 characters. Cap 12k characters: drop read-only entries first, then the middle of the list; report `log_truncated`. Never drop below the last 80 data-changing calls.
- On success: `status:"completed"`, `failed_call:null`, `returned` (JSON, ≤ 8k characters).
- If a call is in flight when time runs out, wait for it (30 s cap) and record its real outcome.

**Tests** (`tests/lh/code-sandbox.test.mjs`, browser fixture like `readiness-check.mjs:25-61`):
1. Two good calls, an error, then a fourth call: `calls_ok = 2`, `failed_call.index = 3`, and the fixture shows the fourth call never ran.
2. `try { await tools.bad() } catch {}`: the script still fails.
3. `Promise.all`: calls run one at a time; the log is in execution order.
4. `await x; while (true) {}`: killed, `kind = timeout`, and the attempt continues.
5. `typeof process`, `fetch`, `require`, `page`, `setTimeout`, `sleep`, `current_url` are all `"undefined"`; `tools.constructor.constructor("return process")()` returns nothing from the host.
6. A tool that navigates and re-registers 200 ms or 800 ms later: the next call succeeds on the new page.
7. Call limit, output caps, frozen `Date`.
8. A content text with `{ok:false}` fails the script; so does a plain `{error}` and `isError`.

## Appendix C. Manifest format `lh-1`

```json
{"manifestVersion":"lh-1",
 "site":{"id":"idurar-erp-crm","name":"IDURAR ERP CRM","origin":"{origin}"},
 "role":"administrator",
 "entry":{"urlPattern":"/login","state":"signed-out"},
 "states":[{"id":"signed-out","description":"Not signed in","requiresAuth":false},
           {"id":"signed-in","description":"Signed in to the workspace","requiresAuth":true,"enteredBy":{"tool":"sign_in"}}],
 "params":{"invoice_id":"invoice id returned by list_invoices"},
 "screens":[{"id":"invoice-read","urlPattern":"/invoice/read/{invoice_id}","title":"Invoice","states":["signed-in"],
             "tools":["ask_site","record_payment"],"toolsetHash":"sha256:…"}],
 "tools":[{"name":"record_payment","description":"…","inputSchema":{},"annotations":{"readOnlyHint":false},
           "schemaHash":"sha256:…","defHash":"sha256:…",
           "exposure":[{"urlPattern":"/invoice/read/{invoice_id}","state":"signed-in","requiresAuth":true}],
           "reachedVia":[{"steps":[{"tool":"sign_in","args":"<credentials from your job>"}]}]}],
 "toolsetHash":"sha256:…",
 "generatedBy":{"crawler":"scripts/lh/crawl-manifest.mjs","gitRevision":"…","goldensLhHash":"…","seed":"crawl","crawledAt":"…"}}
```

- `schemaHash = sha256(canonicalJSON(inputSchema))` with sorted keys and the raw (not flattened) schema; `defHash = sha256(canonicalJSON({name, description, inputSchema, annotations}))`; screen `toolsetHash` = sha256 of sorted `defHash`es; top-level `toolsetHash` covers the union.
- `reachedVia` is the shortest path from `entry` (BFS), as `{navigate: urlPattern}` and `{tool, args:"<placeholder>"}` steps.
- `{origin}` is replaced with the capsule base URL when served. Annotations stay in the manifest file; the prompt rendering for models drops them (H1 rule).

## Appendix D. Checker sidecar

Written to `results/long-horizon/raw/<campaign>/checks/<run_id>.json`; summarised in the row.

```json
{"score_version":"lh-v2","pass":false,"partial":0.41,"weighted":0.82,
 "checkpoints":[{"id":"all-registered","critical":true,"weight":3,"pass":true,"gated":false,"detail":"18/18"}],
 "forbidden":[{"id":"no-duplicate-orders","hit":true,"detail":"company Acme: 2 orders"}],
 "diff":{"unclean":[{"site":"idurar-erp-crm","table":"clients","op":"added","id":"…"}]},
 "answer":{"valid":true,"errors":[]},
 "world_changes":[{"id":"workshop-sells-out","after_call":41,"touched":[]}],
 "final_text":"…full text…",
 "evidence":{"before":{},"after":{}}}
```

## Appendix E. `lh_state` contents per site

Each probe prints one JSON object of arrays; every row has a stable `id` and a `deleted` flag. Copy the query patterns named here. Table and column names are **verify-live** against a booted capsule.

| Site | Arrays and fields | Pattern to copy |
|---|---|---|
| nextjs-starter-medusa (Postgres) | `orders` {id, display_id, email (lowercase), status, canceled, deleted, shipping_address {first_name, last_name, company, address_1, city, postal_code, country_code}, items [{sku, variant_id, product, variant, quantity, unit_price}], shipping [{name, amount, option_id}]}; `customers` {id, email, has_account, deleted}; `inventory` {id = sku, sku, stocked, reserved}. Order items via `order_item` (matching `order.version`) joined to `order_line_item`; shipping via `order_shipping` / `order_shipping_method`. Check price units (major vs minor). | `json_build_object` / `json_agg` + `psql -At` (`capsules/nextjs-starter-medusa/oracle.sh:27-35`) |
| hi-events (Postgres) | `events` {id, slug, title, status, deleted}; `tiers` {id (product_price id), event_id, product_id, tier (product title), capacity (`initial_quantity_available`), sold (`quantity_sold`), deleted}; `orders` {id, ref (short_id), event_id, email, status, deleted}; `attendees` {id, ref, event_id, order_id, email, first_name, last_name, tier, status, deleted}. All events, not only the fixture one. | `capsules/hi-events/oracle.sh:70-74` |
| idurar-erp-crm (Mongo, ES5 in the legacy shell) | `clients` {id, name, email, enabled, deleted (`removed`)}; `invoices` {id, number, year, key "year/number", status, paymentStatus, client, clientName, total, credit, deleted, items [{name, quantity, price, total}]}; `payments` {id, number, invoice, client, amount, ref, deleted}. No paging; include soft-deleted docs. | `compose_exec db mongo --quiet … --eval` (`capsules/idurar-erp-crm/oracle.sh:8-18`) |
| easyappointments (MySQL) | `appointments` {id, hash, start, end, date, weekday, startMinute, service (name), provider (email), customer (email), notes} where `is_unavailability=0`; `customers` {id, email, first_name, last_name}; `unavailability` {id, provider, start, end}. `JSON_ARRAYAGG` has no ORDER BY, so sort with `jq sort_by(.id)`. Times are server-local. | `JSON_OBJECT` / `JSON_ARRAYAGG` (`capsules/easyappointments/oracle.sh:8-18`) |
| learnhouse | None unless a control job changes data (control jobs are answer-only). | `capsules/learnhouse/oracle.sh` |

Rules for every new probe: validate each argument with `jq -er 'select(...)'` before using it (integers: `type=="number" and floor==. and .>0`; strings: a strict regex with no quotes); wrap aggregates in `COALESCE(…,'[]')` or `JSON_ARRAY()`; mutations return `{affectedRows, touched:[{table,id}]}`; add each probe to `tests/lh/probes-lint.test.mjs`. Each observe call takes roughly 1–2 s (estimate, **verify**), so use one `lh_state` per site before and after, and single-row counts for world-change triggers.
