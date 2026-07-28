# WindTunnel run — <label>

**Date:** YYYY-MM-DD · **Preset:** <smoke|lite|full> · **Sites:** <lite|core|categories|full>
**Repeats per task:** <N> · **Approx. cost:** $<x>

Reproduce:

```bash
npm run bench -- --preset <preset> --sites <profile>
```

Task set: `<name @ hash>` · Harness commit: `<git sha>` · N: `<repeats>`

## Headline — task×method combinations solved (out of <total>)

The same tasks, run three ways. Higher is better.

| Access method | Model | Solved | % |
|---|---|---|---|
| Screenshots (computer use) | <model> | <n> | <%> |
| Page structure (DOM / a11y) | <model> | <n> | <%> |
| WebMCP tool calls | <model> | <n> | <%> |

**One-line takeaway:** <which interface won, and by how much>

## By difficulty tier

| Tier | Screenshots | Page structure | WebMCP |
|---|---|---|---|
| Answer (1–2 steps) | <n/n> | <n/n> | <n/n> |
| Act, short (3–5) | <n/n> | <n/n> | <n/n> |
| Act, long (6–10) | <n/n> | <n/n> | <n/n> |
| Transaction (8–15) | <n/n> | <n/n> | <n/n> |

## By site (optional)

| Site | Screenshots | Page structure | WebMCP |
|---|---|---|---|
| <site> | <n/n> | <n/n> | <n/n> |

## Robustness (optional)

Scores on perturbed pages (renamed buttons, shifted layout). Reported
separately from the headline.

| Access method | Normal | Perturbed | Drop |
|---|---|---|---|
| Screenshots | <%> | <%> | <pp> |
| Page structure | <%> | <%> | <pp> |
| WebMCP | <%> | <%> | <pp> |

## Notes

- Skipped runs (missing keys, timeouts): <...>
- Anomalies or surprises: <...>
- Sanity checks (the two control sites behaved as expected?): <...>
