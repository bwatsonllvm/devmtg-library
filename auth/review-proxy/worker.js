/**
 * Cloudflare Worker: GitHub OAuth gate for /papers/review.html.
 *
 * Required secrets:
 * - GITHUB_CLIENT_ID
 * - GITHUB_CLIENT_SECRET
 * - SESSION_SECRET
 *
 * Required vars:
 * - UPSTREAM_ORIGIN (for example https://bwatsonllvm.github.io/library)
 * - ALLOWED_GITHUB_USERS (comma-separated GitHub logins)
 */

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

const SESSION_COOKIE = 'llvm_review_session';
const STATE_COOKIE = 'llvm_review_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const STATE_TTL_SECONDS = 60 * 10;

const PROTECTED_PATHS = new Set([
  '/papers/review.html',
  '/papers/review',
  '/papers/review/',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/auth/review/')) {
      return handleAuthRoute(request, env);
    }

    if (PROTECTED_PATHS.has(pathname)) {
      const session = await readSession(request, env);
      if (!session.valid || !session.authorized) {
        return redirectToLogin(request, env);
      }
    }

    return proxyToUpstream(request, env);
  },
};

async function handleAuthRoute(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/auth/review/login') {
    return startLogin(request, env);
  }
  if (pathname === '/auth/review/callback') {
    return finishLogin(request, env);
  }
  if (pathname === '/auth/review/logout') {
    return logout(request, env);
  }
  if (pathname === '/auth/review/session') {
    return getSessionStatus(request, env);
  }

  return json(
    { error: 'not_found', message: `Unknown auth route: ${pathname}` },
    404
  );
}

async function startLogin(request, env) {
  const url = new URL(request.url);
  const returnTo = normalizeReturnTo(url.searchParams.get('return_to'));

  const now = Math.floor(Date.now() / 1000);
  const statePayload = {
    returnTo,
    exp: now + STATE_TTL_SECONDS,
    nonce: randomToken(24),
  };
  const stateToken = await signPayload(statePayload, env.SESSION_SECRET);

  const callbackUrl = new URL('/auth/review/callback', url.origin).toString();
  const githubAuthUrl = new URL(GITHUB_AUTHORIZE_URL);
  githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID || '');
  githubAuthUrl.searchParams.set('scope', 'read:user');
  githubAuthUrl.searchParams.set('allow_signup', 'false');
  githubAuthUrl.searchParams.set('redirect_uri', callbackUrl);
  githubAuthUrl.searchParams.set('state', stateToken);

  const headers = new Headers({
    Location: githubAuthUrl.toString(),
    'Cache-Control': 'no-store',
  });
  headers.append(
    'Set-Cookie',
    serializeCookie(STATE_COOKIE, stateToken, {
      maxAge: STATE_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
    })
  );

  return new Response(null, { status: 302, headers });
}

async function finishLogin(request, env) {
  const requestUrl = new URL(request.url);
  const code = String(requestUrl.searchParams.get('code') || '').trim();
  const stateToken = String(requestUrl.searchParams.get('state') || '').trim();
  const stateCookie = getCookie(request, STATE_COOKIE);

  if (!code || !stateToken || !stateCookie || stateCookie !== stateToken) {
    return authError('Invalid login state. Retry sign-in.');
  }

  const statePayload = await verifySignedPayload(stateToken, env.SESSION_SECRET);
  if (!statePayload.valid) {
    return authError('Expired or invalid login state. Retry sign-in.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Number(statePayload.payload.exp || 0) < now) {
    return authError('Login state expired. Retry sign-in.');
  }

  const callbackUrl = new URL('/auth/review/callback', requestUrl.origin).toString();
  const tokenResp = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'llvm-library-review-auth',
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID || '',
      client_secret: env.GITHUB_CLIENT_SECRET || '',
      code,
      redirect_uri: callbackUrl,
    }).toString(),
  });

  if (!tokenResp.ok) {
    return authError(`GitHub token exchange failed (HTTP ${tokenResp.status}).`);
  }

  const tokenJson = await tokenResp.json();
  const accessToken = String(tokenJson.access_token || '').trim();
  if (!accessToken) {
    return authError('GitHub did not return an access token.');
  }

  const userResp = await fetch(GITHUB_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'llvm-library-review-auth',
    },
  });
  if (!userResp.ok) {
    return authError(`GitHub user lookup failed (HTTP ${userResp.status}).`);
  }

  const userJson = await userResp.json();
  const login = String(userJson.login || '').trim().toLowerCase();
  if (!login) {
    return authError('Could not resolve GitHub login.');
  }

  const allowlist = parseAllowlist(env.ALLOWED_GITHUB_USERS);
  if (!allowlist.has(login)) {
    return authError(`GitHub account @${login} is not allowlisted.`);
  }

  const ttl = parsePositiveInt(env.SESSION_TTL_SECONDS, SESSION_TTL_SECONDS);
  const sessionPayload = {
    login,
    exp: now + ttl,
  };
  const sessionToken = await signPayload(sessionPayload, env.SESSION_SECRET);
  const returnTo = normalizeReturnTo(statePayload.payload.returnTo);

  const headers = new Headers({
    Location: returnTo,
    'Cache-Control': 'no-store',
  });
  headers.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, sessionToken, {
      maxAge: ttl,
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
    })
  );
  headers.append(
    'Set-Cookie',
    serializeCookie(STATE_COOKIE, '', {
      maxAge: 0,
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
    })
  );

  return new Response(null, { status: 302, headers });
}

