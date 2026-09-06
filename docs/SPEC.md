# WindTunnel — design spec

WindTunnel is the WebMCP benchmark. It measures WebMCP against the other ways a
browser agent operates a website — screenshots (computer use) and page
structure (DOM / accessibility tree) — by racing all three against the **same
tasks** on the **same real websites**, scoring each on whether the task
actually succeeded and what it cost in time, tokens, and dollars. This document
is the design: what it measures, how, and why
each choice was made. A plain-language overview is in the
[README](../README.md); vocabulary is in [CONTEXT.md](../CONTEXT.md).

## 1. Goal

Answer one question with evidence instead of opinion: **does WebMCP let an
agent operate a website more reliably and cheaply than screenshots or page
structure — and where does it not?**

The three methods (the benchmark calls them *interface classes*):

- **Screenshots** — the agent sees rendered images and acts by coordinates
  (computer use).
- **Page structure** — the agent reads the page's HTML / accessibility tree.
- **WebMCP tool calls** — the site exposes direct actions
  (`add_to_cart(id)`), and the agent calls them.

Concrete success bar for the first release: someone with Docker and an API key
can score a method on a laptop-sized subset in under an hour; the results are
reproducible from pinned inputs; and the numbers are trustworthy enough to
settle the question in public.

## 2. Why a new benchmark

Existing web-agent benchmarks (WebArena, WebVoyager, Mind2Web, and others)
measure how well *one* agent style completes tasks. None of them race the
**access methods against each other** on identical tasks, none include WebMCP,
and most stop short of real checkout/booking flows. WindTunnel is built around
that head-to-head comparison.

What makes the results defensible:

- **Verifiable** — success is a code check against real post-run state, never
  a human or an LLM judge.
- **Reproducible** — real apps pinned at fixed versions, run in deterministic
  local containers.
- **Transaction-inclusive** — it scores real checkout and booking flows,
  configured so no real charge occurs (the site's sandbox/test mode, or an
  offline-payment fixture).
- **Interface-controlled** — the same task runs through all three methods, so
  differences come from the interface, not the task or the site.
- **Real sites** — production open-source apps, not simplified pages tuned to
  flatter one method.

## 3. The sites

