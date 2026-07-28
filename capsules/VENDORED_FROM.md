# Vendored site-boot apparatus

- Source: `nekuda-ai/webmcp-kit` (private at the time of writing — not yet published)
- Commit: `0dabb13d8218cd2028703cccc182759bd5f56870`
- Vendored date: `2026-07-22`
- Paths: `harness/bin/`, `harness/lib/`, `capsules/`, `fixtures/`, `goldens/*.reference.patch`

## WebMCP tools are NOT applied at boot — and that is WindTunnel's job, not upstream's

The `goldens/*.reference.patch` files ARE the reference WebMCP tool
implementations for each site (they register the site's `navigator.modelContext`
tools). But the vendored capsule lifecycle boots every site **vanilla** and does
NOT apply them — by design: webmcp-kit is an *authoring* eval, so it withholds
the goldens (see the "Expected tools, evaluator probes, and goldens are not
provided" guard in `harness/lib/site-adapter.sh`). This will never change from
upstream; there are no pending PRs.

WindTunnel's need is the opposite: its WebMCP arm must **drive** the reference
tools, so WindTunnel applies `goldens/<site>.reference.patch` during `prepare`.
The computer-use / DOM / a11y arms continue to boot vanilla sites.

## WindTunnel local edits (re-apply after re-sync)

- `goldens/*.reference.patch` — **6 of 8 goldens carry WindTunnel fixes**
  (2026-07-23 golden review): directory-9d8 (error message),
  bulletproof-react (honest no-match ask_site, 404-vs-transient, page clamp),
  nextjs-starter-medusa (quantity validation, additionalProperties:false,
  retry .catch), learnhouse (read-path try/catch, resume ambiguity),
  idurar-erp-crm (partial-failure reporting, validate-before-number, warn on
  registration failure). hi-events and tailwind-nextjs-blog are unchanged.
  These diverge from webmcp-kit until upstreamed — see the fix list sent to
  the webmcp-kit maintainer.
- `capsules/directory-9d8/` — new `patches/fixture-newsletter.patch` (local
  subscribe success + email validation, all arms) wired into capsule.sh.
- `fixtures/easyappointments/seed-services.sql` — business + 3 named services,
  wired into capsules/easyappointments/capsule.sh after console install.

- `harness/lib/site-adapter.sh`: `# WINDTUNNEL: webmcp golden-apply` applies and
  hashes the site golden at the shared post-SDK-vendor prepare seam when
  `WT_WEBMCP=1`.
