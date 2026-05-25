# OpenGallery Security Analysis

> Deep security audit across UI (Angular), Worker (encode/watcher), and Backend (Fastify/tRPC/SQLite).
> Generated: 2026-05-25

---

## Table of Contents

1. [Critical: Missing Authorization in tRPC Procedures](#1-critical-missing-authorization-in-trpc-procedures)
2. [Critical: Default Secrets and Weak Credentials](#2-critical-default-secrets-and-weak-credentials)
3. [Critical: No Rate Limiting on Auth Endpoints](#3-critical-no-rate-limiting-on-auth-endpoints)
4. [Critical: Missing Content Security Policy (CSP)](#4-critical-missing-content-security-policy-csp)
5. [High: OS Command Injection via FFmpeg Argument Injection](#5-high-os-command-injection-via-ffmpeg-argument-injection)
6. [High: Path Traversal in Asset Serving](#6-high-path-traversal-in-asset-serving)
7. [High: Insecure CORS Configuration](#7-high-insecure-cors-configuration)
8. [Medium: Timing-Unsafe Token Comparison](#8-medium-timing-unsafe-token-comparison)
9. [Medium: Information Disclosure in Logs](#9-medium-information-disclosure-in-logs)
10. [Medium: No XSRF/CSRF Token Configuration](#10-medium-no-xsrfcsrf-token-configuration)
11. [Medium: Weak Input Validation](#11-medium-weak-input-validation)
12. [Low: CDN Dependency Without SRI](#12-low-cdn-dependency-without-sri)
13. [Low: Cookie Security Attributes](#13-low-cookie-security-attributes)
14. [Low: Admin Directory Traversal](#14-low-admin-directory-traversal)
15. [Low: Shell Exec in getEncoderInfo](#15-low-shell-exec-in-getencoderinfo)
16. [Notable Good Practices](#16-notable-good-practices)
17. [Recommendation Priority Matrix](#17-recommendation-priority-matrix)

---

## 1. Critical: Missing Authorization in tRPC Procedures

### 1A: `album.get` Returns All Albums (C-01)

**Location:** `api/src/routers/album.router.ts:147`

```ts
get: privateProcedure.query(() => db.select().from(AlbumTable)),
```

**Issue:** No WHERE clause, no access scope check. Every authenticated user (or internal caller) can list **every album** created by every user, including private albums.

**Why it's critical:** Trivially exploitable via any authenticated tRPC call. An attacker sees the entire album catalog — album names, descriptions, directory paths.

**Fix:** Add `buildFileAccessFilter` or restrict via `getAccessScope(userId, session).visibleAlbumIds`.

---

### 1B: `album.getAlbumByDir` No Access Control (C-02)

**Location:** `api/src/routers/album.router.ts:149-153`

```ts
getAlbumByDir: privateProcedure
  .input(z.string())
  .query(({ input }) =>
    db.select().from(AlbumTable).where(eq(AlbumTable.dir, input)).limit(1),
  ),
```

**Issue:** Takes a directory path and returns any matching album with no access control.

**Fix:** Add access scope check — verify the caller has `visibleAlbumIds` containing the result.

---

### 1C: `album.getAllAlbumsForLibrary` No Access Control (C-03)

**Location:** `api/src/routers/album.router.ts:155-173`

**Issue:** Accepts a `libraryId` and returns all albums for that library with no ownership or access check.

**Fix:** Verify `libraryId` is in `accessibleLibraryIds` from the caller's access scope.

---

### 1D: `albumFile.create` No Ownership Check (C-04)

**Location:** `api/src/routers/album-file.router.ts:8-19`

```ts
create: privateProcedure
  .input(z.array(z.object({ albumId: z.string(), fileId: z.string() })))
  .mutation(({ ctx: { userId }, input }) =>
    db.insert(AlbumFileTable).values(input),
  ),
```

**Issue:** `userId` from context is destructured but **never used**. No ownership check on either the album or the file. An attacker can:
- Add any file to any album
- Exfiltrate data by linking arbitrary files to albums they can view

**Why it's critical:** This is a write endpoint with zero access validation. The user context is available but ignored.

**Fix:** Verify the caller owns the album (via `getAlbumOwnerUserId`) and that the file is accessible to them.

---

### 1E: `albumFile.getByAlbumIds` No Access Control (C-05)

**Location:** `api/src/routers/album-file.router.ts:21-28`

**Issue:** Returns file IDs for any album IDs provided. Enumerates file-album relationships across the entire system.

**Fix:** Filter by `visibleAlbumIds` from access scope before querying.

---

### 1F: `libraryFile.create` No Ownership Check (C-06)

**Location:** `api/src/routers/library-file.router.ts:8-27`

```ts
create: privateProcedure
  .input(z.array(z.object({ fileId: z.string(), libraryId: z.string() })))
  .mutation(({ ctx: { userId }, input }) =>
    db.insert(LibraryFileTable).values(
      input.map((inp) => ({ ...inp, userId })),
    ).returning()
  ),
```

**Issue:** `{ ...inp, userId }` spreads `userId` into the insert, but `LibraryFileTable` has **no `userId` column** — Drizzle silently ignores it. No ownership validation. An attacker can link arbitrary files to libraries they do not own.

**Why it's critical:** Write endpoint with no validation. The dead-code spread of `userId` into a non-existent column is a red flag suggesting incomplete implementation.

**Fix:** Validate that `libraryId` belongs to the caller before inserting.

---

### 1G: `libraryFile.getAllLibraryFiles` No Access Control (C-07)

**Location:** `api/src/routers/library-file.router.ts:29-46`

**Issue:** Returns all files in any library by ID. No check that the caller owns or has access.

**Fix:** Verify `libraryId` is in `accessibleLibraryIds` from access scope.

---

### 1H: `issues.list` / `issues.retry` / `issues.retryAll` No User Filter (C-08)

**Location:** `api/src/routers/issues.router.ts:8-90`

- `list`: Returns ALL failed encode tasks across ALL users (leaks file IDs).
- `retry`: Any user can retry encoding for any fileId. No ownership check.
- `retryAll`: Any authenticated user can reset ALL failed encode tasks globally, potentially causing a stampede.

**Fix:** Change to `adminProcedure` or at minimum filter by the user's accessible files.

---

### 1I: `files.getFilesInDir` No Access Control (C-09)

**Location:** `api/src/routers/files.router.ts:79-83`

**Issue:** Takes a directory path and returns all files at that path. No scope check. An attacker can probe whether specific files exist.

**Fix:** Add access scope check or restrict to `adminProcedure`.

---

### Summary of Authorization Gaps

| ID | File | Procedure | Severity | Type |
|----|------|-----------|----------|------|
| C-01 | `album.router.ts` | `get` | **CRITICAL** | Read — all albums leaked |
| C-02 | `album.router.ts` | `getAlbumByDir` | **HIGH** | Read — album data by path probing |
| C-03 | `album.router.ts` | `getAllAlbumsForLibrary` | **HIGH** | Read — albums enumerated by libraryId |
| C-04 | `album-file.router.ts` | `create` | **CRITICAL** | Write — unlimited mutation |
| C-05 | `album-file.router.ts` | `getByAlbumIds` | **HIGH** | Read — file-album links leaked |
| C-06 | `library-file.router.ts` | `create` | **CRITICAL** | Write — unlimited mutation |
| C-07 | `library-file.router.ts` | `getAllLibraryFiles` | **HIGH** | Read — all files in any library |
| C-08 | `issues.router.ts` | `list`/`retry`/`retryAll` | **HIGH** | Read+Write — no user scoping |
| C-09 | `files.router.ts` | `getFilesInDir` | **MEDIUM** | Read — file existence probing |

---

## 2. Critical: Default Secrets and Weak Credentials

### 2A: `INTERNAL_TOKEN=changeme` in Docker (S-01)

**Location:** `Dockerfile.unified:142`

```dockerfile
ENV INTERNAL_TOKEN=changeme
```

**Issue:** The internal API token defaults to a well-known value. This token protects `/metrics`, all `internalProcedure` tRPC endpoints, and worker-to-API communication. Anyone who can reach the API port with `Bearer changeme` gains full internal access — equivalent to administrative control.

**Why it's critical:** This is the single highest-severity finding. The default is documented in `ANALYSIS.md` and `README.md`, making it well-known. Deployments that don't override this are trivially compromised.

**Fix:** Remove the default from `Dockerfile.unified`. Require the token to be explicitly set. Fail startup if `INTERNAL_TOKEN` is unset or equals `changeme`.

---

### 2B: Weak Sample Secrets in `.env` Files (S-02)

**Location:**
- `api/.env:2,5`
- `api/.env.sample:2,5`
- `worker/.env:2`
- `worker/.env.sample:2`

```
BETTER_AUTH_SECRET=mysecret
INTERNAL_TOKEN=my_token
```

**Issue:** Trivially guessable strings used as sample values. If `.env` files are committed to version control or accidentally used in production, the auth system is compromised.

**Fix:** Use auto-generated secrets in samples (e.g., `BETTER_AUTH_SECRET=generate-a-random-secret`). Add `.env` to `.gitignore` (confirm it's already there). Remove committed `.env` files.

---

### 2C: GitHub PAT in Scripts (S-03)

**Location:** `scripts/publish-unified.sh:13`, `scripts/publish-unified-dev.sh:13`

```bash
echo "$GH_PAT" | docker login ghcr.io -u ... --password-stdin
```

**Issue:** `GH_PAT` is passed via `echo` pipe. While standard practice, the token is briefly visible in the process table to other processes running as the same user.

**Fix:** Use `docker login` with `--password-stdin` from a file descriptor or a Docker credential helper. Ensure CI systems mask the PAT in logs.

---

## 3. Critical: No Rate Limiting on Auth Endpoints

**Location:** `api/src/auth/auth.ts:118`

```ts
emailAndPassword: { enabled: true },
```

**Issue:** BetterAuth is configured with no rate limiting on login or sign-up. An attacker can:
- Brute-force user passwords without restriction
- Flood the registration endpoint to create spam accounts
- Exhaust DB connections with rapid auth requests

**Why it's critical:** Auth endpoints are the most common attack vector. Without rate limiting, credential brute-forcing is trivial. BetterAuth has a built-in rate-limit plugin that is not enabled.

**Fix:** Enable BetterAuth's rate-limit plugin or add a reverse-proxy-level rate limiter (`@fastify/rate-limit`). Recommended: 5 req/min per IP on login, 2 req/min per IP on sign-up.

---

## 4. Critical: Missing Content Security Policy (CSP)

**Location:** `web/src/index.html`

**Issue:** No Content Security Policy meta tag or HTTP header. The app has zero XSS mitigation at the CSP level. An inline `<script>` block (lines 12-27) manipulates `localStorage` and `documentElement.classList` for theme detection, which would need a nonce if CSP were added.

**Why it's critical:** CSP is the last line of defense against XSS. Without it, any stored or reflected XSS vulnerability can execute arbitrary JavaScript in the user's session context.

**Fix:** Add a strict CSP header:
```
default-src 'self';
script-src 'self' 'nonce-{random}';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' https://*.basemaps.cartocdn.com;
frame-ancestors 'none';
```

Add `nonce` attribute to the inline theme script. Apply via Angular's `HttpInterceptor` for SSR or Nginx for production.

---

## 5. High: OS Command Injection via FFmpeg Argument Injection

### 5A: FFmpeg Spawn (S-04)

**Location:** `worker/src/encoding/encode.ts:437,457`

```ts
const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
```

Where `args` includes `inputPath`, `optPath`, and `thumbPath` derived from file names on the filesystem.

**Issue:** While `spawn` with an array prevents shell injection, **argument injection** is still possible. If a malicious file is named something like `-ss 0 -f image2 -i /etc/passwd -.mp4`, the `-` prefix causes ffmpeg to interpret the filename as a flag.

**Why it's high:** An attacker who can place a file on a watched media directory can craft filenames that cause ffmpeg to:
- Read arbitrary files (path traversal via `-i`)
- Write output to arbitrary locations
- Execute 3rd-party encoder plugins

**Not theoretical:** Any shared photo directory or auto-import from USB drives could be a vector.

**Fix:** One of:
1. Pass `--` before user-controlled paths: `args = [...args, '--', inputPath]`
2. Pre-validate filenames: reject names starting with `-` or containing whitespace/path separators
3. Pass input via stdin pipe instead of file argument

### 5B: FFprobe Spawn (S-05)

**Location:** `worker/src/utils/ffprobe.ts:76`

```ts
const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path];
const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
```

**Issue:** Same argument injection pattern — `path` is the last element in the args array with no `--` separator.

**Fix:** Same as 5A — add `'--'` before `path`.

---

## 6. High: Path Traversal in Asset Serving

**Location:** `api/src/server.ts:151-153`

```ts
const abs = await resolveAssetPath(path.resolve(path.join(target.dir, target.name)));
```

**Issue:** The file path is constructed from DB fields (`target.dir`, `target.name`) and then resolved. If an attacker could inject path traversal characters (e.g., `../../../etc/passwd`) into a DB record (via the authorization gaps in Section 1), they could read arbitrary files on the server.

**Why it's high:** Combined with the authorization gaps in Section 1, an attacker who can create/modify DB records can escalate to arbitrary file reads on the server.

**Fix:**
- Verify that the resolved path is within an allowed base directory (chroot-style check)
- Reject paths containing `..` segments
- Use `path.normalize()` and verify the result starts with an allowed prefix

---

## 7. High: Insecure CORS Configuration

**Location:** `api/src/server.ts:64-76`, `Dockerfile.unified:143`

**Issue:** When `TRUSTED_ORIGINS` is unset or `*`, the CORS handler reflects any origin:
```ts
const allowAll = !rawOrigins || rawOrigins.trim() === "*";
```
With `credentials: true`, cookies are included cross-origin. The Dockerfile defaults to `ENV TRUSTED_ORIGINS=*`.

**Why it's high:** Any website can make credentialed requests to the API in a user's browser. While the attacker can't read responses (CORS), this enables:
- Session-hijacking via subdomain takeover (if the app is served from a subdomain)
- CSRF-style attacks on state-changing endpoints
- API surface scanning by random origins

**Fix:** Require explicit origin configuration in production. Remove the `*` default from Dockerfile. Validate origin against a whitelist, not a reflection pattern.

---

## 8. Medium: Timing-Unsafe Token Comparison

**Location:** `api/src/trpc.ts:42-44`, `api/src/metrics.ts:93`

```ts
const isInternal = Boolean(process.env["INTERNAL_TOKEN"]) && bearer === process.env["INTERNAL_TOKEN"];
```

**Issue:** String equality (`===`) with the internal token is timing-sensitive. An attacker on the same network can byte-guess the token by measuring response times.

**Why it's medium:** In practice, this requires thousands of requests over a local network. With `changeme` as the default (see S-01), timing attack is the least of the concerns. However, with a strong random token, timing attack becomes the only viable vector for token discovery.

**Fix:** Use `crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(process.env["INTERNAL_TOKEN"]))` after length validation.

---

## 9. Medium: Information Disclosure in Logs

### 9A: Slow Request Logging Leaks Input Data (S-06)

**Location:** `api/src/trpc.ts:111-114`

```ts
if (duration > 200) {
  logger.warn(`[TRPC] SLOW REQUEST ${path} took ${duration}ms`, {
    input: JSON.stringify(input, null, 2),
  });
}
```

**Issue:** The full tRPC input is logged for any request taking over 200ms. This can include user IDs, email addresses, album names, file paths, and other PII.

**Fix:** Log a sanitized/truncated version of input, or log only the input keys, not values.

### 9B: Console.log Leaks Storage Paths in UI (S-07)

**Location:** `web/src/app/settings/settings-storage/settings-storage.ts:250,265,301,319,339`

```
console.log("[Storage Settings] Auto-default effect running:", ...);
console.log("Setting defaults: { uploadPath, variantsPath, sep }");
console.log("Saving paths: { uploadPath, variantsPath }");
```

**Issue:** Storage paths (which may encode filesystem structure) are logged to the browser console. In a shared-computer scenario, any user can open devtools and see these paths.

**Fix:** Remove `console.log` calls or guard with `isDevMode()`.

### 9C: Console.error May Leak User Data (S-08)

**Location:** `web/src/@core/dialogs/create-user/create-user.ts:122`, `web/src/@core/components/register-form/register-form.ts:260`

```
console.error('Create user failed:', error);
console.error('Register failed:', error);
```

**Issue:** Error objects may contain user data or stack traces leaked to the console.

**Fix:** Use structured logging or suppress in production builds with Angular's `provideNoopLogger`.

---

## 10. Medium: No XSRF/CSRF Token Configuration

**Location:** `web/src/app/app.config.ts:37`

```ts
provideHttpClient(withFetch()),
```

**Issue:** Angular's `HttpClientXsrfModule` is not configured. All tRPC calls use `withCredentials: true` (cookies sent automatically), but there is no CSRF token mechanism to prevent cross-origin form submissions.

**Why it's medium:** Combined with permissive CORS (Section 7), this means any website can make authenticated requests to the API. The `better-auth` library may provide some CSRF protection, but it's not configured explicitly.

**Fix:** Configure Angular's XSRF token handling with `withXsrfConfiguration()`, or verify that better-auth's built-in CSRF protection is active and correctly configured.

---

## 11. Medium: Weak Input Validation

**Location:** Multiple files

**Issues:**
- Several procedures use `z.string()` without UUID validation where UUIDs are expected (e.g., `albumFile.create`, `libraryFile.create`, `album.getAlbumByDir`). This allows arbitrary non-UUID strings, reducing DB performance and allowing format probing.
- No path validation on `settings.update` for `uploadPath` and `variantsPath` — an admin could set paths to arbitrary locations.
- No file size limits on tRPC requests — Fastify has no `bodyLimit` configured.

**Fix:**
- Use `z.string().uuid()` where UUIDs are expected
- Validate directory paths with a path allowlist or `path.resolve` + prefix check
- Set `bodyLimit: 1048576` on Fastify instance

---

## 12. Low: CDN Dependency Without SRI

**Location:** `web/src/app/asset/asset.ts:650-653`

```ts
// Leaflet CSS/images from unpkg.com — no Subresource Integrity hashes
```

**Issue:** Leaflet assets are loaded from a third-party CDN with no `integrity` attribute. If the CDN is compromised, the Leaflet library could be replaced with malicious code.

**Fix:** Add `crossorigin="anonymous"` and `integrity="sha384-..."` attributes. Or bundle Leaflet CSS/images locally.

---

## 13. Low: Cookie Security Attributes

**Issue:** Auth cookies are set by better-auth server-side. The cookie configuration is not visible in the codebase (better-auth defaults). If cookies don't use `HttpOnly`, `Secure`, and `SameSite=Strict/Lax`, session tokens could be stolen via XSS or intercepted over HTTP.

**Fix:** Verify better-auth cookie configuration includes:
- `httpOnly: true`
- `secure: true` (in production)
- `sameSite: "lax"` (or `"strict"`)

---

## 14. Low: Admin Directory Traversal

**Location:** `api/src/routers/directory.router.ts:21-24`

```ts
ls: adminProcedure.input(z.string().optional()).query(...)
```

**Issue:** Admin `ls` endpoint reads arbitrary filesystem directories. No path allowlist; `path.resolve` doesn't prevent traversal through symlinks.

**Fix:** Add a path prefix check — ensure the resolved path starts with an allowed base directory (e.g., `/`, `STORAGE_PATH`, or `HOST_ROOT_PREFIX`).

---

## 15. Low: Shell Exec in getEncoderInfo

**Location:** `api/src/routers/settings.router.ts:174-277`

```ts
const execAsync = promisify(exec);
const { stdout, stderr } = await execAsync("ffmpeg -encoders");
const { stdout: nvidiaStdout } = await execAsync(
  "nvidia-smi --query-gpu=index,name --format=csv,noheader",
);
```

**Issue:** `exec()` with a hardcoded command. While no user input is involved, `exec` spawns a shell, which has higher overhead and risk than `spawn`. This is `adminProcedure`-gated. If the `ffmpeg` or `nvidia-smi` binaries are compromised, arbitrary command execution is possible.

**Fix:** Replace with `spawn('ffmpeg', ['-encoders'])` / `spawn('nvidia-smi', ['--query-gpu=index,name', '--format=csv,noheader'])`.

---

## 16. Notable Good Practices

1. **Safe image encoding pipeline:** SVG files explicitly excluded from encoding (`encode.ts:295`), preventing potential SSRF via SVG.

2. **Parameterized queries:** All database interactions use Drizzle ORM with SQL tag templates. No raw string concatenation.

3. **EXIF data sanitization:** `safeString()` in `exif.ts` strips non-printable and control characters from EXIF metadata before storage.

4. **No DOM injection:** Zero instances of `innerHTML`, `outerHTML`, `bypassSecurityTrustHtml`, or `DomSanitizer.bypass*` in the Angular frontend.

5. **No eval/Function:** Zero instances of `eval()`, `Function()`, or `setTimeout(string)` anywhere.

6. **Server-controlled user roles:** `user.type` is set to `input: false` in better-auth config, preventing self-promotion to admin.

7. **Auth context stripped from CORS forwarding:** Auth response headers are purged of CORS-related headers to avoid conflicts with `@fastify/cors` (`server.ts:231-247`).

8. **First-user admin promotion is atomic:** Uses SQLite's serialized transactions — no race condition.

9. **Scope cache with TTL:** `getAccessScope` caches with 60-second TTL, preventing the full scope rebuild on every request.

10. **In-memory auth tokens:** The Angular client stores session tokens in an in-memory `signal` (not localStorage), preventing token theft via XSS.

---

## 17. Recommendation Priority Matrix

| Priority | ID | Issue | Effort | Impact |
|----------|----|-------|--------|--------|
| **P0** | All C-* | Fix authorization gaps in album-file, library-file, album, issues, files routers | 3 days | **Critical** — unlimited read/write access to other users' data |
| **P0** | S-01 | Remove `INTERNAL_TOKEN=changeme` default; fail on missing token | 1 day | **Critical** — full API compromise via default token |
| **P0** | S-02 | Remove committed `.env` files; add to `.gitignore`; use non-guessable sample secrets | 1 day | **Critical** — secrets in version control |
| **P0** | — | Add rate limiting to auth endpoints | 1 day | **Critical** — brute-force and spam prevention |
| **P0** | — | Add Content Security Policy header | 1 day | **Critical** — last line of XSS defense |
| **P1** | S-04/05 | Add `--` separator before user-derived paths in ffmpeg/ffprobe spawn | 1 day | **High** — argument injection prevention |
| **P1** | — | Path traversal protection in asset serving (chroot-style check) | 1 day | **High** — prevent arbitrary file reads |
| **P1** | — | Fix CORS: remove `*` default; require explicit `TRUSTED_ORIGINS` | 1 day | **High** — CSRF and origin scanning |
| **P2** | — | Timing-safe token comparison (`crypto.timingSafeEqual`) | 1 day | **Medium** — token discovery mitigation |
| **P2** | — | Clean up console.log/error in UI (guard with `isDevMode()`) | 1 day | **Medium** — info disclosure |
| **P2** | — | Add stricter input validation (`z.string().uuid()`, path validation) | 2 days | **Medium** — defense in depth |
| **P2** | — | Configure XSRF/CSRF protection in Angular | 1 day | **Medium** — CSRF mitigation |
| **P2** | N | Replace `privateProcedure` usage with appropriate types (`adminProcedure`, `strictPrivateProcedure`) | 2 days | **Medium** — correct authorization model |
| **P3** | — | Add SRI hashes to CDN-loaded Leaflet assets | 1 day | **Low** — supply chain risk |
| **P3** | — | Verify better-auth cookie security attributes | 1 day | **Low** — session protection |
| **P3** | — | Restrict admin `directory.ls` to allowed paths | 1 day | **Low** — admin privilege hardening |
| **P3** | — | Replace `exec()` with `spawn()` in getEncoderInfo | 1 day | **Low** — shell escaping |
| **P3** | — | Set Fastify `bodyLimit` to prevent OOM | 1 day | **Low** — resource exhaustion |

---

## Quick-Fix Checklist (Can Be Done in <1 Hour)

These are single-line or trivial changes with significant security benefit:

- [ ] **Dockerfile.unified:142** — Remove `ENV INTERNAL_TOKEN=changeme` line
- [ ] **api/src/routers/album-file.router.ts:17** — Remove `userId` from destructure or add proper check
- [ ] **api/src/routers/issues.router.ts** — Change `privateProcedure` → `adminProcedure`
- [ ] **api/src/authz/shared-access.ts:44** — Increase `SCOPE_TTL_MS` to `300000` (5 min)
- [ ] **worker/src/encoding/encode.ts:437** — Add `'--'` before file paths in spawn args
- [ ] **worker/src/utils/ffprobe.ts:75** — Add `'--'` before `path` in spawn args
- [ ] **web/src/index.html** — Add CSP `<meta>` tag
- [ ] **api/src/server.ts** — Add `bodyLimit: 1048576` to Fastify constructor

---

## Summary

The most critical finding is the **widespread missing authorization in tRPC procedures**. The `album-file`, `library-file`, `album`, and `issues` routers have procedures that are `privateProcedure` but perform zero access control checks. Combined, an authenticated attacker can read every album, every library, and every file in the system, and can mutate associations at will.

The next tier includes **default secrets** (`INTERNAL_TOKEN=changeme`, `BETTER_AUTH_SECRET=mysecret`), **no rate limiting** on auth, and **no CSP** in the frontend.

The ffmpeg argument injection vector is notable because it's a realistic attack against any shared-media deployment — a crafted filename is all that's needed.

**Immediate action items (this sprint):**
1. Secure all tRPC procedures with access control checks
2. Remove default secrets from Dockerfile and `.env` files
3. Enable rate limiting on auth endpoints
4. Add CSP to the frontend
