# WindTunnel run — opus5-smoke

**Date:** 2026-08-17 · **Preset:** smoke · **Sites:** tailwind-nextjs-blog
**Repeats per task:** 1 · **Approx. cost:** $0.6196

Reproduce:

```bash
npm run bench -- --preset smoke --sites tailwind-nextjs-blog --arms cu-claude,wm-claude
```

Task set: `development tasks` · Harness commit: `f7bac03f4c391259c7e60933a34e74a90b0f4ae3-dirty` · N: `1`

## Headline — task×method combinations solved (out of 4)

**2/4 task×method combinations solved (50.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-claude | claude-opus-5 | 1/2 | 50.0% |
| wm-claude | claude-opus-5 | 1/2 | 50.0% |

**One-line takeaway:** cu-claude, wm-claude solved 2/4 task×method combinations.

## By difficulty tier

| Tier | cu-claude | wm-claude |
|---|---|---|
| answer | 1/2 | 1/2 |
| act-short | 0/0 | 0/0 |
| act-long | 0/0 | 0/0 |
| transaction | 0/0 | 0/0 |

## By site (optional)

| Site | cu-claude | wm-claude |
|---|---|---|
| tailwind-nextjs-blog | 1/2 | 1/2 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
