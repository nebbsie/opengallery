# Product / Correctness Investigation — OpenGallery

> **Status:** investigation only — no fixes applied.
> **Date:** 2026-05-31. Audited the *current working tree* (heavily modified since `HEAD`).
> Covers data-integrity, worker/watcher reliability, UX correctness, and feature gaps.
> (Security → SECURITY.md; raw perf → PERFORMANCE.md.)

---

## Findings

### 🔴 Critical

#### D1 — Share changes never invalidate the access-scope cache
`api/src/authz/shared-access.ts:46` defines `clearScopeCache(userId?)` "for future use" — but it is
**called nowhere** (grep confirms only the definition exists). `album.updateShares`
(`api/src/routers/album.router.ts:848`) deletes+inserts `SharedItemTable` rows but never clears the cache.
**Impact:** after sharing, the recipient can't see the item for up to 60s; after un-sharing, they *retain
access* for up to 60s (also a security-staleness issue — cross-ref SECURITY.md).
**Fix:** call `clearScopeCache(affectedUserId)` for every added/removed `sharedToUserId` inside `updateShares`
(and any other share mutation).

### 🟠 High

#### D2 — Face detection duplicates faces on retry (data integrity)
`worker/src/face-detection/detect.ts:24` loops over detected faces calling `assignFace` per face and only marks
the `detect_faces` task succeeded at the end. `assignFace` (`api/src/routers/faces.router.ts:249`) **always
INSERTs a new face row** — no dedup on `(fileId, box)`, no "clear existing faces for this file" first. If any face
mid-loop throws, the task is marked `failed` + re-leased (up to 3 attempts), re-detecting from scratch and
re-inserting already-saved faces — inflating `PersonTable.faceCount`, polluting centroids, duplicating avatar crops.
**Fix:** delete existing `FaceTable` rows for `fileId` at the start (recompute affected person counts), or make
per-file detection idempotent/transactional.

#### D3 — Deleted files leave orphaned variant files on disk forever
`deleteFilesWithCascade` (`api/src/utils/file-operations.ts:17`) deletes all DB rows (now incl. faces/persons) but
never `unlink`s the AVIF/MP4 variant files. No reconciliation job exists. Disk fills with orphans over time.
**Fix:** resolve variant paths via `resolveAssetPath` and best-effort `fs.promises.unlink` before deleting
`FileVariantTable` rows (mirror the `reencode` path at `file-task.router.ts:702`); add a periodic orphan sweep.

#### D4 — File content changes silently ignored
`handleFileChanged` (`worker/src/watcher/file-watcher.ts:298`) just calls `handleFileAdded`, which no-ops if the
filename already exists (`:194`). A modified/replaced file keeps its stale thumbnail/EXIF/GPS/hash forever. The
scanner keys on path, not hash (`scanner.ts:197`), so a restart doesn't heal it either.
**Fix:** on change, compare `computeFileHash` to the stored `contentHash`; if different, delete variants + re-queue
encode/geo/faces and refresh metadata. Make the scanner hash-aware.

#### D5 — Scanner re-loads the entire library per folder (quadratic import)
`worker/src/watcher/scanner.ts:258` calls `libraryFile.getAllLibraryFiles(libraryId)`,
`album.getAllAlbumsForLibrary(libraryId)`, and `albumFile.getByAlbumIds(allAlbumIds)` **inside** the per-folder loop —
the whole library, for every folder with new files. On a large initial import (thousands of folders) this is
O(folders × files) and pins the API.
**Fix:** hoist the three lookups out of the loop (load once, maintain maps incrementally).

### 🟡 Medium

- **D6 — Startup-scan vs live-watch race.** `addWatcher` (`file-watcher.ts:55`) `await scan(...)` completes before
  chokidar attaches (`ignoreInitial: true`), so files created mid-scan are missed until the next restart.
  **Fix:** attach the watcher (buffering) before the scan, or add a post-watch reconciliation pass.
