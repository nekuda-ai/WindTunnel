async () => {
  if (typeof vars !== 'function' || !globalThis.App?.Utils?.Url) {
    throw new Error('EasyAppointments login page did not expose its application helpers');
  }
  const response = await fetch(App.Utils.Url.siteUrl('login/validate'), {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'},
    body: new URLSearchParams({
      csrf_token: vars('csrf_token'),
      username: 'administrator',
      password: 'administrator',
    }),
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) {
    throw new Error(`EasyAppointments administrator login failed: ${response.status}`);
  }
  return {username: 'administrator', role: 'admin'};
}
