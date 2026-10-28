# Security Investigation — OpenGallery

> **Status:** open findings only. S1, S2, S4, S7 and S8 were fixed on 2026-10-28 (see REVIEW-2026-10-28.md).
> **Date:** 2026-05-31. Audited the *current working tree* (heavily modified since `HEAD`),
> verifying every prior claim against live code. Items marked **FIXED** were open in the
> May 25 docs but are now resolved; do not re-report them.

Stack under review: Fastify 5 + tRPC 11 + Drizzle/better-sqlite3 + BetterAuth (session auth)
+ BullMQ on the API; Angular 19 SSR web; worker using sharp/ffmpeg/exifr/chokidar.
nginx fronts everything on port 4321 and proxies `/api/` → API.

---

## Findings

### 🔴 Critical

#### S3 — No rate limiting on auth endpoints
`api/src/auth/auth.ts:118` enables email/password; no `@fastify/rate-limit`, no better-auth `rateLimit`,
no nginx `limit_req` (grep confirmed empty). Login/signup are brute-forceable.
**Fix:** enable better-auth rate limiting or `@fastify/rate-limit` on `/auth/*`, plus nginx `limit_req`.

### 🟠 High

#### S5 — No CSP / security headers
`nginx.conf` (the production front) sets no `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`,
`X-Content-Type-Options`, `Referrer-Policy`, or HSTS. No XSS defense-in-depth; app is framable (clickjacking).
**Fix:** add the headers in nginx (CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS).

#### S6 — FFmpeg/FFprobe argument injection (partial / hardening)
`worker/src/encoding/encode.ts:648–765` and `worker/src/utils/ffprobe.ts:75` pass filesystem paths as
positional args with no `--` separator and no filename validation. Filenames originate from `basename()`
of scanner-discovered files. **Mitigating factor:** `inputPath` is always absolute (`/…`), so a leading-`-`
basename does not become a flag in practice — so this is lower risk than the old doc claimed.
**Fix anyway:** add `--` before path operands and reject filenames starting with `-`.

### 🟡 Medium

- **S9 — `settings.get` exposes filesystem paths.** `settings.router.ts:43` is `privateProcedure` and returns
  `uploadPath`/`variantsPath` to any authenticated user. **Fix:** admin-only or strip paths for non-admins.

### ⚪ Low

- **S10a — No Fastify `bodyLimit`** (grep empty); nginx caps proxy body at 100M only. **Fix:** set `bodyLimit`.
- **S10b — Admin directory traversal.** `directory.router.ts:21` `ls: adminProcedure` reads arbitrary FS dirs,
  no allowlist. Admin-gated → Low.
- **S10c — `exec()` (shell) in `getEncoderInfo`.** `settings.router.ts:187` — hardcoded commands, no user input,
  admin-gated → Low.
- **S10d — Cookie attributes** rely on better-auth defaults; no explicit `secure`/`sameSite`/expiry. Verify over HTTPS.
- **S10e — `queue.encodingCounts`** (`queue.router.ts:8`) returns global counts to any user (minor aggregate leak).
- **S10f — No XSRF token** in the Angular client; relies on better-auth/SameSite (compounds with S4).
- **S10g — Live-format `GH_PAT`** in untracked local `api/.env` / `worker/.env` (gitignored, not committed) — rotate/remove.

---

## Remediation order (security)
1. **Phase 0 (ship-blockers):** S2, S4 (drop Docker defaults, fail-fast), S1 (close authz holes), S3 (rate limit), S5 (CSP/headers).
2. **Phase 3 (hardening):** S6 (`--` + reject `-` names), S7 (`timingSafeEqual`), S8 (log shape only), S9 (gate paths), S10a (`bodyLimit`).
