# WindTunnel run — stagehand-v4-gemini-full

**Date:** 2026-08-18 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $0.8016

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms wm-stagehand-v4-gemini
```

Task set: `development tasks` · Harness commit: `a228ee043db996760ec788f1fb642afe4c41f9b0-dirty` · N: `3`

## Headline — task×method combinations solved (out of 49)

**48/49 task×method combinations solved (98.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| wm-stagehand-v4-gemini | gemini-3.6-flash | 48/49 | 98.0% |

**One-line takeaway:** wm-stagehand-v4-gemini solved 48/49 task×method combinations.

## By difficulty tier

| Tier | wm-stagehand-v4-gemini |
|---|---|
| answer | 21/21 |
| act-short | 16/16 |
| act-long | 8/8 |
| transaction | 3/4 |

## By site (optional)

| Site | wm-stagehand-v4-gemini |
|---|---|
| tailwind-nextjs-blog | 2/2 |
| bulletproof-react | 2/2 |
| directory-9d8 | 3/3 |
| nextjs-starter-medusa | 8/9 |
| easyappointments | 8/8 |
| learnhouse | 7/7 |
| idurar-erp-crm | 8/8 |
| hi-events | 10/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
