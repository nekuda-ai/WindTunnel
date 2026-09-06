# Model expansion comparison

The main table uses the same definitions as the reference Explorer charts:
infrastructure rows are excluded, success is per attempt, tokens are total
processed (uncached input + cache reads + cache writes + output — identical to
the earlier definition for every row that recorded no cache writes), and time
is agent time (wall time only as fallback).

| Interface | Model / run | Attempt success | Median cost / task | Median tokens / task | Median agent time / task |
|---|---|---:|---:|---:|---:|
| Computer use | GPT-5.5 reference | 90.3% (131/145) | $0.090 | 18,659 | 20.4s |
| Computer use | GPT-5.6 Luna (Phase 1) | 83.0% (122/147) | $0.017 | 20,914 | 18.3s |
| Computer use | GPT-5.6 SOL | 83.7% (123/147) | $0.063 | 16,312 | 25.1s |
| Computer use | Gemini 3.6 Flash | 78.9% (116/147) | $0.020 | 23,658 | 33.7s |
| Computer use | Claude Opus 5 | 86.4% (127/147) | $0.139 | 47,141 | 50.4s |
| Computer use | GPT-6 Astra | 91.8% (135/147) | $0.261 | 20,560 | 20.8s |
| Code execution | GPT-6 Astra | 100.0% (147/147) | $0.119 | 10,982 | 16.4s |
| WebMCP | GPT-5.5 reference | 93.2% (137/147) | $0.015 | 2,546 | 5.8s |
| WebMCP | GPT-5.6 Luna (Phase 1) | 93.2% (137/147) | $0.002 | 2,596 | 5.7s |
| WebMCP | GPT-5.6 SOL (Phase 2) | 93.9% (138/147) | $0.013 | 2,573 | 9.4s |
| WebMCP | Gemini 3.6 Flash | 96.6% (142/147) | $0.004 | 4,460 | 7.8s |
| WebMCP | Claude Opus 5 | 96.6% (142/147) | $0.014 | 4,871 | 9.9s |
| WebMCP | GPT-6 Astra (v1.1 board) | 99.3% (146/147) | $0.017 | 2,575 | 6.3s |

All model-expansion rows use the canonical 600-second per-attempt cap. The SOL
row replaces the attempts that reached the previous cap with their targeted
600-second reruns; see `2026-08-17-sol-600-timeouts/PROVENANCE.md`.

## Majority-task success

| Interface | GPT-5.5 reference | GPT-5.6 Luna | GPT-5.6 SOL | Gemini 3.6 Flash | Claude Opus 5 | GPT-6 Astra |
|---|---:|---:|---:|---:|---:|---:|
| Computer use | 44/49 (89.8%) | 41/49 (83.7%) | 42/49 (85.7%) | 38/49 (77.6%) | 43/49 (87.8%) | 45/49 (91.8%) |
| Code execution | — | — | — | — | — | 49/49 (100%) |
| WebMCP | 47/49 (95.9%) | 46/49 (93.9%) | 46/49 (93.9%) | 47/49 (95.9%) | 48/49 (98.0%) | 49/49 (100%) |

The Luna, SOL, Gemini and Opus WebMCP cells above are the historical
expansion-run values. On the current canonical board (v1.1, after the Medusa
store gained `complete_checkout`) every WebMCP configuration solves **49/49**;
see [`../CHANGELOG.md`](../CHANGELOG.md).

## Tracked run cost

| Run | Tracked canonical cost |
|---|---:|
| GPT-5.6 Luna | $6.3644 |
| GPT-5.6 SOL | $32.4690 |
| Gemini 3.6 Flash | $6.7573 |
| Claude Opus 5 | $34.6716 |
| GPT-6 Astra (three arms) | $105.5504 |

The SOL total is the canonical substitution dataset. It excludes discarded
partial attempts that are not part of the benchmark result.

## Takeaway

- Gemini has the strongest WebMCP attempt result at 96.6%, and ties the GPT-5.5
  reference at 47/49 majority tasks. It costs less per median attempt than
  GPT-5.5 or SOL, but uses more tokens than the three GPT WebMCP arms.
- Luna is the cost winner: it matches GPT-5.5's WebMCP attempt success at about
  one-sixth the median cost.
- Gemini CU trails Luna and SOL on attempt success. It is slower and uses more
  tokens than Luna, but recorded zero timeouts. EasyAppointments was its lowest
  aggregate CU site (13/24); IDURAR
  contained its slowest and most consistently failed long CU tasks.
- Opus has the strongest majority-task WebMCP result at 48/49 and ties Gemini's
  96.6% attempt success. Its CU result, 86.4% and 43/49 majority tasks, trails
  only the GPT-5.5 reference among the CU results in this table. Twenty-nine CU
  attempts exhausted their turn budget, including 19 failures.
- Opus is the most expensive completed expansion run at $34.67. WebMCP used
  $3.03 of that total, versus $31.65 for computer use.
- SOL CU completes 83.7% of attempts and 42/49 majority tasks under the
  canonical 600-second cap. Two attempts timed out and three more exhausted
  their turn budgets.
- Astra is the first model measured on three interfaces. Its native WebMCP row
  (146/147, $0.017, 6.3s) sits with the other WebMCP rows; its screenshot row
  is the most expensive on the board ($0.261 per median attempt — 2× the list
  price of SOL, more turns, and no cache reads on the screenshot path) for a
  mid-pack 45/49.
- OpenAI's recommended code-execution mode is the strongest screen-driving
  result measured here: 147/147 attempts and 49/49 tasks at $0.119 and 16.4s.
  Same model, same tasks, native WebMCP is 6.9× cheaper, 4.3× lighter and 2.6×
  faster at the same 49/49 (v1.1 board).
- Astra was the most expensive expansion run at $105.55: computer use $66.69,
  code execution $35.53, WebMCP $3.33.
