async () => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      email: 'organizer@webmcp-eval.test',
      password: 'WebmcpEval123!'
    })
  });
  if (!response.ok) throw new Error(`organizer login failed: ${response.status}`);
  const session = await response.json();
  if (!session.token) throw new Error('organizer login returned no bearer token');

  // Hi.Events emits a Secure cookie even for its local HTTP deployment. Install
  // the same token as an HTTP-compatible evaluator cookie so the subsequent
  // verifier navigation can hydrate the authenticated SSR route.
  document.cookie = `token=${encodeURIComponent(session.token)}; Path=/; SameSite=Lax`;
  localStorage.removeItem('previous_url');
  return {
    authenticated: true,
    actor: 'organizer',
    email: session.user?.email,
    accountId: session.accounts?.[0]?.id
  };
}
