# Results

Finished benchmark runs live here. Each run is one folder, and each folder has
a short Markdown report as its front page.

**The current reference is [`2026-07-27-reference/`](2026-07-27-reference/)** —
the full 7-method × 8-site × 49-task measurement — one benchmark generation (single commit), the base run plus two same-day patch flights (per-cell provenance in its
[`PROVENANCE.md`](2026-07-27-reference/PROVENANCE.md)). Open its
`explorer.html` for the interactive view; `results.csv` / `run.json` carry
every attempt including full agent transcripts.

**The cross-model view is [`model-comparison.md`](model-comparison.md).** It
compares the paired computer-use and WebMCP arms for GPT-5.5, GPT-5.6 Luna,
GPT-5.6 SOL, Gemini 3.6 Flash, and Claude Opus 5 under the canonical
600-second per-attempt cap.

| Run | Scope |
|---|---|
| [`2026-07-27-reference/`](2026-07-27-reference/) | Original seven-method reference |
| [`2026-08-16-luna-full/`](2026-08-16-luna-full/) | GPT-5.6 Luna paired full run |
| [`2026-08-17-sol-full/`](2026-08-17-sol-full/) | GPT-5.6 SOL paired source run |
| [`2026-08-17-sol-600-timeouts/`](2026-08-17-sol-600-timeouts/) | Completes the canonical SOL result at the 600s ceiling |
| [`2026-08-17-gemini-full/`](2026-08-17-gemini-full/) | Gemini 3.6 Flash paired full run |
| [`2026-08-17-opus5-full/`](2026-08-17-opus5-full/) | Claude Opus 5 paired full run |

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
