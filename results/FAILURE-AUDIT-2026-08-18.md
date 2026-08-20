# WindTunnel failure audit — 2026-08-18

## Scope

This audit covers 2,499 canonical attempts: the 2026-07-27 reference run, Stagehand v4, Luna, Gemini, Opus, SOL, and Stagehand v4 + Gemini. Smoke runs are excluded. SOL's original 300-second timeout rows are replaced by the targeted 600-second reruns.

The artifacts contain 241 raw failures (9.6%). Transcript review shows that they are not all model failures:

| Cause | Attempts | Benchmark treatment |
|---|---:|---|
| Genuine model, harness, or task-execution failure | 99 | Count, subject to the task notes below |
| IDURAR UI/fixture parity defect | 48 | Repair fixture and rerun `id-6` and `id-7` for non-WebMCP arms |
| Confirmed scorer false negative | 35 | Rescore from existing artifacts |
| Intentional WebMCP checkout boundary | 27 | Count if full checkout is the required outcome; otherwise score handoff separately |
| Directory prompt/scorer mismatch | 13 | Fix task and rerun or add a state probe |
| Ambiguous blog-author golden/tool mismatch | 9 | Align fixture, tool output, prompt, and golden; rerun |
| Infrastructure/provider failure | 8 | Rerun; do not attribute to model task ability |
| Genuine SOL 600-second timeout | 2 | Count under the canonical timeout policy |

More than half of all failed rows (123/241) exhausted their turn budget. This is the dominant mechanism among otherwise valid computer-use failures.

## Findings that require benchmark changes

### 1. `hev-8` has a broken answer regex

All 32 failed rows answered the question correctly with `Live`, `Live/Published`, or `On Sale`. The scorer requires the words `status` and `live` within 30 non-period characters, rejecting natural answers such as “The WebMCP Community Workshop is currently LIVE.”

**Fix:** score the seeded event-status field directly. If answer scoring must remain, accept `live`, `published`, or `on sale` without the proximity constraint. Existing artifacts can be rescored; no rerun is needed.

### 2. `directory-filter` asks for an action but scores an unrequested answer

All 13 failures reported that the Development/developer-tools filter was applied. The prompt does not ask the agent to name a result, while the scorer requires `github`.

**Fix:** add a state probe that verifies the active filter. Alternatively, change the prompt to ask for one visible tool after filtering, then rerun. This mismatch disproportionately penalizes computer use and changes four computer-use majority totals by one task if treated as completed.

### 3. `blog-read-author` is ambiguous across the page, tool output, and golden

The golden accepts only `Azimuth`, while failed runs consistently found `Sparrow Hawk` or, less often, template author `Timothy Lin`. The same tool/page has exposed different author identities, so the nine failures cannot safely be called model errors.

**Fix:** name the exact page/author role in the prompt and make the visible page, WebMCP result, seed, and scorer agree. Rerun this task only.

### 4. IDURAR `id-6` and `id-7` are not interface-equivalent

Every non-WebMCP configuration failed both tasks. The compatibility patch removes default tax and payment-mode data/routes, but the visual invoice and payment flows still depend on them. Transcripts repeatedly show an empty required tax selector or a `Record Payment` 404/unusable flow. WebMCP bypasses those UI dependencies through direct application APIs.

**Fix:** seed a 0% tax and default payment mode while keeping their administration pages out of scope, or patch the invoice/payment forms to use deterministic defaults. Then rerun `id-6` and `id-7` for every non-WebMCP arm. Until then, these tasks can depress non-WebMCP majority completion by as much as 2/49 tasks (4.1 percentage points).

### 5. Three smaller answer scorers reject correct answers

- `md-7`: two Gemini computer-use rows answered `3`, exactly the requested cart item count; the regex also requires the word `cart` or `items`.
- `react-auth-boundary`: one GPT WebMCP row correctly said the private app was “not accessible while signed out”; the regex accepts only login/redirect/unauthorized/denied wording.
- `md-9` in Stagehand v4 + Gemini never reached the model because Stagehand initialization timed out. It should be classified as infrastructure and rerun.

## Intentional coverage boundary

`md-8` asks the agent to complete guest checkout. All 27 WebMCP failures stop after `start_checkout`: the tool intentionally hands the sensitive checkout steps back to the page and provides no address, delivery, payment, or order-submission tool. This is not a model failure. It is a real interface-coverage result if the benchmark requires a completed order, and it explains the common 48/49 WebMCP ceiling.

Computer-use failures on `md-8` are different: those agents could use the page but sometimes exhausted their turn budget while operating the country selector/address flow. Keep those as execution failures.

## Remaining task-level failures

