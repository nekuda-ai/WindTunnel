# Provenance

This is a merged reference: the base full run plus targeted re-runs, merged
per (site, method, task) cell with later runs superseding earlier ones. Source
runs, in precedence order (later wins):

1. 2026-08-16-luna-full
2. 2026-08-17-gemini-full
3. 2026-08-17-opus5-full
4. 2026-08-17-sol-full
5. 2026-08-18-stagehand-v4-gemini-full
6. 2026-08-19-sonnet5-wm-claude-full
7. 2026-08-19-sonnet5-shv4-full
8. 2026-08-19-sonnet5-cu-full
9. 2026-08-19-sonnet5-a11y-full
10. 2026-08-19-sonnet5-dom-full
11. 2026-08-19-luna-a11y-full
12. 2026-08-20-luna-dom-full
13. 2026-08-20-sol-cu-600-full
14. 2026-08-20-sonnet5-dom-topup
15. 2026-08-20-rerun-cu-claude-claude-opus-5-directory-9d8
16. 2026-08-20-rerun-cu-claude-claude-opus-5-idurar-erp-crm
17. 2026-08-20-rerun-cu-claude-claude-opus-5-tailwind-nextjs-blog
18. 2026-08-20-rerun-cu-gemini-gemini-36-flash-directory-9d8
19. 2026-08-20-rerun-cu-gemini-gemini-36-flash-idurar-erp-crm
20. 2026-08-20-rerun-cu-gemini-gemini-36-flash-tailwind-nextjs-blog
21. 2026-08-20-rerun-cu-openai-gpt-56-luna-directory-9d8
22. 2026-08-20-rerun-cu-openai-gpt-56-luna-idurar-erp-crm
23. 2026-08-20-rerun-cu-openai-gpt-56-luna-tailwind-nextjs-blog
24. 2026-08-20-rerun-cu-openai-gpt-56-sol-directory-9d8
25. 2026-08-20-rerun-cu-openai-gpt-56-sol-idurar-erp-crm
26. 2026-08-20-rerun-cu-openai-gpt-56-sol-tailwind-nextjs-blog
27. 2026-08-20-rerun-wm-claude-claude-opus-5-directory-9d8
28. 2026-08-20-rerun-wm-claude-claude-opus-5-idurar-erp-crm
29. 2026-08-20-rerun-wm-claude-claude-opus-5-tailwind-nextjs-blog
30. 2026-08-20-rerun-wm-gemini-gemini-36-flash-directory-9d8
31. 2026-08-20-rerun-wm-gemini-gemini-36-flash-idurar-erp-crm
32. 2026-08-20-rerun-wm-gemini-gemini-36-flash-tailwind-nextjs-blog
33. 2026-08-20-rerun-wm-gpt-gpt-56-luna-directory-9d8
34. 2026-08-20-rerun-wm-gpt-gpt-56-luna-idurar-erp-crm
35. 2026-08-20-rerun-wm-gpt-gpt-56-luna-tailwind-nextjs-blog
36. 2026-08-20-rerun-wm-gpt-gpt-56-sol-directory-9d8
37. 2026-08-20-rerun-wm-gpt-gpt-56-sol-idurar-erp-crm
38. 2026-08-20-rerun-wm-gpt-gpt-56-sol-tailwind-nextjs-blog
39. 2026-08-20-rerun-wm-stagehand-v4-gemini-gemini-36-flash-directory-9d8
40. 2026-08-20-rerun-wm-stagehand-v4-gemini-gemini-36-flash-idurar-erp-crm
41. 2026-08-20-rerun-wm-stagehand-v4-gemini-gemini-36-flash-tailwind-nextjs-blog
42. 2026-08-20-scorer-corrections

## Cells per source, by method

An arm marked SPLIT draws cells from more than one source run — legitimate for
gap-fills, but those cells were measured under that run's harness generation.

