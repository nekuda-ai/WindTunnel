# Provenance

- Branch: `feat/gemini-arms`
- Harness base revision: `1254659cddf4cc7a7ababb5b660e3096714dfd5a`
- Harness state: dirty during the smoke with the Gemini adapters committed with
  this artifact
- Host: macOS arm64 with Docker Desktop
- Started: 2026-08-17 08:52:34 IDT
- Finished: 2026-08-17 08:57:23 IDT
- Matrix: 2 arms x 1 site x 2 tasks x 1 repeat (4 attempts)
- Model: `gemini-3.6-flash`
- Orchestrator: GPT-5.6 SOL with medium reasoning
- Budget guard: `$2`; tracked benchmark spend: `$0.031424`

Command, with the existing environment-file path omitted:

```bash
node --env-file=<existing-env> harness/cli.mjs \
  --preset smoke --sites tailwind-nextjs-blog \
  --arms cu-gemini,wm-gemini \
  --budget 2 --label gemini-smoke
```

## Gemini API configuration

- Raw REST requests use the current `v1beta/interactions` endpoint; no Gemini
  SDK dependency was added.
- Computer Use uses Google's current `computer_use` browser environment with
  normalized 0-999 coordinates scaled to the fixed 1280x800 viewport.
- Interactions are stateless (`store: false`) so the client can keep exactly
  the three newest screenshots while replaying required thought signatures.
- Usage includes separately reported thought tokens in billed output tokens.
- The Interactions API does not expose temperature in its current generation
  config, so both arms record the provider default. No thinking level override
  is applied.
- Pricing verified on 2026-08-17: $0.75/M input, $3.75/M output including
  thinking, and $0.075/M cached input through 2026-12-31.
- Setup/schema probes before the benchmark cost less than one cent and are not
  included in the benchmark's tracked spend.

## Smoke gate

- `cu-gemini`: 2/2 attempts passed, `$0.017308`
- `wm-gemini`: 2/2 attempts passed, `$0.014117`
- Timeouts, infrastructure failures, retries, and budget exhaustion: zero
- Gate 5-smoke: pass
