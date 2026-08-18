<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo.svg" width="78" height="78" alt="">
</picture>

# WindTunnel

**Benchmark WebMCP against other methods browser agents use to interact with websites.**

[Quick start](#quick-start) · [Results](#results) · [Run data](results/) · [Methodology](docs/SPEC.md) · [Cost](#cost) · [WebMCP spec](https://github.com/webmachinelearning/webmcp)

[![license](https://img.shields.io/badge/license-Apache--2.0-a9c1a0?style=flat-square&labelColor=2f3336)](LICENSE)
[![benchmark](https://img.shields.io/badge/benchmark-49%20tasks%20%C3%97%208%20sites-a9c1a0?style=flat-square&labelColor=2f3336)](tasks/)
[![built on](https://img.shields.io/badge/built%20on-WebMCP-a9c1a0?style=flat-square&labelColor=2f3336)](https://github.com/webmachinelearning/webmcp)
[![tests](https://img.shields.io/github/actions/workflow/status/nekuda-ai/WindTunnel/test.yml?branch=main&style=flat-square&label=tests&color=a9c1a0&labelColor=2f3336)](https://github.com/nekuda-ai/WindTunnel/actions/workflows/test.yml)
[![results](https://img.shields.io/badge/results-15%20configurations%20%C2%B7%202%2C205%20attempts-eaa47c?style=flat-square&labelColor=2f3336)](#results)

</div>

**WindTunnel compares WebMCP with other ways browser agents interact with
websites.** It runs the same tasks on the same sites and measures success rate,
execution time, token usage, and cost.

## Quick start

Just want the results? [Jump to them.](#results)

Run the harness for free (Node 20.11+, no key, no Docker):

```bash
npm ci
WT_FAKE_LIFECYCLE=1 npm run bench    # no LLM — scores 0/7 by design, just proves it runs
```

Run the real benchmark — needs Docker, Linux, and a key
([setup](#running-it-yourself)):

```bash
npx playwright install chromium
export ANTHROPIC_API_KEY=sk-ant-...
npm run bench -- --arms wm-claude,cu-claude --budget 2
```

Runs the 7 tasks on the three lightweight sites once each, same model on two
interfaces — WebMCP against screenshots. 14 attempts, well under $1; `--budget`
hard-stops the run if it isn't.

## Background: Three ways to operate a website

A browser agent can operate a website through three main interfaces:

1. **Screenshots (computer use)** — it reads rendered images of the page and
   acts by coordinate.
2. **Page structure** — it reads the page's DOM and accessibility tree.
3. **WebMCP** — the website exposes direct actions (`add_to_cart(id)`,
   `book_slot(time)`) for the agent to call.
   ([What is WebMCP?](https://github.com/webmachinelearning/webmcp))

## Results

**Reference run: 2026-07-27** — 7 methods × 49 tasks across 8 sites × 3
attempts = 1,029 attempts. **Additional runs: 2026-08-13–17** — Stagehand v4
plus Luna, SOL, Gemini, and Opus on native computer use and WebMCP = 1,323
attempts.

WebMCP completed **94–98% of tasks vs. 78–90%** for the other interfaces. In
the six native model pairs it was about **3–5× faster, 5–10× cheaper, and
5–11× lighter on tokens**.

Full run data — [reference](results/2026-07-27-reference/),
[Stagehand v4](results/2026-08-13-stagehand-v4-native-full/),
[Luna](results/2026-08-16-luna-full/),
[SOL](results/2026-08-17-sol-full/) ([canonical replacements](results/2026-08-17-sol-600-timeouts/)),
[Gemini](results/2026-08-17-gemini-full/), and
[Opus](results/2026-08-17-opus5-full/).

| Model | Interface | Tasks solved | Attempt success | Median cost | Median agent time | Median tokens |
|---|---|---:|---:|---:|---:|---:|
| Sonnet 4.6 | WebMCP · native | 48/49 (98.0%) | 142/147 (96.6%) | $0.007 | 7.2s | 3,626 |
| Sonnet 4.6 | WebMCP · Stagehand v4 | 48/49 (98.0%) | 144/147 (98.0%) | $0.008 | 7.3s | 3,596 |
| Sonnet 4.6 | Computer use | 39/49 (79.6%) | 115/147 (78.2%) | $0.047 | 31.1s | 38,856 |
| Sonnet 4.6 | DOM + vision | 43/49 (87.8%) | 130/147 (88.4%) | $0.112 | 37.8s | 33,365 |
| Sonnet 4.6 | Accessibility tree | 42/49 (85.7%) | 128/147 (87.1%) | $0.043 | 35.6s | 11,784 |
| GPT-5.5 | WebMCP | 47/49 (95.9%) | 137/147 (93.2%) | $0.015 | 5.8s | 2,546 |
| GPT-5.5 | Computer use | 44/49 (89.8%) | 131/145 (90.3%) | $0.090 | 20.4s | 18,659 |
| GPT-5.6 Luna | WebMCP | 46/49 (93.9%) | 137/147 (93.2%) | $0.002 | 5.7s | 2,596 |
| GPT-5.6 Luna | Computer use | 41/49 (83.7%) | 122/147 (83.0%) | $0.017 | 18.3s | 20,914 |
| GPT-5.6 SOL | WebMCP | 46/49 (93.9%) | 138/147 (93.9%) | $0.013 | 9.4s | 2,573 |
| GPT-5.6 SOL | Computer use | 42/49 (85.7%) | 123/147 (83.7%) | $0.063 | 25.1s | 16,312 |
| Gemini 3.6 Flash | WebMCP | 47/49 (95.9%) | 142/147 (96.6%) | $0.004 | 7.8s | 4,460 |
| Gemini 3.6 Flash | Computer use | 38/49 (77.6%) | 116/147 (78.9%) | $0.020 | 33.7s | 23,658 |
| Claude Opus 5 | WebMCP | 48/49 (98.0%) | 142/147 (96.6%) | $0.014 | 9.9s | 4,871 |
| Claude Opus 5 | Computer use | 43/49 (87.8%) | 127/147 (86.4%) | $0.139 | 50.4s | 47,141 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/charts/balanced-leaderboard-dark.svg">
  <img src="assets/charts/balanced-leaderboard.svg" alt="WindTunnel leaderboard across WebMCP, computer-use, DOM, and accessibility-tree configurations, weighting attempt success at 60 percent, median cost at 20 percent, and median agent time at 20 percent.">
</picture>

<sub>The final score weights attempt success 60%, median cost 20%, and median
agent time 20%; cost and time are log-scaled across the 15 configurations.
Each component is normalized to the observed 0–100 range before weighting.
Tokens are not scored separately because they are already reflected in cost.
The Sonnet 4.6 configurations use the reference results for native WebMCP,
computer use, DOM + vision, and accessibility tree, plus the later Stagehand
v4 result. The table reports tasks solved by a majority of three attempts.
Infrastructure rows are excluded.</sub>

### How the advantage scales with journey length

| Tier | Tasks | WebMCP solved | Computer use solved | Cheaper | Faster | Lighter |
|---|---:|---:|---:|---:|---:|---:|
| Answer (1–2 steps) | 21 | 103/105 | 95/105 | 5.2× | 3.6× | 6.3× |
| Action, short (3–5) | 16 | 80/80 | 70/80 | 4.6× | 3.1× | 4.7× |
| **Action, long (6–10)** | 8 | **36/40** | **24/40** | **10.9×** | **5.4×** | **12.5×** |
| **Sensitive action (8–15)** | 4 | **15/20** | **19/20** | **12.0×** | **9.4×** | **15.1×** |

**On long journeys the efficiency gap still widens sharply.** Across the 12
long and sensitive-action tasks, WebMCP solved **51/60 model-task cells (85%)** vs
**43/60 (72%)**, at **10.9× lower cost**, **7.6× less agent time**, and **16.3×
fewer tokens**. The sensitive-action row is the deliberate coverage boundary:
today's WebMCP tools hand guest checkout back to the page before the final
purchase, so computer use completes that one task more often.

<sub>How these numbers are computed: [`docs/SPEC.md`](docs/SPEC.md).</sub>

## How it works

Every task runs on the same site, from the same seeded state, scored by the
same check, for every method — so a difference in outcome isn't the site or the
data. What differs is the whole method configuration: interface, model,
framework, and turn budget.

- **Real, self-hosted applications.** Production open-source apps, not
  synthetic pages. Each runs locally in Docker, pinned to a fixed version.
- **Outcome-based scoring.** No human or model judges a run: WindTunnel
  inspects the resulting application state — is the item in the cart, does the
  appointment exist — and records pass or fail, plus what the attempt cost.
- **Integrity.** Checked values are generated fresh from a seed, state-changing
  tasks are scored by inspecting the application, and every transcript is
  published so any answer can be audited. Memorization risk and its limits:
  [`docs/SPEC.md`](docs/SPEC.md).

## The sites

Eight applications across public and authenticated pages and different stacks —
six live targets, two read-only controls.

| Site | Type | Pulled from (upstream) | Exercises |
|---|---|---|---|
| nextjs-starter-medusa | online store | [medusajs/nextjs-starter-medusa](https://github.com/medusajs/nextjs-starter-medusa) | browse → cart → checkout |
| hi-events | events / ticketing | [HiEventsDev/Hi.Events](https://github.com/HiEventsDev/Hi.Events) | browse → ticket checkout |
| easyappointments | appointment booking | [alextselegidis/easyappointments](https://github.com/alextselegidis/easyappointments) | booking; admin (auth) |
| learnhouse | course platform | [learnhouse/learnhouse](https://github.com/learnhouse/learnhouse) | catalog; authoring (auth) |
| idurar-erp-crm | B2B CRM | [idurar/idurar-erp-crm](https://github.com/idurar/idurar-erp-crm) | record CRUD (auth) |
| directory-9d8 | business directory | [9d8dev/directory](https://github.com/9d8dev/directory) | search / filter |
| tailwind-nextjs-blog | blog (control) | [timlrx/tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) | read-only content |
| bulletproof-react | web app (control) | [alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react) | read-only; auth |

## The tasks

49 benchmark tasks across the eight sites, plus 10 calibration tasks for cost
measurement. Four difficulty tiers by journey length:

| Tier | Steps | Example |
|---|---|---|
| Answer | 1–2 | "What is the price of X?" |
| Action (short) | 3–5 | "Add two of X to the cart." |
| Action (long) | 6–10 | "File a ticket, assign it, set its priority from the report." |
| Sensitive action | 8–15 | "Book the cheapest available slot and confirm." |

Each task is attempted N times (3 by default). A task is **solved** when a
majority of attempts pass; the headline is solved ÷ total, reported next to
median time, tokens, and cost.

Each task also carries a per-interface turn budget — a screenshot agent needs
~3 turns per step, a tool-calling agent ~1 (defaults: [`docs/SPEC.md`](docs/SPEC.md)).

## The methods

The benchmark starts with seven screenshot, page-structure, and WebMCP methods,
then adds Stagehand v4 and runs the native computer-use/WebMCP pair with Luna,
SOL, Gemini, and Opus. Every configuration uses the same 49 tasks, sites,
scoring, and three attempts.

## Cost

**Where the tokens go.** How much an agent reads each turn is set by the
interface:

- **Screenshots (computer use)** — a full page *image* every turn: thousands of
  tokens each, refreshed nearly every step. Heaviest.
- **Page structure (DOM / accessibility tree)** — the page's *text* every turn.
  Lighter than images, but still the whole page, re-read each step.
- **WebMCP** — a short list of tool schemas plus small JSON results. No page
  text, no screenshots. Lightest by far.

**Task length multiplies it.** Page-reading interfaces grow fastest because
they re-read the page each step. Across the native model pairs, WebMCP's median
cost advantage grows from about 5× on short tasks to 11–12× on longer journeys.

**Per-task medians** across the current 15-configuration leaderboard (tokens
include cache reads; pricing detail in [`docs/SPEC.md`](docs/SPEC.md)):

| Interface | Configurations | Median tokens / task | Median cost / task |
|---|---:|---:|---:|
| WebMCP | 7 | 2,546–4,871 | $0.002–$0.015 |
| Computer use | 6 | 16,312–47,141 | $0.017–$0.139 |
| Accessibility tree | 1 | 11,784 | $0.043 |
| DOM + vision | 1 | 33,365 | $0.112 |

**What a run costs:**

| Run | Scope | Ballpark |
|---|---|---:|
| quick check | `--preset smoke --sites lite` — 3 light sites, 1 attempt each | under $1 |
| small | `--preset lite --sites lite` — the lite task set × 3 attempts | $5–10 |
| full paired model (measured additions) | all 8 sites, 49 tasks × 3 attempts × WebMCP + computer use | ~$6–35 |
| full reference (measured) | all 8 sites, 49 tasks × 3 attempts × 7 configurations | ~$107 |

In the reference flight, the three WebMCP methods were ~9% of the bill; full breakdown:
[docs/CALIBRATION.md](docs/CALIBRATION.md).

**Spending less.** The levers, cheapest first:

- **Fewer sites** — `--sites lite` (3 lightweight sites, no databases).
- **Fewer / cheaper methods** — WebMCP medians are $0.002–$0.015/task;
  computer use and DOM + vision carry most of the cost.
- **Fewer attempts** — `--preset smoke` or `--n 1` instead of the default 3
  (you lose majority voting, so one run decides each task).

## Running it yourself

**Setup.** You need Docker, Node 20.11+, and an API key for the model under test:

```bash
npm install
npx playwright install chromium                       # browser for the agents (or set WT_CHROME)
python3 -m venv .venv-browseruse \
  && .venv-browseruse/bin/pip install browser-use==0.12.7   # only for the dom-browseruse method
```

Real site boots use Linux-oriented capsule tooling. Native Linux is the
lowest-overhead host; macOS works through Docker Desktop when GNU tar and
coreutils are installed and placed first on `PATH` (`brew install gnu-tar
coreutils`). Docker Desktop's VM and filesystem layer add boot/reset and
wall-clock overhead, so report the host and avoid comparing absolute latency
with bare-metal Linux. You can also dry-run the pipeline
(`WT_FAKE_LIFECYCLE=1`) or point it at a site you booted yourself
(`WT_MANUAL_BASEURL=http://localhost:PORT`).

**Site profiles** size the run to the machine at hand:

| profile | sites | needs | runs on |
|---|---|---|---|
| `lite` | 3 lightweight sites, no databases | Node | laptop, CI |
| `core` | `lite` + the online store | + Postgres | 8 GB laptop |
| `categories` | one site per category | mixed | 16 GB machine |
| `full` | all 8 sites | all stacks | 16 GB+ worker |

**Commands.** `--arms` picks the methods; the default (`scripted`) is a free,
no-LLM baseline that only exercises the pipeline:

```bash
npm run bench -- --preset smoke --sites lite --arms scripted    # free pipeline check, no API key
npm run bench -- --preset smoke --sites lite --arms wm-claude,cu-claude   # cheapest paid run, 1 attempt per task
npm run bench -- --preset lite --sites lite --arms wm-claude,cu-claude,dom-browseruse,a11y-stagehand   # every task on the three lite sites × 3 attempts
npm run bench -- --preset smoke --sites lite --arms wm-claude --seed 7 --budget 2 --label check
npm run bench -- --preset smoke --sites idurar-erp-crm --arms cu-openai --task-ids id-6,id-6,id-8 --n 1
```

**Keys.** Runs read the provider key straight from your environment:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # cu-claude, dom-browseruse, a11y-stagehand, wm-claude, wm-stagehand
export OPENAI_API_KEY=sk-...          # cu-openai, wm-gpt
export GEMINI_API_KEY=...             # cu-gemini, wm-gemini
export WT_SECRET=...                  # optional capsule secret
export WT_SECRET_KEY=...              # optional key used to protect it
```

A method whose key is absent is skipped with a notice, never an error.
`--task-ids` selects exact task IDs; repeated IDs intentionally repeat a task,
which is useful for targeted diagnostics.

**Switching models.** `--model <method>=<model>` overrides the model for one
method:

```bash
npm run bench -- --preset lite --sites lite --arms wm-claude --model wm-claude=claude-opus-5
```

Computer use needs a computer-use-capable model. Switching provider takes that
provider's own method and key, not just a model name.

## Repo layout

```
docs/       design spec and methodology
sites/      sites under test + subset configuration
capsules/   self-contained boot recipes per site (Docker, pinned commits, WebMCP tools)
fixtures/   per-site seed data and runtime patches
goldens/    the reference WebMCP tool implementations, one patch per site
tasks/      task definitions
harness/    the runner (bin/ has the site-boot CLIs)
scoring/    per-task checks and result formats
arms/       interface implementations
results/    finished runs and reports
tests/      harness test suite (npm test)
```

## License

WindTunnel's own code — harness, boot recipes, and WebMCP patches — is
Apache-2.0. It does **not** vendor any site's source tree: each site is cloned
from its upstream at a pinned commit and patched locally at run time, so the
copyleft (AGPL/GPL) sites run locally only, and Hi.Events' required "Powered by
Hi.Events" footer is preserved. A few reference patches modify upstream files;
the upstream lines those hunks carry remain under the upstream project's
license. Upstreams, licenses, and pinned commits:
[`ATTRIBUTION.md`](ATTRIBUTION.md) (canonical) and each `capsules/<site>/capsule.yaml`.
