> ⚠️ **TRUNCATED RUN.** One or more task×method verdicts had zero valid attempts.

# WindTunnel run — sonnet5-dom-full

**Date:** 2026-08-19 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $46.2081

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms dom-browseruse
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 47)

**47/47 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| dom-browseruse | claude-sonnet-5 | 47/47 | 100.0% |

**One-line takeaway:** dom-browseruse solved 47/47 task×method combinations.

## By difficulty tier

| Tier | dom-browseruse |
|---|---|
| answer | 21/21 |
| act-short | 16/16 |
| act-long | 6/6 |
| transaction | 4/4 |

## By site (optional)

| Site | dom-browseruse |
|---|---|
| tailwind-nextjs-blog | 2/2 |
| bulletproof-react | 2/2 |
| directory-9d8 | 3/3 |
| nextjs-starter-medusa | 9/9 |
| easyappointments | 8/8 |
| learnhouse | 7/7 |
| idurar-erp-crm | 8/8 |
| hi-events | 8/8 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): 2 task×method verdicts had no attempts (budget stop)
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
