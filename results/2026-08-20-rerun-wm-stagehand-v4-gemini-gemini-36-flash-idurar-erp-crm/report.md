# WindTunnel run — rerun-wm-stagehand-v4-gemini-gemini-36-flash-idurar-erp-crm

**Date:** 2026-08-20 · **Preset:** full · **Sites:** idurar-erp-crm
**Repeats per task:** 3 · **Approx. cost:** $0.0370

Reproduce:

```bash
npm run bench -- --preset full --sites idurar-erp-crm --arms wm-stagehand-v4-gemini
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 2)

**2/2 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| wm-stagehand-v4-gemini | gemini-3.6-flash | 2/2 | 100.0% |

**One-line takeaway:** wm-stagehand-v4-gemini solved 2/2 task×method combinations.

## By difficulty tier

| Tier | wm-stagehand-v4-gemini |
|---|---|
| answer | 0/0 |
| act-short | 0/0 |
| act-long | 2/2 |
| transaction | 0/0 |

## By site (optional)

| Site | wm-stagehand-v4-gemini |
|---|---|
| idurar-erp-crm | 2/2 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
