# WindTunnel run — rerun-wm-claude-claude-opus-5-idurar-erp-crm

**Date:** 2026-08-20 · **Preset:** full · **Sites:** idurar-erp-crm
**Repeats per task:** 3 · **Approx. cost:** $0.1594

Reproduce:

```bash
npm run bench -- --preset full --sites idurar-erp-crm --arms wm-claude
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 2)

**2/2 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| wm-claude | claude-opus-5 | 2/2 | 100.0% |

**One-line takeaway:** wm-claude solved 2/2 task×method combinations.

## By difficulty tier

| Tier | wm-claude |
|---|---|
| answer | 0/0 |
| act-short | 0/0 |
| act-long | 2/2 |
| transaction | 0/0 |

## By site (optional)

| Site | wm-claude |
|---|---|
| idurar-erp-crm | 2/2 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
