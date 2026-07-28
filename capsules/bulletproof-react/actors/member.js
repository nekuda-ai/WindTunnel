async () => {
  const credentials = {
    firstName: 'Eval',
    lastName: 'Member',
    email: 'member@webmcp-eval.com',
    password: 'WebmcpEval123!',
    teamName: 'WebMCP Evaluation Team',
  };

  const register = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(credentials),
  });

  if (!register.ok && register.status !== 400) {
    throw new Error(`member registration failed: ${register.status}`);
  }

  if (!register.ok) {
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: credentials.email, password: credentials.password}),
    });
    if (!login.ok) throw new Error(`member login failed: ${login.status}`);
  }

  return {registered: register.ok, email: credentials.email, role: 'ADMIN'};
}
