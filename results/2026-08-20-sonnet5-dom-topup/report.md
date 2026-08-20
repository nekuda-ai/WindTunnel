# WindTunnel run — sonnet5-dom-topup

**Date:** 2026-08-20 · **Preset:** full · **Sites:** hi-events
**Repeats per task:** 3 · **Approx. cost:** $4.2108

Reproduce:

```bash
npm run bench -- --preset full --sites hi-events --arms dom-browseruse
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 3)

**2/3 task×method combinations solved (66.7%).**

| Method | Model | Solved | % |
|---|---|---|---|
| dom-browseruse | claude-sonnet-5 | 2/3 | 66.7% |

**One-line takeaway:** dom-browseruse solved 2/3 task×method combinations.

## By difficulty tier

| Tier | dom-browseruse |
|---|---|
| answer | 0/0 |
| act-short | 0/0 |
| act-long | 1/2 |
| transaction | 1/1 |

## By site (optional)

| Site | dom-browseruse |
|---|---|
| hi-events | 2/3 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
