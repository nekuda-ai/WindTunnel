# Calibration flight — directory-9d8 (2026-07-23)

**Not a benchmark result.** A cost/plumbing test flight: one real site
(directory-9d8, WebMCP golden applied, run via manual lifecycle), 5 tasks,
N=1, two arms (wm-claude, cu-claude), both using the retired Anthropic
calibration model. Purpose: verify
the runner end-to-end and get real per-task costs before the full sweep.

## Result

| Arm | Solved | Median time | Median tokens | Median cost |
|---|---|---|---|---|
| wm-claude (WebMCP) | 5/5 | 5.9 s | 2,500 | $0.009 |
| cu-claude (computer use) | 4/5 | 22 s | 25,235 | $0.081 |

Total spend this flight: **$0.71** (first, budget-truncated flight: $0.34).

## Findings

1. **Plumbing works end-to-end** — both arms drive a real site, answer
   predicates score against finalText, budget rail enforces, report + CSV +
   run.json emitted.
2. **Real costs are far below the old-study medians on this (light) site** —
   WebMCP ~$0.009/task (old study $0.038), computer use ~$0.08/task (old study
   $0.57). Lighter site, shorter journeys, screenshot pruning.
3. **cu-claude cal-3 failure is a REAL interface limitation, not a bug.** The
   task asks for a bookmark's destination URL, which is an `href` behind a
   "Visit Website" button — not visible text. The screenshot agent cannot read
   an href from pixels (tried right-click, F12, status-bar hover; all fail
   headless), burned 74 s / 124k tokens / $0.39 flailing, and gave up. WebMCP's
   `get_bookmark` returns `url` as data → trivial. This is the interface gap
   the benchmark measures — but note it as a **task-design flag**: "read a link
   target" structurally favors WebMCP. Keep such tasks only as deliberate,
   disclosed probes of that exact gap, not as generic answer tasks.
4. **The turn-budget bug is fixed** — flat `max_steps` was capping model turns;
   now per-interface (`{webmcp, cu, structured}`). cal-5 (the newsletter fix)
   passes on both arms, exercising this morning's directory fixture fix live.

## Full-sweep cost projection (conservative)

Calibration confirms the cheap end; heavier sites (medusa, hi-events) have
longer journeys and will cost more per task, especially for computer use.

- WebMCP ×3 arms: ~$5 total across 50 tasks × N=3 (trivially cheap).
- Computer use ×2: the dominant cost; light-site $0.08/task, heavy-site tail
  seen at $0.39. Budget $0.15–0.40/task → $45–120 across 300 runs.
- Browser Use + Stagehand ×2: old-study ~$0.25/task → ~$75 across 300 runs.

Estimated full 8-site sweep (50 tasks × 7 arms × N=3): **$100–200**, under the
$240 ceiling. Recommend a `--budget` cap and a per-heavy-site calibration
before committing the full run.

## Reference-run cost breakdown (2026-07-27)

Money actually spent: **$107.41** — $102.63 for the base 56-batch run plus
$4.78 for the two targeted patch flights. Of that, the three WebMCP methods
together were **$9.97 (~9%)**; the browser methods (screenshots, DOM+vision,
a11y) carry the remaining ~91%.

The explorer reports "about $102.68" because it sums the *merged dataset* — the
27 base-run attempts superseded by the patch flights are excluded there, but
they were still paid for. Both figures are correct for what they count.

The per-method flight documented above predates the reference run and is
superseded by the measured per-task table in the README.
