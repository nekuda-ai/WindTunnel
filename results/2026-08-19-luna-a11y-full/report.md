# WindTunnel run — luna-a11y-full

**Date:** 2026-08-19 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $6.2437

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms a11y-stagehand
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 49)

**40/49 task×method combinations solved (81.6%).**

| Method | Model | Solved | % |
|---|---|---|---|
| a11y-stagehand | gpt-5.6-luna | 40/49 | 81.6% |

**One-line takeaway:** a11y-stagehand solved 40/49 task×method combinations.

## By difficulty tier

| Tier | a11y-stagehand |
|---|---|
| answer | 18/21 |
| act-short | 15/16 |
| act-long | 6/8 |
| transaction | 1/4 |

## By site (optional)

| Site | a11y-stagehand |
|---|---|
| tailwind-nextjs-blog | 2/2 |
| bulletproof-react | 2/2 |
| directory-9d8 | 3/3 |
| nextjs-starter-medusa | 5/9 |
| easyappointments | 6/8 |
| learnhouse | 7/7 |
| idurar-erp-crm | 5/8 |
| hi-events | 10/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
