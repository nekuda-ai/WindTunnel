# WindTunnel changelog

## v1.1 — 2026-09-06

**Feedback we received:** the Medusa store's WebMCP tools stopped at `begin_checkout`, so none of the eight WebMCP configurations could complete task `md-8` (guest checkout), while screenshot and code-execution agents could finish it on the page. That made 48/49 the ceiling for WebMCP by construction — a limitation of one demo store's tool surface, not of the approach.

**What changed:** the store now exposes `complete_checkout` (contact + address → shipping → payment → place order, through the storefront's own checkout code path). `md-8` was re-run, three attempts each, for all eight WebMCP configurations:

| Configuration | md-8 before | md-8 after |
|---|---:|---:|
| _filled in after the re-run_ | 0/3 | — |

No other cell changed. Screen-driving rows are untouched — they never see tools and the page is unchanged.

**Also in this release:** GPT-6 Astra added as three configurations (WebMCP, screenshots, and OpenAI's recommended code-execution path — a new interface class). Harness corrections disclosed in `results/canonical/PROVENANCE.md`: keypress chords in the OpenAI screenshot arm, cache-write pricing, capsule step timeouts.

## v1.0 — 2026-08-20

Initial canonical board: 16 configurations, 2,352 attempts, 784 majority verdicts.
