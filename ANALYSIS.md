# OpenGallery — Security & Performance Analysis

> Generated: 2026-05-25  
> Status key: ✅ Fixed | 🔴 Critical | 🟠 High | 🟡 Medium | ⚪ Low

---

## SECURITY

---

### ✅ S-01 — Admin endpoints accessible by any authenticated user

**Severity:** Critical  
**Files:** `api/src/routers/settings.router.ts`, `directory.router.ts`, `log.router.ts`  
**Status:** Fixed — `adminProcedure` now enforces admin role on all of these.

**What was wrong:**  
`settings.get`, `settings.update`, `settings.getStorageStats`, `settings.getEncoderInfo`, `directory.ls`, and `log.get` all used `privateProcedure`, which only checks that the user is logged in. Any regular account could:
- Read and modify system-wide settings (encoding quality, storage paths, self-registration toggle, GPU config)
- Browse any directory on the server filesystem
- Read all system logs, including error messages containing internal paths and stack traces

**Fix applied:**  
Added `adminProcedure` to `trpc.ts` that requires `session.user.type === "admin"`. All six endpoints now use it. Non-admin users receive `403 FORBIDDEN`.

---

### ✅ S-02 — `directory.ls` allows full server filesystem traversal

**Severity:** Critical  
**File:** `api/src/routers/directory.router.ts`  
**Status:** Fixed (covered by S-01 admin restriction)

**What was wrong:**  
The directory browser accepted any absolute path from the client and returned all entries under it, with no path allowlist or restriction. A logged-in regular user could call `directory.ls` with `/etc`, `/home`, the data directory, or any other path on the server and get a full directory listing. This exposed the entire filesystem to enumeration.

The feature exists so admins can pick media source folders via the UI. It should only ever be reachable by admins.

**Fix applied:**  
`directory.ls` now uses `adminProcedure`.

---

### ✅ S-03 — `/metrics` and `/metrics/encode` had no authentication

**Severity:** High  
**File:** `api/src/metrics.ts`  
**Status:** Fixed — both endpoints now require the `INTERNAL_TOKEN` Bearer header.

**What was wrong:**  
`GET /metrics` (Prometheus scrape endpoint) was publicly accessible with no authentication. Anyone who could reach the API port could read all operational metrics — file counts, encoding durations, queue depths, HTTP request rates — giving a detailed picture of server activity.

`POST /metrics/encode` was also unauthenticated. Any caller could POST arbitrary values to corrupt gauge and counter readings, making observability data unreliable.

**Fix applied:**  
Both endpoints now check the `Authorization: Bearer <INTERNAL_TOKEN>` header and return `401` if it is missing or wrong.

---

### ✅ S-04 — Sessions with null `expiresAt` treated as valid forever

**Severity:** High  
**File:** `api/src/trpc.ts` line 54  
**Status:** Fixed.

**What was wrong:**  
```typescript
// Before
const expired = expiresAt && new Date(expiresAt) <= new Date();
```
If `session.session.expiresAt` was `null` or `undefined`, the expression evaluated to `false` (falsy), making `expired` false, so the session was accepted. A session row with no expiry date could never be revoked by time-based expiry.

**Fix applied:**  
```typescript
// After
const expired = !expiresAt || new Date(expiresAt) <= new Date();
```
Sessions without an expiry date are now treated as expired.

---

### 🔴 S-05 — `INTERNAL_TOKEN` defaults to `changeme` in Docker

**Severity:** Critical  
**File:** `Dockerfile.unified` line 143  
**Status:** Open — requires deployment config change.

**What is wrong:**  
```
ENV INTERNAL_TOKEN=changeme
```
`INTERNAL_TOKEN` is the shared secret between the API and the worker. Any caller who presents this token as a Bearer header is treated as an internal service and can access `internalProcedure` endpoints — which bypass all user authentication and can create/delete files, run bulk imports, and modify library state.

If a user deploys the Docker container without setting `INTERNAL_TOKEN`, the default `changeme` value is active and the internal API is effectively unprotected from anyone who can reach port 4321.

