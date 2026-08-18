# WindTunnel run — gemini-smoke

**Date:** 2026-08-17 · **Preset:** smoke · **Sites:** tailwind-nextjs-blog
**Repeats per task:** 1 · **Approx. cost:** $0.0314

Reproduce:

```bash
npm run bench -- --preset smoke --sites tailwind-nextjs-blog --arms cu-gemini,wm-gemini
```

Task set: `development tasks` · Harness commit: `1254659cddf4cc7a7ababb5b660e3096714dfd5a-dirty` · N: `1`

## Headline — task×method combinations solved (out of 4)

**4/4 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-gemini | gemini-3.6-flash | 2/2 | 100.0% |
| wm-gemini | gemini-3.6-flash | 2/2 | 100.0% |

**One-line takeaway:** cu-gemini, wm-gemini solved 4/4 task×method combinations.

## By difficulty tier

| Tier | cu-gemini | wm-gemini |
|---|---|---|
| answer | 2/2 | 2/2 |
| act-short | 0/0 | 0/0 |
| act-long | 0/0 | 0/0 |
| transaction | 0/0 | 0/0 |

## By site (optional)

| Site | cu-gemini | wm-gemini |
|---|---|---|
| tailwind-nextjs-blog | 2/2 | 2/2 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
