# 2026-09-05-astra-smoke-idurar

Smoke gate for GPT-6 Astra on IDURAR `id-6` (multi-field invoice form), one
attempt, three arms. **Gate FAILED**, kept as evidence:

- `cu-openai` exhausted its 30-turn budget. Cause: the arm pressed the keys of
  a `keypress` action one at a time; OpenAI's action is a combination, so
  Ctrl+A never selected text and the model retried 16 spellings of it. Fixed in
  the next commit (`keyChord`); re-run in `2026-09-05-astra-smoke-idurar-cu2`.
- The gate also mis-flagged the predicate text `"price":400` as an HTTP 400;
  fixed in the same commit (request-error check scoped to harness failures).
- `wm-gpt` (4 turns, $0.04) and `code-openai` (14 turns, $0.73) solved the task.
