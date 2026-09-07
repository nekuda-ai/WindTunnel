**Verdict: (b) WebMCP tool gap on the site — guest checkout is not solvable through the tools as exposed. Confidence: high.**

Investigation: 2026-09-06, `<repo>`. Local source and recorded transcripts only; no git, API calls, or Docker execution. References below are repository-relative file:line locations; patch references use the patch file's actual line numbers.

## Evidence

### Task and scoring

`tasks/nextjs-starter-medusa.yaml:81-91` defines `md-8` as `transaction`: buy one Medusa T-Shirt, L / Black, complete guest checkout with Jane Tester's supplied name, email, UK address and phone, use the test payment method, and report confirmation. Budgets are WebMCP 15, computer use 40, structured 32. Lines 84-86 explicitly say checkout requires page interaction and WebMCP failure is expected by design.

There is no task-specific `start_url` or `start_path`; `harness/tasks.mjs:44-48` defaults to the capsule root `/`. The inspected Astra rows record roots on ports 3226 (WebMCP), 3218 (screenshots), and 3234 (code), and the code transcript shows the resulting `/gb` storefront (`results/2026-09-05-astra-full/run.json:57505`, `11580`, `85234`, `85325-85328`). Checkout opens at `/gb/checkout?step=address`.

The predicate requires **exactly one database order**, not an order-number string: `scoring/predicates.mjs:3-13,30-48` routes this non-answer predicate to `capsule.observe("database")`; `capsules/nextjs-starter-medusa/oracle.sh:27-34,49-50` counts rows in the SQL `"order"` table. `final_text` is ignored on this path. The harness resets before each attempt and scores afterward (`harness/run.mjs:33-45`); Medusa restores its database dump (`capsules/nextjs-starter-medusa/capsule.sh:274-294`).

An offline check against the actual scorer, using in-memory observations and all four inspected final answers, confirmed: `orders: 0` fails, `orders: 1` passes, `orders: 2` fails regardless of wording. Thus this is not a formatting trap, a hidden page-only answer, or a cart-cookie observation problem. The predicate is weaker than the full request—it does not verify the purchased variant, customer details, payment method, or reported confirmation—but that weakness cannot explain these failures. The stored failures say `predicate failed`, not `probe-error`; the original database observation payloads are not stored in these rows.

### The missing capability

The site-specific implementation is `goldens/nextjs-starter-medusa.reference.patch`, applied by the WebMCP bootstrap (`harness/lib/site-adapter.sh:697-709`). Its provider registers only seven distinct tool names (`goldens/nextjs-starter-medusa.reference.patch:129-148,172-201`):

| Tools | Capability | Implementation lines in that patch |
|---|---|---|
| `ask_site`, `search_products`, `get_product` | Read policies/catalog/variants; navigate catalog/product pages | 613-829, 875-887, 948-989 |
| `view_cart` | Read cart contents and totals | 834-848 |
| `add_to_cart` | Add a variant and quantity; product-page form accepts product options | 894-940, 990-1031 |
| `update_cart` | Change quantity or remove a line | 1044-1091 |
| `begin_checkout` | Navigate to checkout with the cart preserved | 1094-1121 |

`begin_checkout` accepts **no parameters**: `properties: {}`, `additionalProperties: false`; its execution function takes no arguments. It retrieves the cart, chooses a checkout path, schedules navigation, and returns the cart. Its description says: “No order is placed and no payment is taken by this tool” (1096); its result explicitly leaves address, delivery and payment to the page UI (1115). No exposed tool accepts guest contact/address data, selects shipping/payment, or submits an order. Adding those fields to an existing call would not implement checkout.

This is not a hidden tool waiting to be discovered: on checkout, the provider removes `add_to_cart`, `update_cart`, and `begin_checkout` and exposes no checkout replacements (168-201, 890-894, 990). `ask_site` only searches content (629-719). WebMCP agents are instructed to operate exclusively through exposed tools (`arms/prompts.mjs:2`). This limits this site's implementation, not WebMCP's ability to represent checkout operations.

### Canonical results and source transcripts

Parsing all canonical WebMCP rows confirms `md-8` is the only task with zero successful attempts across every WebMCP configuration: **0/24**, eight configurations × three attempts. Canonical first-attempt anchors in `results/canonical/run.json` are: wm-gpt Luna `90872`, SOL `433064`, Astra `740999`; wm-claude Opus `326755`, Sonnet `487396`; wm-gemini `199695`; wm-stagehand-v4 `512158`; wm-stagehand-v4-gemini `460285`. Each configuration has three failures. Screenshot OpenAI Luna/SOL/Astra and code OpenAI Astra each pass **3/3**, stronger than merely majority (`15345`, `360305`, `695074`, `768728` respectively).

