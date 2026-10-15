# WindTunnel v1.3 provenance

18 configurations, 49 tasks, eight sites, seed 1, three attempts per cell:
2,646 attempts and 882 majority verdicts. All published cohorts are complete.

Seven configurations are retained from v1.2 (Opus 5, GPT-6 Astra and Jev +
Mercury 2.5). Their outcomes, usage, costs and timing are unchanged. Earlier
boards remain in Git history at `5ca8644` and the named result folders.

Eleven new configurations use direct Anthropic, OpenAI, Google or Meta APIs.
Per-source hashes, measurement revisions and frozen runtime/task/golden hashes
are in [PROVENANCE.json](PROVENANCE.json); `source` identifies each attempt's
cohort. Measurement revisions predate this consolidated publication commit.
The published harness contains the measured request paths; publication and
explorer changes do not rewrite those recorded hashes.

A corrected signed-out-page expression promotes three Sonnet 5.5 WebMCP
attempts and one computer-use attempt. No model request was repeated for this
correction. Retained historical outcomes were checked and remain unchanged.

Opus 5.5 and Argon are excluded. Gemini 3.8 Flash and Muse Wonder have no
computer-use score because the provider did not accept that interface.
Smokes, provider diagnostics and infrastructure retries are outside this board.
Genuine model failures remain, including Luna's unsolved task and Wonder's
single turn-cap miss.

Costs are estimates from recorded token usage at measurement-time rates;
retained historical costs are not repriced. Opus 5's older cache-write token
counts are incomplete, so its total-token figures understate processed usage.
Agent time excludes setup and reset. Settings and turn budgets vary by method;
this is a fixed-task comparison, not a measure of all possible browser work.

New public rows contain metrics and redacted final answers. Raw transcripts,
encrypted reasoning, provider keys, fixture passwords, local paths and support
probes are omitted. The existing separately published redacted Jev traces stay
available under their original release.
