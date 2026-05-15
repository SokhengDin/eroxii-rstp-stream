export function authHeaders(extra = {}) {
  const token = localStorage.getItem('auth-token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'x-session-token': token } : {}),
    ...extra,
  };
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('auth-token');
    window.location.reload();
  }
  return res;
}
