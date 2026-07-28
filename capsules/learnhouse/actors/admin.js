async () => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      username: 'admin@webmcp-eval.com',
      password: 'WebmcpEvalAdmin!234',
    }),
    credentials: 'include',
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.tokens?.access_token) {
    throw new Error(`LearnHouse admin login failed: ${response.status}`);
  }

  return {
    email: 'admin@webmcp-eval.com',
    authenticated: true,
    hasAccessToken: Boolean(body.tokens.access_token),
  };
}
