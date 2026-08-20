# Licensing and redistribution notes

This file separates materials that have different rights instead of applying the dataset card's Apache-2.0 label to every byte. It is a publication checklist, not legal advice. The publisher should confirm the provider agreements and any organization-specific order forms that governed the canonical run before making the transcript config public.

## WindTunnel material

The WindTunnel harness, task definitions, scoring predicates, release schema, and nekuda-authored annotations are Apache-2.0 under the source repository's `LICENSE`. The majority verdicts and factual measurements are released with that benchmark material.

The Apache-2.0 label does not grant rights in third-party page text or provider model output embedded in transcripts. Users who only need benchmark scores can use `attempts`, `verdicts`, and `tasks` without downloading `transcripts`.

## Provider model outputs

The transcripts contain outputs from Anthropic, OpenAI, and Google models. The relevant public commercial/API terms allocate output rights to or decline to assert ownership against the customer, but they also make the customer responsible for lawful use and retain restrictions. Those terms are contractual permissions and restrictions; they do not make all output Apache-2.0.

- **Anthropic:** the [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) state that, as between the parties and to the extent permitted by law, the customer owns outputs and Anthropic assigns any rights it has. They require evaluation before sharing and prohibit using the service to build a competing product, including training competing models.
- **OpenAI:** the [OpenAI Services Agreement](https://openai.com/policies/services-agreement/) states that, as between the parties and to the extent permitted by law, the customer owns output and OpenAI assigns any rights it has. It makes the customer responsible for output use and restricts using output to develop competing AI models except for defined permitted exceptions.
- **Google:** the [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) say Google will not claim ownership over generated original content, while making the customer responsible for its use and restricting development of competing models. Additional rules differ for paid and unpaid services and for grounded results.

Accordingly, this package publishes transcripts for benchmark transparency, audit, and evaluation; it does not offer them under a blanket Apache-2.0 training license. Redistributors and model trainers must review the provider terms that apply to their use, the publisher's account-specific agreements, applicable law, and any third-party content rights. Output may be non-unique and may contain material for which neither the provider nor the benchmark publisher can grant rights.

Terms change. The links above were reviewed on 2026-08-20; publication should include a final terms check.

## Third-party application content

Transcripts and `final_text` may quote seeded page content rendered by eight third-party open-source applications. This package ships no upstream source tree. It contains only benchmark data; the WindTunnel source repository records pinned revisions, Docker image digests, seed fixtures, and patches used to construct the local evaluation stacks.

| WindTunnel site / supporting source | Upstream repository | Pinned revision | License recorded in this repository |
|---|---|---|---|
| bulletproof-react | [alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react) | `9506629ed003a561c6627735480cce4994244bb4` | MIT |
| directory-9d8 | [9d8dev/directory](https://github.com/9d8dev/directory) | `d140b0c8089040643cfce8b6ac508998cb5ee36e` | MIT |
| easyappointments | [alextselegidis/easyappointments](https://github.com/alextselegidis/easyappointments) | `bf7e4d227bb138c610004f5af440e7313b8f0ce4` | GPL-3.0 |
| hi-events | [HiEventsDev/Hi.Events](https://github.com/HiEventsDev/Hi.Events) | `69acd11df7416ade52a851355a2fbf1e09c700dc` | AGPL-3.0 plus attribution clause; preserve the "Powered by Hi.Events" footer |
| idurar-erp-crm | [idurar/idurar-erp-crm](https://github.com/idurar/idurar-erp-crm) | `5b2cf28969dc9a720c3fca20f0d2c7606534b277` | AGPL-3.0 |
| learnhouse | [learnhouse/learnhouse](https://github.com/learnhouse/learnhouse) | `5b792a0e9031609766179bfb9397abf61290a242` | AGPL-3.0 |
| nextjs-starter-medusa | [medusajs/nextjs-starter-medusa](https://github.com/medusajs/nextjs-starter-medusa) | `9818886f06e493cb2249733d114d339aa216ef00` | MIT |
| Medusa evaluator backend fixture | [medusajs/medusa-starter-default](https://github.com/medusajs/medusa-starter-default) | `8a45ee35eebcb7f13623be0837c7f74f92012626` | MIT |
| tailwind-nextjs-blog | [timlrx/tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) | `b45bef66b40c63b6f57c15ee8cd090682238df4c` | MIT |

These revisions come from `capsules/*/capsule.yaml`; license labels come from the source repository's `ATTRIBUTION.md`. No unrecorded license has been guessed.

## Why a patch is different from distributing an upstream source tree

A patch is a delta: it records additions and changes to apply to a separately obtained pinned checkout. It is not a runnable copy of the full upstream application and does not supply the unchanged source tree. That distinction is why WindTunnel clones upstream code under its own license at run time instead of vendoring complete AGPL/GPL applications into the Apache-2.0 repository.

The distinction is not a claim that every patch byte becomes Apache-2.0. Patch hunks can reproduce upstream context and removed lines, and those copied portions remain under the upstream license. New WindTunnel-authored additions can be Apache-2.0 while copied upstream portions retain their original terms. This Hugging Face package contains neither the patches nor the upstream source; it contains measurements, tasks, and transcripts that may quote rendered page content.
