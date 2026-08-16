# Model expansion plan: GPT-5.6 Luna → Sol → Claude Opus 5

Execution plan for adding new frontier models to the benchmark, ordered cheapest-first so
each phase de-risks the next. Written for a coding agent with access to this repository.
Run phases strictly in order and stop at each **gate** to report results before continuing.

## Context

The reference run (`results/2026-07-27-reference/`) covers two models: `claude-sonnet-4-6`
(5 arms) and `gpt-5.5` (2 arms). This plan adds, in order:

| Phase | Model | Model ID | $/1M in / out | Why this order |
|---|---|---|---|---|
| 1 | GPT-5.6 Luna (fast tier) | `gpt-5.6-luna` | $0.20 / $1.20 | Nearly free (~$2–4 total); validates the whole pipeline; "cheap model + WebMCP beats flagship + pixels" is the strongest version of the benchmark's thesis |
| 2 | GPT-5.6 Sol (flagship) | `gpt-5.6-sol` | $5 / $30 | Flagship comparison vs the gpt-5.5 baseline (~$33) |
| 3 (optional) | GPT-5.6 Terra | `gpt-5.6-terra` | $2 / $12 | OpenAI's designated replacement for the retired `computer-use-preview`; natural mid-tier (~$13) |
| 4 | Claude Opus 5 | `claude-opus-5` | $5 / $25 | Heaviest in cost and wall-clock; run last (~$30 for 2 arms, ~$117 for all 5 Anthropic arms) |

No new adapters are needed for any of these: all four run through existing arms via the
`--model <arm>=<model>` override. (Gemini would need a new arm — explicitly out of scope
here; see "Not in this plan" at the bottom.)

## Ground rules

- **Never edit the ARMS registry defaults** in `harness/cli.mjs` — pass `--model` overrides
  instead, so existing runs stay comparable and the change is visible in each row's `model`
  column.
- **Always pass `--budget <usd>`** (hard stop, checked live) and `--label <name>`.
- `--n` must be a positive **odd** integer. Presets: `smoke` → n=1, `full` → n=3.
- Runs are strictly sequential; a full 2-arm × 8-site × 49-task × n=3 flight takes roughly
  **4–7 h wall clock** (container boots/resets included). Plan them as overnight runs.
- Results append to `results/live.jsonl` immediately per attempt, so an interrupted run
  loses nothing. Follow `results/README.md` conventions when archiving a finished run
  (including a `PROVENANCE.md` noting model IDs, git SHA, and any deviations).
- Prereqs: Linux host with docker + 16 GB RAM for the `full` site profile,
  `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` set, `npm ci`, and Playwright Chromium
  installed (`npx playwright install chromium` if `harness/bin/prereqs` complains).
- Do not modify anything under `results/2026-07-27-reference/`.

## Phase 0 — prep (one small commit, then a smoke run)

### 0a. Add pricing for the new models

In `harness/lib.mjs`, extend `PRICES` (order matters — `costFor` takes the **first**
matching prefix; none of these collide with existing entries):

```js
["claude-opus-5", [5, 25, 0.5, 6.25]],
["gpt-5.6-sol", [5, 30, 0.5, 0]],
["gpt-5.6-terra", [2, 12, 0.2, 0]],
["gpt-5.6-luna", [0.2, 1.2, 0.02, 0]],
```

Rates verified against openai.com/api pricing and Anthropic pricing, August 2026
(Luna reflects the July 30, 2026 price cut). Without these entries, costs silently fall
back to Sonnet rates and every row gets flagged `cost_estimated` — that must not happen.

### 0b. Verify the OpenAI computer tool still works on GPT-5.6

`arms/cu-openai.mjs` calls the Responses API with a `type: "computer"` tool, written
against `gpt-5.5`. OpenAI retired the dedicated `computer-use-preview` model on
2026-07-23 and moved computer use to a tool on mainline GPT-5.6 models — the tool type
may now be `computer_use`. **Do not guess**: run the smoke below; if the API rejects the
model/tool combination, consult the current OpenAI computer-use guide
(developers.openai.com/api/docs/guides/tools-computer-use) and update the tool
declaration in `arms/cu-openai.mjs` accordingly. `arms/wm-gpt.mjs` uses plain function
calling and should work unchanged.

### 0c. Smoke run (gate for everything else)

One cheap, fast-booting site, n=1, both OpenAI arms on Luna:

```sh
npm run bench -- --preset smoke --sites tailwind-nextjs-blog \
  --arms cu-openai,wm-gpt \
  --model cu-openai=gpt-5.6-luna --model wm-gpt=gpt-5.6-luna \
  --budget 2 --label luna-smoke
```

**Gate 0 — proceed to Phase 1 only if:** the API accepts the model and computer tool;
no `cost_estimated` rows; no `harness-infra` failures; no "unknown model pricing"
warning in the console. Pass rate does not matter here.

