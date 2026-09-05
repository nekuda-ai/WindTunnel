# WindTunnel run — astra-smoke

**Date:** 2026-09-05 · **Preset:** smoke · **Sites:** tailwind-nextjs-blog
**Repeats per task:** 1 · **Approx. cost:** $0.3184

Reproduce:

```bash
npm run bench -- --preset smoke --sites tailwind-nextjs-blog --arms cu-openai,wm-gpt,code-openai
```

Task set: `development tasks` · Harness commit: `b4265bf49f372ca1c328ee5c332aab9eed4bb3d3-dirty` · N: `1`

## Headline — task×method combinations solved (out of 6)

**6/6 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-6-astra | 2/2 | 100.0% |
| wm-gpt | gpt-6-astra | 2/2 | 100.0% |
| code-openai | gpt-6-astra | 2/2 | 100.0% |

**One-line takeaway:** cu-openai, wm-gpt, code-openai solved 6/6 task×method combinations.

## By difficulty tier

| Tier | cu-openai | wm-gpt | code-openai |
|---|---|---|---|
| answer | 2/2 | 2/2 | 2/2 |
| act-short | 0/0 | 0/0 | 0/0 |
| act-long | 0/0 | 0/0 | 0/0 |
| transaction | 0/0 | 0/0 | 0/0 |

## By site (optional)

| Site | cu-openai | wm-gpt | code-openai |
|---|---|---|---|
| tailwind-nextjs-blog | 2/2 | 2/2 | 2/2 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
