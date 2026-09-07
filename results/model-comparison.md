# Model comparison

Two sections: the **current canonical board** (v1.1, regenerated from
`canonical/results.csv`) and a **historical snapshot** of the expansion runs as
they were measured at the time. Definitions match the README: infrastructure
rows excluded, success per attempt, tokens are total processed (uncached input
+ cache reads + cache writes + output), time is median agent time. Board
versions and what changed between them: [`../CHANGELOG.md`](../CHANGELOG.md).

## Current canonical board (v1.1) — paired native arms per model

| Interface | Model | Attempt success | Tasks solved | Median cost / attempt | Median tokens / attempt | Median agent time |
|---|---|---:|---:|---:|---:|---:|
| Computer use | GPT-5.6 Luna | 91.2% (134/147) | 45/49 | $0.017 | 20,914 | 18.3s |
| Computer use | GPT-5.6 SOL | 91.2% (134/147) | 46/49 | $0.063 | 16,235 | 27.3s |
| Computer use | Gemini 3.6 Flash | 88.4% (130/147) | 43/49 | $0.020 | 23,857 | 33.7s |
| Computer use | Claude Opus 5 | 91.2% (134/147) | 45/49 | $0.139 | 47,141 | 50.4s |
| Computer use | GPT-6 Astra | 91.8% (135/147) | 45/49 | $0.261 | 20,560 | 20.8s |
| Code execution | GPT-6 Astra | 100.0% (147/147) | 49/49 | $0.119 | 10,982 | 16.4s |
| WebMCP | GPT-5.6 Luna | 99.3% (146/147) | 49/49 | $0.002 | 2,596 | 5.7s |
| WebMCP | GPT-5.6 SOL | 98.6% (145/147) | 49/49 | $0.012 | 2,573 | 9.3s |
| WebMCP | Gemini 3.6 Flash | 100.0% (147/147) | 49/49 | $0.004 | 4,453 | 7.2s |
| WebMCP | Claude Opus 5 | 100.0% (147/147) | 49/49 | $0.014 | 4,770 | 9.8s |
| WebMCP | GPT-6 Astra | 99.3% (146/147) | 49/49 | $0.017 | 2,575 | 6.3s |

### Majority-task success (current board)

| Interface | GPT-5.6 Luna | GPT-5.6 SOL | Gemini 3.6 Flash | Claude Opus 5 | GPT-6 Astra |
|---|---:|---:|---:|---:|---:|
| Computer use | 45/49 | 46/49 | 43/49 | 45/49 | 45/49 |
| WebMCP | 49/49 | 49/49 | 49/49 | 49/49 | 49/49 |

Code execution (GPT-6 Astra only): 49/49.

### Tracked canonical cost (current board)

| Model | Native CU + WebMCP tracked cost |
|---|---:|
| GPT-5.6 Luna | $5.57 |
| GPT-5.6 SOL | $26.52 |
| Gemini 3.6 Flash | $6.39 |
| Claude Opus 5 | $34.37 |
| GPT-6 Astra | $70.02 |
| GPT-6 Astra incl. code execution | $105.55 |

### Takeaways (current board)

- Every native WebMCP configuration solves 49/49 tasks; Gemini 3.6 Flash and
  Claude Opus 5 pass all 147 attempts, Luna and Astra 146/147, SOL 145/147.
  Until v1.1 the Medusa checkout task capped every WebMCP row at 48/49 by
  construction (see the changelog).
- GPT-5.6 Luna is the cost winner on WebMCP at $0.002 per median
  attempt; Astra's WebMCP row costs $0.017 — more per token, with among the
  lowest token counts on the board (2,575; SOL's 2,573 is the lowest) and a
  6.3 s median time.
- Computer use tops out at 91.8% attempt success (GPT-6 Astra); no
  screenshot configuration solves more than 46/49 tasks. Turn-cap hits on the
  screenshot arms: GPT-5.6 Luna 11, GPT-5.6 SOL 12, Gemini 3.6 Flash 22, Claude Opus 5 27, GPT-6 Astra 11.
- Astra is the first model measured with OpenAI's code-execution interface
  alongside screenshots and WebMCP. Its screenshot row is the most expensive on
  the board ($0.261 per median attempt — roughly 2× SOL's input price and 1.7×
  its output price, more turns per task, and cache reads on only 1 of 147
  attempts) for a mid-pack 45/49.
- OpenAI's recommended code-execution mode is the strongest screen-driving
  result measured here: 147/147 attempts and 49/49 tasks at $0.119 and 16.4s.
  Same model, same tasks, native WebMCP is 6.9× cheaper, 4.3× lighter and
  2.6× faster at the same 49/49.
- Astra was the most expensive model to measure: $105.55 across its three arms
  (computer use $66.69, code execution $35.53, WebMCP $3.33).

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
