# WindTunnel run — astra-rem-cu-openai

**Date:** 2026-09-05 · **Preset:** full · **Sites:** learnhouse,hi-events
**Repeats per task:** 3 · **Approx. cost:** $16.5772

Reproduce:

```bash
npm run bench -- --preset full --sites learnhouse,hi-events --arms cu-openai
```

Task set: `development tasks` · Harness commit: `42b185357813fa98b0c2ab92accb92c91a059d74-dirty` · N: `3`

## Headline — task×method combinations solved (out of 17)

**17/17 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-6-astra | 17/17 | 100.0% |

**One-line takeaway:** cu-openai solved 17/17 task×method combinations.

## By difficulty tier

| Tier | cu-openai |
|---|---|
| answer | 8/8 |
| act-short | 4/4 |
| act-long | 4/4 |
| transaction | 1/1 |

## By site (optional)

| Site | cu-openai |
|---|---|
| learnhouse | 7/7 |
| hi-events | 10/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run


## Notes (operator)

Targeted re-run of the two `cu-openai × gpt-6-astra` sites the main flight (`2026-09-05-astra-full`) lost: learnhouse (stale runtime dir from a killed earlier attempt) and hi-events (capsule app container died mid-batch; teardown hung; batch rows dropped). Fresh capsules, same harness commit as the main flight plus the capsule-timeout fixes. All 51 rows valid; combined-explorer takes these cells over the main flight's (which has none for them).
