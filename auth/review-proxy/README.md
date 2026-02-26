# Review Auth Proxy (Cloudflare Worker)

This worker adds **server-side GitHub OAuth auth** for the review queue page:

- Protected path: `/papers/review.html`
- Auth endpoints:
  - `/auth/review/login`
  - `/auth/review/callback`
  - `/auth/review/session`
  - `/auth/review/logout`

The worker proxies all other routes to your static site (`UPSTREAM_ORIGIN`).

## Why this is needed

The site is deployed as static pages, so true private admin access needs a backend gate.
This worker is that gate, with an allowlist of GitHub logins.

## 1) Configure Worker vars/secrets

Set in Cloudflare:

- Vars:
  - `UPSTREAM_ORIGIN` (for example `https://bwatsonllvm.github.io/library`)
  - `ALLOWED_GITHUB_USERS` (comma-separated GitHub usernames)
  - optional `SESSION_TTL_SECONDS`
- Secrets:
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `SESSION_SECRET` (long random string)

Example (Wrangler CLI):

```bash
cd auth/review-proxy
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

## 2) Create GitHub OAuth App

Create a GitHub OAuth App and set callback URL to:

`https://<your-worker-domain>/auth/review/callback`

Use that app's client ID/secret in the worker secrets above.

## 3) Deploy

```bash
cd auth/review-proxy
wrangler deploy
```

Then use the worker domain as your primary site URL (or route your custom domain through it), so `/papers/review.html` is actually protected server-side.

## 4) Optional: set explicit auth base in the review page

If your review page is rendered from a different host than the auth worker, set:

```html
<meta name="review-auth-base" content="https://<your-worker-domain>">
```

in `papers/review.html`.

For same-origin protected deployments, leave it blank.
