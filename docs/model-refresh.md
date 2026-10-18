# Model refresh

v1.4 adds DeepSeek V4.1 Flash-1017 with WebMCP to the current board. Results and exclusions are in the
[root changelog](../CHANGELOG.md) and [provenance](../results/canonical/PROVENANCE.md).
The manifest also contains preparation-only configurations; it is not a list
of published results.

## Run and resume

Use Docker and the direct provider keys listed in the README. On macOS,
install GNU tar and coreutils and put their `gnubin` folders first on `PATH`.
Run serially on one host. Start from a clean committed checkout; a source or
configuration change requires a new smoke and campaign.

Example for Haiku 5.5 (paid; the cap stops between attempts):

```sh
node scripts/native-flight.mjs start --campaign haiku-refresh --hours 6 --budget 10 --ids claude-haiku-5-5-wm-claude,claude-haiku-5-5-cu-claude
node scripts/native-flight.mjs status --campaign haiku-refresh
node scripts/native-flight.mjs stop --campaign haiku-refresh
```

Repeat the same start command to resume. Completed attempts stay in ignored
`results/model-refresh-private/`. A stop finishes the current attempt first.
After a forced interruption, reconcile uncertain provider billing before
resuming; do not delete the ledger or accounting hold to bypass that check.

New Claude computer-use models use the updated tool version. Native Claude
runs reject `ANTHROPIC_BASE_URL` to prevent accidental routing. The current
board used direct APIs; optional OpenRouter paths are separate configurations.

## Prepare a release

Use reviewed complete sources and preserve their hashes. Never rerun the
old generic merge to publish a new board: it can restore private transcripts.
Run `node scripts/verify-published-results.mjs`, regenerate charts with
`node scripts/readme-charts.mjs`, then follow [the HF instructions](../hf/UPDATE.md).
Publication requires a separate review of the exact artifact diff.
