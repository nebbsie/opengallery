import { and, eq, inArray, sql } from "drizzle-orm";
import { FileTaskTable, type FileTaskType } from "../db/schema.js";

// Every task type. The `satisfies` and the check below fail the build when a
// type is added to FileTaskType but not here.
export const FILE_TASK_TYPES = [
  "encode_thumbnail",
  "encode_optimised",
  "video_poster",
  "detect_faces",
  "extract_geolocation",
  "embed_clip",
] as const satisfies readonly FileTaskType[];
type MissingTaskType = Exclude<FileTaskType, (typeof FILE_TASK_TYPES)[number]>;
const allTaskTypesListed: [MissingTaskType] extends [never] ? true : never = true;
void allTaskTypesListed;

// Work a worker can lease: waiting or failed, under the 3-attempt cap.
// Word for word the WHERE of file_task_queue_idx (schema.ts). SQLite uses a
// partial index only when the query repeats its predicate with literals; a
// bound parameter (inArray, eq) does not match, and the query falls back to a
// scan. So keep the literals inline and do not change this text without the
// index.
export const taskQueued = sql`${FileTaskTable.status} IN ('pending', 'failed') AND ${FileTaskTable.attempts} < 3`;

// Work a worker holds now. The type list lets file_task_type_status_idx seek
// (type, status) instead of a scan of the whole table.
export const taskRunning = and(
  inArray(FileTaskTable.type, [...FILE_TASK_TYPES]),
  eq(FileTaskTable.status, "in_progress"),
  sql`${FileTaskTable.attempts} < 3`,
)!;