Provenance correction: this checkout's canonical rows have no `source` field; `options.sources` lists source directories (`results/canonical/run.json:3-50`). I matched by `run_id` and verified the four source transcripts, final answers and pass flags equal their canonical counterparts. All three selected Astra attempts are in `2026-09-05-astra-full`, not the later remainder directories.

**WebMCP Astra**, run `md-8_wm-gpt_1ee0be6b-6be6-430f-bec7-095e82318cae`: searched for the T-Shirt (turn 1), received the L / Black variant ID, added quantity 1 (turn 2), discovered `begin_checkout`, and called it (turn 3). Returns confirm the correct cart and the explicit UI handoff. It stopped at turn 4 saying no order had been placed; budget was not exhausted. Evidence: `results/2026-09-05-astra-full/run.json:57507-57531` (failure/budget), `57574-57584` (search result), `57613-57636` (add result/discovery), `57664-57674` (handoff), `57710` (final answer).

**WebMCP Opus**, run `md-8_wm-claude_56182e60-b706-48f4-b2d3-e93b5230d582`: followed the same search → add → begin checkout sequence, then called `view_cart`. Discovery on checkout showed only `ask_site`, `search_products`, `view_cart`, `get_product`. It correctly reported that it could not enter guest details, choose shipping/payment, or submit an order; stopped at turn 5 without exhausting its budget. Evidence: `results/2026-08-17-opus5-full/run.json:109008-109026`, `109080-109147`, `109196-109210`, `109245-109265`, `109298`.

One misleading final answer does occur: wm-stagehand-v4-gemini claims “Test payment method initialized.” Its `begin_checkout` result only opened the address step; its subsequent `ask_site("test payment method checkout")` returned no matching content (`results/2026-08-18-stagehand-v4-gemini-full/run.json:10302-10311,10350-10360,10455`). That unsupported claim cannot create an order or pass the predicate.

## What the passing agents did

**Screenshot Astra**, run `md-8_cu-openai_59570ad9-34ce-4c4f-8f47-6c326437e6c3`: used mouse/keyboard interaction, entered Jane's address in turn 14 and email/phone in turn 15, then continued through checkout using clicks, scrolling and waits. It finished in 25 turns and reported order #1, L / Black, quantity 1, €20 including standard shipping. Recorded actions: `results/2026-09-05-astra-full/run.json:12241-12450,12484-12868`; pass flag `11582`; final answer `12903`. The JSON records coordinates rather than button labels; the code attempt below provides explicit labels and confirmation-page text.

**Code Astra**, run `md-8_code-openai_6fd0ba3e-cb97-46a5-9b01-8781d02688d2`: selected Black and L, added the shirt, opened checkout, and waited for form fields (turns 6-9). It filled named shipping/contact inputs, selected United Kingdom, and clicked **Continue to delivery** (turn 10), **Standard Shipping / Continue to payment** (11), **Manual Payment / Continue to review** (12), then **Place order** (13). The recorded page output says “Your order was placed successfully,” order number 1, L / Black ×1, Jane's address, and Manual Payment, €20 paid. Evidence: `results/2026-09-05-astra-full/run.json:85453-85552,85581-85584,85613-85616,85645-85648,85677-85680`; pass flag `85236`; final answer `85716`. These are page interactions through Playwright, not a backend shortcut.

**Claude screenshot failures have a separate cause.** All six canonical attempts exhausted 40 turns. Inspected Opus ended at the address-to-delivery transition; Sonnet was still filling contact information. Evidence: `results/2026-08-17-opus5-full/run.json:22431,22442,24290` and `results/2026-08-19-sonnet5-cu-full/run.json:17531,17548,19397`. They had page controls but did not finish within the budget; that does not make the missing WebMCP operations discoverable with more effort.

## Recommendation

Keep the completed-order requirement and historical scores. Describe `md-8` explicitly as a **site-tool coverage gap requiring page fallback**, not a legitimately hard tool-solvable task; `README.md:144-146` already acknowledges the deliberate handoff, but should name `md-8` and make the tools-only impossibility explicit. If a future benchmark version is intended to test fully tool-solvable checkout, add site tools for guest details, delivery/payment selection and order submission, returning persisted confirmation; version the changed tool surface and rerun affected configurations. Do not award purchase success merely for opening checkout.

## Plain-English explanation

The store lets these agents put a shirt in the basket, but its WebMCP tools cannot finish the purchase.
The successful agents filled in the checkout page and clicked Place order, which created the order the test checks for.
This is a missing capability in the store's tools, so document it as a limitation rather than blaming the test or calling it merely difficult.
