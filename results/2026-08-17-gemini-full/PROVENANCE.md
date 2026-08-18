# Provenance

- Branch: `feat/gemini-arms`
- Harness revision: `39f4b3fda5ab3062982d8c099cbfc3139c863967`
- Harness state: clean during the run
- Host: macOS arm64 with Docker Desktop
- First completed attempt: 2026-08-17 09:03:05 IDT
- Final report written: 2026-08-17 14:05:48 IDT
- End-to-end wall time: approximately 5 hours 5 minutes
- Matrix: 2 arms x 8 sites x 49 tasks x 3 repeats (294 attempts)
- Model: `gemini-3.6-flash`
- Orchestrator: GPT-5.6 SOL with medium reasoning
- Harness budget guard: `$14`
- User-approved absolute ceiling: `$15`
- Tracked benchmark spend: `$6.757266`

Command, with the existing environment-file path omitted:

```bash
node --env-file=<existing-env> harness/cli.mjs \
  --preset full --sites full \
  --arms cu-gemini,wm-gemini \
  --n 3 --budget 14 --label gemini-full
```

## Results

| Arm | Attempt success | Majority-task success | Median cost | Median tokens | Median agent time | Tracked cost |
|---|---:|---:|---:|---:|---:|---:|
| `cu-gemini` | 116/147 (78.9%) | 38/49 (77.6%) | $0.019985 | 23,658 | 33.674s | $5.969912 |
| `wm-gemini` | 142/147 (96.6%) | 47/49 (95.9%) | $0.004429 | 4,460 | 7.777s | $0.787354 |

- Exactly 294 unique run IDs were recorded, with three repeats for every
  arm-task pair.
- Timeouts, infrastructure failures, and systemic adapter failures: zero.
- Four transient retries occurred across three CU attempts, with 10 seconds of
  total retry wait; all recovered.
- CU reached its task turn budget on 28 attempts: eight still passed and 20
  failed. No WM attempt exhausted its turn budget.
- All 36 failures were task/scorer predicate failures. WM failures were the
  three `md-8` repeats and two `hev-8` repeats.

## Timeout policy

The fixed 300-second deadline was retained for comparability. No Gemini attempt
timed out. The longest CU failures completed well below the deadline; most slow
misses were constrained by the existing per-task turn budgets instead. A
600-second Gemini rerun is therefore not supported by this result.

## Gemini API configuration

- Raw REST requests used `v1beta/interactions`; no Gemini SDK dependency was
  added.
- Computer Use used Google's `computer_use` browser environment with normalized
  0-999 coordinates scaled to the fixed 1280x800 viewport.
- Interactions were stateless (`store: false`) with the three newest screenshots
  replayed alongside required thought signatures.
- Separately reported thought tokens were included in billed output tokens.
- Both arms record provider-default temperature and no thinking-level override.
- Pricing used $0.75/M input, $3.75/M output including thinking, and $0.075/M
  cached input, verified before the run on 2026-08-17.

## Host caveat

A Docker container labeled `webmcp-kit-test` remained at post-run inspection.
It did not use a `wt-*` benchmark run ID, so whether it was current capsule
preparation or unrelated concurrent work is uncertain. The run recorded no
timeout or infrastructure failures, but Docker Desktop VM/filesystem overhead
and possible host contention still affect absolute wall-clock timings.
