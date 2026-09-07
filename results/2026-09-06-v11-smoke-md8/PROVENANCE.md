# 2026-09-06-v11-smoke-md8

Smoke gate for board v1.1: `wm-gpt × gpt-5.6-luna` on `nextjs-starter-medusa/md-8`,
one attempt, with the new `complete_checkout` WebMCP tool. Gate passed; the
attempt solved the task in 5 turns ($0.0088): search_products → add_to_cart →
complete_checkout (returned the two shipping options) → complete_checkout with
shipping_option_id → order #1. Not a benchmark result.
