// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// CSRF-aware fetch + auth. Every authenticated call goes through apiFetch or
// the api helpers below: they attach the session cookie and the x-csrf-token
// header, which a raw fetch silently omits.

import { setState } from './store';

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)aerie_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

type FetchOptions = RequestInit & {
  /** Skip the CSRF header (for auth endpoints that set the cookie). */
  skipCsrf?: boolean;
};

export async function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const { skipCsrf, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();

  if (!skipCsrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = getCsrfToken();
    if (token) {
      fetchOptions.headers = { ...fetchOptions.headers, 'x-csrf-token': token };
    }
  }

  fetchOptions.credentials = fetchOptions.credentials ?? 'include';
  return fetch(url, fetchOptions);
}

export const api = {
  get: (url: string, options?: FetchOptions) => apiFetch(url, { ...options, method: 'GET' }),

  post: (url: string, body?: unknown, options?: FetchOptions) =>
    apiFetch(url, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  put: (url: string, body?: unknown, options?: FetchOptions) =>
    apiFetch(url, {
      ...options,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: (url: string, body?: unknown, options?: FetchOptions) =>
    apiFetch(url, {
      ...options,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: (url: string, options?: FetchOptions) => apiFetch(url, { ...options, method: 'DELETE' }),
};

// --- Auth ---

export async function checkAuth(): Promise<boolean> {
  setState((s) => ({ auth: { ...s.auth, checking: true } }));
  try {
    const res = await fetch('/api/auth/check', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const authenticated = data.authenticated === true;
      const required = data.auth_required !== false;
      setState({ auth: { checking: false, authenticated, required } });
      return authenticated;
    }
    setState((s) => ({ auth: { ...s.auth, checking: false, authenticated: false } }));
    return false;
  } catch (err) {
    console.error('Auth check failed:', err);
    setState((s) => ({ auth: { ...s.auth, checking: false, authenticated: false } }));
    return false;
  }
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setState((s) => ({ auth: { ...s.auth, authenticated: true } }));
      return { success: true };
    }
    const data = await res.json().catch(() => ({}));
    return { success: false, error: data.error || 'Login failed' };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, error: 'Network error' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    setState((s) => ({ auth: { ...s.auth, authenticated: false } }));
  }
}
