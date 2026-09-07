# 2026-09-05-astra-smoke

Smoke gate for GPT-6 Astra (`gpt-6-astra`) on the control blog, one attempt per
task, three arms: `cu-openai`, `wm-gpt`, `code-openai` (new). `smoke-gate.mjs`
passed: served model matches, usage recorded, no truncation, no infra failures.
Not a benchmark result — scoring is incidental. Harness at the commit that
ships this directory (Astra price row, no temperature probe, cache-write split,
effort/truncation recorded).