- **D7 — WS broadcasts are global, not per-owner.** `wsManager.broadcast` (`api/src/ws-manager.ts:24`) hits every
  connected user. `file:variant-saved` (`files.router.ts:542`) invalidates *every* user's gallery on *anyone's*
  encode; `file:task-completed` (`file-task.router.ts:242,387`) is emitted but **no client handles it** (dead traffic).
  No data leak (queries are server-scoped) but needless refetches. **Fix:** add `broadcastToUser(userId, …)`
  (the map is already keyed by userId); drop the unhandled `task-completed` emit or wire a handler.
- **D8 — Non-atomic mutations.** `settings.update` (`settings.router.ts:98`) does select-then-insert/update with no
  txn (race can duplicate-insert on a fresh DB). `updateShares` (`album.router.ts:891`) deletes-then-inserts with no
  txn (a crash between leaves the item fully unshared). **Fix:** `onConflictDoUpdate` / wrap in `db.transaction`.
- **D-perf cross-refs:** P1 (`getAccessScope` loads whole tables) and P9a (no `FileTable.type` index) live in
  PERFORMANCE.md but touch the same correctness-adjacent code paths.

### Lower-priority / notes
- **G6 — Redundant double-cleanup on delete.** `handleFileDeleted` (`file-watcher.ts:333`) calls `removeFilesById`
  (already cascades) then separately removes album/library rows; same pattern in `scanner.ts:169,188`. Harmless, extra round-trips.

---

## Feature gaps & product decisions

#### D9 — "Public / anonymous share links" do not exist  ⚠️ DECISION NEEDED
The README advertises per-file/per-album public links, but sharing is strictly **user-to-user**
(`SharedItemTable.shareType === "user"`, `accessLevel "view"`). There is no token/anonymous-link table and no
`publicProcedure` share-view endpoint anywhere (grep across api + web found none).
**Open question (deferred):** build the feature, or correct the README? — *to be decided.*

#### "AI analysis" = face detection, not LLM/captioning
The recent "AI analysis" commit is the InsightFace sidecar (`face-service/`): detect → cluster → crop →
merge-suggestions (`migrations/0006_merge_suggestions.sql`). No OpenAI/Anthropic/caption code exists. The pipeline
is reasonably complete; the main correctness gap is D2 (duplicate-on-retry).

#### Worker lease is single-process-only
`leaseFilesForEncode` (`file-task.router.ts:399`) is a non-transactional SELECT-then-UPDATE — safe **only** with a
single worker. If ever scaled to replicas, two workers can lease the same files. Worth a guard/comment, or convert to
a transactional `UPDATE … RETURNING`. Otherwise the retry/lease logic is sound (stale `in_progress` reclaim after
5 min, `attempts < 3` cap, `reviveDeadEncodeTasks` on boot, terminal `skipped` for undecodable/no-data).

---

## Already FIXED since May 25 (do not re-report)
- **G-08** — `getFilesInDir` is now a `.query()` (`files.router.ts:90`).
- **G-01/G-02/G-03** — info-panel restore, cache key, dead TimingMiddleware code.
- **Drizzle expression-index gotcha** — `migrations/0005_wakeful_terrax.sql` hand-writes the `coalesce(...)` indexes;
  `_journal.json` lines up with the on-disk `.sql` files.
- **Encode partial-failure is safe** — `saveVariants` writes thumbnail+optimised together; a pre-`saveVariants`
  failure leaves no orphan DB rows (only a possible orphan video file on disk, re-encoded on retry).

---

## Remediation order (product)
1. **Phase 0:** D1 (wire `clearScopeCache` into share mutations).
2. **Phase 1 (data integrity):** D3 (orphan variants), D2 (face dedup/idempotency), D4 (content-change detection),
   D8 (atomic mutations).
3. **Phase 3 (polish):** D6 (watch/scan race), D7 (per-owner WS), G6 (dedup cleanup), D5 (hoist scanner lookups — also a perf win).
4. **Phase 4 (decisions):** D9 (public links — build or correct README), multi-worker lease safety.