| Site | Tasks | Observed cause | Recommended treatment |
|---|---|---|---|
| Bulletproof React | `react-public-content`, `react-auth-boundary` | One Gemini-CU turn cap; two bridge-registration timeouts; one strict-regex false negative | Count the turn-cap miss; rescore the correct answer; rerun bridge timeouts |
| Directory | `directory-search`, `directory-filter` | One SOL provider safety rejection; filter prompt/scorer mismatch | Rerun provider rejection; repair filter task |
| Medusa | `md-1`, `md-2`, `md-3`, `md-7`, `md-8`, `md-9` | Visual discovery/accordion misses and turn caps; two strict-answer false negatives; checkout coverage boundary; one Stagehand init timeout | Count visual execution misses; rescore `md-7`; document/decide `md-8`; rerun `md-9` |
| Easy!Appointments | `ea-1`–`ea-8` except `ea-4` in later models | Models repeatedly fail to expose/select services, navigate booking steps, or finish before the turn cap; two SOL attempts still exceed 600 seconds | These are mostly valid interface/model failures; retain the 600-second timeouts |
| LearnHouse | `lh-2`, `lh-8` | One Luna and one Opus computer-use turn-cap/navigation miss | Count |
| IDURAR | `id-2`–`id-8` | `id-6`/`id-7` fixture defect; `id-8` is a difficult but sometimes solvable dashboard-navigation task; a few auth/bridge/network failures | Repair and rerun `id-6`/`id-7`; count `id-8`; rerun operational failures |
| Hi.Events | `hev-7`, `hev-8`, `hev-9`, `hev-10` | `hev-8` scorer defect; isolated transaction/navigation/turn-cap misses elsewhere | Rescore `hev-8`; count the others |

## Operational failures

The eight non-timeout operational rows are four WebMCP bridge-registration timeouts, two OpenAI `fetch failed` rows, one SOL provider safety-policy rejection, and one Stagehand initialization timeout. They should be reported separately and rerun rather than folded into model task ability. Browser-use's 14 “returned no result” rows are retained as harness-execution failures because they occur after the autonomous harness runs and cluster on difficult tasks; future runs should preserve its underlying stop reason and trace so they can be classified more precisely.

SOL's canonical 600-second computer-use result is 123/147 attempt passes and 42/49 majority tasks. Two rerun rows (`ea-5`, `ea-6`) still reached the 600-second agent budget; these are genuine timeout outcomes under the declared policy. The provider retry path can make observed wall time exceed 600 seconds, so the harness should eventually hard-abort provider work at the deadline even though the scoring cap remains 600 seconds.

## Quantified effect of confirmed scoring errors

Correcting only the 35 certain answer-scoring false negatives changes these configurations:

| Configuration | Raw attempts / majority | Corrected attempts / majority |
|---|---:|---:|
| GPT-5.5 · WebMCP | 137/147 · 47/49 | 141/147 · 48/49 |
| GPT-5.5 · computer use | 131/147 · 44/49 | 134/147 · 45/49 |
| Sonnet 4.6 · DOM + vision | 130/147 · 43/49 | 133/147 · 44/49 |
| Sonnet 4.6 · accessibility tree | 128/147 · 42/49 | 130/147 · 43/49 |
| Luna · WebMCP | 137/147 · 46/49 | 140/147 · 47/49 |
| Luna · computer use | 122/147 · 41/49 | 125/147 · 42/49 |
| Gemini · WebMCP | 142/147 · 47/49 | 144/147 · 48/49 |
| Gemini · computer use | 116/147 · 38/49 | 121/147 · 40/49 |
| Opus · WebMCP | 142/147 · 48/49 | 143/147 · 48/49 |
| Opus · computer use | 127/147 · 43/49 | 128/147 · 43/49 |
| SOL · WebMCP | 138/147 · 46/49 | 141/147 · 47/49 |
| SOL · computer use (600s) | 123/147 · 42/49 | 126/147 · 43/49 |
| Stagehand v4 + Gemini | 142/147 · 48/49 | 143/147 · 48/49 |

The Stagehand v4 + Sonnet and Sonnet-native WebMCP totals do not change because they did not fail these specific scorers. Treating `directory-filter` as completed would additionally add one majority task to GPT-5.5, Luna, Gemini, and SOL computer use; the task should be repaired rather than silently rescored.

## Stagehand v4 + Gemini experiment

The new arm completed 142/147 attempts (96.6%) and 48/49 majority tasks at $0.8016 total. Median cost was $0.00444/task; median agent time was 8.16 seconds. Its five raw misses were three expected `md-8` checkout-boundary failures, one correct `hev-8` answer rejected by the scorer, and one pre-model Stagehand initialization timeout.

Compared with native WebMCP + Gemini, attempt success ties (142 vs 142) and majority completion improves by one task (48 vs 47), but the paired attempt difference is not significant (McNemar exact p=1.0). Median cost is effectively identical and median agent time is about 10% slower. Compared with Stagehand v4 + Sonnet, it has two fewer raw attempt passes (142 vs 144; p=0.50), the same 48/49 majority total, about half the median cost, and about 10% longer median agent time. After correcting the `hev-8` scorer and rerunning/excluding the initialization timeout, both Stagehand v4 models have the same underlying failure set: only the intentional `md-8` checkout boundary.

**Conclusion:** there is no statistically reliable evidence that Stagehand v4 makes Gemini more accurate than the existing native WebMCP harness. It reaches the same top-line attempt success, gains one raw majority task because of attempt variance/scoring, costs essentially the same as native Gemini, and is slightly slower. It does show that Gemini can drive Stagehand v4's native WebMCP transport as reliably as Sonnet at materially lower model cost.
