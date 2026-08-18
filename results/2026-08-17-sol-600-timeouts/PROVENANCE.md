# Provenance — GPT-5.6 SOL canonical timeout completion

This targeted completion supplies the replacements needed to apply the
benchmark's canonical 600-second rule to exactly the 26 `cu-openai` attempts
that reached the previous cap in
[`../2026-08-17-sol-full/`](../2026-08-17-sol-full/), preserving each original
task's multiplicity. The 147 WebMCP attempts were not rerun because none
reached the cap.

## Conditions

- Date: 2026-08-17 (Asia/Jerusalem)
- Host: macOS arm64 with Docker Desktop
- Harness commit at process start: `6c1540e38eeacc104f928edad5108e767995fee9`
- Model and snapshot: `gpt-5.6-sol`
- Interface: `cu-openai` (computer use)
- Attempt ceiling: canonical 600 seconds
- Reasoning effort: provider default `medium`; the request omitted an explicit
  override, and [OpenAI documents `medium` as the GPT-5.6
  default](https://developers.openai.com/api/docs/guides/latest-model#update-api-and-model-parameters)
- Spend ceiling: $20 harness cutoff; $7.227616 tracked
- Exact elapsed time: 1h 36m 04s

The combined report was written after unrelated documentation/chart edits had
begun in the shared worktree. The runner process had already loaded from the
clean commit above; the normalized `git_revision` in `run.json` records that
execution state.

## Validation

- 26/26 planned attempts completed with 26 unique run IDs.
- The site/task multiset exactly matches the 26 source timeout rows.
- All rows report model and snapshot `gpt-5.6-sol`.
- 19 passed and 7 failed; 2 failures remained genuine 600-second timeouts.
- 3 failures exhausted their turn budget; 2 were ordinary scorer-predicate
  failures. There were no other infrastructure failures.
- 7 provider retries added 24 seconds of retry wait.

The attempt ceiling is checked between model calls. Provider retry/API work is
not hard-aborted at the deadline, so recorded wall time can exceed 600 seconds;
`ea-6` reached 961.018 seconds. This is a harness limitation worth fixing before
another timeout-sensitive study.

## Canonical result

Replacing the 26 capped rows in the original 294-row SOL run produces:

| Interface | Attempt success | Majority tasks | Median cost | Median tokens | Median agent time |
|---|---:|---:|---:|---:|---:|
| Computer use | 123/147 (83.7%) | 42/49 (85.7%) | $0.063 | 16,312 | 25.1s |

The canonical dataset's tracked cost is $32.4690: $25.2414 from retained source
rows plus $7.2276 from the replacements.

## Reproduction

```bash
env WT_CU_OPENAI_ATTEMPT_MS=600000 \
  node --env-file=.env scripts/sol-600-timeout-rerun.mjs
```

`targeted-rerun.json` records the source run, timeout, planned/completed counts,
tracked cost, and validation result.
