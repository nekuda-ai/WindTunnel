# WindTunnel changelog

## v1.1 — 2026-09-06

**Feedback we received:** the Medusa store's WebMCP tools stopped at `begin_checkout`, so none of the eight WebMCP configurations could complete task `md-8` (guest checkout), while screenshot and code-execution agents could finish it on the page. That made 48/49 the ceiling for WebMCP by construction — a limitation of one demo store's tool surface, not of the approach.

**What changed:** the store now exposes `complete_checkout` (contact + address → shipping → payment → place order, through the storefront's own checkout code path). `md-8` was re-run, three attempts each, for all eight WebMCP configurations:

| Configuration | md-8 before | md-8 after |
|---|---:|---:|
| wm-claude × claude-opus-5 | 0/3 | 3/3 |
| wm-claude × claude-sonnet-5 | 0/3 | 3/3 |
| wm-gemini × gemini-3.6-flash | 0/3 | 3/3 |
| wm-gpt × gpt-5.6-luna | 0/3 | 3/3 |
| wm-gpt × gpt-5.6-sol | 0/3 | 3/3 |
| wm-gpt × gpt-6-astra | 0/3 | 3/3 |
| wm-stagehand-v4 × claude-sonnet-5 | 0/3 | 3/3 |
| wm-stagehand-v4-gemini × gemini-3.6-flash | 0/3 | 3/3 |

All 24 attempts passed, each in 5 model turns with 4 tool calls (`search_products → add_to_cart → complete_checkout ×2`; one attempt used `get_product` instead of `search_products`), $0.93 in total.

No other cell changed. Screen-driving rows are untouched — they never see tools and the page is unchanged.

**Also in this release:** GPT-6 Astra added as three configurations (WebMCP, screenshots, and OpenAI's recommended code-execution path — a new interface class). Harness corrections are listed below and in `docs/SPEC.md` §6; each run's `report.md` Notes name the ones that applied to it (`results/canonical/PROVENANCE.md` records only per-cell source precedence).

**Harness corrections in this release** (none changes an existing row's pass/fail; rows measured before a correction are retained as measured):

| Correction | Affects | Historical rows that predate it |
|---|---|---|
| `gpt-6-astra` price row ($10 / $50 / $1 cached / $12.50 cache write) | cost of Astra rows | — |
| OpenAI arms send no `temperature` (reasoning models reject it; the old probe doubled every request) | request count / agent time overhead on `cu-openai`, `wm-gpt` | Luna, SOL rows |
| Cache-write tokens split out of `input_tokens` and priced at the write rate | cost accounting on OpenAI arms | Luna, SOL rows (no cache-write column recorded) |
| Rows record provider-reported `effort` and `truncated`; `wm-gpt` keeps usage on a timeout | audit columns | — |
| `cu-openai` keypress is one chord (Ctrl+A); xdotool/DOM key names normalized | screenshot arm behaviour | Luna, SOL `cu-openai` rows: 23 of their 26 failed rows contain a multi-key keypress, one of which is a select-all — exposure, not proven cause |
| Smoke gate: request-error check scoped to harness failures | gate only | — |
| Capsule lifecycle steps have hard ceilings, classified as infrastructure; a failed teardown no longer drops a batch's rows; teardown errors are persisted | harness robustness | — |
| Results explorer keyed by arm × model (it pooled Luna and SOL); cache writes in explorer token totals | explorer display only | — |

The first v1.1 `md-8` re-run pass (23/24) exposed a tool-registration race in the Medusa golden — `complete_checkout` was briefly unregistered during the `begin_checkout` navigation. The tool was moved to the always-on group and all eight configurations were re-run against the corrected golden (24/24); the published cells come from that second pass. The first pass is not part of the board.

## v1.0 — 2026-08-20

Initial canonical board: 16 configurations, 2,352 attempts, 784 majority verdicts.
