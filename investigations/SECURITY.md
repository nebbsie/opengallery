# Security Investigation — OpenGallery

> **Status:** investigation only — no fixes applied.
> **Date:** 2026-05-31. Audited the *current working tree* (heavily modified since `HEAD`),
> verifying every prior claim against live code. Items marked **FIXED** were open in the
> May 25 docs but are now resolved; do not re-report them.

Stack under review: Fastify 5 + tRPC 11 + Drizzle/better-sqlite3 + BetterAuth (session auth)
+ BullMQ on the API; Angular 19 SSR web; worker using sharp/ffmpeg/exifr/chokidar.
nginx fronts everything on port 4321 and proxies `/api/` → API.

---

## Findings

### 🔴 Critical

#### S1 — Residual missing authorization in tRPC procedures
A real authz framework now exists (`api/src/trpc.ts`, `api/src/authz/shared-access.ts`) and most
endpoints use it correctly, but several `privateProcedure` handlers still do **zero** access control.
Any authenticated (non-admin) user can read cross-user data and mutate associations.

- `api/src/routers/album.router.ts:223` — `get: privateProcedure.query(() => db.select().from(AlbumTable))` returns **every album of every user**.
- `api/src/routers/album.router.ts:225` — `getAlbumByDir` returns any album by dir, no scope check.
- `api/src/routers/album.router.ts:231` — `getAllAlbumsForLibrary` returns all albums for any `libraryId`, no ownership check.
- `api/src/routers/album-file.router.ts:8` — `create` destructures `ctx.userId` then **never uses it**; inserts arbitrary `(albumId, fileId)` pairs.
- `api/src/routers/album-file.router.ts:21` — `getByAlbumIds` returns links for any album IDs.
- `api/src/routers/library-file.router.ts:8` — `create` no ownership check; `:29` `getAllLibraryFiles` returns all files for any library.
- `api/src/routers/files.router.ts:90` — `getFilesInDir` returns all rows for any directory string (file-existence probing).
- `api/src/routers/issues.router.ts:8,36,64` — `list`/`retry`/`retryAll` unscoped; `retry`/`retryAll` let any user reset every failed encode task system-wide (stampede/DoS).

**Fix:** scope reads via `getAccessScope` / `buildFileAccessFilter`; verify ownership with
`getAlbumOwnerUserId` / `getFileOwnerUserId` on writes (use the already-destructured `userId`);
move internal/admin-only ops (`issues.*`, association writes) to `adminProcedure` / `internalProcedure`.

#### S2 — `INTERNAL_TOKEN=changeme` default baked into Docker
`Dockerfile.unified:179` `ENV INTERNAL_TOKEN=changeme`. This token gates `/metrics`, `/metrics/encode`,
and every `internalProcedure` (file CRUD, `files.getAllFiles`, variant writes, album/library deletes).
nginx proxies `/api/` to the API, so `/api/trpc/<internalProc>` with `Authorization: Bearer changeme`
is reachable from outside the host. A deployment that doesn't override is fully compromised.
**Fix:** remove the default; fail startup if unset or equal to `changeme`.

#### S3 — No rate limiting on auth endpoints
`api/src/auth/auth.ts:118` enables email/password; no `@fastify/rate-limit`, no better-auth `rateLimit`,
no nginx `limit_req` (grep confirmed empty). Login/signup are brute-forceable.
**Fix:** enable better-auth rate limiting or `@fastify/rate-limit` on `/auth/*`, plus nginx `limit_req`.

### 🟠 High

#### S4 — CORS reflects any origin with credentials by default
`api/src/server.ts:27` — when `TRUSTED_ORIGINS` is unset or `*`, `origin: (_origin, cb) => cb(null, true)`
reflects any origin with `credentials: true`. `Dockerfile.unified:180` defaults `TRUSTED_ORIGINS=*`;
`auth.ts:17` defaults `trustedOrigins` to `["*"]`. Any website can make credentialed requests in a
victim's browser. **Fix:** require an explicit allowlist in production; drop the `*` default.

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

- **S7 — Timing-unsafe token comparison.** `trpc.ts:43` (`bearer === INTERNAL_TOKEN`) and `metrics.ts:93`
  (`token !== INTERNAL_TOKEN`) use plain `===`/`!==`. **Fix:** length-checked `crypto.timingSafeEqual`.
- **S8 — Slow-request logging leaks full tRPC input.** `trpc.ts:119` logs `JSON.stringify(input)` for any
  request over `SLOW_TRPC_MS` — PII (emails, userIds, dirs, album names) in logs. **Fix:** log key/shape only.
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
