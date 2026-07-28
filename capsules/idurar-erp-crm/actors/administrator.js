async () => {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({email: 'admin@admin.com', password: 'admin123'}),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true || !body.result?.token) {
    throw new Error(`IDURAR administrator login failed: ${response.status}`);
  }

  localStorage.setItem(
    'auth',
    JSON.stringify({
      current: body.result,
      isLoggedIn: true,
      isLoading: false,
      isSuccess: true,
    }),
  );
  localStorage.removeItem('isLogout');
  return {email: body.result.email, role: body.result.role};
}
