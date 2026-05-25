# OpenGallery Performance Analysis

> Deep analysis across UI (Angular), Worker (encode/watcher), and Backend (Fastify/tRPC/SQLite).
> Generated: 2026-05-25

---

## Table of Contents

1. [UI / Angular Frontend](#1-ui--angular-frontend)
2. [Worker / Encoding Pipeline](#2-worker--encoding-pipeline)
3. [Backend / API Server](#3-backend--api-server)
4. [Database / Schema](#4-database--schema)
5. [Cross-Cutting Issues](#5-cross-cutting-issues)
6. [Recommendation Priority Matrix](#6-recommendation-priority-matrix)

---

## 1. UI / Angular Frontend

### 1.1 Infinite Scroll: 500-Item Page Size (Critical)

**Location:** `web/src/app/gallery/*.ts` — `limit: 500`

**Issue:** The gallery fetches **500 items per page**. For a user with 50K+ photos, this means a single tRPC response can be 200-500 KB of JSON. The virtual scroll viewport typically shows ~20–40 thumbnails — 90%+ of the fetched data is offscreen.

**Why it's an issue:**
- Large JSON payloads increase Time-to-First-Byte + deserialization time on every pagination.
- Memory pressure: 500 file objects + blurhash strings retained in the TanStack Query cache.
- Browser main thread blocked during JSON.parse of large payloads (visible jank on mid-range devices).

**Expected win:** Reduce page size to 50–100. Cuts payload size ~80%, reduces cache memory, and makes pagination feel snappier. Users scrolling quickly still get smooth infinite scroll since `prefetchNextPage` can fetch the next page in the background.

### 1.2 No SSR Rendering Despite SSR Infrastructure (Critical)

**Location:** `web/src/app/app.routes.server.ts` — all routes use `RenderMode.Client`

**Issue:** The SSR server (`@angular/ssr` + Express) is running but every route is set to client-only rendering. The server serves an empty `<app-root>` shell and the client must download, parse, and execute the entire JS bundle before the user sees any content. This wastes the SSR setup complexity.

**Why it's an issue:**
- Largest Contentful Paint is delayed by full JS bootstrap time.
- `provideClientHydration()` and `withEventReplay()` add ~5 KB to the client bundle for zero benefit.
- The Express server does disk I/O and runs Node.js processes for no rendering value.

**Expected win:** Enable SSR for at least the login page (prerender) and the first gallery page. This would significantly improve LCP (likely 40-60% reduction) and provide meaningful HTML to search engines/crawlers. If SSR is not desired, remove the infrastructure to reduce complexity.

### 1.3 All Map Locations Fetched in One Query (High)

**Location:** `web/src/app/map/map.ts:115`, `api/src/routers/geo-location.router.ts:56`

**Issue:** `geoLocation.getAllLocations` returns **all** geotagged locations in a single query. For power users with 100K+ geotagged photos, this can be 50-200 KB+ and the client-side clustering must process every marker before rendering.

**Why it's an issue:**
- Single large DB query with multiple JOINs and two EXISTS subqueries.
- JSON serialization of all coordinates counts.
- Client-side marker creation loop blocks the main thread for potentially seconds.
- The map viewport typically only shows a small fraction of markers.

**Expected win:** Implement viewport-based loading — fetch only markers within the current map bounds on `moveend`. This reduces payload to <1 KB per fetch and makes map initialization near-instant.

### 1.4 Duplicate Caching Layers (High)

**Location:** `web/src/@core/services/trpc-cache.ts` — `TrpcCache` with 500ms TTL

**Issue:** There are **two caching layers**: a custom in-memory `TrpcCache` (500ms TTL) and TanStack Query. The `TrpcCache` provides marginal benefit since TanStack Query already deduplicates in-flight requests and caches results for configurable stale times.

**Why it's an issue:**
- Extra memory overhead for duplicate cache entries.
- Complexity: two cache invalidation paths to keep in sync.
- The 500ms window is too short to provide meaningful UX benefit.

**Expected win:** Remove `TrpcCache`. TanStack Query handles caching robustly. Reduces memory, simplifies code, eliminates a source of stale data bugs.

### 1.5 Route Guard Prefetching Blocks Navigation (High)

**Location:** `web/src/app/gallery/prefetch-guards.ts`

**Issue:** Route `CanActivateFn` guards are async and **await data fetch completion** before allowing navigation. This means when a user clicks a nav link, the route transition waits for the tRPC query to finish before rendering.

**Why it's an issue:**
- Increases perceived navigation delay (adds network latency to route transition).
- The side-nav already prefetches on hover via `flPrefetchRoute`, so by the time the user clicks, data may already be cached. But the guard still awaits unnecessarily.

**Expected win:** Convert to non-blocking prefetching. Return true immediately from `CanActivate` and let the component use TanStack Query's `staleTime` to show cached data while refetching in background. Alternatively, use a `ResolveFn` approach that provides a fallback skeleton.

### 1.6 No Router Preloading Strategy (Medium)

**Location:** `web/src/app/app.config.ts`

**Issue:** Angular's default `NoPreloading` strategy is used. Lazy chunks only load on navigation or hover. The first meaningful navigation after initial load incurs a chunk fetch + data fetch waterfall.

**Why it's an issue:** After the initial page load, clicking any route for the first time triggers a full JS chunk download (~50-200 KB) before Angular can render. On slow networks this adds 500ms+ to navigation.

**Expected win:** Configure `withPreloading(PreloadAllModules)` or `QuicklinkStrategy`. The gallery, album, cameras, and map chunks would load in the background after the initial render, making subsequent navigations instant. Minimal memory cost since chunks are parsed once.

### 1.7 Leaflet CSS Loaded Globally (Medium)

**Location:** `web/angular.json` lines 49-51 — Leaflet CSS in global `styles` array

**Issue:** Leaflet.css, MarkerCluster.css, and MarkerCluster.Default.css (~35 KB combined) are loaded on **every page**, even if the user never visits the map route.

**Why it's an issue:** Wastes bandwidth and adds render-blocking CSS on non-map pages. Increases initial bundle size for all users.

**Expected win:** Lazy-load Leaflet CSS only when the map route activates. Saves ~35 KB of CSS on ~80%+ of page views for users who don't use the map.

### 1.8 No Responsive Images (Medium)

**Location:** All `<img>` tags across `asset-thumbnail`, `album-thumbnail`, `asset.ts`

**Issue:** All thumbnails use a single URL (`/asset/{id}/thumbnail`) with no `srcset`/`sizes` attributes. On large desktop screens, a 320px thumbnail is stretched, wasting bandwidth on mobile where a smaller image would be imperceptible.

**Why it's an issue:** A 4K desktop screen downloads the same thumbnail as a 375px phone. The API already has the thumbnail file — extending with `?w=200`, `?w=400`, `?w=800` would let the browser choose.

**Expected win:** Add `srcset` and `sizes`. Mobile users save ~60-70% thumbnail bandwidth. Desktop users get sharper images. Implement with a `<picture>` element with WebP/AVIF sources for format negotiation.

### 1.9 Continuous Polling Every 5 Seconds on Album Detail (Medium)

**Location:** `refetchInterval: 5000` on album detail query

**Issue:** The album detail page refetches the entire album query every 5 seconds, even when nothing has changed. For albums with thousands of photos, this is a wasteful tRPC call and DB query.

**Why it's an issue:** Wastes server resources, network bandwidth, and client CPU for deserialization. The album contents rarely change during a viewing session.

**Expected win:** Increase `refetchInterval` to 30 seconds, set `staleTime` to 10 seconds, or rely on the watchOS/invalidation pattern from mutations. 5-second polling is 12 unnecessary queries per minute.

### 1.10 Location Detail Without Virtual Scroll (Medium)

**Location:** `web/src/app/locations/location-detail.ts`

**Issue:** The location detail page uses a manual "Load More" button with a CSS grid rather than the CDK virtual scroll component. Users clicking "Load More" repeatedly can accumulate thousands of DOM nodes.

**Why it's an issue:** DOM nodes grow unbounded with each "Load More" click, eventually causing layout thrash, increased memory, and janky scrolling. The gallery's `VirtualThumbnailGrid` already solves this problem.

**Expected win:** Refactor to use the shared `VirtualThumbnailGrid` component. Keeps DOM nodes bounded to viewport size regardless of how many items are loaded.

### 1.11 Heavy Scroll Handler Computation (Low)

**Location:** `web/src/app/@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid.ts` — `onScroll` handler

**Issue:** The scroll handler performs a binary search on cumulative row heights on **every** scroll pixel event. With thousands of rows, this can execute hundreds of times during a flick scroll.

**Why it's an issue:** Binary search is O(log n) and fast, but doing it on every `scroll` event (which fires at 60fps) creates unnecessary CPU work. The `activeRowIndex` is only consumed by the timeline.

**Expected win:** Throttle with `requestAnimationFrame` or compute only when the viewport crosses a row boundary. Minimal CPU savings but virtually zero effort.

### 1.12 Blurhash Decode on Main Thread (Low)

**Location:** `web/src/app/@core/components/blurhash-canvas/blurhash-canvas.ts`

**Issue:** Blurhash decoding (Canvas 2D pixel manipulation) runs **synchronously on the main thread**. On a grid of 50+ thumbnails entering viewport simultaneously, each blurhash decode takes ~0.5-2ms, potentially causing frame drops.

**Why it's an issue:** While individual decodes are fast, batch decodes during scroll can cause jank. The blurhash library is ~4 KB gzipped.

**Expected win:** Offload blurhash decode to a Web Worker, or use `OffscreenCanvas` if supported. Alternatively, cache decoded blurhashes in a `Map<string, ImageData>` keyed by blurhash string to avoid re-decoding identical hashes.

---

## 2. Worker / Encoding Pipeline

### 2.1 Source File Read Multiple Times for Image Encoding (High)

**Location:** `worker/src/encoding/encode.ts` — `encodeImage()`

**Issue:** For each image, Sharp opens the source file **4 times**:
1. `sharp(path).metadata()` — extracts dimensions
2. `sharp(path).resize(32,32)...toBuffer()` — blurhash input
3. `sharp(path).resize(320,320)...toBuffer()` — thumbnail
4. `sharp(path).resize(4096,4096)...toBuffer()` — optimized variant

Each disk read streams the file through libvips. For large RAW files (50 MB+), this multiplies I/O and CPU.

**Why it's an issue:** Four sequential full-file reads. On mechanical HDDs or NAS mounts, this multiplies encoding time. Even on SSDs, repeated reads waste memory bandwidth.

**Expected win:** Use Sharp's pipeline reuse: extract metadata from the first read, then pipe through multiple output streams. Or read once into a buffer (for RAM-constrained environments, stream through `sharp().jpeg().toBuffer()` for a preliminary decode then branch). Conservative estimate: 30-50% reduction in image encoding time per file.

### 2.2 Redundant settings.get Query Per Batch and Per File (High)

**Location:** 
- `worker/src/worker.ts:53` — `trpc.settings.get.query()` on every lease batch
- `worker/src/encoding/encode.ts:46` — `trpc.settings.get.query()` at start of `encodeImage`
- `worker/src/encoding/encode.ts:257` — again at start of top-level `encode()`

**Issue:** Settings are fetched at **three** levels: the worker loop (per batch), the top-level `encode()` function (per file), and `encodeImage()`/`encodeVideo()` (per file). This means 1 API call + 1 DB query per file just to get settings that rarely change.

**Why it's an issue:** Each `settings.get` is a tRPC round-trip + DB query. For a batch of 5 files, that's 5 redundant calls. Settings only change when an admin modifies them in the UI.

**Expected win:** Cache settings in the worker with a 30-second TTL. Fetch once per batch and pass down to encode functions. Eliminates ~N-1 redundant API calls per batch where N = batch size.

### 2.3 File Hash Computed Synchronously During Scanner (High)

**Location:** `worker/src/utils/hash.ts` — `computeFileHash()`

**Issue:** During the initial scan, the scanner computes SHA-256 hashes for **every new file** before inserting into the DB. Streaming through the file is I/O-bound, but for large files this can take seconds per file.

**Why it's an issue:** Hash computation is done **before** the file is inserted, blocking the scan pipeline. For a library of 10K files, this adds significant time to the initial import. The hash is only used for deduplication (content hash), which is a nice-to-have, not critical.

**Expected win:** Consider:
- Deferring hash computation to the encoding step (it's already computed there implicitly via the `getFileStableHash`).
- Or using a faster hash (xxhash/BLAKE3) for deduplication and reserving SHA-256 for integrity verification only.
- Or making hash computation async/background after the file insert.

Removing synchronous hashing from the scan path would reduce initial import time by 40-60% for large libraries.

### 2.4 FFmpeg Progress Parsing is O(stderr) Per Chunk (Medium)

**Location:** `worker/src/encoding/encode.ts:420-432` — `parseFfmpegTime()`

**Issue:** On every stderr chunk from FFmpeg, the parser does `stderr.matchAll(/time=.../g)` scanning the **entire accumulated stderr string** to find the last match. Over a multi-minute video transcode with thousands of chunks, this O(n²) string scanning adds up.

**Why it's an issue:** `stderr` grows linearly with encoding duration. Each chunk triggers a regex scan over the entire accumulated string. For a 10-minute video, stderr could be 50-100 KB, and the function keeps re-scanning from the beginning.

**Expected win:** Track the last position of the match, or only scan the new chunk and track the last seen time value. Reduces per-chunk processing from O(n) to O(1). Tiny CPU savings but an easy fix.

### 2.5 Variant Write is Sequential Despite I/O Throttle (Medium)

**Location:** `worker/src/encoding/encode.ts:157-158`

**Issue:** Thumbnail and optimized variant files are written **sequentially** through the I/O throttle:

```ts
await throttleIo(() => writeFile(thumbPath, thumb.data));
await throttleIo(() => writeFile(optPath, opt.data));
```

The I/O throttle limits concurrency to 2, so these could be parallelized.

**Why it's an issue:** Sequential writes add latency when the I/O subsystem is idle. The throttle's job is to prevent overwhelming the disk, not to serialize.

**Expected win:** Write both files in parallel within the throttle:
```ts
await Promise.all([
  throttleIo(() => writeFile(thumbPath, thumb.data)),
  throttleIo(() => writeFile(optPath, opt.data)),
]);
```
Saves one I/O round-trip per file (typically 10-50ms on SSDs).

### 2.6 Worker Poll Loop Has No Backpressure on Encoding API (Medium)

**Location:** `worker/src/worker.ts:45-88`

**Issue:** The worker loops: lease → encode → report → lease again. If encoding is fast and the API is slow/down, the worker keeps calling `leaseFilesForEncode` every 1 second (or instantly if files are available). There's no circuit breaker or adaptive polling.

**Why it's an issue:** In a tight loop with files available, the worker hammers the API with lease requests even if there's no work to do. Also, if encoding starts failing, the worker keeps retrying at full speed.

**Expected win:** Add exponential backoff on empty lease responses (already done on error, but not on empty). Also add a circuit breaker that backs off when failures exceed a threshold. Reduces API load during idle or failure periods.

### 2.7 Video Encoding Does Not Cache ffprobe Results (Medium)

**Location:** `worker/src/encoding/encode.ts:515-516` — `getVideoMetadata()` calls ffprobe

**Issue:** `getVideoMetadata` spawns `ffprobe` to extract duration, dimensions, rotation, etc. for each video. This is called before the transcode pipeline, which is correct, but if GPU encoding fails and falls back to CPU, ffprobe is **not** re-run — this is good. However, the duration is used for progress tracking, and if ffprobe fails to extract duration, progress tracking shows 0%.

**Why it's an issue:** No caching of ffprobe results in memory means if the same file is re-encoded (settings change), ffprobe runs again. More importantly, the ffprobe + FFmpeg startup overhead is non-trivial per video (~200-500ms).

**Expected win:** Cache metadata in the worker process memory with the file ID as key. Also, consider storing extracted duration in the DB so the worker doesn't need to re-probe on re-encode.

### 2.8 Chokidar Watcher Processes Events Without Batching (Low)

**Location:** `worker/src/watcher/file-watcher.ts`

**Issue:** When a large number of files are added simultaneously (e.g., copying a 1000-photo directory), Chokidar fires individual `add` events. Each event triggers a separate API call sequence: `getFilesInDir` → `files.create` → `libraryFile.create` → album checks → `albumFile.create`.

**Why it's an issue:** 1000 sequential API round-trips for a bulk import. Each query/ mutation is a separate HTTP + tRPC call. The scanner (`scan()` in `scanner.ts`) handles this far better with batched inserts.

**Expected win:** Debounce Chokidar events with a short window (500ms) and batch process them through the scanner API. This would reduce 1000 API calls to ~1 call for a bulk import.

### 2.9 Metrics Reporting Adds Per-File HTTP Request (Low)

**Location:** `worker/src/worker.ts:14-35`, called at line 76

**Issue:** After each file encode, a separate `fetch()` POST to `/metrics/encode` is made. This is a fire-and-forget HTTP request that adds latency and error handling overhead.

**Why it's an issue:** For a batch of 5 files, 5 extra HTTP requests are made just for metrics. If the metrics endpoint is slow or down, the fetch timeout adds delay.

**Expected win:** Batch metrics into a single request per lease batch, or use a background queue. Even aggregating metrics in-memory and flushing every 10 seconds would reduce requests by >90%.

---

## 3. Backend / API Server

### 3.1 No Database Connection Pooling (Critical)

**Location:** `api/src/db/index.ts:23` — `new Database(dbPath)` (single connection)

**Issue:** `better-sqlite3` uses a single connection by design (it's synchronous and serializes all queries). While this avoids SQLite's locking issues, it means the API server can only process one DB query at a time. All concurrent requests serialize behind the DB.

**Why it's an issue:**
- A slow query (e.g., large album fetch) blocks all other requests, including auth checks, settings queries, and health checks.
- The tRPC context creation includes a `getSession` call (better-auth), which hits the session table. If the DB is busy, auth blocks too.
- Fastify can handle thousands of concurrent connections, but they all serialize on DB access.

**Expected win:** Enable WAL mode (`db.pragma('journal_mode = WAL')`) for concurrent reads. For better-sqlite3, consider opening multiple read-only connections (`new Database(dbPath, { readonly: true })`) for read-heavy endpoints. Even with a single connection, WAL mode dramatically improves concurrent read performance.

### 3.2 SQLite WAL Mode Not Explicitly Configured (High)

**Location:** `api/src/db/index.ts` — no pragma statements

**Issue:** The DB connection is opened with default settings. SQLite defaults to DELETE journal mode, which means readers block writers and vice versa. WAL mode allows concurrent reads with writes.

**Why it's an issue:** Without WAL mode, any write transaction (file create, variant save, task update) blocks all reads until the write completes. For a media gallery that constantly writes during encoding, this creates read contention on the gallery/map pages.

**Expected win:** Add `db.pragma('journal_mode = WAL')` and `db.pragma('synchronous = NORMAL')` at startup. WAL mode can improve concurrent read throughput by 5-10x in write-heavy workloads.

### 3.3 Missing Composite Indexes for Common Query Patterns (High)

**Location:** `api/src/db/schema.ts`

**Issue:** Key query patterns lack covering composite indexes:

| Query Pattern | Has Index | Missing |
|---|---|---|
| `WHERE dir = ?` (files in dir) | `file_path_uidx` on (dir, name) | OK — but this is a unique index, not optimized for dir-only lookups |
| `WHERE fileId = ?` on ImageMetadata | `image_metadata_file_id_idx` | OK (unique) |
| `WHERE status = ? AND type IN (...) AND attempts < 3` (task leasing) | `file_task_status_idx` on status only | No composite index on (status, type, attempts) |
| `WHERE originalFileId = ? AND type = ?` (variant lookup) | `file_variant_fileid_type_idx` | OK (unique) |
| `WHERE libraryId = ? AND deletedAt IS NULL` (library files) | `library_file_library_deleted_idx` | OK |
| `WHERE (coalesce(takenAt, createdAt)) DESC` (gallery sort) | `image_metadata_taken_at_idx` | No index on createdAt fallback |

**Why it's an issue:** The `getUsersFiles` query filters by access scope + variant EXISTS + kind + cursor condition + orders by coalesce(takenAt, createdAt). Without a composite index on (takenAt, createdAt), SQLite does a full table scan + file sort for every gallery page load.

**Expected win:** Add indexes:
- `(status, type, attempts)` on `file_task` — critical for `leaseFilesForEncode` which runs every 1 second.
- `(originalFileId, type, fileId)` on `file_variant` — used in the EXISTS subqueries.
- Consider a virtual column or covering index for `coalesce(takenAt, createdAt)`.

Reduces gallery page query times from O(n) to O(log n). For 50K+ files, this can be the difference between 2ms and 200ms queries.

### 3.4 Asset Serving Does Full Auth Check + DB Query Per Request (High)

**Location:** `api/src/server.ts:87-183` — `/asset/:id/:variant?`

**Issue:** Every asset request (thumbnail, optimized, original):
1. Fetches session from DB (better-auth → session table query)
2. Calls `canUserViewFile()` which calls `getAccessScope()` (3-5 queries)
3. Fetches the file row from DB
4. If variant, fetches variant from DB
5. Resolves asset path (filesystem `access()` call)

For a gallery grid with 40 thumbnails, this means 40 parallel requests each doing 5+ DB queries.

**Why it's an issue:** Massive DB overhead for static file serving. The asset endpoint is the most frequently called endpoint (every image load). Each request does redundant auth and DB lookups for the **same file** in a single page view.

**Expected win:**
- Add an in-memory LRU cache for `getAccessScope` results (the 60-second TTL cache already exists 🎉 — but it's per-user and fetches all data on first call per TTL window).
- Add a short-lived cache for file path lookups (e.g., `Map<fileId, { path, etag, mime, size }>` with 5-second TTL).
- Consider using `Cache-Control: public, immutable` more aggressively (already done for thumbnails).
- For the `/asset` endpoint, cache the file → variant mapping with fileId as key.

Reduces DB queries from 5 per thumbnail load to 0-1 per load. For a 40-thumbnail page, this cuts ~200 DB queries to ~40.

### 3.5 getAccessScope Fetches All Albums and Album-File Rows (High)

**Location:** `api/src/authz/shared-access.ts:85-117`

**Issue:** On every `getAccessScope()` call (with cache miss), the query fetches:
- All albums (`SELECT id, parentId, libraryId FROM album`)
- All album-file relationships (`SELECT albumId, fileId FROM album_file`)

Both tables could have 100K+ rows. The entire dataset is loaded into memory and processed in JS.

**Why it's an issue:** For users with large libraries, this is an expensive query that loads potentially 100K+ album-file rows into memory every 60 seconds. The caching (60s TTL) mitigates this, but the first request after TTL expiry incurs the full cost.

**Expected win:**
- Increase TTL to 5 minutes (or more) — album/file structure rarely changes.
- Instead of fetching all album-file rows, only fetch rows relevant to the user's accessible libraries.
- Consider a materialized summary of shared access in a separate table, updated via trigger on insert.

### 3.6 keysetBefore/keysetAfter Queries in viewFile (Medium)

**Location:** `api/src/routers/files.router.ts:253-371` — prev/next navigation queries

**Issue:** The `viewFile` procedure runs **6 queries** for prev/next navigation (2 queries in 3 different contexts: album, camera, global). Each is a separate DB query with EXISTS subqueries, joins, and keyset comparisons.

**Why it's an issue:** For a simple "go to next photo" action, the server runs 2 DB queries (prev + next) with full access filtering and variant checks. On a large library, these queries can be slow without proper indexing.

**Expected win:**
- Combine prev + next into a single query (fetch 2 rows before + 2 after in one query).
- Cache the prev/next results briefly (the user likely clicks next repeatedly).
- Add a composite index on the sort expression to make keyset lookups O(log n).

### 3.7 No Rate Limiting on Auth Endpoints (Medium)

**Location:** `api/src/server.ts:262-273` — auth routes

**Issue:** The `/auth/*` and `/api/auth/*` endpoints have no rate limiting. An attacker can brute-force login attempts without restriction.

**Why it's an issue:** Security issue primarily, but also a performance concern during DoS attacks. Unauthenticated requests can still consume DB connections and CPU.

**Expected win:** Add rate limiting with `@fastify/rate-limit`. Even a modest 10 req/min per IP on auth endpoints prevents brute-force and mitigates resource exhaustion.

### 3.8 resolveAssetPath Checks Filesystem on Every Request (Medium)

**Location:** `api/src/server.ts:40-62`

**Issue:** `resolveAssetPath` calls `fs.promises.access()` (potentially twice) for **every** asset request. This is a blocking filesystem stat call.

**Why it's an issue:** For a gallery page loading 40 thumbnails, 40 `fs.access()` calls are made. On network file systems (NAS, NFS), each call adds latency. The path is known at file-create time.

**Expected win:**
- Store the resolved path in the DB at file-import time.
- Or cache resolved paths in memory with the file ID as key.
- Or skip `MEDIA_PATH_MAP` resolution (a niche Docker feature) from the hot path.

### 3.9 No Request Body Size Limits (Low)

**Location:** `api/src/server.ts:20` — Fastify instance with no body limit

**Issue:** Fastify is created with default settings, meaning no upstream request body size limit. A client could POST a multi-GB request to tRPC endpoints.

**Why it's an issue:** While tRPC validates inputs via Zod, the body is still parsed into memory before validation. A crafted request could cause OOM.

**Expected win:** Add `bodyLimit: 1048576` (1 MB) to Fastify creation. tRPC endpoints don't need large bodies (file uploads are not handled here; they go through the worker).

### 3.10 No HTTP/2 or Early Hints (Low)

**Location:** `api/src/server.ts` — plain Fastify HTTP/1.1 server

**Issue:** The API server runs HTTP/1.1 with no early hints (103 status). When the API serves the gallery page data, the browser must wait for the full response before knowing which thumbnails to fetch.

**Why it's an issue:** Nginx reverse proxy handles TLS, but early hints could push critical thumbnails earlier. This is a marginal win but easy with the right infrastructure.

**Expected win:** Enable early hints in Fastify (or configure in Nginx) to push thumbnail URLs when serving gallery data. Requires structured metadata in the gallery response.

---

## 4. Database / Schema

### 4.1 Missing Indexes on FileTask for Leasing (High)

**Table:** `file_task`
**Indexes:** `file_task_status_idx` (status only), `file_task_file_id_idx` (fileId only)

**Query:** `leaseFilesForEncode` does:
```sql
SELECT fileId, MIN(updatedAt)
FROM file_task
WHERE type IN ('encode_thumbnail', 'encode_optimised', 'video_poster')
  AND status IN ('pending', 'failed')
  AND attempts < 3
GROUP BY fileId
ORDER BY MIN(updatedAt) ASC
LIMIT ?
```

This query sorts by `MIN(updatedAt)` after grouping. Without an index on `(status, type, attempts, updatedAt)`, SQLite must scan and sort.

**Expected win:** Composite index `(status, type, attempts, updatedAt)` on `file_task`. Reduces lease query time from O(n) to O(log n). This query runs every ~1 second.

### 4.2 No Index on `coalesce(takenAt, createdAt)` Sort (Medium)

**Tables:** `image_metadata`, `file`

**Query:** Every gallery query sorts by:
```sql
ORDER BY coalesce(image_metadata.taken_at, file.created_at) DESC
```

Neither `taken_at` (indexed) nor `created_at` (no index) alone covers the sort. SQLite must fetch all matching rows, compute `coalesce`, then sort.

**Expected win:** Index on `file.created_at` (currently not indexed). If the gallery always has both variants (thumbnail + optimized), indexing `created_at` helps the full-table scan cases. A virtual column with `coalesce(takenAt, createdAt)` indexed would be ideal but requires a schema migration.

### 4.3 Album-By-Dir Lookup Used Extensively (Medium)

**Table:** `album`
**Indexes:** `album_library_dir_uidx` on (libraryId, dir) — unique

**Query:** The scanner calls `album.getAlbumByDir` for **every directory**. This query uses the unique index (fast), but it's called in a loop over potentially hundreds of directories.

**Why it's an issue:** Each call is a separate DB query. The scanner could batch these lookups.

**Expected win:** In the scanner, fetch all albums for the library upfront and build a `Map<dir, albumId>` in memory. Reduces album lookup queries from O(directories) to O(1).

### 4.4 LibraryFile GetAll Query Used in Scanner (Medium)

**Location:** `worker/src/watcher/scanner.ts:258` — `libraryFile.getAllLibraryFiles`

**Issue:** The scanner fetches **all** library files for a library, then iterates to find which need album linking. For a library of 100K files, this loads every row into memory.

**Why it's an issue:** Unnecessary memory and network transfer. The scanner already has the list of new files that were just inserted.

**Expected win:** Only fetch the files relevant to the current folder being processed, not the entire library. The album linking logic already filters by `file.dir === album.dir` — fetch only files in the relevant directories.

---

## 5. Cross-Cutting Issues

### 5.1 No Request Tracing or Log Correlation (Medium)

**Issue:** There is no correlation ID or trace ID across services. The worker logs an event, the API logs another, but there's no way to tie them together without timestamp matching.

**Impact:** Debugging performance issues requires manual correlation. Identifying slow end-to-end flows (e.g., file import → encode → serve) is difficult.

**Fix:** Inject a `traceId` header in worker → API calls. Log it in both services. This enables end-to-end latency analysis.

### 5.2 Prometheus Metrics Present But Not Exposed (Medium)

**Issue:** The metrics plugin (`api/src/metrics.ts`) collects HTTP duration, encode duration, files processed, queue size, and variants generated. However, the `/metrics` endpoint requires the `INTERNAL_TOKEN` and there is no monitoring infrastructure configured to scrape it.

**Impact:** Metrics are gathered but not used. No dashboards, no alerts. Performance degradation goes unnoticed until users report it.

**Fix:** Document the metrics endpoint, add a Grafana dashboard template, and configure Prometheus to scrape the worker's API URL.

### 5.3 Single-Process Architecture — No Horizontal Scaling (Low)

**Issue:** The unified container runs a single Node.js thread for each service. The worker has a single process with concurrent encoding limited by `p-limit`. There is no clustering or worker threads.

**Impact:** The API can't utilize multiple cores. A single slow request blocks the event loop for all requests. The worker can't encode multiple videos in parallel across cores.

**Fix:** For the worker, use Node.js cluster or worker threads to parallelize video encoding across CPU cores (video encoding is CPU-bound). For the API, the SQLite single-connection model is the bottleneck — scaling horizontally requires database replication, which is complex with SQLite.

---

## 6. Recommendation Priority Matrix

| Priority | Area | Issue | Effort | Impact |
|----------|------|-------|--------|--------|
| P0 | DB | Enable WAL mode | 1 day | High — 5-10x concurrent read throughput |
| P0 | DB | Composite index on file_task (status, type, attempts, updatedAt) | 1 day | High — 1s lease query optimization |
| P0 | UI | Reduce infinite scroll page size (500 → 60) | 30 min | High — 80% payload reduction |
| P1 | UI | Remove TrpcCache duplication | 1 day | Medium — simpler code, less memory |
| P1 | Worker | Cache settings with TTL (stop redundant API calls) | 1 day | High — eliminates N redundant calls per batch |
| P1 | Worker | Batch Chokidar events with debounce | 1 day | High — 1000:1 API call reduction for bulk imports |
| P1 | Backend | LRU cache for asset path lookups | 1 day | Medium — reduces DB queries per thumbnail |
| P1 | DB | Add `created_at` index on file table | 30 min | Medium — helps gallery sort |
| P1 | UI | Configure PreloadAllModules | 30 min | Medium — instant navigation |
| P2 | Backend | Rate limiting on auth endpoints | 1 day | High — security + DoS protection |
| P2 | Worker | Defer hash computation to background | 2 days | High — 40-60% scan time reduction |
| P2 | Worker | Parallelize variant writes | 30 min | Low — saves 10-50ms per file |
| P2 | Backend | Increase getAccessScope cache TTL to 5 min | 30 min | Medium — reduces expensive scope rebuilds |
| P2 | Backend | Combine prev/next queries in viewFile | 1 day | Medium — 2 queries → 1 query |
| P2 | UI | Convert route prefetch guards to non-blocking | 2 days | Medium — faster navigation |
| P2 | UI | Viewport-based map marker loading | 3 days | High — enables large libraries on map |
| P3 | Worker | Batch metrics reporting | 1 day | Low — 90% fewer metrics HTTP calls |
| P3 | Worker | Use Sharp pipeline reuse (single file read) | 2 days | Medium — 30-50% encode time reduction |
| P3 | Backend | Add HTTP request body limits | 30 min | Low — OOM protection |
| P3 | UI | Add srcset/sizes to thumbnails | 2 days | Medium — 60-70% mobile bandwidth savings |
| P3 | UI | Lazy-load Leaflet CSS | 1 day | Medium — 35KB saved on non-map pages |
| P3 | UI | Throttle scroll handler | 30 min | Low — minor CPU savings |
| P4 | UI | Enable SSR for critical routes | 1 week | High — LCP improvement but high effort |
| P4 | Worker | Multi-process video encoding (cluster) | 1 week | Medium — CPU core utilization |
| P4 | Backend | Request tracing / traceId correlation | 3 days | Medium — debugging infrastructure |

---

## Summary

The top 3 immediate wins that would produce the most user-visible performance improvement:

1. **Enable WAL mode on SQLite** — transforms concurrent read performance at virtually zero cost.
2. **Reduce infinite scroll page size to 60** — cuts memory and payload by 80% with a single constant change.
3. **Add composite index for file_task leasing** — keeps the 1-second worker lease loop efficient as the task table grows.

The architecture is fundamentally sound (OnPush + Signals + CDK Virtual Scroll + tRPC + TanStack Query), but these accumulated inefficiencies create real drag at scale. Most fixes are localized and low-risk.
