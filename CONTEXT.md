# Context — WindTunnel

The working vocabulary for WindTunnel. This is a glossary only — definitions of
terms, not design decisions (those live in [`docs/SPEC.md`](docs/SPEC.md)).

## Terms

**Interface / interface class** — one of the three ways an agent can operate a
website: **screenshots** (computer use), **page structure** (DOM /
accessibility tree), and **WebMCP** (site-provided tool calls). The thing
WindTunnel compares.

**Method / implementation** — a concrete way to run one interface: a driver
plus a model (for example, WebMCP driven by a native loop with Claude).
WindTunnel ships seven. The CLI flag that selects them is `--arms`, and their
code lives in `arms/`.

**Task** — one instruction to complete on a site (e.g. "add two of X to the
cart"), with a success predicate that decides pass or fail.

**Task template** — the reusable definition of a task: prompt, predicate,
difficulty tier, and data parameters. The repo currently ships 59 active tasks
(50 benchmark + 9 calibration; one API-only task is retained but excluded).

**Tier** — a task's difficulty band by journey length: **answer** (1–2 steps),
**act, short** (3–5), **act, long** (6–10), **transaction** (8–15).

**Task set** — the concrete set of tasks used for a run, with their data
values filled in. The **development** set is public; the **held-out** set is
private and used for official scoring.

**Fixture data (seed)** — the data a site's database is loaded with (catalog,
prices, dates, records). Set from a fixed seed per task set, so held-out sets
can use fresh values that can't be answered from a site's public defaults.

**Container stack** — a site booted as a pinned, reproducible set of services
with seeded data and health checks, on a fixed lifecycle
`prepare → up → status → reset → down`. The recipe for each site is a
**capsule** vendored in-repo under `capsules/<site>/`.

**Repeat (N)** — one attempt at a task by a method. Default N = 3 (odd, for
majority scoring). Repeats share the same reset container state, so N measures
the agent's own run-to-run variance.

**Solved (per task)** — a task counts as solved by a method when a majority of
its N attempts pass. The headline score is solved tasks ÷ total tasks. A
secondary **per-run** view reports the share of individual attempts that
passed.

**Negative control** — a site where the correct behavior is to answer, not
act. Guards against a method inventing actions that shouldn't exist.

**Outcome probe** — an evaluator-only reader (API, database, browser, or
authorization) that inspects real state after a run to decide a predicate.
Invisible to the agent.

**Perturbation** — an adversarial change to a page the agent is working on
(renamed buttons, shifted layout, an added modal), used to measure reliance on
unstable page details. Reported separately from the headline.

**Leaderboard period** — a scoring window with its own held-out task set,
committed by hash when it opens and revealed when it closes.

**Site profile** — a named subset of sites (`lite`, `core`, `categories`,
`full`) so a run fits the machine at hand.