```
  a11y-stagehand × claude-sonnet-5         49×2026-08-19-sonnet5-a11y-full
  a11y-stagehand × gpt-5.6-luna            49×2026-08-19-luna-a11y-full
  cu-claude × claude-opus-5          SPLIT 44×2026-08-17-opus5-full  2×2026-08-20-rerun-cu-claude-claude-opus-5-idurar-erp-crm  1×2026-08-20-rerun-cu-claude-claude-opus-5-tailwind-nextjs-blog  1×2026-08-20-rerun-cu-claude-claude-opus-5-directory-9d8  1×2026-08-20-scorer-corrections
  cu-claude × claude-sonnet-5              49×2026-08-19-sonnet5-cu-full
  cu-gemini × gemini-3.6-flash       SPLIT 43×2026-08-17-gemini-full  2×2026-08-20-scorer-corrections  2×2026-08-20-rerun-cu-gemini-gemini-36-flash-idurar-erp-crm  1×2026-08-20-rerun-cu-gemini-gemini-36-flash-tailwind-nextjs-blog  1×2026-08-20-rerun-cu-gemini-gemini-36-flash-directory-9d8
  cu-openai × gpt-5.6-luna           SPLIT 44×2026-08-16-luna-full  2×2026-08-20-rerun-cu-openai-gpt-56-luna-idurar-erp-crm  1×2026-08-20-rerun-cu-openai-gpt-56-luna-tailwind-nextjs-blog  1×2026-08-20-rerun-cu-openai-gpt-56-luna-directory-9d8  1×2026-08-20-scorer-corrections
  cu-openai × gpt-5.6-sol            SPLIT 45×2026-08-20-sol-cu-600-full  2×2026-08-20-rerun-cu-openai-gpt-56-sol-idurar-erp-crm  1×2026-08-20-rerun-cu-openai-gpt-56-sol-tailwind-nextjs-blog  1×2026-08-20-rerun-cu-openai-gpt-56-sol-directory-9d8
  dom-browseruse × claude-sonnet-5   SPLIT 46×2026-08-19-sonnet5-dom-full  3×2026-08-20-sonnet5-dom-topup
  dom-browseruse × gpt-5.6-luna            49×2026-08-20-luna-dom-full
  wm-claude × claude-opus-5          SPLIT 44×2026-08-17-opus5-full  2×2026-08-20-rerun-wm-claude-claude-opus-5-idurar-erp-crm  1×2026-08-20-rerun-wm-claude-claude-opus-5-tailwind-nextjs-blog  1×2026-08-20-rerun-wm-claude-claude-opus-5-directory-9d8  1×2026-08-20-scorer-corrections
  wm-claude × claude-sonnet-5              49×2026-08-19-sonnet5-wm-claude-full
  wm-gemini × gemini-3.6-flash       SPLIT 44×2026-08-17-gemini-full  2×2026-08-20-rerun-wm-gemini-gemini-36-flash-idurar-erp-crm  1×2026-08-20-rerun-wm-gemini-gemini-36-flash-tailwind-nextjs-blog  1×2026-08-20-rerun-wm-gemini-gemini-36-flash-directory-9d8  1×2026-08-20-scorer-corrections
  wm-gpt × gpt-5.6-luna              SPLIT 44×2026-08-16-luna-full  2×2026-08-20-rerun-wm-gpt-gpt-56-luna-idurar-erp-crm  1×2026-08-20-rerun-wm-gpt-gpt-56-luna-tailwind-nextjs-blog  1×2026-08-20-rerun-wm-gpt-gpt-56-luna-directory-9d8  1×2026-08-20-scorer-corrections
  wm-gpt × gpt-5.6-sol               SPLIT 44×2026-08-17-sol-full  2×2026-08-20-rerun-wm-gpt-gpt-56-sol-idurar-erp-crm  1×2026-08-20-rerun-wm-gpt-gpt-56-sol-tailwind-nextjs-blog  1×2026-08-20-rerun-wm-gpt-gpt-56-sol-directory-9d8  1×2026-08-20-scorer-corrections
  wm-stagehand-v4 × claude-sonnet-5        49×2026-08-19-sonnet5-shv4-full
  wm-stagehand-v4-gemini × gemini-3.6-flash SPLIT 44×2026-08-18-stagehand-v4-gemini-full  2×2026-08-20-rerun-wm-stagehand-v4-gemini-gemini-36-flash-idurar-erp-crm  1×2026-08-20-rerun-wm-stagehand-v4-gemini-gemini-36-flash-tailwind-nextjs-blog  1×2026-08-20-rerun-wm-stagehand-v4-gemini-gemini-36-flash-directory-9d8  1×2026-08-20-scorer-corrections
```

Per-cell sources are in `run.json` (each verdict's `source` field).