**Recommendation:**  
The `INTERNAL_TOKEN` env var should have no default and the container should refuse to start if it is not set. Add a startup check in `entrypoint.unified.sh`:
```sh
if [ -z "$INTERNAL_TOKEN" ] || [ "$INTERNAL_TOKEN" = "changeme" ]; then
  echo "ERROR: INTERNAL_TOKEN must be set to a secure random value." >&2
  exit 1
fi
```

---

### 🔴 S-06 — `TRUSTED_ORIGINS` defaults to `*` (allow all)

**Severity:** High  
**Files:** `Dockerfile.unified` line 145, `api/src/auth/auth.ts` line 23  
**Status:** Open — requires deployment config change.

**What is wrong:**  
Two separate defaults both allow all origins:

```
# Dockerfile
ENV TRUSTED_ORIGINS=*
```

```typescript
// auth.ts — fallback when env var is not set
const parsedOrigins = rawOrigins ? ... : ["*"];
```

BetterAuth uses `trustedOrigins` to validate where session cookies may be sent from. With `*`, sessions can be initiated and used from any origin — which undermines CSRF protection and means the session cookies are effectively origin-agnostic.

**Recommendation:**  
Remove the `*` fallback in `auth.ts`. Make the app log a warning or refuse to start when `TRUSTED_ORIGINS` is not explicitly configured. Document that the value must be the public URL of the frontend (e.g. `https://mygallery.example.com`).

---

### 🟠 S-07 — First-user admin promotion is not fully atomic

**Severity:** Medium  
**File:** `api/src/auth/auth.ts` lines 43–110  
**Status:** Open.

**What is wrong:**  
When the first user registers, BetterAuth runs a `before` hook (checks `STORAGE_PATH`), creates the user row, then runs an `after` hook that checks for an existing admin and promotes this user if none exists. These three steps are not wrapped in a single transaction. On a concurrent two-request race (two people registering at the exact same millisecond on an empty server), both `after` hooks could see no existing admin and both users could be promoted. SQLite serialises writes, which reduces the window, but the check and the update are still separate statements.

**Recommendation:**  
Wrap the admin check and update in a SQLite transaction with `db.transaction(async tx => { ... })` so the check-and-promote is atomic.

---

### 🟠 S-08 — Admin `users.create` leaks internal error text to callers

**Severity:** Medium  
**File:** `api/src/routers/users.router.ts` lines 154–158  
**Status:** Open.

**What is wrong:**  
When an admin creates a user via the tRPC endpoint, it makes an internal HTTP call to BetterAuth's sign-up endpoint. If that call fails, the raw response body text from BetterAuth is returned directly as the tRPC error message. Internal authentication error messages (which may contain stack traces, database details, or constraint violation text) are forwarded verbatim to the browser.

**Recommendation:**  
Parse the response and return a controlled, sanitised error message rather than forwarding the raw body.

---

### 🟡 S-09 — No rate limiting on authentication endpoints

**Severity:** Medium  
**File:** `api/src/server.ts`  
**Status:** Open.

**What is wrong:**  
The login and registration endpoints (`/auth/sign-in/email`, `/auth/sign-up/email`) have no rate limiting configured. An attacker can make unlimited login attempts, enabling brute-force attacks against user passwords. BetterAuth has a built-in rate limiting plugin but it is not enabled in `auth.ts`.

**Recommendation:**  
Enable BetterAuth's rate limiting plugin or add Fastify `@fastify/rate-limit` in front of the auth routes:
```typescript
// auth.ts
import { betterAuth } from "better-auth";
import { rateLimit } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [rateLimit()],
  ...
});
```

---

### 🟡 S-10 — nginx serves no security headers

**Severity:** Medium  
**File:** `nginx.conf`  
**Status:** Open.

**What is wrong:**  
The nginx reverse proxy does not set any HTTP security headers. This means:
- No `X-Frame-Options` — the app can be embedded in an iframe on any site (clickjacking risk)
- No `X-Content-Type-Options: nosniff` — browsers may MIME-sniff responses
- No `Content-Security-Policy` — XSS protections are weakened
- No `Referrer-Policy` — the full URL is sent in Referer headers to third parties (e.g. the OpenStreetMap tile server used by the map view)