async function logout(request) {
  const requestUrl = new URL(request.url);
  const returnTo = normalizeReturnTo(requestUrl.searchParams.get('return_to'));
  const headers = new Headers({
    Location: returnTo,
    'Cache-Control': 'no-store',
  });
  headers.append(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', {
      maxAge: 0,
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
    })
  );
  return new Response(null, { status: 302, headers });
}

async function getSessionStatus(request, env) {
  const session = await readSession(request, env);
  const payload = {
    authenticated: session.valid,
    authorized: session.valid && session.authorized,
    login: session.login || '',
    reason: session.reason || '',
  };
  return json(payload, 200, { 'Cache-Control': 'no-store' });
}

async function readSession(request, env) {
  const raw = getCookie(request, SESSION_COOKIE);
  if (!raw) {
    return { valid: false, authorized: false, login: '', reason: 'missing_session' };
  }

  const verified = await verifySignedPayload(raw, env.SESSION_SECRET);
  if (!verified.valid) {
    return { valid: false, authorized: false, login: '', reason: 'invalid_session' };
  }

  const payload = verified.payload || {};
  const login = String(payload.login || '').trim().toLowerCase();
  const exp = Number(payload.exp || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!login || !Number.isFinite(exp) || exp < now) {
    return { valid: false, authorized: false, login: '', reason: 'expired_session' };
  }

  const allowlist = parseAllowlist(env.ALLOWED_GITHUB_USERS);
  const authorized = allowlist.has(login);
  return {
    valid: true,
    authorized,
    login,
    reason: authorized ? '' : 'not_allowlisted',
  };
}

function redirectToLogin(request) {
  const requestUrl = new URL(request.url);
  const loginUrl = new URL('/auth/review/login', requestUrl.origin);
  loginUrl.searchParams.set('return_to', `${requestUrl.pathname}${requestUrl.search}`);
  return new Response(null, {
    status: 302,
    headers: {
      Location: loginUrl.toString(),
      'Cache-Control': 'no-store',
    },
  });
}

async function proxyToUpstream(request, env) {
  const upstreamOrigin = String(env.UPSTREAM_ORIGIN || '').trim();
  if (!upstreamOrigin) {
    return json(
      { error: 'misconfigured', message: 'UPSTREAM_ORIGIN is required.' },
      500
    );
  }

  const incoming = new URL(request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, upstreamOrigin);

  const headers = new Headers(request.headers);
  headers.set('Host', new URL(upstreamOrigin).host);
  headers.delete('CF-Connecting-IP');
  headers.delete('CF-IPCountry');
  headers.delete('CF-Ray');
  headers.delete('CF-Visitor');

  const method = request.method.toUpperCase();
  const proxyRequest = new Request(upstream.toString(), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  return fetch(proxyRequest);
}

function parseAllowlist(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeReturnTo(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/papers/review.html';
  if (!raw.startsWith('/')) return '/papers/review.html';
  if (raw.startsWith('//')) return '/papers/review.html';
  if (raw.toLowerCase().startsWith('/auth/review/callback')) return '/papers/review.html';
  return raw;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getCookie(request, key) {
  const header = String(request.headers.get('cookie') || '');
  if (!header) return '';
  const pairs = header.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    if (name !== key) continue;
    return decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return '';
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  parts.push(`Path=${options.path || '/'}`);
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

function randomToken(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function signPayload(payload, secret) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

async function verifySignedPayload(token, secret) {
  const raw = String(token || '').trim();
  const dot = raw.lastIndexOf('.');
  if (dot <= 0 || dot >= raw.length - 1) {
    return { valid: false, payload: null };
  }
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expectedSig = await hmacSha256Base64Url(secret, body);
  if (!timingSafeEqual(sig, expectedSig)) {
    return { valid: false, payload: null };
  }
  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(body));
    const payload = JSON.parse(decoded);
    if (!payload || typeof payload !== 'object') return { valid: false, payload: null };
    return { valid: true, payload };
  } catch {
    return { valid: false, payload: null };
  }
}

async function hmacSha256Base64Url(secret, message) {
  const keyData = new TextEncoder().encode(String(secret || ''));
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const base64 = normalized + padding;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function json(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(payload), { status, headers });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function authError(message) {
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Review Auth Error</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;background:#f5f5f5;color:#111;margin:0;padding:32px}
.card{max-width:720px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:20px}
h1{margin:0 0 10px;font-size:1.2rem}
p{margin:0 0 10px;line-height:1.45}
a{color:#0b5cab;text-decoration:none;font-weight:600}
a:hover{text-decoration:underline}
</style></head><body><main class="card">
<h1>Authentication failed</h1>
<p>${escapeHtml(message)}</p>
<p><a href="/auth/review/login?return_to=%2Fpapers%2Freview.html">Try sign-in again</a></p>
</main></body></html>`;
  return new Response(body, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
