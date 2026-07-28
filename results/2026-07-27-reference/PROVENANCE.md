# Provenance

This is a merged reference: the base full run plus targeted re-runs, merged
per (site, method, task) cell with later runs superseding earlier ones. Source
runs, in precedence order (later wins):

1. 2026-07-27-clean-reference
2. 2026-07-27-patch-medusa
3. 2026-07-27-patch-idurar

## Cells per source, by method

An arm marked SPLIT draws cells from more than one source run — legitimate for
gap-fills, but those cells were measured under that run's harness generation.

```
  a11y-stagehand  SPLIT 48×2026-07-27-clean-reference  1×2026-07-27-patch-idurar
  cu-claude       SPLIT 48×2026-07-27-clean-reference  1×2026-07-27-patch-idurar
  cu-openai       SPLIT 48×2026-07-27-clean-reference  1×2026-07-27-patch-idurar
  dom-browseruse  SPLIT 48×2026-07-27-clean-reference  1×2026-07-27-patch-idurar
  wm-claude       SPLIT 46×2026-07-27-clean-reference  2×2026-07-27-patch-medusa  1×2026-07-27-patch-idurar
  wm-gpt          SPLIT 48×2026-07-27-clean-reference  1×2026-07-27-patch-idurar
  wm-stagehand    SPLIT 48×2026-07-27-clean-reference  1×2026-07-27-patch-idurar
```

Per-cell sources are in `run.json` (each verdict's `source` field).

## Post-run corrections (full disclosure)

- **md-5 / md-8 × wm-claude** were re-run (patch-medusa): the medusa oracle's
  new `orders` count had a shell-quoting bug that made the database probe
  error during the base run's first six attempts. The oracle was fixed and
  verified against a live capsule mid-run; the other six methods scored those
  tasks on the fixed oracle within the base run itself.
- **id-6 × every method** was re-run (patch-idurar): the base run's assertion
  co-located `number` with the line item's `name`/`price` in one flat object,
  which the oracle's normalized shape can never satisfy — transcripts showed
  agents completing the task correctly while scoring 0/21. The corrected
  assertion was validated against the oracle shape before the re-run.
  Outcome: WebMCP methods 9/9, browser methods 0/12 (step budgets expire
  mid-form) — a genuine interface difference, verified by database state.
- **hev-4** was re-scored offline (no re-run): its regex forbade a sentence
  break inside the answer, failing one model's correct multi-sentence
  phrasing. The corrected pattern was validated against all 21 stored answers
  (21/21 match) before re-scoring; 3 wm-claude rows flipped, marked
  `rescored` in run.json.

## Notable findings (state-verified in both directions)

- **Full checkout (`md-8`) fails for all three WebMCP implementations** — the
  golden tools hand off at `begin_checkout` by design, and the orders table
  confirms no order was placed (0/9 attempts). The multimodal browser agent
  (dom-browseruse) completes the same checkout 3/3. The WebMCP reach limit is
  real, not a tool-only-agent artifact (wm-stagehand, which can also drive
  the page, fails it too).
- **A multi-field CRUD form (`id-6`) fails for all four browser methods**
  (0/12 — step budgets expire mid-form: client picker, item row, quantity,
  price, save) **and is one tool call for WebMCP** (9/9). Both verified by
  database state, not self-report.
- One task (`lh-4`) is excluded from the headline as API-only-data — the
  page never renders the seeded answer, so only tool-calling agents could
  ever see it. It remains in the task file, marked `excluded`.