**Recommendation:**  
Add a headers block to the nginx `server {}` section:
```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
```

---

## PERFORMANCE

---

### ✅ P-01 — `getAccessScope` fired 4–8 DB queries on every thumbnail load

**Severity:** Critical  
**File:** `api/src/authz/shared-access.ts`  
**Status:** Fixed — 60-second in-memory cache added.

**What was wrong:**  
`getAccessScope` is called on every request that touches a file. For a non-admin user it ran four parallel DB queries: owned libraries, shared items, all albums, all album-file relationships. The `/asset/:id/:variant?` HTTP endpoint (which serves every thumbnail and image) called `canUserViewFile` which called `getAccessScope` on every single request. A gallery page displaying 500 thumbnails would trigger 500 × 4 = 2,000 DB queries just for authorization.

`viewFile` also called `getAccessScope` twice — once inside `canUserViewFile` and again directly on the next line.

**Fix applied:**  
`getAccessScope` now checks an in-memory `Map` keyed by `userId:isAdmin` before hitting the database. The computed scope is cached for 60 seconds. Within a browsing session, the auth scope is computed once and all subsequent thumbnail loads are cache hits. `clearScopeCache(userId?)` is exported for future use when share state changes.

---

### ✅ P-02 — `resolveAssetPath` blocked the event loop on every file serve

**Severity:** Medium  
**File:** `api/src/server.ts`  
**Status:** Fixed — replaced `fs.existsSync` with `fs.promises.access`.

**What was wrong:**  
`resolveAssetPath` used `fs.existsSync` (a synchronous blocking call) inside an async Fastify route handler. Every image or video served by the API blocked Node's event loop while the OS checked for the file. Under concurrent load, this creates head-of-line blocking: one slow filesystem check holds up all other in-flight requests.

**Fix applied:**  
The function is now `async` and uses `await fs.promises.access(...)` which yields control to the event loop while waiting.

---

### 🔴 P-03 — `getAccessScope` loads ALL albums from the database for every non-admin user

**Severity:** High  
**File:** `api/src/authz/shared-access.ts` lines 85–97  
**Status:** Open (partially mitigated by P-01 cache — first call per 60s still expensive).

**What is wrong:**  
For non-admin users, `getAccessScope` fetches every album and every album-file relationship in the entire system, regardless of whether the user has any connection to them:

```typescript
db.select({ id, parentId, libraryId }).from(AlbumTable)          // ALL albums
db.select({ albumId, fileId }).from(AlbumFileTable)               // ALL album-file rows
```

On a multi-user server with many libraries, this is O(total albums) and O(total album-files) of memory and query time — for every user, on every cache miss. A server with 10 users each having 1,000 albums fetches 10,000 rows to answer "what can user A see?"

**Recommendation:**  
Scope the album queries to only albums accessible to this user by joining through their library memberships and shared items, rather than loading the full table and filtering in application code.

---

### 🔴 P-04 — N+1 HTTP calls per file during bulk import

**Severity:** High  
**File:** `worker/src/watcher/file-watcher.ts` — `handleFileAdded`  
**Status:** Open.

**What is wrong:**  
When a new file is detected, the worker makes 6–8 sequential tRPC round-trips (each an HTTP call to the API) before moving to the next file:

1. `files.getFilesInDir` — check if file already exists
2. `files.create` — create file record
3. `library.getDefaultLibraryIdForUser` — get library ID
4. `libraryFile.create` — link to library
5. `album.getAlbumByDir` — check for existing album
6. `album.create` (if needed)
7. `album.getAlbumByDir` again — re-fetch after creation
8. `albumFile.create` — link to album

For an initial scan of a 10,000-file library, this produces 60,000–80,000 sequential HTTP round-trips. The scan takes many minutes rather than seconds.

**Recommendation:**  
Batch file creation: collect files in a directory during scanning and send them to the API in a single bulk mutation. Cache the default library ID and album-by-dir lookups in memory during a scan rather than re-fetching for each file.

---

### 🟠 P-05 — No index on `FileTable.type` for photo/video filtering

**Severity:** High  
**File:** `api/src/db/schema.ts`  
**Status:** Open.

