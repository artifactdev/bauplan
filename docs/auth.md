# Users & sign-in

## Initial setup
As long as **no account** exists, the app redirects to `/setup`. The first account is created there and becomes **Admin**; the interface language can also be chosen there. Afterwards `/setup` is locked.

## Roles
| Role | Permissions |
| --- | --- |
| **Admin** | Everything, plus user management, OIDC, calendar subscription |
| **Member** | Read and edit all project data |
| **Pending** | Signed in, but sees **no data** until an admin approves the account |

There is no public registration. Admins create accounts under **Settings → Users**, change roles, reset passwords, and delete accounts. **The last admin is protected:** they cannot be deleted or demoted unless another admin exists.

## Local authentication
- Own tables: `app_users`, `app_sessions`, `app_settings`.
- Passwords: PBKDF2 (210,000 iterations, WebCrypto).
- Sessions: random token, 30 days, stored only as a SHA-256 hash, httpOnly cookie `bp_session`.
- Files under `/api/files/*` require a valid session.
- CalDAV under `/api/caldav/` uses HTTP Basic with the same email/password, not a browser session.
  It requires an admin/member role and HTTPS outside localhost. SSO-only users can set a local
  password in personal settings. See [calendar integration](calendar-feed.md).

## Optional OIDC (e.g. Pocket ID)
- Settings → "Sign in with OIDC": issuer, client ID, client secret, public address (behind a reverse proxy).
- Callback URL to register with the provider: `https://<address>/api/oidc/callback`.
- Flow: Authorization Code + PKCE (`/api/oidc/login` → provider → `/api/oidc/callback`), discovery, token exchange, userinfo.
- When enabled, the app makes outbound requests to the configured identity provider. Email/password sign-in works without OIDC or an external service.
- Account matching (`decideOidcLogin` in `src/server/auth-core.ts`):
  1. Known OIDC `sub` → sign-in.
  2. **Verified** email belongs to an existing account → link the account.
  3. Otherwise → create a new account with the **Pending** role.

Tests: `src/server/auth-core.test.ts`.
