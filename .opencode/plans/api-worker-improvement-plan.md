# OpenGallery API & Worker Improvement Plan

> Generated: January 15, 2026

## Executive Summary

This plan addresses significant performance issues and code quality problems in the `/api` and `/worker` directories. The most critical issues are:

1. **N+1 queries** in the API layer (causing slow album pages)
2. **Synchronous file I/O** in the worker (blocking the event loop)
3. **Unbounded concurrency** in encoding (can exhaust system resources)
4. **Missing database indexes** (slow queries)
5. **Code duplication** across both codebases

---

## Phase 1: Critical Performance Fixes (High Priority)

### 1.1 Fix N+1 Queries in Album Router

**File:** `api/src/routers/album.router.ts`

| Location | Problem | Solution |
|----------|---------|----------|
| Lines 235-265 | Individual cover query per album in `getUsersAlbums` | Single query with `GROUP BY albumId` and `MIN(fileId)` |
| Lines 405-424 | Walking parent chain one-by-one in `getAlbumInfo` | Fetch all ancestors in single query |
| Lines 513-542 | Individual cover query per child in `getAlbumInfo` | Batch with `GROUP BY` |
| Lines 616-627 | Per-album file existence check in `removeEmptyUnderDir` | Single query with `LEFT JOIN` and `COUNT` |

**Expected Impact:** Album list/detail pages go from O(n) queries to O(1)

### 1.2 Fix N+1 Query in File Task Router

**File:** `api/src/routers/file-task.router.ts`

| Location | Problem | Solution |
|----------|---------|----------|
| Lines 142-171 | Per-item status update in loop (`setManyStatusByFileAndType`) | Batch update with transaction |

### 1.3 Optimize `viewFile` Pagination

**File:** `api/src/routers/files.router.ts`

| Location | Problem | Solution |
|----------|---------|----------|
| Lines 361-384 | Loads ALL file IDs to find prev/next | Use cursor-based approach or window functions |

### 1.4 Add Missing Database Indexes

**File:** `api/src/db/schema.ts`

```typescript
// Indexes to add:
LibraryFileTable: index on (libraryId), index on (fileId)
AlbumFileTable: index on (albumId), index on (fileId)
ImageMetadataTable: index on (fileId), index on (takenAt)
FileTaskTable: index on (status), index on (fileId)
GeoLocationTable: index on (fileId)
LogTable: index on (createdAt)
```

**Expected Impact:** 5-50x faster queries on tables with many rows

---

## Phase 2: Worker Performance Fixes (High Priority)

### 2.1 Fix Synchronous I/O in Encoder

**File:** `worker/src/encoding/encode.ts`

| Line | Current | Change |
|------|---------|--------|
| 44 | `readFileSync(path)` | Use Sharp's file path directly: `sharp(path)` |
| 89-90 | `readFileSync` | `await fs.promises.readFile()` |
| 118-119 | `writeFileSync` | `await fs.promises.writeFile()` |

### 2.2 Fix Synchronous I/O in Scanner

**File:** `worker/src/watcher/scanner.ts`

| Line | Current | Change |
|------|---------|--------|
| 49 | `readdirSync` | `await fs.promises.readdir()` |
| 81 | `statSync` | `await fs.promises.stat()` |

**Expected Impact:** Non-blocking event loop, significantly better throughput

### 2.3 Add Concurrency Limiting

**File:** `worker/src/worker.ts`

```typescript
// Add p-limit to control concurrent encoding
import pLimit from 'p-limit';

const limit = pLimit(encodingConcurrency);
await Promise.allSettled(files.map((id) => limit(() => encode(id))));
```

**Expected Impact:** Prevents memory exhaustion, predictable resource usage

---

## Phase 3: Code Quality & Deduplication (Medium Priority)

### 3.1 Create Shared Utilities in Worker

**New file:** `worker/src/utils/paths.ts`

```typescript
export function toContainerPath(p: string): string
export function toHostPath(p: string): string
export function getFullPath(dir: string, name: string): string
```

Currently duplicated in:
- `encode.ts` (lines 35-41, 362-368)
- `file-watcher.ts` (lines 68-74)
- `scanner.ts` (lines 29-33)

### 3.2 Create Media Types Utility in Worker

**New file:** `worker/src/utils/media-types.ts`

```typescript
export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']);
export const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
export const ALLOWED_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
export function getMediaType(ext: string): 'image' | 'video' | null
export function isSupportedFile(name: string): boolean
```

Currently duplicated in:
- `file-watcher.ts` (lines 18-31)
- `scanner.ts` (lines 10-18)

### 3.3 Refactor Worker Files to Use New Utils

**Files to update:**
- `encode.ts` - remove 2 duplicate `toContainerPath` functions
- `file-watcher.ts` - remove `toContainerPath`, media type sets, `getMediaType`
- `scanner.ts` - remove `toHostPath`, media type sets, `getMediaType`