## Phase 1 — GPT-5.6 Luna, full flight (~$2–4, one overnight run)

```sh
npm run bench -- --preset full --sites full \
  --arms cu-openai,wm-gpt \
  --model cu-openai=gpt-5.6-luna --model wm-gpt=gpt-5.6-luna \
  --n 3 --budget 10 --label luna-full
```

What to watch and report:

- **The headline number: `wm-gpt` (WebMCP) pass rate on Luna.** The gpt-5.5 baseline is
  93.2%. If a $0.20/M model holds ≥ ~85–90% on WebMCP while `cu-openai` on the same model
  degrades sharply, that is the strongest possible framing of the benchmark's thesis.
- `budget_exhausted` count on `cu-openai` — a weak model flailing on pixels shows up as
  step-cap exhaustion (reference gpt-5.5: 14 of 147).
- Retries / 429s: Luna is a high-throughput tier, but confirm the retry counters stay low.
- Median $/attempt and tokens per tier, from the generated `report.md` / `results.csv`.

**Gate 1:** report the arm-level table (pass %, median $/attempt, tokens, budget-exhausted)
and stop for review. Luna results are informative regardless of pass rate — a bad CU score
is a finding, not a failure.

## Phase 2 — GPT-5.6 Sol, full flight (~$33, one overnight run)

Same two arms; Sol is priced identically to the gpt-5.5 baseline ($5/$30), so the
reference run's ~$32 OpenAI spend is a good estimate.

```sh
npm run bench -- --preset full --sites full \
  --arms cu-openai,wm-gpt \
  --model cu-openai=gpt-5.6-sol --model wm-gpt=gpt-5.6-sol \
  --n 3 --budget 45 --label sol-full
```

Compare directly against the reference gpt-5.5 rows (cu-openai 89.1% / $0.0816 median;
wm-gpt 93.2% / $0.0150 median) and against Phase 1 — the Sol-vs-Luna delta per interface
class shows how much model capability buys on each interface.

**Gate 2:** same report format; stop for review.

## Phase 3 (optional) — GPT-5.6 Terra (~$13)

Only if the Sol/Luna spread makes the mid-tier interesting, or reviewers ask which model
OpenAI actually recommends for computer use (it is Terra):

```sh
npm run bench -- --preset full --sites full \
  --arms cu-openai,wm-gpt \
  --model cu-openai=gpt-5.6-terra --model wm-gpt=gpt-5.6-terra \
  --n 3 --budget 20 --label terra-full
```

## Phase 4 — Claude Opus 5, run last (~$30 core, ~$117 full)

Opus 5 supports the current `computer_20251124` tool version that `arms/cu-claude.mjs`
already declares — no code change beyond the Phase 0 pricing entry.

**4a. Core (CU + WebMCP, mirrors the OpenAI phases):**

```sh
npm run bench -- --preset full --sites full \
  --arms cu-claude,wm-claude \
  --model cu-claude=claude-opus-5 --model wm-claude=claude-opus-5 \
  --n 3 --budget 40 --label opus5-core
```

Estimate: ~$30 (Sonnet baseline $16.78 + $1.47, scaled ×1.67 for Opus rates).

**4b. Optional full Anthropic sweep** — extend to the remaining three arms
(`dom-browseruse`, `a11y-stagehand`, `wm-stagehand`; all accept an Anthropic model ID via
`--model` since Stagehand hardcodes the `anthropic/` provider prefix):

```sh
npm run bench -- --preset full --sites full \
  --arms dom-browseruse,a11y-stagehand,wm-stagehand \
  --model dom-browseruse=claude-opus-5 --model a11y-stagehand=claude-opus-5 --model wm-stagehand=claude-opus-5 \
  --n 3 --budget 110 --label opus5-extended
```

Estimate: ~$87 additional (~$117 for all five arms). Only run 4b if 4a's ranking makes the
full sweep worth publishing.

## Budget summary

| Phase | Est. API cost | Wall clock |
|---|---|---|
| 0 smoke | < $1 | < 1 h |
| 1 Luna | $2–4 | ~4–6 h |
| 2 Sol | ~$33 | ~4–6 h |
| 3 Terra (optional) | ~$13 | ~4–6 h |
| 4a Opus 5 core | ~$30 | ~5–7 h |
| 4b Opus 5 extended (optional) | ~$87 | ~12–15 h |
| **Total (1+2+4a)** | **~$65–70** | 3 overnight runs |

## Not in this plan

- **Gemini** (`gemini-3.6-flash`, Google's GA computer-use model): requires a new arm —
  adapter file, ARMS entry, SDK dependency, and ideally a paired `wm-gemini` — roughly a
  day of engineering. Scope it as a separate task after Phase 4.
- Changing arm defaults, viewport, step budgets, or anything that would break
  comparability with the reference run.