**What is wrong:**  
`getUsersFiles` and `getTimeline` both filter by `FileTable.type` when the user is browsing Photos-only or Videos-only views. The `type` column has no index, so these queries do a full table scan on the `file` table for every paginated load.

For a library with 100,000 files, a Photos query scans all 100,000 rows to find images, even though a simple index could resolve this instantly.

**Recommendation:**  
Add an index in the schema:
```typescript
export const FileTable = sqliteTable("file", {
  ...
}, (t) => [
  uniqueIndex("file_path_uidx").on(t.dir, t.name),
  index("file_type_idx").on(t.type),           // ← add this
]);
```
Then generate and apply the migration:
```bash
npm run generate && npm run migrate
```

---

### 🟠 P-06 — Encoding settings fetched from the database on every encode job

**Severity:** Medium  
**File:** `worker/src/encoding/encode.ts` lines 46, 495  
**Status:** Open.

**What is wrong:**  
`await trpc.settings.get.query()` is called at the beginning of every image encode and every video encode. During a bulk encoding run of 1,000 files, this fires 1,000 HTTP requests to the API just to retrieve the same settings values (quality levels, GPU toggle, variants path) that almost never change between encodes.

**Recommendation:**  
Cache the settings in the worker process with a short TTL (e.g. 30 seconds):
```typescript
let settingsCache: { value: Settings; expires: number } | null = null;

async function getSettings() {
  if (settingsCache && settingsCache.expires > Date.now()) {
    return settingsCache.value;
  }
  const value = await trpc.settings.get.query();
  settingsCache = { value, expires: Date.now() + 30_000 };
  return value;
}
```

---

### 🟠 P-07 — Two separate Sharp decode passes per image encode

**Severity:** Medium  
**File:** `worker/src/encoding/encode.ts` lines 61, 73  
**Status:** Open.

**What is wrong:**  
`encodeImage` opens the source file with Sharp twice: once to extract width/height metadata, and again to generate the blurhash. For a 50 MB RAW file this means two full decompression passes through the image data.

```typescript
const sharpInstance = sharp(path);              // first decode — metadata only
const metadata = await sharpInstance.metadata();

const smallImg = await sharp(path)              // second decode — blurhash
  .rotate().resize(32, 32)...
```

**Recommendation:**  
Derive the blurhash from the thumbnail that is already being generated, rather than opening the source file a second time. The thumbnail is a 320×320 AVIF — blurhash only needs 32×32 pixels, so downscale from the thumbnail buffer instead:

```typescript
// After generating thumb, derive blurhash from it instead of re-opening source
const smallImg = await sharp(thumb.data)
  .resize(32, 32, { fit: 'inside' })
  .ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
```

---

### 🟡 P-08 — Two correlated EXISTS subqueries per row in file listing and timeline

**Severity:** Low  
**File:** `api/src/routers/files.router.ts` lines 629–650, 541–562  
**Status:** Open.

**What is wrong:**  
Both `getUsersFiles` and `getTimeline` filter out files that don't yet have both a thumbnail and an optimised variant, using two separate correlated EXISTS subqueries:

```sql
EXISTS (SELECT 1 FROM file_variant WHERE original_file_id = file.id AND type = 'thumbnail')
EXISTS (SELECT 1 FROM file_variant WHERE original_file_id = file.id AND type = 'optimised')
```

Each row in the result set triggers two subquery evaluations. With a large library these add measurable overhead, particularly on the timeline query which is always a full-table aggregate.

**Recommendation:**  
Combine into a single subquery using a `HAVING COUNT` check, or join on a per-file variant count:
```sql
-- Single join alternative
INNER JOIN (
  SELECT original_file_id
  FROM file_variant
  WHERE type IN ('thumbnail', 'optimised')
  GROUP BY original_file_id
  HAVING COUNT(DISTINCT type) = 2
) v ON v.original_file_id = file.id
```

---

## GENERAL / CORRECTNESS

---

### ✅ G-01 — Info panel state not restored from localStorage

**File:** `web/src/app/asset/asset.ts`  
**Status:** Fixed — `signal(this.readInfoOpenFromStorage())`.

