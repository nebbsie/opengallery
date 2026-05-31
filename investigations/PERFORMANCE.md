# Performance Investigation — OpenGallery

> **Status:** open TODOs only. P1 & P3 fixed and P2's poll bounded on 2026-05-31; those are dropped from here.
> **Date:** 2026-05-31. Audited the *current working tree* (heavily modified since `HEAD`).

The remaining drag is concentrated in a handful of hot paths below.

---

## Findings

### 🟠 High

#### P2 — `album.getAlbumInfo` selects the full file list unbounded
`api/src/routers/album.router.ts:592` selects **ALL** files in the album (no `limit`), each with two EXISTS
variant subqueries, ordered by the sort expr, plus subtree count rollup. The 5s-poll amplification is already
fixed, but the query itself is still unbounded.
**Fix:** split import-status counts from the full file list / paginate the file query (a larger API +
virtual-grid refactor).

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

## Remediation order (performance)
**Phase 2:** P2 (paginate album file query — poll already fixed), P4 (single decode), P5/P9a (indexes —
hand-written migrations), P7/P8 (page size + prefetch guard). **Phase 3 polish:** P6, P9b–d, P10a/b.
