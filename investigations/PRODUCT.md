# Product / Correctness Investigation — OpenGallery

> **Status:** open findings only — completed items are removed once fixed.
> **Date:** 2026-05-31. Audited the *current working tree* (heavily modified since `HEAD`).
> Covers data-integrity, worker/watcher reliability, UX correctness, and feature gaps.
> (Security → SECURITY.md; raw perf → PERFORMANCE.md.)

---

## Findings

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
is reasonably complete.

#### Worker lease is single-process-only
`leaseFilesForEncode` (`file-task.router.ts:399`) is a non-transactional SELECT-then-UPDATE — safe **only** with a
single worker. If ever scaled to replicas, two workers can lease the same files. Worth a guard/comment, or convert to
a transactional `UPDATE … RETURNING`. Otherwise the retry/lease logic is sound (stale `in_progress` reclaim after
5 min, `attempts < 3` cap, `reviveDeadEncodeTasks` on boot, terminal `skipped` for undecodable/no-data).

---

## Remediation order (product)
1. **Phase 1 (data integrity):** D8 (atomic mutations — `settings.update` + `updateShares` need transactions).
2. **Phase 3 (polish):** D6 (watch/scan race), D7 (per-owner WS), G6 (dedup cleanup).
3. **Phase 4 (decisions):** D9 (public links — build or correct README), multi-worker lease safety.
