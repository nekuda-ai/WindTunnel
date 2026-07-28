# Attribution & upstream licenses

WindTunnel does **not** vendor any third-party website's source tree. Each
site's own source is cloned from its public upstream repository at a pinned
commit at run time, and WebMCP reference patches are applied locally. The boot
recipes, seed data, and WebMCP patches that WindTunnel ships (under `capsules/`
and `fixtures/`) are nekuda's own work, licensed Apache-2.0 like the rest of
the benchmark. Note that a few patches modify upstream files rather than only
adding new ones; the upstream lines those patch hunks carry (context and
removed lines) remain under the upstream project's license, not Apache-2.0.
The sites themselves remain under their upstream licenses, listed below.

Site selection, boot recipes, and the WebMCP reference implementations
originated in nekuda's webmcp-kit authoring project (57 candidates researched →
47 verified runnable → 8 in this set) and are vendored here so WindTunnel is
standalone. Credit for that work: Ilay (nekuda). Credit for the sites
themselves: the upstream projects below — this benchmark exists on their
shoulders.

## Phase-1 sites

| site | upstream | license | notes |
|---|---|---|---|
| nextjs-starter-medusa | [medusajs/nextjs-starter-medusa](https://github.com/medusajs/nextjs-starter-medusa) | MIT | + [medusajs/medusa-starter-default](https://github.com/medusajs/medusa-starter-default) backend fixture (MIT) |
| directory-9d8 | [9d8dev/directory](https://github.com/9d8dev/directory) | MIT | |
| hi-events | [HiEventsDev/Hi.Events](https://github.com/HiEventsDev/Hi.Events) | AGPL-3.0 + attribution clause | **"Powered by Hi.Events" footer must stay intact** (AGPL §7(b) additional term); never remove it in patches or screenshots |
| learnhouse | [learnhouse/learnhouse](https://github.com/learnhouse/learnhouse) | AGPL-3.0 | run locally only; never redistribute combined work |
| idurar-erp-crm | [idurar/idurar-erp-crm](https://github.com/idurar/idurar-erp-crm) | AGPL-3.0 | run locally only; never redistribute combined work |
| tailwind-nextjs-blog | [timlrx/tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) | MIT | thin-content control |
| bulletproof-react | [alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react) | MIT | client-auth/MSW control |
| easyappointments | [alextselegidis/easyappointments](https://github.com/alextselegidis/easyappointments) | GPL-3.0 | run locally only; never redistribute combined work |

## License-handling rules

1. **Never vendor upstream source trees** into this repo — pin + clone + patch
   at run time. This keeps AGPL/GPL obligations away from the Apache-2.0
   harness.
2. **Patches are additive where possible** (new files + minimal wiring) and are
   distributed with WindTunnel. A few patches modify upstream files (for
   example idurar's payment and invoice controllers, and tailwind's
   contentlayer config); the upstream lines carried in those hunks — context
   and removed lines — stay under the upstream license.
3. **Hi.Events footer attribution stays**, including in published screenshots
   and demo videos.
4. Published results should link upstream projects (this file is the
   canonical list).
