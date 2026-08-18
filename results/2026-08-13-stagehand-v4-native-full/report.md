# WindTunnel run — stagehand-v4-native-full

**Date:** 2026-08-13 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $1.4795

Reproduce:

```bash
npx --yes node@22.18.0 harness/cli.mjs --preset full --sites full --arms wm-stagehand-v4
```

Task set: `development tasks` · Harness commit: `4323cd087e3365ead3bab4494f64fcae04149275-dirty` · N: `3`

## Headline — task×method combinations solved (out of 49)

**48/49 task×method combinations solved (98.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| wm-stagehand-v4 | claude-sonnet-4-6 | 48/49 | 98.0% |

**One-line takeaway:** wm-stagehand-v4 solved 48/49 task×method combinations.

## By difficulty tier

| Tier | wm-stagehand-v4 |
|---|---|
| answer | 21/21 |
| act-short | 16/16 |
| act-long | 8/8 |
| transaction | 3/4 |

## By site (optional)

| Site | wm-stagehand-v4 |
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