### 3.4 Create Shared Utilities in API

**New file:** `api/src/utils/file-operations.ts`

```typescript
export async function deleteFilesWithCascade(db, fileIds: string[]): Promise<void>
export async function computeAlbumCovers(db, albumIds: string[]): Promise<Record<string, string | null>>
```

Deduplicates from `files.router.ts` lines 71-132 and 135-210

### 3.5 Create Task Helpers in API

**New file:** `api/src/utils/task-helpers.ts`

```typescript
export function buildTaskStatusUpdate(status: FileTaskStatus, error?: string): TaskUpdate
```

Deduplicates from `file-task.router.ts` lines 38-54, 93-118, 142-171

### 3.6 Refactor files.router.ts

Use the new `deleteFilesWithCascade` utility to remove duplicated deletion logic.

### 3.7 Fix Upsert Patterns

**Files to update:**
- `api/src/routers/image-metadata.router.ts` (lines 25-73)
- `api/src/routers/geo-location.router.ts` (lines 16-50)
- `api/src/routers/ui-settings.router.ts` (lines 9-93)

Replace select-then-insert/update pattern with Drizzle's `onConflictDoUpdate`:

```typescript
await db.insert(Table).values(data).onConflictDoUpdate({
  target: Table.id,
  set: { ...updates }
});
```

---

## Phase 4: Error Handling (Medium Priority)

### 4.1 Fix Silent Failures in Encoder

**File:** `worker/src/encoding/encode.ts`

| Lines | Current | Fix |
|-------|---------|-----|
| 187, 506 | `console.warn()` | `logger.warn()` |
| 192 | Empty catch `{}` | Add `logger.warn('Failed to resolve issue', { fileId })` |
| 274-276 | Empty catch `{}` | Add `logger.error()` with context |
| 331-333 | Empty catch `{}` | Add `logger.error()` with context |
| 509-511 | Empty catch `{}` | Add `logger.warn()` with context |

### 4.2 Fix Silent Failure in EXIF Parser

**File:** `worker/src/utils/exif.ts`

| Lines | Current | Fix |
|-------|---------|-----|
| 67-68 | Silent return undefined | Add `logger.debug('EXIF parse failed', { error })` |

### 4.3 Implement or Remove Empty Mutations

**File:** `api/src/routers/issues.router.ts`

Lines 36-53: `record` and `resolveForFile` mutations accept input but do nothing.

Options:
1. Implement properly (insert/update IssueTable)
2. Remove if not needed

---

## Phase 5: Type Safety (Low Priority)

### 5.1 Create Proper EXIF Types

**New file:** `worker/src/types/exif-data.ts`

```typescript
export interface ExifData {
  DateTimeOriginal?: Date | string;
  CreateDate?: Date | string;
  ModifyDate?: Date | string;
  Make?: string;
  Model?: string;
  LensModel?: string;
  ISO?: number;
  ExposureTime?: number;
  FocalLength?: number;
  FNumber?: number;
  latitude?: number;
  longitude?: number;
}
```

Update `exif.ts` to use this interface instead of `as any` (14 occurrences at lines 37-53)

### 5.2 Fix Types in File Task Router

**File:** `api/src/routers/file-task.router.ts`

Replace `any` types at lines 40, 95, 104, 146, 156 with proper Drizzle types.

### 5.3 Fix Types in Log Router

**File:** `api/src/routers/log.router.ts`

Replace `any` casts at lines 19, 21, 42 with typed SQL conditions.

---

## Phase 6: Security & Access Control (Medium Priority)

### 6.1 Restrict User Listing to Admins

**File:** `api/src/routers/users.router.ts`

Lines 25-28: `getAll` procedure allows any authenticated user to list all users.

**Fix:** Add admin role check or use `strictPrivateProcedure`.

### 6.2 Add Ownership Checks to Library File Router

**File:** `api/src/routers/library-file.router.ts`

- `create` (lines 8-27): Doesn't validate user owns the library
- `getAllLibraryFiles` (lines 29-46): Doesn't validate user owns the library

**Fix:** Add ownership verification before operations.

### 6.3 Add Ownership Checks to Album File Router

**File:** `api/src/routers/album-file.router.ts`

- `create` (lines 8-19): Doesn't validate user owns the album
- `removeAlbumFilesById` (lines 21-28): Doesn't validate user owns the albums

**Fix:** Add ownership verification before operations.

---

## Phase 7: Unit Testing (Medium Priority)

### 7.1 Setup Vitest

**Packages to add:**
- `api/`: `vitest`, `@vitest/coverage-v8`
- `worker/`: `vitest`, `@vitest/coverage-v8`

**Config files to create:**
- `api/vitest.config.ts`
- `worker/vitest.config.ts`

### 7.2 API Utility Tests

