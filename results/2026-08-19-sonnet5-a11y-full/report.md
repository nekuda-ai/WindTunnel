# WindTunnel run — sonnet5-a11y-full

**Date:** 2026-08-19 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $17.8364

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms a11y-stagehand
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 49)

**42/49 task×method combinations solved (85.7%).**

| Method | Model | Solved | % |
|---|---|---|---|
| a11y-stagehand | claude-sonnet-5 | 42/49 | 85.7% |

**One-line takeaway:** a11y-stagehand solved 42/49 task×method combinations.

## By difficulty tier

| Tier | a11y-stagehand |
|---|---|
| answer | 20/21 |
| act-short | 13/16 |
| act-long | 6/8 |
| transaction | 3/4 |

## By site (optional)

| Site | a11y-stagehand |
|---|---|
| tailwind-nextjs-blog | 2/2 |
| bulletproof-react | 2/2 |
| directory-9d8 | 3/3 |
| nextjs-starter-medusa | 8/9 |
| easyappointments | 7/8 |
| learnhouse | 6/7 |
| idurar-erp-crm | 6/8 |
| hi-events | 8/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