WindTunnel runs eight real open-source apps, chosen to cover the three things a
web agent does — a trust ladder from
[WebMCP.com methodology](https://webmcp.com/methodology): **answer** (read-only),
**act** (reversible state change), and **transact** (money or commitment) —
across different tech stacks and both public and logged-in pages.

| site | category | resource class | transaction flow |
|---|---|---|---|
| nextjs-starter-medusa | online store | medium | ✅ real checkout (test payments); v1.1 adds the `complete_checkout` WebMCP tool — see CHANGELOG.md |
| hi-events | events / ticketing | heavy | ✅ ticket checkout |
| easyappointments | appointment booking | medium | ✅ booking |
| directory-9d8 | business directory | light | — |
| learnhouse | course platform | medium | — (authenticated author flows) |
| idurar-erp-crm | B2B CRM | heavy | — (authenticated CRUD) |
| tailwind-nextjs-blog | thin-content control | light | — |
| bulletproof-react | auth / mock-API control | light | — |

The last two are **negative controls**: sites where the right behavior is to
answer, not act. They catch a method that hallucinates actions or invents tools
that shouldn't exist.

**Where the sites come from.** WindTunnel is standalone — it has no runtime
dependency on any other project. The boot recipes for every site (pinned
commits, container definitions, seed data, and the WebMCP tool implementations)
ship in this repo under `capsules/` and `fixtures/`. What is *not* copied is
each site's own source code: at run time it is cloned from its public upstream
repository at the pinned commit and patched locally, so upstream licenses are
never redistributed. Full credits and licenses are in
[ATTRIBUTION.md](../ATTRIBUTION.md). New sites are added by contributing a
capsule recipe and registering the site in
[`sites/sites.yaml`](../sites/sites.yaml).

**How a site is run.** Each site boots as a deterministic container stack with
a fixed lifecycle — `prepare → up → status → reset → down` — with seeded data,
test identities, and health checks. Between repeat runs the harness issues
`reset` and confirms clean state before continuing, so no run contaminates the
next.

**Running a subset.** Booting all eight stacks needs a substantial machine, so
sites are grouped into profiles selectable with `--sites`: `lite` (three
lightweight sites, no databases — laptop/CI), `core` (lite + the online store,
one database), `categories` (one site per category), and `full` (all eight).
Profiles are defined in [`sites/sites.yaml`](../sites/sites.yaml); the resource
classes there are current estimates and are verified against the container
manifests before a release is frozen.

**How success is checked.** An evaluator-only probe reads real state after the
agent finishes — the store's cart row, the event's order record, the booked
appointment — through API, database, browser, and authorization adapters the
agent never sees. The task's predicate passes or fails on that.

**Live targets vs controls.** Six of the eight sites are live targets, meant
to be acted on or transacted with. The other two are **controls**: read-only
sites where the task has nothing to act on, so passing means answering the
question and stopping. They catch the opposite failure — an agent that acts
when it shouldn't.

## 4. Keeping the comparison honest

These are real open-source apps, so their code is already in every model's
training data. WindTunnel does not try to hide the sites; instead the design
makes memorization irrelevant to the result:

1. **Paired comparison (the main defense).** Every method runs the same task on
   the same site. If a model has memorized a site, that helps *all three*
   methods equally — it inflates the absolute scores together but leaves the
   *gap between methods*, which is the actual claim, intact. Memorization would
   only distort the finding if it helped one interface more than another, and
   nothing about knowing a site's content does that.
2. **Held-out task sets.** The secret that rotates each leaderboard period is
   the **tasks** — their prompts, checks, and data values — not the sites. A
   development set is public; the scoring set is private (see §7).
3. **Seeded data we control.** Catalog contents, prices, dates, and
   availability are seeded by WindTunnel, so held-out task sets can use fresh
   values that can't be answered from the upstream defaults.
4. **Perturbation mode** (§6) tests reliance on unstable page details.
5. **Canary markers** on published data so training pipelines can exclude it,
   plus periodic contamination checks.

### 4.1 Memorization risk: bounded, not eliminated

The sites are open source and this repo ships its own fixtures, so the values
checked by the **41 answer-scored tasks are visible here** — a model trained on
the repo could recall some of them instead of reading the live site. Stated
plainly, because the development set cannot be made memorization-proof.

What bounds the risk:

- The other **8 tasks are scored by inspecting application state** (orders,
  appointments, invoices, carts). Recall cannot fake a database row — it has to
  be created.
- **Every attempt's full transcript is published** in the run's `run.json`, so
  anyone can check whether an agent actually called tools and read pages, or
  answered blind. This is auditable by a skeptic rather than asserted by us.

What actually fixes it: a **held-out task set with unpublished values**, which
is planned and not yet built. Until it exists, read answer-tier scores as
retrieval-plus-possible-recall, not retrieval alone. State-verified tasks and
the published transcripts are what carry weight in the meantime.

## 5. Tasks

Tasks are small YAML templates — each has a prompt, a success predicate, a
difficulty tier, and any data parameters. The repo currently ships 17: 7
benchmark tasks across the three `lite` sites, plus 10 calibration tasks. The
design target is ~50, roughly six or seven per site. Tiers, by journey length:

- **T1 — answer** (1–2 steps): "what's the price of X?"
- **T2 — act, short** (3–5 steps): "add two of X to the cart."
- **T3 — act, long** (6–10 steps): "file a ticket, assign it, set priority
  from the report."
- **T4 — transaction** (8–15 steps): "book the cheapest slot and confirm."

Fifty is a deliberate floor, not a round number: with a task counted as solved
only when it passes most repeats, ~50 tasks give the score enough resolution
(about two percentage points per task) to separate methods that finish close
together — 25–30 tasks cannot. Task parameters resolve from the seeded data, so
the correct answer lives only in the running instance. Transaction tasks target
the three sites with real checkout/booking; authenticated-page tasks (course
authoring, CRM edits) exercise logged-in flows. A frozen task subset for CI and
cheap runs — selected with `--preset lite` (distinct from the `--sites lite`
site profile) — is planned; today presets set only the repeat count (`smoke`:
N=1; `lite`/`full`: N=3).

## 6. Methods under test and how runs are configured

Eleven implementations across four interface classes are represented in the
canonical run:

| id | interface class | driver | canonical model(s) | status |
|---|---|---|---|---|
| `wm-claude` | WebMCP | native loop | claude-sonnet-5, claude-opus-5 | built · measured |
| `dom-browseruse` | page structure (DOM) | Browser Use | claude-sonnet-5, gpt-5.6-luna | built · measured |
| `a11y-stagehand` | page structure (a11y) | Stagehand agent | claude-sonnet-5, gpt-5.6-luna | built · measured |
| `cu-claude` | screenshots | Anthropic computer use | claude-sonnet-5, claude-opus-5 | built · measured |
| `cu-openai` | screenshots | OpenAI computer use | gpt-5.6-luna, gpt-5.6-sol, gpt-6-astra | built · measured |
| `wm-gpt` | WebMCP | native loop | gpt-5.6-luna, gpt-5.6-sol, gpt-6-astra | built · measured |
| `wm-stagehand-v4` | WebMCP | Stagehand v4 | claude-sonnet-5 | built · measured |
| `wm-stagehand-v4-gemini` | WebMCP | Stagehand v4 | gemini-3.6-flash | built · measured |
| `cu-gemini` | screenshots | Gemini computer use | gemini-3.6-flash | built · measured |
| `wm-gemini` | WebMCP | native loop | gemini-3.6-flash | built · measured |
| `code-openai` | code execution (Playwright) | OpenAI function tool `exec_js`: model-written JavaScript runs in the harness with Playwright `page` in scope; stdout and `display()` screenshots are returned | gpt-6-astra | built · measured |

The headline groups these into the four interface classes; per-method numbers
are available underneath. `code-openai` is OpenAI's recommended computer-use
path for GPT-6 Astra: the model writes Playwright code that can both query
selectors and take screenshots, so it is neither "screenshots" nor "page
structure" and is reported as its own class. It runs at the screen-driving
step budget and a 1280×800 viewport; the model's code executes in the harness
process against pinned local capsules (a `node:vm` context exposing only the
browser objects). New methods are added by implementing one small
interface, so outside contributors can submit their own.

The WebMCP methods call the tools each site's capsule installs (the WebMCP
reference implementations vendored under `capsules/`) — real, reviewed tool
sets, not tools invented for the benchmark.

