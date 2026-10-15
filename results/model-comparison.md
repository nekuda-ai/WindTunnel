# Model comparison

Current board v1.3, generated from `canonical/results.csv`. Tasks are solved
by majority vote; costs and agent times are medians across all valid attempts.
See [provenance](canonical/PROVENANCE.md) and [changes](../CHANGELOG.md).

| Configuration | Interface | Solved | Attempts | Turn-cap | Median cost | Median tokens | Median s |
|---|---|---:|---:|---:|---:|---:|---:|
| Haiku 5.5 | WebMCP | 49/49 | 147/147 | 0 | $0.000251 | 5,153 | 3.7 |
| GPT-6 Luna | WebMCP | 48/49 | 144/147 | 0 | $0.000194 | 2,525 | 5.0 |
| Jev + Mercury 2.5 | WebMCP | 49/49 | 141/147 | 0 | $0.001064 | 9,793 | 3.2 |
| Sonnet 5.5 | WebMCP | 49/49 | 147/147 | 0 | $0.003530 | 5,046 | 4.2 |
| GPT-6.1 Sol | WebMCP | 49/49 | 147/147 | 0 | $0.003432 | 2,502 | 8.0 |
| Gemini 3.8 Flash | WebMCP | 49/49 | 147/147 | 0 | $0.003638 | 3,799 | 8.3 |
| GPT-6 Astra | WebMCP | 49/49 | 146/147 | 0 | $0.017100 | 2,575 | 6.3 |
| Muse Wonder | WebMCP | 49/49 | 146/147 | 1 | $0.015549 | 5,236 | 8.2 |
| Claude Opus 5 | WebMCP | 49/49 | 147/147 | 0 | $0.014013 | 4,770 | 9.8 |
| GPT-6.1 Sol | Code execution | 49/49 | 147/147 | 0 | $0.019001 | 10,503 | 16.5 |
| GPT-6 Luna | Computer use | 41/49 | 128/147 | 9 | $0.002112 | 21,177 | 19.4 |
| Haiku 5.5 | Computer use | 41/49 | 123/147 | 0 | $0.001698 | 37,601 | 16.0 |
| GPT-6 Astra | Code execution | 49/49 | 147/147 | 0 | $0.118676 | 10,982 | 16.4 |
| Sonnet 5.5 | Computer use | 47/49 | 140/147 | 3 | $0.031641 | 37,339 | 19.7 |
| GPT-6.1 Sol | Computer use | 45/49 | 134/147 | 14 | $0.039839 | 20,797 | 20.8 |
| Jev + Mercury 2.5 | DOM (ultrafast) | 25/49 | 76/147 | 19 | $0.000778 | 13,892 | 5.4 |
| GPT-6 Astra | Computer use | 45/49 | 135/147 | 11 | $0.260780 | 20,560 | 20.8 |
| Claude Opus 5 | Computer use | 45/49 | 134/147 | 27 | $0.138857 | 47,141 | 50.4 |

## Historical snapshot — expansion runs as measured at the time

These are the numbers recorded when each model was added (GPT-5.5 reference
run of 2026-07-27; Luna, SOL, Gemini and Opus expansion runs of August 2026).
They predate the 2026-08-20 scorer corrections and board v1.1, and use the
older token definition (input + cached input + output). They are kept for the
record and are **not** the current board.

| Interface | Model / run | Attempt success | Median cost / task | Median tokens / task | Median agent time / task |
|---|---|---:|---:|---:|---:|
| Computer use | GPT-5.5 reference | 90.3% (131/145) | $0.090 | 18,659 | 20.4s |
| Computer use | GPT-5.6 Luna (Phase 1) | 83.0% (122/147) | $0.017 | 20,914 | 18.3s |
| Computer use | GPT-5.6 SOL | 83.7% (123/147) | $0.063 | 16,312 | 25.1s |
| Computer use | Gemini 3.6 Flash | 78.9% (116/147) | $0.020 | 23,658 | 33.7s |
| Computer use | Claude Opus 5 | 86.4% (127/147) | $0.139 | 47,141 | 50.4s |
| WebMCP | GPT-5.5 reference | 93.2% (137/147) | $0.015 | 2,546 | 5.8s |
| WebMCP | GPT-5.6 Luna (Phase 1) | 93.2% (137/147) | $0.002 | 2,596 | 5.7s |
| WebMCP | GPT-5.6 SOL (Phase 2) | 93.9% (138/147) | $0.013 | 2,573 | 9.4s |
| WebMCP | Gemini 3.6 Flash | 96.6% (142/147) | $0.004 | 4,460 | 7.8s |
| WebMCP | Claude Opus 5 | 96.6% (142/147) | $0.014 | 4,871 | 9.9s |

All model-expansion rows use the canonical 600-second per-attempt cap. The SOL
row replaces the attempts that reached the previous cap with their targeted
600-second reruns; see `2026-08-17-sol-600-timeouts/PROVENANCE.md`.

## Majority-task success

| Interface | GPT-5.5 reference | GPT-5.6 Luna | GPT-5.6 SOL | Gemini 3.6 Flash | Claude Opus 5 |
|---|---:|---:|---:|---:|---:|
| Computer use | 44/49 (89.8%) | 41/49 (83.7%) | 42/49 (85.7%) | 38/49 (77.6%) | 43/49 (87.8%) |
| WebMCP | 47/49 (95.9%) | 46/49 (93.9%) | 46/49 (93.9%) | 47/49 (95.9%) | 48/49 (98.0%) |


## Tracked run cost

| Run | Tracked canonical cost |
|---|---:|
| GPT-5.6 Luna | $6.3644 |
| GPT-5.6 SOL | $32.4690 |
| Gemini 3.6 Flash | $6.7573 |
| Claude Opus 5 | $34.6716 |

The SOL total is the canonical substitution dataset. It excludes discarded
partial attempts that are not part of the benchmark result.
