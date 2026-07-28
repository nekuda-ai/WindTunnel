async () => {
  // Anonymous storefront shopper: no authentication required. The Medusa
  // storefront middleware answers the first request to any country-code path
  // with a 307 that sets the _medusa_cache_id region cookie; the verifier's
  // browser follows the redirect and carries the cookie automatically. This
  // setup is intentionally a no-op — the meaningful assertion is the
  // expect-text ("T-Shirt") that confirms the seeded product actually renders
  // in the browser on the product detail page.
  return { anonymous: true }
}
