# Results

Finished benchmark runs live here. Each run is one folder, and each folder has
a short Markdown report as its front page.

**The current reference is [`2026-07-27-reference/`](2026-07-27-reference/)** —
the full 7-method × 8-site × 49-task measurement — one benchmark generation (single commit), the base run plus two same-day patch flights (per-cell provenance in its
[`PROVENANCE.md`](2026-07-27-reference/PROVENANCE.md)). Open its
`explorer.html` for the interactive view; `results.csv` / `run.json` carry
every attempt including full agent transcripts.

## Layout

```
results/
  YYYY-MM-DD-<label>/     one run (e.g. 2026-07-21-lite-smoke)
    report.md            the readable summary — start here
    explorer.html        interactive per-run explorer
    PROVENANCE.md        merge/source notes when a reference run has them
    results.csv          one row per task attempt (times, tokens, cost, verdict)
    run.json             the full run record: options, capsules, rows, verdicts
```

Use a dated folder name so runs sort chronologically and never collide:
`2026-07-21-full-reference`, `2026-07-22-medusa-perturbed`, and so on.

## Writing a report

Copy [`TEMPLATE.md`](TEMPLATE.md) to `<your-run>/report.md` and fill it in.
The template is short on purpose — the goal is that anyone can read one report
and understand what was tested, what won, and how to reproduce it.

## Reading a report

The headline is **solved / total** for each access method — how many tasks each
of the three interfaces completed. A task is "solved" when it passes on most
repeat attempts. Higher is better; the interesting part is the *gap* between
the three methods on the same tasks.
