# WindTunnel run — gemini-full

**Date:** 2026-08-17 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $6.7573

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms cu-gemini,wm-gemini
```

Task set: `development tasks` · Harness commit: `39f4b3fda5ab3062982d8c099cbfc3139c863967` · N: `3`

## Headline — task×method combinations solved (out of 98)

**85/98 task×method combinations solved (86.7%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-gemini | gemini-3.6-flash | 38/49 | 77.6% |
| wm-gemini | gemini-3.6-flash | 47/49 | 95.9% |

**One-line takeaway:** cu-gemini, wm-gemini solved 85/98 task×method combinations.

## By difficulty tier

| Tier | cu-gemini | wm-gemini |
|---|---|---|
| answer | 18/21 | 21/21 |
| act-short | 13/16 | 16/16 |
| act-long | 3/8 | 7/8 |
| transaction | 4/4 | 3/4 |

## By site (optional)

| Site | cu-gemini | wm-gemini |
|---|---|---|
| tailwind-nextjs-blog | 2/2 | 2/2 |
| bulletproof-react | 2/2 | 2/2 |
| directory-9d8 | 2/3 | 3/3 |
| nextjs-starter-medusa | 7/9 | 8/9 |
| easyappointments | 4/8 | 8/8 |
| learnhouse | 7/7 | 7/7 |
| idurar-erp-crm | 5/8 | 8/8 |
| hi-events | 9/10 | 9/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
