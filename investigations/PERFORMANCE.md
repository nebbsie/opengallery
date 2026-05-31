# Performance Investigation — OpenGallery

> **Status:** investigation only — no fixes applied.
> **Date:** 2026-05-31. Audited the *current working tree* (heavily modified since `HEAD`).
> Items marked **FIXED** were open in the May 25 doc but are now resolved.

The big structural P0s from May are **genuinely fixed** (WAL/PRAGMAs, expression sort indexes,
worker + session + scope caching, single-query asset serving). The remaining drag is concentrated
in a handful of hot paths below.

---

## Findings

### 🟠 High

#### P1 — `getAccessScope` loads the ENTIRE `album` + `album_file` tables per non-admin
`api/src/authz/shared-access.ts:104` — for non-admins it runs `db.select(...).from(AlbumTable)` (every album)
**and** `db.select({albumId,fileId}).from(AlbumFileTable)` (every album-file mapping, no WHERE), then builds
in-memory maps. On a 100K-photo library `album_file` can be hundreds of thousands of rows, pulled into Node
on every 60s cache miss / invalidation. The `albumIdsByFileId` map is only needed when `directFileIds` is
non-empty (typically empty).
**Fix:** only load `album_file` when `directFileIds.size > 0`, scoped via `inArray(fileId, [...directFileIds])`;
load albums filtered to accessible libraries instead of the whole table. *(Biggest multi-user win.)*

#### P2 — `album.getAlbumInfo` polled every 5s, unbounded
`web/src/app/album/album-detail/album-detail.ts:99` sets `refetchInterval: 5000`. The procedure
(`api/src/routers/album.router.ts:592`) selects **ALL** files in the album (no `limit`), each with two EXISTS
variant subqueries, ordered by the sort expr, plus subtree count rollup — 720×/hour even when nothing is importing.
**Fix:** poll only while `pendingTasks > 0` (`refetchInterval: () => pending ? 5000 : false`); add `staleTime`;
split import-status counts from the full file list / paginate.

#### P3 — Map fetches ALL location points in one query
`web/src/app/map/map.ts:62` calls `geoLocation.getAllLocations` with no bounds. The query
(`api/src/routers/geo-location.router.ts:74`) groups by **exact** float `(lat, lon)` (so no real clustering)
with two correlated EXISTS subqueries per row, and the client builds all markers up front.
**Fix:** add a viewport-bounded `getInBounds` endpoint (the `getFilesByLocation` bounds pattern already exists);
server-side grid-snap clustering at low zoom; fetch on Leaflet `moveend`.

#### P4 — Image encode decodes the source up to 4×
`worker/src/encoding/encode.ts` — `openImage(path).metadata()` (`:111`), blurhash resize (`:123`),
`renderThumb` (`:195`), `renderOpt` (`:196`) are four independent libvips decodes of the same source.
~30–50% of per-image encode time is redundant decode/I/O — brutal on the flaky USB bridge (see MEMORY).
**Fix:** decode once — derive blurhash from the thumbnail's raw buffer (320px is plenty for 32×32) and read
width/height from the thumbnail/opt `info` instead of a separate `metadata()` pass.

### 🟡 Medium

- **P5 — `file_task` lease query lacks a covering composite index.** `api/src/routers/file-task.router.ts:431`
  runs `WHERE status IN (…) AND type IN (…) AND attempts < 3 GROUP BY fileId ORDER BY MIN(updatedAt) LIMIT n`
  every ~1s, but only single-column `file_task_status_idx` / `file_task_file_id_idx` exist (`schema.ts:546`).
  **Fix:** hand-write a migration (drizzle-kit mangles these — see MEMORY) for `(status, type, attempts, updated_at)`.
- **P6 — Non-admin `/asset` does 1–2 extra DB queries per request.** `shared-access.ts:285` `canUserViewFile`
  does a `LibraryFileTable` then `AlbumFileTable` lookup → 40–160 extra auth queries per gallery scroll on shared
  installs (admins short-circuit). **Fix:** cache per-(user,fileId) decisions briefly, or fold `buildFileAccessFilter`
  into the single variant query.
- **P7 — Infinite-scroll page size still 500.** `gallery-all.ts:94`, `gallery-photos.ts`, `gallery-videos.ts`,
  and prefetch guards all request `limit: 500` (~200–500KB JSON/page for ~20–40 visible tiles). The May "reduce to 60"
  was never applied. **Fix:** drop to 60–100; background-prefetch the next page.
- **P8 — Route-guard prefetch blocks navigation AND has a mismatched cache key.** `web/src/app/prefetch-guards.ts:11`
  `await`s a 500-item `prefetchInfiniteQuery` before returning `true`; its `queryKey: [CacheKey.GalleryAll]` does NOT
  match the component's `[CacheKey.GalleryAll, { seekCursor }]` (`gallery-all.ts:90`), so it pays the cost twice and
  reuses neither. **Fix:** return `true` immediately; align the queryKey so the prefetch is consumed.
- **P9a — No `FileTable.type` index** (`schema.ts:96`); photos/videos views (`files.router.ts:283,649`) filter unindexed.
- **P9b — No SSR despite full SSR infra** — `web/src/app/app.routes.server.ts` is a single `RenderMode.Client` `**`
  route; the SSR server emits an empty shell. **Fix:** prerender login + SSR first gallery page, or drop the SSR server.
- **P9c — No router preloading** (`app.config.ts:28`). **Fix:** `withPreloading(PreloadAllModules)`.
- **P9d — Synchronous SHA-256 hashing inline in the scanner** (`worker/src/watcher/scanner.ts:209`) gates inserts
  during initial import. **Fix:** defer hashing to the encode step / background it / use a faster hash.

### ⚪ Low
- **P10a — Blurhash decoded synchronously on the main thread, no memo** (`web/src/@core/components/blurhash-canvas/blurhash-canvas.ts:43`). **Fix:** cache `Map<hash+size, ImageData>`; consider OffscreenCanvas.
- **P10b — Scroll handler O(n) linear scan + saves scroll state every pixel** (`virtual-thumbnail-grid.ts:990`).
  **Fix:** rAF-throttle, binary-search the cumulative array, debounce the save.

---

## Already FIXED since May 25 (do not re-report)
- **WAL mode / PRAGMAs** — `api/src/db/index.ts:37` sets `journal_mode=WAL`, `synchronous=NORMAL`, `temp_store=MEMORY`,
  `cache_size=-131072`, `mmap_size=256MB`, `busy_timeout=5000`, `optimize`.
- **`coalesce(takenAt, createdAt)` sort index** — `schema.ts:100` adds three expression indexes backed by a
  denormalized `file.takenAt`; `file-sort.ts` writes the sentinel as an inline literal so the index is usable.
- **Worker settings refetch** — `api/src/utils/settings-cache.ts` caches system + per-user settings in-process with
  explicit invalidation; lease path uses `getCachedSystemSettings()`.
- **Session validation per asset** — `api/src/auth/session-cache.ts` caches `getSession` by cookie for 5 min.
- **getAccessScope caching** — per-user 60s cache (`shared-access.ts:44`). *(But see P1 — what it loads is still heavy;
  and PRODUCT.md D1 — it's never invalidated on share changes.)*
- **Asset serving two-query → one-query** — `server.ts:122` with ETag/Last-Modified/304 + range support.

---

## Remediation order (performance)
**Phase 2:** P1 (scope query), P2 (album poll), P4 (single decode), P5/P9a (indexes — hand-written migrations),
P7/P8 (page size + prefetch guard), P3 (map viewport). **Phase 3 polish:** P6, P9b–d, P10a/b.