**New file:** `api/src/__tests__/utils/file-operations.test.ts`
- Test `deleteFilesWithCascade` properly cleans up all related records
- Test `computeAlbumCovers` returns correct cover mappings

**New file:** `api/src/__tests__/utils/task-helpers.test.ts`
- Test `buildTaskStatusUpdate` sets correct timestamps based on status

### 7.3 Worker Utility Tests

**New file:** `worker/src/__tests__/utils/paths.test.ts`
- Test `toContainerPath` with/without HOST_ROOT_PREFIX env var
- Test `toHostPath` inverse transformation
- Test `getFullPath` path joining

**New file:** `worker/src/__tests__/utils/media-types.test.ts`
- Test extension detection for all supported types
- Test `isSupportedFile` with valid/invalid files
- Test `getMediaType` returns correct type

### 7.4 Album Router Tests

**New file:** `api/src/__tests__/routers/album.router.test.ts`
- Test `getUsersAlbums` returns correct covers in single query
- Test `getAlbumInfo` returns correct ancestor chain
- Test `getAlbumInfo` returns correct children with covers

### 7.5 Encoder Tests

**New file:** `worker/src/__tests__/encoding/encode.test.ts`
- Test image encoding produces correct thumbnail dimensions
- Test image encoding produces correct optimized dimensions
- Test blurhash generation works correctly
- Test video poster frame extraction

---

## Task Summary

| ID | Task | Priority | Status |
|----|------|----------|--------|
| 1 | Fix N+1 queries in album.router.ts | High | **Completed** |
| 2 | Fix N+1 query in file-task.router.ts | High | **Completed** |
| 3 | Optimize viewFile pagination in files.router.ts | High | **Completed** |
| 4 | Add missing database indexes to schema.ts | High | **Completed** |
| 5 | Fix synchronous I/O in encode.ts | High | **Completed** |
| 6 | Fix synchronous I/O in scanner.ts | High | **Completed** |
| 7 | Add concurrency limiting to worker.ts | High | **Completed** |
| 8 | Create worker/src/utils/paths.ts | Medium | **Completed** |
| 9 | Create worker/src/utils/media-types.ts | Medium | **Completed** |
| 10 | Refactor worker files to use new utils | Medium | **Completed** |
| 11 | Create api/src/utils/file-operations.ts | Medium | **Completed** |
| 12 | Create api/src/utils/task-helpers.ts | Medium | **Completed** |
| 13 | Refactor files.router.ts to use deleteFilesWithCascade | Medium | **Completed** |
| 14 | Fix upsert patterns in routers | Medium | **Completed** |
| 15 | Fix silent failures in encode.ts | Medium | **Completed** |
| 16 | Fix silent failure in exif.ts | Medium | **Completed** |
| 17 | Implement or remove empty mutations in issues.router.ts | Medium | **Completed** |
| 18 | Create worker/src/types/exif-data.ts and fix exif.ts types | Low | **Completed** |
| 19 | Fix any types in file-task.router.ts | Low | **Completed** |
| 20 | Fix any types in log.router.ts | Low | **Completed** |
| 21 | Add admin check to users.router.ts getAll | Medium | **Completed** |
| 22 | Add ownership checks to library-file.router.ts | Medium | **Completed** |
| 23 | Add ownership checks to album-file.router.ts | Medium | **Completed** |
| 24 | Setup Vitest in api/ and worker/ | Medium | Pending |
| 25 | Write unit tests for api utils | Medium | Pending |
| 26 | Write unit tests for worker utils | Medium | Pending |
| 27 | Write unit tests for album.router.ts | Medium | Pending |
| 28 | Write unit tests for encode.ts | Medium | Pending |

---

## Expected Outcomes

| Area | Improvement |
|------|-------------|
| Album pages | **10-100x faster** (N+1 fixes) |
| Query performance | **5-50x faster** on large datasets (indexes) |
| Worker throughput | **Significantly improved** (async I/O) |
| Stability | **No memory exhaustion** (concurrency limits) |
| Maintainability | **Much better** (shared utils, fewer duplicates) |
| Reliability | **Improved** (proper error logging) |
| Test coverage | **Good foundation** for future changes |

---

## Implementation Order

Execute in this order for maximum impact:

1. Phase 1.1 - Fix N+1 queries (Very High impact)
2. Phase 1.4 - Add indexes (High impact, Low effort)
3. Phase 2.1-2.3 - Fix worker sync I/O + concurrency (High impact)
4. Phase 1.2-1.3 - Remaining N+1 fixes (High impact)
5. Phase 4 - Fix error handling (Medium impact, Low effort)
6. Phase 3 - Code deduplication (Medium impact)
7. Phase 7 - Unit tests (Medium impact)
8. Phase 6 - Access control (Medium impact, Low effort)
9. Phase 5 - Type safety (Low impact)
