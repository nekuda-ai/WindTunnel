# WindTunnel run — rerun-cu-claude-claude-opus-5-idurar-erp-crm

**Date:** 2026-08-20 · **Preset:** full · **Sites:** idurar-erp-crm
**Repeats per task:** 3 · **Approx. cost:** $2.8566

Reproduce:

```bash
npm run bench -- --preset full --sites idurar-erp-crm --arms cu-claude
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 2)

**2/2 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-claude | claude-opus-5 | 2/2 | 100.0% |

**One-line takeaway:** cu-claude solved 2/2 task×method combinations.

## By difficulty tier

| Tier | cu-claude |
|---|---|
| answer | 0/0 |
| act-short | 0/0 |
| act-long | 2/2 |
| transaction | 0/0 |

## By site (optional)

| Site | cu-claude |
|---|---|
| idurar-erp-crm | 2/2 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
