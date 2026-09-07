# 2026-09-05-astra-smoke-idurar

Smoke gate for GPT-6 Astra on IDURAR `id-6` (multi-field invoice form), one
attempt, three arms. **Gate FAILED**, kept as evidence:

- `cu-openai` exhausted its 30-turn budget. Cause: the arm pressed the keys of
  a `keypress` action one at a time (Control released before `a` arrived);
  OpenAI defines `keys` as "the combination of keys", i.e. a chord. Select-all
  never happened, and the model spent the budget on login-field recovery: 24
  keypress requests, 14 multi-key, 8 distinct chord spellings of select-all.
  Fixed in the next commit (`keyChord`); re-run in
  `2026-09-05-astra-smoke-idurar-cu2` (12 turns, pass). Independently confirmed
  by a Codex (gpt-6-astra) review of the old code, OpenAI's spec, and both
  transcripts.
- Exposure of the existing board: 13/13 failed Luna and 10/13 failed SOL
  canonical `cu-openai` rows contain a multi-key keypress, but only ONE of those
  23 is a Ctrl+A select-all; the rest are other shortcuts (Ctrl+L, Alt+Down…).
  These are exposed rows, not failures proven to be caused by the bug. They are
  retained as measured; a matched re-run is a separate decision.
- The gate also mis-flagged the predicate text `"price":400` as an HTTP 400;
  fixed in the same commit (request-error check scoped to harness failures).
- `wm-gpt` (4 turns, $0.04) and `code-openai` (14 turns, $0.73) solved the task.