Run configuration:

- `--arms` selects which methods run. A method whose API key is absent is
  **skipped with a notice**, never an error — no Anthropic key still runs
  every GPT method, and vice versa.
- `--model <method>=<model>` overrides a method's model (any tool-capable model
  for the WebMCP methods; the computer-use methods are vendor-locked).
- `--sites <profile|list>` picks which sites boot; `--n` sets repeats (odd,
  for majority scoring; the preset sets the default). A planned `--n auto`
  mode — run each task once, repeat only first-attempt failures — is not yet
  implemented. `--budget <usd>` is a hard stop.
- `--perturbed` is planned and currently rejected explicitly.

Practical note: containers boot in minutes, not milliseconds, so the harness
boots each site once per (site × method) batch and `reset`s between repeats
rather than rebooting per run.

The canonical board (v1.1) uses Sonnet 5, Opus 5, GPT-5.6 Luna, GPT-5.6 SOL,
GPT-6 Astra, and Gemini 3.6 Flash. Its 19 configurations produced 2,793
attempts at a recorded total cost of $281.35 (see the README's [Cost](../README.md#cost) section). Other
models are a natural thing for submitters to bring.

### 6.1 Single- vs multi-modal arms

The `cu-*` (screenshots-only) and `a11y-stagehand` (accessibility-tree-only)
arms are deliberate single-channel controls, so a difference can be
attributed to *that* channel. Browser Use, by contrast, runs **multimodal by
default** — it sends the model the DOM *and* a screenshot each step — so
`dom-browseruse` is really a DOM+vision agent, the strongest realistic
non-WebMCP baseline, not a DOM-only one. That is the fair comparison for
WebMCP: on the canonical board, Sonnet 5 on DOM + vision passes 145/147
attempts and solves 48/49 tasks; native WebMCP for the same model passes
147/147 and solves 49/49 while costing 23× less per median attempt, using
12.5× fewer tokens, and running 4.3× faster.

A set-of-marks arm (a11y marks overlaid on a screenshot, à la WebVoyager) is a
planned addition as an even stronger combined baseline.

### 6.2 How the headline numbers are computed

- **Solved** — a task counts as solved by a method when a majority of its N
  attempts pass. Counts quoted as `x/y` are **task×method cells**, not tasks.
- **Time** — the headline is **median agent time**: the per-attempt clock
  starts after the container reset and page boot and stops before scoring, so
  the identical harness overhead every method pays (11–34s per attempt,
  depending on the site) is excluded from all of them. Rows also carry
  `reset_s`, `setup_s`, and total `wall_clock_s`.
- **Cost** — provider list prices, with **cached input priced at each
  provider's cached rate**. Prompt caching is enabled for every method whose
  framework supports it, and each row records its `caching` state so an arm
  that cannot cache is visible rather than silently cheap.
- **Tokens** — *total processed*: uncached input + cache reads + cache writes +
  output. Cache reads and writes are real model context; the discount is a
  billing fact captured in the cost column, so excluding them would make
  caching arms look an order of magnitude lighter than they are. The split
  stays in `results.csv` for anyone who wants it.
- **Leaderboard score** — a display-only composite: attempt success 60%,
  median cost 20%, and median agent time 20%. Success enters as the raw pass
  rate; only cost and time are log-transformed, min-max normalized across the
  field, and reversed so lower is better. Success is deliberately NOT min-max
  normalized: that pins the weakest arm to exactly 0 and deletes the entire
  60% weight, so an arm passing 81% of its attempts scored 9.2/100. Tokens are not scored separately because cost already reflects
  them. The underlying metrics remain the primary results.
- **Infrastructure exclusions** — attempts that fail on provider rate limits
  or capsule boot errors are excluded from every number and reported
  separately. Agent and driver failures — including step-budget exhaustion and
  the uniform 600s per-attempt agent cap — **count as failures**.
- **Per-tier multiples** (the journey-length table) are the pooled native
  computer-use median ÷ the pooled native WebMCP median for that tier, with
  each of the six paired models represented equally. The long-tier sample is
  12 tasks: 72 model-task cells and 216 attempts per interface.

Report format: [`results/README.md`](../results/README.md); template:
[`results/TEMPLATE.md`](../results/TEMPLATE.md).

**Why cost scales differently with journey length.** Every interface gets more
expensive on longer journeys — WebMCP included, since each call adds its
arguments and its result to the conversation, and tool schemas are re-sent on
every request rather than registered once at the wire level. The difference is
the growth rate: a page-reading interface re-reads the whole page on every
step, so its payload compounds, while a WebMCP call's payload is independent of
page size. Measured across tiers in the six-model comparison (median cost per
attempt, shortest tier → longest): **WebMCP $0.0067 → $0.0285 (~4×)**;
**computer use $0.0399 → $0.3620 (~9×)**. That divergence, not a flat WebMCP
cost, is what widens the multiple on long journeys.

**OpenAI arms, v1.1 harness.** The OpenAI arms send no `temperature` (every
GPT-5.x/6 reasoning model rejects it; rows record `temperature: default` and
the provider-reported `effort`). OpenAI reports cache writes inside
`input_tokens`; the arms split them out and price them at the provider's
cache-write rate (1.25× input on GPT-5.6+/Astra). `cu-openai` sends a
`keypress` as one chord (Ctrl+A), matching OpenAI's action semantics; Luna and
SOL rows predate that fix and are retained as measured (see PROVENANCE).

**Per-interface turn budgets.** A task's YAML may set `max_steps` per interface
class; when it doesn't, the arms fall back to their defaults — **WebMCP 12,
computer use 25, DOM/a11y 20 turns**. The classes differ because the same
journey costs a different number of model turns per interface: a screenshot
agent needs roughly three turns per journey step, a tool-calling agent about
one. Every attempt is additionally capped at **600s of agent time**, and a row
records `budget_exhausted` when the loop ended by hitting its limit.

**Model prices.** Cost estimates use a built-in per-model price table
(`harness/lib.mjs`), which the run serializes into `run.json` so a published
result can be re-costed later. A model absent from the table is estimated at
Sonnet rates and its rows are flagged `cost_estimated`, rather than silently
priced.

**Model snapshots.** Native harnesses record the provider response when it
identifies the served snapshot. Stagehand and browser-use cannot surface that
value, so their rows use `snapshot_source: unavailable:<harness>` and the
configured model is confirmed out of band by `scripts/verify-model.mjs`.

## 7. Leaderboard and held-out scoring

Submitters send their method (a container/config plus their own API keys); the
maintainer runs it against the current period's private task set. Integrity
comes from a commit-and-reveal: the SHA-256 of a period's task set is published
when the period **opens**, and the task set itself is revealed when it
**closes** — so anyone can confirm the tasks existed unchanged before any
submission, and re-run every score. A self-serve task-set service is a later
addition if submission volume needs it.

## 8. Non-goals (first release)

- No remote or unpinned websites — everything runs from pinned local
  containers.
- No real payments — transaction tasks use the sites' own checkout flows in
  sandbox/test mode or with an offline-payment fixture, so no real charge
  occurs.
- No LLM or human judging — code predicates only.
- No tuning of third-party agent frameworks by us — they run at their defaults.
- No mobile viewports, CAPTCHA simulation, or auth walls beyond what the sites
  ship — candidates for later.

## 9. License and governance

The benchmark code is Apache-2.0 (chosen over MIT for its explicit patent
grant, which suits corporate contributors). Each site keeps its upstream
license; [ATTRIBUTION.md](../ATTRIBUTION.md) records the pin-and-patch rule that
keeps copyleft site code out of this repo, and the Hi.Events footer-attribution
obligation. Contributions are accepted under a DCO sign-off.