`readInfoOpenFromStorage()` was defined but never called on initialisation. The signal always started as `false`, so the info panel always opened closed regardless of what the user had left it at. Fixed by initialising the signal from localStorage.

---

### ✅ G-02 — Wrong cache key in `settings-users.ts`

**File:** `web/src/app/settings/settings-users/settings-users.ts`  
**Status:** Fixed — changed from `CacheKey.MediaSourcesSettings` to `CacheKey.SystemSettings`.

The system settings query was stored under the media sources cache key, meaning changes to either settings group could cause stale data to be served from the wrong cache entry.

---

### ✅ G-03 — Dead code in `TimingMiddleware`

**File:** `api/src/trpc.ts`  
**Status:** Fixed — removed.

`if (t._config.isDev && false)` can never execute. The `&& false` makes the condition permanently false. The dev-delay simulation block was removed.

---

### 🔴 G-04 — Deleted files leave orphaned variant files on disk forever

**Severity:** High  
**File:** `api/src/utils/file-operations.ts`  
**Status:** Open.

**What is wrong:**  
`deleteFilesWithCascade` removes file records from the database but never deletes the corresponding files from disk. When a file is removed (because the user deleted it from their source folder), the original stays on disk (it's read-only mounted), but the generated variants — AVIF thumbnail, AVIF optimised image, MP4 transcode — remain in the variants directory permanently.

Over time, on an active library with many changes, the variants directory fills up with files that have no corresponding database record. There is no cleanup job or reconciliation mechanism.

**Recommendation:**  
In `deleteFilesWithCascade`, fetch the variant file paths before deleting the DB rows and then unlink the files on disk:
```typescript
// Before deleting DB rows, get paths
const variantFiles = await db.select({ dir: FileTable.dir, name: FileTable.name })
  .from(FileTable)
  .where(inArray(FileTable.id, variantFileIds));

// After DB deletion
for (const f of variantFiles) {
  await unlink(join(f.dir, f.name)).catch(() => {});
}
```

---

### 🔴 G-05 — File content changes are silently ignored by the watcher

**Severity:** High  
**File:** `worker/src/watcher/file-watcher.ts` line 298  
**Status:** Open.

**What is wrong:**  
`handleFileChanged` delegates entirely to `handleFileAdded`:
```typescript
private async handleFileChanged(filePath, userId, rootPath) {
  await this.handleFileAdded(filePath, userId, rootPath);
}
```
`handleFileAdded` checks whether the filename already exists in the database and does nothing if it does. So when a file on disk is modified — its content changes, its EXIF data is updated, it is replaced with a new version — nothing happens. The old thumbnail, old metadata, and old GPS coordinates remain in the database permanently.

**Recommendation:**  
`handleFileChanged` should detect that the file exists, compare the content hash, and if changed: delete the existing variants, re-queue encoding, and update metadata.

---

### 🟠 G-06 — Redundant double-cleanup in `handleFileDeleted`

**Severity:** Medium  
**File:** `worker/src/watcher/file-watcher.ts` lines 329–340  
**Status:** Open.

**What is wrong:**  
When a file is deleted, the watcher calls:
1. `trpc.files.removeFilesById` → calls `deleteFilesWithCascade` → already deletes `AlbumFileTable` and `LibraryFileTable` rows for the file
2. Then separately calls `trpc.albumFile.removeAlbumFilesById` on the same file
3. Then separately calls `trpc.libraryFile.removeLibraryFilesById` on the same file

Steps 2 and 3 operate on rows that step 1 already deleted. They silently do nothing but still fire HTTP calls to the API on every file deletion.

**Recommendation:**  
Remove the redundant calls to `albumFile.removeAlbumFilesById` and `libraryFile.removeLibraryFilesById` from `handleFileDeleted`. `deleteFilesWithCascade` already handles this cleanup.

---

### 🟠 G-07 — `settings.update` upsert is not atomic

**Severity:** Medium  
**File:** `api/src/routers/settings.router.ts` lines 88–118  
**Status:** Open.

**What is wrong:**  
The procedure checks whether a `SystemSettingsTable` row exists, then either updates or inserts. These are two separate statements with no transaction wrapping them:
```typescript
const [existing] = await db.select().from(SystemSettingsTable).limit(1);
if (existing) {
  await db.update(...);
} else {
  await db.insert(...);  // could race with another insert
}
```
Two concurrent settings updates on a fresh database could both see no row and both attempt to insert, causing a constraint violation or duplicate rows.

**Recommendation:**  
Use a single `INSERT ... ON CONFLICT DO UPDATE` (upsert) statement, which SQLite handles atomically:
```typescript
await db.insert(SystemSettingsTable)
  .values({ ...defaults, ...input })
  .onConflictDoUpdate({ target: SystemSettingsTable.id, set: { ...input } });
```

---

### 🟡 G-08 — `getFilesInDir` is registered as a mutation instead of a query

**Severity:** Low  
**File:** `api/src/routers/files.router.ts` line 72  
**Status:** Open.

**What is wrong:**  
```typescript
getFilesInDir: privateProcedure
  .input(z.string())
  .mutation(...)   // ← wrong: this is a read operation
```
tRPC mutations use HTTP POST and are not cached by TanStack Query. `getFilesInDir` only reads data and should be a `.query()`. Using `.mutation()` means this endpoint cannot be cached, deduplicated, or subscribed to by the client, and it semantically misrepresents the operation.

**Recommendation:**  
Change `.mutation(` to `.query(` for `getFilesInDir`.

---

## Summary

| ID | Area | Severity | Status | Description |
|---|---|---|---|---|
| S-01 | Security | 🔴 Critical | ✅ Fixed | Admin endpoints accessible by any user |
| S-02 | Security | 🔴 Critical | ✅ Fixed | Filesystem traversal via `directory.ls` |
| S-03 | Security | 🟠 High | ✅ Fixed | `/metrics` endpoints unauthenticated |
| S-04 | Security | 🟠 High | ✅ Fixed | Null session expiry treated as valid |
| S-05 | Security | 🔴 Critical | Open | `INTERNAL_TOKEN` defaults to `changeme` |
| S-06 | Security | 🟠 High | Open | `TRUSTED_ORIGINS` defaults to `*` |
| S-07 | Security | 🟠 Medium | Open | First-user admin promotion race condition |
| S-08 | Security | 🟠 Medium | Open | Admin create-user leaks error text |
| S-09 | Security | 🟡 Medium | Open | No rate limiting on auth endpoints |
| S-10 | Security | 🟡 Medium | Open | nginx serves no security headers |
| P-01 | Performance | 🔴 Critical | ✅ Fixed | `getAccessScope` called per thumbnail load |
| P-02 | Performance | 🟠 Medium | ✅ Fixed | Sync `fs.existsSync` blocking event loop |
| P-03 | Performance | 🔴 High | Open | `getAccessScope` loads all albums globally |
| P-04 | Performance | 🔴 High | Open | N+1 API calls per file during bulk import |
| P-05 | Performance | 🟠 High | Open | No index on `FileTable.type` |
| P-06 | Performance | 🟠 Medium | Open | Settings fetched from DB on every encode |
| P-07 | Performance | 🟠 Medium | Open | Two Sharp decode passes per image |
| P-08 | Performance | 🟡 Low | Open | Redundant EXISTS subqueries in file listing |
| G-01 | Correctness | 🟠 Medium | ✅ Fixed | Info panel state not restored from localStorage |
| G-02 | Correctness | 🟡 Low | ✅ Fixed | Wrong cache key in `settings-users.ts` |
| G-03 | Correctness | ⚪ Low | ✅ Fixed | Dead code in `TimingMiddleware` |
| G-04 | Correctness | 🔴 High | Open | Deleted files leave orphaned variants on disk |
| G-05 | Correctness | 🔴 High | Open | File changes silently ignored by watcher |
| G-06 | Correctness | 🟠 Medium | Open | Double-cleanup in `handleFileDeleted` |
| G-07 | Correctness | 🟠 Medium | Open | `settings.update` upsert not atomic |
| G-08 | Correctness | 🟡 Low | Open | `getFilesInDir` registered as mutation not query |
