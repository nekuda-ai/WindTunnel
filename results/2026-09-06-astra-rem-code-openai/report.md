# WindTunnel run — astra-rem-code-openai

**Date:** 2026-09-06 · **Preset:** full · **Sites:** learnhouse
**Repeats per task:** 3 · **Approx. cost:** $4.2157

Reproduce:

```bash
npm run bench -- --preset full --sites learnhouse --arms code-openai --model code-openai=gpt-6-astra
```

Task set: `development tasks` · Harness commit: `42b185357813fa98b0c2ab92accb92c91a059d74-dirty` · N: `3`

## Headline — task×method combinations solved (out of 7)

**7/7 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| code-openai | gpt-6-astra | 7/7 | 100.0% |

**One-line takeaway:** code-openai solved 7/7 task×method combinations.

## By difficulty tier

| Tier | code-openai |
|---|---|
| answer | 3/3 |
| act-short | 2/2 |
| act-long | 2/2 |
| transaction | 0/0 |

## By site (optional)

| Site | code-openai |
|---|---|
| learnhouse | 7/7 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run


## Notes (operator)

Targeted re-run of `code-openai × gpt-6-astra × learnhouse`, skipped in the main flight when the image build timed out behind a locked-keychain Docker pull. Fresh capsule, same harness commit plus the capsule-timeout fixes. All 21 rows valid.
