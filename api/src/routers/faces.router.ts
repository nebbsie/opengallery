import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import {
  type SQL,
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  buildFileAccessFilter,
  clearScopeCache,
  getAccessScope,
  isPersonHiddenFor,
  type AccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { fileSortExpr, galleryOrderBy, keysetBefore } from "../db/file-sort.js";
import {
  FaceRejectionTable,
  FaceTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
  PersonTable,
  PersonMergeDismissedTable,
  ViewerHiddenPersonTable,
} from "../db/schema.js";
import {
  adminProcedure,
  internalProcedure,
  privateProcedure,
  router,
} from "../trpc.js";
import { getCachedSystemSettings } from "../utils/settings-cache.js";
import {
  moveViewerRulesToPerson,
  pinViewerHiddenFaces,
} from "../utils/file-operations.js";
import {
  invalidateFaceIndex,
  resolveCurrentModel,
  setPersonInIndexes,
  withFaceLock,
} from "../faces/face-index.js";
import { getVoteThreshold, ingestFileFaces, resolveLibraryId } from "../faces/ingest.js";
import { deletePeopleRows, refreshPeople } from "../faces/people.js";
import { isReclusterRunning, reclusterAll, startAutoRecluster } from "../faces/recluster.js";
import { dot, faceVec, meanVec } from "../faces/vector.js";

// Keyset cursor for listPeoplePage: the (flag, faceCount, id) of the last row
// returned, base64-encoded. Bad/garbled cursors decode to null (treated as the
// first page) rather than throwing.
type PeopleCursor = { flag: number; faceCount: number; id: string };

function encodePeopleCursor(c: PeopleCursor): string {
  return Buffer.from(JSON.stringify([c.flag, c.faceCount, c.id])).toString(
    "base64",
  );
}

function decodePeopleCursor(raw: string | null | undefined): PeopleCursor | null {
  if (!raw) return null;
  try {
    const [flag, faceCount, id] = JSON.parse(
      Buffer.from(raw, "base64").toString("utf8"),
    );
    if (typeof flag !== "number" || typeof faceCount !== "number" || typeof id !== "string")
      return null;
    return { flag, faceCount, id };
  } catch {
    return null;
  }
}

// Matching, regrouping and person upkeep live in api/src/faces/*. This router
// is the tRPC surface over them.

// Merge suggestions: two people whose mean embeddings are at least this close
// (relative to the vote threshold) are checked face by face.
const SUGGEST_CENTROID_OFFSET = 0.04;
// How many centroid-passing pairs to run the (more expensive) member-level
// confirmation on. Bounds DB work while still covering the strongest matches.
const SUGGEST_CANDIDATE_CAP = 60;
// Don't load more than this many clusters per library into the O(n²) centroid
// scan. Real recurring people have the largest clusters, so rank by faceCount and
// consider the top slice.
const SUGGEST_MAX_PEOPLE_PER_LIBRARY = 600;
// Cap how many of a person's faces the member-level check loads.
const MAX_CONFIRM_MEMBERS = 50;
// Unnamed people with fewer photos than this are left off the People page
// unless asked for (Google-style: tiny groups are mostly noise).
const MIN_LISTED_FACES = 3;
// A merge can be undone for this long.
const UNDO_MERGE_MS = 10 * 60 * 1000;

// Canonical (order-independent) key for a pair of person ids, so a dismissal
// applies regardless of which way round the pair was suggested.
function pairKey(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

function parseCentroid(json: string | null): Float32Array | null {
  return faceVec({ embedding: json });
}

const boxInput = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

// Undo state for recent merges, in memory: an API restart drops it, which only
// ends the undo window early.
type MergeUndo = {
  at: number;
  target: { id: string; name: string | null; pinned: boolean; coverFaceId: string | null };
  source: typeof PersonTable.$inferSelect;
  movedFaceIds: string[];
  viewerIds: string[];
  // What the merge added to the target, so undo can take it off again.
  addedRuleViewerIds: string[];
  addedRejectionFaceIds: string[];
};
const mergeUndo = new Map<string, MergeUndo>();

// Undo state for single-face edits (remove, move, new person, review answers):
// a snapshot of the faces, their rejections, and every person they touched.
// In memory, like mergeUndo.
type FaceEditUndo = {
  at: number;
  faces: { id: string; personId: string | null; confirmed: boolean }[];
  rejections: { faceId: string; personId: string }[];
  people: (typeof PersonTable.$inferSelect)[];
  createdPersonId?: string;
};
const faceEditUndo = new Map<string, FaceEditUndo>();

// Take the snapshot before the edit. Caller holds the face lock.
async function snapshotFaceEdit(faceIds: string[], personIds: string[]): Promise<string> {
  const faces = await db
    .select({ id: FaceTable.id, personId: FaceTable.personId, confirmed: FaceTable.confirmed })
    .from(FaceTable)
    .where(inArray(FaceTable.id, faceIds));
  const rejections = await db
    .select({ faceId: FaceRejectionTable.faceId, personId: FaceRejectionTable.personId })
    .from(FaceRejectionTable)
    .where(inArray(FaceRejectionTable.faceId, faceIds));
  const ids = [...new Set([...personIds, ...faces.map((f) => f.personId).filter((p): p is string => !!p)])];
  const people = ids.length
    ? await db.select().from(PersonTable).where(inArray(PersonTable.id, ids))
    : [];
  const token = randomUUID();
  const cutoff = Date.now() - UNDO_MERGE_MS;
  for (const [k, v] of faceEditUndo) if (v.at < cutoff) faceEditUndo.delete(k);
  faceEditUndo.set(token, { at: Date.now(), faces, rejections, people });
  return token;
}

// Load faces by id and check they are all in libraries the admin may change.
async function loadFacesForEdit(faceIds: string[]) {
  const ids = [...new Set(faceIds)];
  const rows = await db
    .select({
      id: FaceTable.id,
      fileId: FaceTable.fileId,
      personId: FaceTable.personId,
      libraryId: LibraryFileTable.libraryId,
    })
    .from(FaceTable)
    .innerJoin(
      LibraryFileTable,
      and(eq(LibraryFileTable.fileId, FaceTable.fileId), isNull(LibraryFileTable.deletedAt)),
    )
    .where(inArray(FaceTable.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (byId.size !== ids.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Face not found" });
  }
  return [...byId.values()];
}

// Put faces on a person as user answers: confirmed, rejections for that
// person cleared, and at most one face per photo (an older face of the same
// person in the same photo is taken off). Caller holds the face lock.
async function putFacesOnPerson(
  faces: { id: string; fileId: string; personId: string | null }[],
  personId: string,
) {
  const now = new Date().toISOString();
  const ids = faces.map((f) => f.id);
  const fileIds = [...new Set(faces.map((f) => f.fileId))];
  const clashes = await db
    .select({ id: FaceTable.id })
    .from(FaceTable)
    .where(
      and(
        eq(FaceTable.personId, personId),
        inArray(FaceTable.fileId, fileIds),
        notInArray(FaceTable.id, ids),
      ),
    );
  if (clashes.length > 0) {
    await db
      .update(FaceTable)
      .set({ personId: null, confirmed: false, updatedAt: now })
      .where(inArray(FaceTable.id, clashes.map((c) => c.id)));
    setPersonInIndexes(clashes.map((c) => c.id), null);
  }
  if (await pinViewerHiddenFaces(fileIds)) clearScopeCache();
  await db
    .update(FaceTable)
    .set({ personId, confirmed: true, updatedAt: now })
    .where(inArray(FaceTable.id, ids));
  await db
    .delete(FaceRejectionTable)
    .where(and(inArray(FaceRejectionTable.faceId, ids), eq(FaceRejectionTable.personId, personId)));
  await db
    .update(PersonTable)
    .set({ pinned: true, updatedAt: now })
    .where(eq(PersonTable.id, personId));
  setPersonInIndexes(ids, personId);
  await refreshPeople([personId, ...faces.map((f) => f.personId).filter((p): p is string => !!p)]);
}

// A non-admin sees a person only through the photos they can see: a person
// with no visible photo, a person hidden from them, or a globally hidden person
// does not exist for them. Every such case throws the same NOT_FOUND as a
// missing id, so a viewer cannot tell that a person is hidden.
const personNotFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Person not found" });

// Ensure the requesting user is allowed to act on a person cluster, returning
// the person row. Admins can act on any cluster (their accessibleLibraryIds only
// covers their own/shared libraries, so we must short-circuit on isAdmin here).
// Pass write=true for mutations: a library shared to the user is view-only, so
// only the owner may change its clusters.
async function loadAuthorizedPerson(
  personId: string,
  scope: AccessScope,
  write = false,
) {
  const [person] = await db
    .select()
    .from(PersonTable)
    .where(eq(PersonTable.id, personId))
    .limit(1);
  if (!person) throw personNotFound();
  if (scope.isAdmin) return person;
  if (isPersonHiddenFor(scope, person.id)) throw personNotFound();
  if (write) {
    if (!scope.ownedLibraryIds.has(person.libraryId)) throw personNotFound();
    return person;
  }
  if (person.hidden) throw personNotFound();
  const [visible] = await viewerPeopleQuery(scope, [eq(PersonTable.id, person.id)]);
  if (!visible) throw personNotFound();
  return person;
}

// People as a non-admin viewer sees them: only people with at least one photo
// the viewer can see, never a person hidden from them or globally hidden. The
// count is the number of photos the viewer gets on the person page (same rules
// as getPersonFiles), and the cover is a face from one of those photos, so a
// count or an avatar never gives away a hidden photo.
function viewerPeopleQuery(scope: AccessScope, extra: SQL[] = []) {
  return db
    .select({
      id: PersonTable.id,
      name: PersonTable.name,
      coverFaceId: sql<string | null>`coalesce(
        max(case when ${FaceTable.id} = ${PersonTable.coverFaceId} then ${FaceTable.id} end),
        min(case when ${FaceTable.cropName} is not null then ${FaceTable.id} end),
        min(${FaceTable.id})
      )`,
      faceCount: sql<number>`count(distinct ${FaceTable.fileId})`,
      hidden: PersonTable.hidden,
    })
    .from(PersonTable)
    .innerJoin(FaceTable, eq(FaceTable.personId, PersonTable.id))
    .where(
      and(
        eq(PersonTable.hidden, false),
        notInArray(
          PersonTable.id,
          db
            .select({ personId: ViewerHiddenPersonTable.personId })
            .from(ViewerHiddenPersonTable)
            .where(eq(ViewerHiddenPersonTable.viewerUserId, scope.userId)),
        ),
        buildFileAccessFilter(scope, FaceTable.fileId),
        exists(
          db
            .select({ _: sql`1` })
            .from(LibraryFileTable)
            .where(
              and(
                eq(LibraryFileTable.fileId, FaceTable.fileId),
                isNull(LibraryFileTable.deletedAt),
              ),
            ),
        ),
        exists(
          db
            .select({ _: sql`1` })
            .from(FileVariantTable)
            .where(
              and(
                eq(FileVariantTable.originalFileId, FaceTable.fileId),
                eq(FileVariantTable.type, "thumbnail"),
              ),
            ),
        ),
        ...extra,
      ),
    )
    .groupBy(PersonTable.id);
}

const peopleNameFlag = sql<number>`CASE WHEN ${PersonTable.name} IS NULL THEN 1 ELSE 0 END`;

// Regroup on its own after enough new faces, or when detection goes idle.
startAutoRecluster();

export const facesRouter = router({
  // --- worker / internal ---------------------------------------------------

  // Reconcile detect_faces tasks against the current library. Idempotent and
  // self-healing, so it's safe (and intended) to run on every worker boot:
  //   1. Delete tasks that target variant outputs (thumbnail/optimised files are
  //      stored as their own type="image" rows by files.saveVariants and must
  //      never be face-scanned — these can never lease and stall the backlog).
  //   2. Seed a task for every original photo and video that doesn't have one.
  //   3. Revive dead tasks (failed at the attempt cap) so a fix to a systemic
  //      failure re-drives them instead of leaving them permanently stuck.
  backfillDetectTasks: internalProcedure.mutation(async () => {
    // 1. Drop bogus tasks on variant outputs.
    const purged = await db
      .delete(FileTaskTable)
      .where(
        and(
          eq(FileTaskTable.type, "detect_faces"),
          exists(
            db
              .select()
              .from(FileVariantTable)
              .where(eq(FileVariantTable.fileId, FileTaskTable.fileId)),
          ),
        ),
      )
      .returning({ id: FileTaskTable.id });

    // 2. Originals only — exclude any file that is the target of a file_variant.
    const images = await db
      .select({ id: FileTable.id })
      .from(FileTable)
      .where(
        and(
          inArray(FileTable.type, ["image", "video"]),
          notExists(
            db
              .select()
              .from(FileVariantTable)
              .where(eq(FileVariantTable.fileId, FileTable.id)),
          ),
        ),
      );

    const rows = images.map((f) => ({
      fileId: f.id,
      type: "detect_faces" as const,
    }));

    // Insert in chunks to stay well under SQLite's variable limit.
    let seeded = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const res = await db
        .insert(FileTaskTable)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoNothing()
        .returning({ id: FileTaskTable.id });
      seeded += res.length;
    }

    // 3. Revive dead tasks so a deploy that fixes the underlying cause re-drives
    //    them. Genuinely-bad files simply re-exhaust their (bounded) attempts.
    const now = new Date().toISOString();
    const revived = await db
      .update(FileTaskTable)
      .set({
        status: "pending",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        progress: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(FileTaskTable.type, "detect_faces"),
          eq(FileTaskTable.status, "failed"),
          sql`${FileTaskTable.attempts} >= 3`,
        ),
      )
      .returning({ id: FileTaskTable.id });

    return { seeded, purged: purged.length, revived: revived.length };
  }),

  // Replace the detected faces of one file with a fresh detection and match
  // them to people (faces/ingest.ts). One call per file, so a retry can never
  // duplicate faces, and answers survive a rescan.
  ingestFileFaces: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        model: z.string().min(1).max(64),
        faces: z
          .array(
            z.object({
              box: boxInput,
              embedding: z.string().min(1),
              detScore: z.number(),
              facePx: z.number(),
              blur: z.number(),
              yaw: z.number(),
            }),
          )
          .max(200),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await ingestFileFaces(input);
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: (e as Error).message });
      }
    }),

  // Record where the worker wrote a face's cropped avatar image on disk.
  setFaceCrop: internalProcedure
    .input(
      z.object({
        faceId: z.string().uuid(),
        cropDir: z.string(),
        cropName: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(FaceTable)
        .set({
          cropDir: input.cropDir,
          cropName: input.cropName,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(FaceTable.id, input.faceId));
      return { ok: true };
    }),

  // Faces that don't yet have an avatar crop on disk, for the worker to backfill
  // from the stored (normalized) box — no re-detection needed. Keyset-paginated by
  // id so persistently-uncroppable faces don't loop forever.
  listFacesMissingCrop: internalProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(async ({ input }) => {
      const where = [isNull(FaceTable.cropName)];
      if (input.cursor) where.push(sql`${FaceTable.id} > ${input.cursor}`);
      const rows = await db
        .select({
          faceId: FaceTable.id,
          fileId: FaceTable.fileId,
          boxX: FaceTable.boxX,
          boxY: FaceTable.boxY,
          boxW: FaceTable.boxW,
          boxH: FaceTable.boxH,
        })
        .from(FaceTable)
        .where(and(...where))
        .orderBy(FaceTable.id)
        .limit(input.limit);
      return rows;
    }),

  // --- web / private -------------------------------------------------------

  // Re-run detection for every photo and video (e.g. after a model upgrade).
  // Faces, people, names and user answers stay: each new face that overlaps an
  // old one in the same photo keeps its row and answers (faces/ingest.ts), and
  // a regroup runs when detection finishes. Admin-only.
  rescanAll: adminProcedure.mutation(async () => {
    const now = new Date().toISOString();
    const tasks = db
      .update(FileTaskTable)
      .set({
        status: "pending",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        progress: null,
        updatedAt: now,
      })
      .where(eq(FileTaskTable.type, "detect_faces"))
      .run();
    return { tasksReset: tasks.changes };
  }),

  // Regroup all faces now (faces/recluster.ts). Runs in the background; poll
  // faces.status for progress.
  recluster: adminProcedure.mutation(async () => {
    if (isReclusterRunning()) return { started: false };
    void reclusterAll().catch(() => undefined);
    return { started: true };
  }),

  status: adminProcedure.query(async () => {
    const count = (where?: SQL) =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(FaceTable)
        .where(where)
        .then((r) => r[0]?.n ?? 0);
    const [faces, unclustered] = await Promise.all([
      count(),
      count(and(isNull(FaceTable.personId), eq(FaceTable.manual, false))),
    ]);
    const [people] = await db
      .select({
        n: sql<number>`count(*)`,
        named: sql<number>`sum(case when ${PersonTable.name} is not null then 1 else 0 end)`,
      })
      .from(PersonTable)
      .where(gt(PersonTable.faceCount, 0));
    const [pending] = await db
      .select({ n: sql<number>`count(*)` })
      .from(FileTaskTable)
      .where(
        and(
          eq(FileTaskTable.type, "detect_faces"),
          inArray(FileTaskTable.status, ["pending", "in_progress"]),
        ),
      );
    const settings = await getCachedSystemSettings();
    return {
      faces,
      people: people?.n ?? 0,
      named: people?.named ?? 0,
      unclustered,
      pendingDetect: pending?.n ?? 0,
      reclusterRunning: isReclusterRunning(),
      lastReclusterAt: settings?.faceLastReclusterAt ?? null,
      model: await resolveCurrentModel(),
    };
  }),

  listPeople: privateProcedure
    .input(z.object({ includeHidden: z.boolean().default(false) }).optional())
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);

      if (!scope.isAdmin) {
        return viewerPeopleQuery(scope).orderBy(
          peopleNameFlag,
          desc(sql`count(distinct ${FaceTable.fileId})`),
          PersonTable.id,
        );
      }

      const libIds = [...scope.accessibleLibraryIds];
      if (libIds.length === 0) return [];

      const where = [inArray(PersonTable.libraryId, libIds), gt(PersonTable.faceCount, 0)];
      if (!input?.includeHidden) where.push(eq(PersonTable.hidden, false));

      const people = await db
        .select({
          id: PersonTable.id,
          name: PersonTable.name,
          coverFaceId: PersonTable.coverFaceId,
          faceCount: PersonTable.faceCount,
          hidden: PersonTable.hidden,
        })
        .from(PersonTable)
        .where(and(...where))
        // Named clusters first, then biggest clusters.
        .orderBy(
          sql`CASE WHEN ${PersonTable.name} IS NULL THEN 1 ELSE 0 END`,
          desc(PersonTable.faceCount),
        );

      return people;
    }),

  // Paginated variant of listPeople for the People page, which can have many
  // thousands of clusters (mostly singletons). Same ordering — named first, then
  // biggest — with keyset pagination so the page loads ~100 at a time on scroll
  // instead of shipping every cluster (and firing an avatar request each) at
  // once. The plain listPeople above still returns all rows for the merge picker.
  listPeoplePage: privateProcedure
    .input(
      z.object({
        includeHidden: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(100),
        cursor: z.string().nullish(),
        // Name contains this text (case-insensitive).
        search: z.string().trim().max(120).optional(),
        filter: z.enum(["all", "named", "unnamed"]).default("all"),
        // Include unnamed people with fewer than MIN_LISTED_FACES photos.
        includeSmall: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);

      // Sort key: named (flag 0) before unnamed (flag 1), then face_count desc,
      // then id asc as a stable tiebreaker for the keyset cursor.
      const flag = peopleNameFlag;
      const cursor = decodePeopleCursor(input.cursor);
      // Rows strictly after the cursor in (flag ASC, faceCount DESC, id ASC).
      const afterCursor = (count: SQL | typeof PersonTable.faceCount) =>
        cursor
          ? sql`(${flag} > ${cursor.flag}
            OR (${flag} = ${cursor.flag} AND ${count} < ${cursor.faceCount})
            OR (${flag} = ${cursor.flag} AND ${count} = ${cursor.faceCount} AND ${PersonTable.id} > ${cursor.id}))`
          : undefined;

      let rows: Array<{
        id: string;
        name: string | null;
        coverFaceId: string | null;
        faceCount: number;
        hidden: boolean;
      }>;
      const filters: SQL[] = [];
      if (input.search) {
        const like = `%${input.search.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        filters.push(sql`lower(${PersonTable.name}) LIKE ${like} ESCAPE '\\'`);
      }
      if (input.filter === "named") filters.push(sql`${PersonTable.name} IS NOT NULL`);
      if (input.filter === "unnamed") filters.push(isNull(PersonTable.name));
      // Small unnamed groups are hidden by default, but never from a search.
      const hideSmall = !input.includeSmall && !input.search;

      if (!scope.isAdmin) {
        // Counts are per viewer (see viewerPeopleQuery), so the keyset runs on
        // the aggregate in HAVING.
        const visibleCount = sql`count(distinct ${FaceTable.fileId})`;
        const havings = [afterCursor(visibleCount)];
        if (hideSmall)
          havings.push(sql`(${PersonTable.name} IS NOT NULL OR ${visibleCount} >= ${MIN_LISTED_FACES})`);
        const having = and(...havings.filter((h): h is SQL => !!h));
        const query = viewerPeopleQuery(scope, filters);
        rows = await (having ? query.having(having) : query)
          .orderBy(flag, desc(visibleCount), PersonTable.id)
          .limit(input.limit + 1);
      } else {
        const libIds = [...scope.accessibleLibraryIds];
        if (libIds.length === 0) return { items: [], nextCursor: null };

        const conds = [inArray(PersonTable.libraryId, libIds), gt(PersonTable.faceCount, 0), ...filters];
        if (!input.includeHidden) conds.push(eq(PersonTable.hidden, false));
        if (hideSmall)
          conds.push(sql`(${PersonTable.name} IS NOT NULL OR ${PersonTable.faceCount} >= ${MIN_LISTED_FACES})`);
        const after = afterCursor(PersonTable.faceCount);
        if (after) conds.push(after);

        rows = await db
          .select({
            id: PersonTable.id,
            name: PersonTable.name,
            coverFaceId: PersonTable.coverFaceId,
            faceCount: PersonTable.faceCount,
            hidden: PersonTable.hidden,
          })
          .from(PersonTable)
          .where(and(...conds))
          .orderBy(flag, desc(PersonTable.faceCount), PersonTable.id)
          .limit(input.limit + 1);
      }

      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        rows.length = input.limit;
        const last = rows[rows.length - 1]!;
        nextCursor = encodePeopleCursor({
          flag: last.name === null ? 1 : 0,
          faceCount: last.faceCount,
          id: last.id,
        });
      }

      return { items: rows, nextCursor };
    }),

  getPerson: privateProcedure
    .input(z.string().uuid())
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const person = await loadAuthorizedPerson(input, scope);
      if (!scope.isAdmin) {
        // Count and cover over the photos this viewer can see.
        const [visible] = await viewerPeopleQuery(scope, [
          eq(PersonTable.id, person.id),
        ]);
        if (!visible) throw personNotFound();
        return visible;
      }
      return {
        id: person.id,
        name: person.name,
        coverFaceId: person.coverFaceId,
        faceCount: person.faceCount,
        hidden: person.hidden,
      };
    }),

  renamePerson: privateProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        // Empty string clears the name (back to an unnamed cluster).
        name: z.string().trim().max(120).nullable(),
      }),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input.id, scope, true);
      const name = input.name && input.name.length > 0 ? input.name : null;
      // Under the face lock: a regroup reads `pinned` once at its start.
      await withFaceLock(() =>
        db
          .update(PersonTable)
          // A named person is user-curated: regrouping keeps its faces fixed.
          .set({ name, ...(name ? { pinned: true } : {}), updatedAt: new Date().toISOString() })
          .where(eq(PersonTable.id, input.id)),
      );
      return { id: input.id, name };
    }),

  setCover: privateProcedure
    .input(z.object({ personId: z.string().uuid(), faceId: z.string().uuid() }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input.personId, scope, true);
      const [face] = await db
        .select({ id: FaceTable.id, personId: FaceTable.personId })
        .from(FaceTable)
        .where(eq(FaceTable.id, input.faceId))
        .limit(1);
      if (!face || face.personId !== input.personId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Face does not belong to this person",
        });
      }
      await db
        .update(PersonTable)
        .set({ coverFaceId: input.faceId, updatedAt: new Date().toISOString() })
        .where(eq(PersonTable.id, input.personId));
      return { ok: true };
    }),

  // Admin-only: hiding a person also hides every photo that contains them from
  // the gallery, timeline and map (see the hidden-person filter applied to the
  // browse queries), so it's a privileged curation action.
  hidePerson: adminProcedure
    .input(z.object({ id: z.string().uuid(), hidden: z.boolean().default(true) }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input.id, scope);
      await withFaceLock(() =>
        db
          .update(PersonTable)
          .set({ hidden: input.hidden, updatedAt: new Date().toISOString() })
          .where(eq(PersonTable.id, input.id)),
      );
      return { ok: true };
    }),

  unhidePerson: adminProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input, scope);
      await db
        .update(PersonTable)
        .set({ hidden: false, updatedAt: new Date().toISOString() })
        .where(eq(PersonTable.id, input));
      return { ok: true as const };
    }),

  // Delete a person: its faces become unclustered (the next regroup may group
  // them again) and the person row goes.
  deletePerson: privateProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input, scope, true);
      await withFaceLock(async () => {
        const faces = await db
          .select({ fileId: FaceTable.fileId })
          .from(FaceTable)
          .where(eq(FaceTable.personId, input));
        const fileIds = [...new Set(faces.map((f) => f.fileId))];
        for (let i = 0; i < fileIds.length; i += 400)
          await pinViewerHiddenFaces(fileIds.slice(i, i + 400));
        await deletePeopleRows([input]);
        invalidateFaceIndex();
      });
      clearScopeCache();
      return { ok: true };
    }),

  // Merge source person into target. The user says these are one person, so
  // the target becomes curated (pinned) and regrouping keeps it whole. Undo is
  // possible for UNDO_MERGE_MS with the returned token. Admin-only.
  mergePeople: adminProcedure
    .input(z.object({ targetId: z.string().uuid(), sourceId: z.string().uuid() }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (input.targetId === input.sourceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge a person into itself" });
      }
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const target = await loadAuthorizedPerson(input.targetId, scope);
      const source = await loadAuthorizedPerson(input.sourceId, scope);
      if (target.libraryId !== source.libraryId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "People are in different libraries" });
      }

      return withFaceLock(async () => {
        const now = new Date().toISOString();
        const moved = await db
          .select({ id: FaceTable.id, fileId: FaceTable.fileId })
          .from(FaceTable)
          .where(eq(FaceTable.personId, input.sourceId));
        const viewers = await db
          .select({ viewerUserId: ViewerHiddenPersonTable.viewerUserId })
          .from(ViewerHiddenPersonTable)
          .where(eq(ViewerHiddenPersonTable.personId, input.sourceId));
        const targetViewers = new Set(
          (
            await db
              .select({ viewerUserId: ViewerHiddenPersonTable.viewerUserId })
              .from(ViewerHiddenPersonTable)
              .where(eq(ViewerHiddenPersonTable.personId, input.targetId))
          ).map((v) => v.viewerUserId),
        );
        const rejectedFrom = async (personId: string) =>
          new Set(
            (
              await db
                .select({ faceId: FaceRejectionTable.faceId })
                .from(FaceRejectionTable)
                .where(eq(FaceRejectionTable.personId, personId))
            ).map((r) => r.faceId),
          );
        const targetRejected = await rejectedFrom(input.targetId);
        const sourceRejected = await rejectedFrom(input.sourceId);

        await db
          .update(FaceTable)
          .set({ personId: input.targetId, updatedAt: now })
          .where(eq(FaceTable.personId, input.sourceId));
        await db
          .update(PersonTable)
          .set({
            // Keep the target's name; adopt source name only if target is unnamed.
            name: target.name ?? source.name,
            pinned: true,
            updatedAt: now,
          })
          .where(eq(PersonTable.id, input.targetId));
        // Rejections of the source carry to the merged person.
        db.$client
          .prepare(
            `INSERT OR IGNORE INTO face_rejection (id, face_id, person_id, created_at)
             SELECT lower(hex(randomblob(16))), face_id, ?, ? FROM face_rejection WHERE person_id = ?`,
          )
          .run(input.targetId, now, input.sourceId);
        // Whoever the source was hidden from keeps the merged person hidden.
        await moveViewerRulesToPerson(input.sourceId, input.targetId);
        await db.delete(PersonTable).where(eq(PersonTable.id, input.sourceId));
        await db
          .delete(PersonMergeDismissedTable)
          .where(
            or(
              eq(PersonMergeDismissedTable.personIdLow, input.sourceId),
              eq(PersonMergeDismissedTable.personIdHigh, input.sourceId),
            ),
          );
        await refreshPeople([input.targetId]);
        setPersonInIndexes(moved.map((m) => m.id), input.targetId);
        clearScopeCache();

        const undoToken = randomUUID();
        const cutoff = Date.now() - UNDO_MERGE_MS;
        for (const [k, v] of mergeUndo) if (v.at < cutoff) mergeUndo.delete(k);
        mergeUndo.set(undoToken, {
          at: Date.now(),
          target: {
            id: target.id,
            name: target.name,
            pinned: target.pinned,
            coverFaceId: target.coverFaceId,
          },
          source,
          movedFaceIds: moved.map((m) => m.id),
          viewerIds: viewers.map((v) => v.viewerUserId),
          addedRuleViewerIds: viewers.map((v) => v.viewerUserId).filter((v) => !targetViewers.has(v)),
          addedRejectionFaceIds: [...sourceRejected].filter((f) => !targetRejected.has(f)),
        });
        return { ok: true as const, undoToken };
      });
    }),

  // Undo a recent merge: the source person comes back with its id, name and
  // faces, and the target gets its old name back.
  undoMerge: adminProcedure
    .input(z.object({ undoToken: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const u = mergeUndo.get(input.undoToken);
      if (!u || Date.now() - u.at > UNDO_MERGE_MS) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This merge can no longer be undone" });
      }
      mergeUndo.delete(input.undoToken);
      await withFaceLock(async () => {
        const now = new Date().toISOString();
        await db.insert(PersonTable).values({ ...u.source, updatedAt: now }).onConflictDoNothing();
        for (let i = 0; i < u.movedFaceIds.length; i += 400) {
          await db
            .update(FaceTable)
            .set({ personId: u.source.id, updatedAt: now })
            .where(
              and(
                inArray(FaceTable.id, u.movedFaceIds.slice(i, i + 400)),
                eq(FaceTable.personId, u.target.id),
              ),
            );
        }
        await db
          .update(PersonTable)
          .set({ name: u.target.name, pinned: u.target.pinned, coverFaceId: u.target.coverFaceId, updatedAt: now })
          .where(eq(PersonTable.id, u.target.id));
        if (u.viewerIds.length > 0) {
          await db
            .insert(ViewerHiddenPersonTable)
            .values(u.viewerIds.map((viewerUserId) => ({ viewerUserId, personId: u.source.id })))
            .onConflictDoNothing();
        }
        if (u.addedRuleViewerIds.length > 0) {
          await db
            .delete(ViewerHiddenPersonTable)
            .where(
              and(
                eq(ViewerHiddenPersonTable.personId, u.target.id),
                inArray(ViewerHiddenPersonTable.viewerUserId, u.addedRuleViewerIds),
              ),
            );
        }
        if (u.addedRejectionFaceIds.length > 0) {
          // The source's own rejection rows were never deleted (no FK), so
          // only the copies on the target go.
          await db
            .delete(FaceRejectionTable)
            .where(
              and(
                eq(FaceRejectionTable.personId, u.target.id),
                inArray(FaceRejectionTable.faceId, u.addedRejectionFaceIds),
              ),
            );
        }
        await refreshPeople([u.source.id, u.target.id]);
        invalidateFaceIndex();
      });
      clearScopeCache();
      return { ok: true as const };
    }),

  // --- single faces ---------------------------------------------------------

  // Faces in one photo, for the viewer's face boxes.
  getFacesForFile: privateProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const [visible] = await db
        .select({ id: FileTable.id })
        .from(FileTable)
        .where(and(eq(FileTable.id, input.fileId), buildFileAccessFilter(scope, FileTable.id)))
        .limit(1);
      if (!visible) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      const rows = await db
        .select({
          faceId: FaceTable.id,
          personId: FaceTable.personId,
          personName: PersonTable.name,
          personHidden: PersonTable.hidden,
          boxX: FaceTable.boxX,
          boxY: FaceTable.boxY,
          boxW: FaceTable.boxW,
          boxH: FaceTable.boxH,
          cropName: FaceTable.cropName,
          manual: FaceTable.manual,
        })
        .from(FaceTable)
        .leftJoin(PersonTable, eq(PersonTable.id, FaceTable.personId))
        .where(eq(FaceTable.fileId, input.fileId));
      return rows
        .filter(
          (r) =>
            scope.isAdmin ||
            !r.personId ||
            (!r.personHidden && !isPersonHiddenFor(scope, r.personId)),
        )
        .map((r) => ({
          faceId: r.faceId,
          personId: r.personId,
          personName: r.personName,
          box: { x: r.boxX, y: r.boxY, width: r.boxW, height: r.boxH },
          hasCrop: !!r.cropName,
          manual: r.manual,
        }));
    }),

  // Faces of one person, newest first, for multi-select on the person page.
  listPersonFaces: privateProcedure
    .input(
      z.object({
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(100),
        cursor: z.string().nullish(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input.personId, scope);
      // Cursor: "<createdAt>|<id>" of the last row.
      const [cAt, cId] = (input.cursor ?? "").split("|");
      const rows = await db
        .select({
          faceId: FaceTable.id,
          fileId: FaceTable.fileId,
          cropName: FaceTable.cropName,
          confirmed: FaceTable.confirmed,
          createdAt: FaceTable.createdAt,
        })
        .from(FaceTable)
        .where(
          and(
            eq(FaceTable.personId, input.personId),
            buildFileAccessFilter(scope, FaceTable.fileId),
            cAt && cId
              ? sql`(${FaceTable.createdAt} < ${cAt} OR (${FaceTable.createdAt} = ${cAt} AND ${FaceTable.id} < ${cId}))`
              : undefined,
          ),
        )
        .orderBy(desc(FaceTable.createdAt), desc(FaceTable.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit);
      const last = items[items.length - 1];
      return {
        items: items.map((r) => ({
          faceId: r.faceId,
          fileId: r.fileId,
          hasCrop: !!r.cropName,
          confirmed: r.confirmed,
        })),
        nextCursor: hasMore && last ? `${last.createdAt}|${last.faceId}` : null,
      };
    }),

  // "This is not X": take faces off their person and remember the answer.
  removeFaces: adminProcedure
    .input(z.object({ faceIds: z.array(z.string().uuid()).min(1).max(5000) }))
    .mutation(async ({ input }) => {
      const faces = await loadFacesForEdit(input.faceIds);
      const undoToken = await withFaceLock(async () => {
        const now = new Date().toISOString();
        const onPerson = faces.filter((f) => f.personId);
        const token = await snapshotFaceEdit(faces.map((f) => f.id), []);
        if (onPerson.length === 0) return token;
        if (await pinViewerHiddenFaces([...new Set(onPerson.map((f) => f.fileId))]))
          clearScopeCache();
        await db
          .insert(FaceRejectionTable)
          .values(onPerson.map((f) => ({ faceId: f.id, personId: f.personId! })))
          .onConflictDoNothing();
        await db
          .update(FaceTable)
          .set({ personId: null, confirmed: false, updatedAt: now })
          .where(inArray(FaceTable.id, onPerson.map((f) => f.id)));
        setPersonInIndexes(onPerson.map((f) => f.id), null);
        await refreshPeople(onPerson.map((f) => f.personId!));
        return token;
      });
      return { ok: true as const, count: faces.length, undoToken };
    }),

  // "This is X": put faces on a person.
  assignFaces: adminProcedure
    .input(
      z.object({
        faceIds: z.array(z.string().uuid()).min(1).max(5000),
        personId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const person = await loadAuthorizedPerson(input.personId, scope);
      const faces = await loadFacesForEdit(input.faceIds);
      if (faces.some((f) => f.libraryId !== person.libraryId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Faces and person are in different libraries" });
      }
      const undoToken = await withFaceLock(async () => {
        const token = await snapshotFaceEdit(faces.map((f) => f.id), [input.personId]);
        await putFacesOnPerson(faces, input.personId);
        return token;
      });
      return { ok: true as const, undoToken };
    }),

  // Make a new person from faces (optionally named).
  createPersonFromFaces: adminProcedure
    .input(
      z.object({
        faceIds: z.array(z.string().uuid()).min(1).max(5000),
        name: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const faces = await loadFacesForEdit(input.faceIds);
      const libraryIds = new Set(faces.map((f) => f.libraryId));
      if (libraryIds.size !== 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Faces are in different libraries" });
      }
      const { personId, undoToken } = await withFaceLock(async () => {
        const token = await snapshotFaceEdit(faces.map((f) => f.id), []);
        const [person] = await db
          .insert(PersonTable)
          .values({
            libraryId: [...libraryIds][0]!,
            name: input.name || null,
            pinned: true,
          })
          .returning({ id: PersonTable.id });
        await putFacesOnPerson(faces, person!.id);
        faceEditUndo.get(token)!.createdPersonId = person!.id;
        return { personId: person!.id, undoToken: token };
      });
      return { personId, undoToken };
    }),

  // "Is this X?" review queue, least certain first: faces the matcher put on
  // a named person but nobody confirmed, and unclustered faces that come close
  // to one. Scored by similarity to the person's confirmed (or all) faces.
  listConfirmCandidates: adminProcedure
    .input(
      z
        .object({
          personId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .optional(),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const limit = input?.limit ?? 30;
      const threshold = await getVoteThreshold();
      const libIds = [...scope.accessibleLibraryIds];
      if (libIds.length === 0) return [];

      const people = await db
        .select({
          id: PersonTable.id,
          name: PersonTable.name,
          libraryId: PersonTable.libraryId,
          centroid: PersonTable.centroid,
        })
        .from(PersonTable)
        .where(
          and(
            inArray(PersonTable.libraryId, libIds),
            input?.personId ? eq(PersonTable.id, input.personId) : sql`${PersonTable.name} IS NOT NULL`,
            gt(PersonTable.faceCount, 0),
          ),
        );
      if (people.length === 0) return [];
      // Only compare embeddings of one model (mid-rescan two are in use).
      const model = await resolveCurrentModel();
      const sameModel = (m: string | null) => (m ?? "buffalo_l") === model;
      const all = await db
        .select({
          id: FaceTable.id,
          fileId: FaceTable.fileId,
          personId: FaceTable.personId,
          vec: FaceTable.vec,
          embedding: FaceTable.embedding,
          model: FaceTable.model,
          confirmed: FaceTable.confirmed,
          cropName: FaceTable.cropName,
        })
        .from(FaceTable)
        .where(inArray(FaceTable.personId, people.map((p) => p.id)));
      const centroids = new Map<string, Float32Array>();
      {
        const byPerson = new Map<string, Float32Array[]>();
        for (const f of all) {
          if (!sameModel(f.model)) continue;
          const v = faceVec(f);
          if (!v) continue;
          const list = byPerson.get(f.personId!) ?? [];
          list.push(v);
          byPerson.set(f.personId!, list);
        }
        for (const [id, vs] of byPerson) {
          const c = meanVec(vs);
          if (c) centroids.set(id, c);
        }
      }
      const personById = new Map(people.map((p) => [p.id, p]));
      const rejected = await db
        .select({ faceId: FaceRejectionTable.faceId, personId: FaceRejectionTable.personId })
        .from(FaceRejectionTable)
        .where(inArray(FaceRejectionTable.personId, people.map((p) => p.id)));
      const rejectedKey = new Set(rejected.map((r) => `${r.faceId}|${r.personId}`));

      // onPerson: the face is on that person now (else it is unclustered).
      type Cand = { faceId: string; fileId: string; personId: string; personName: string | null; score: number; onPerson: boolean };
      const out: Cand[] = [];

      // a) Unconfirmed members, weakest first.
      const members = all.filter((f) => !f.confirmed && f.cropName && sameModel(f.model));
      for (const m of members) {
        const c = centroids.get(m.personId!);
        const v = faceVec(m);
        if (!c || !v || v.length !== c.length) continue;
        const s = dot(v, c);
        // Clearly-matching faces are not worth a question.
        if (s >= threshold + 0.25) continue;
        out.push({ faceId: m.id, fileId: m.fileId, personId: m.personId!, personName: personById.get(m.personId!)!.name, score: s, onPerson: true });
      }

      // b) Unclustered faces close to one of these people.
      const loose = await db
        .select({
          id: FaceTable.id,
          fileId: FaceTable.fileId,
          vec: FaceTable.vec,
          embedding: FaceTable.embedding,
          model: FaceTable.model,
          libraryId: LibraryFileTable.libraryId,
        })
        .from(FaceTable)
        .innerJoin(
          LibraryFileTable,
          and(eq(LibraryFileTable.fileId, FaceTable.fileId), isNull(LibraryFileTable.deletedAt)),
        )
        .where(
          and(
            isNull(FaceTable.personId),
            eq(FaceTable.manual, false),
            isNotNull(FaceTable.cropName),
            inArray(LibraryFileTable.libraryId, libIds),
            or(isNull(FaceTable.quality), gt(FaceTable.quality, 0.2)),
          ),
        );
      for (const f of loose) {
        if (!sameModel(f.model)) continue;
        const v = faceVec(f);
        if (!v) continue;
        let best: { id: string; s: number } | null = null;
        for (const p of people) {
          if (p.libraryId !== f.libraryId) continue;
          const c = centroids.get(p.id);
          if (!c || c.length !== v.length || rejectedKey.has(`${f.id}|${p.id}`)) continue;
          const s = dot(v, c);
          if (!best || s > best.s) best = { id: p.id, s };
        }
        if (best && best.s >= threshold - 0.05) {
          out.push({ faceId: f.id, fileId: f.fileId, personId: best.id, personName: personById.get(best.id)!.name, score: best.s, onPerson: false });
        }
      }

      // Members sit above the threshold and loose faces near it; asking about
      // the ones closest to the line first gets the most out of each answer.
      out.sort((a, b) => Math.abs(a.score - threshold) - Math.abs(b.score - threshold));
      return out.slice(0, limit);
    }),

  confirmFace: adminProcedure
    .input(
      z.object({
        faceId: z.string().uuid(),
        personId: z.string().uuid(),
        verdict: z.enum(["yes", "no"]),
      }),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const person = await loadAuthorizedPerson(input.personId, scope);
      const [face] = await loadFacesForEdit([input.faceId]);
      if (face!.libraryId !== person.libraryId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Face and person are in different libraries" });
      }
      const undoToken = await withFaceLock(async () => {
        const token = await snapshotFaceEdit([input.faceId], [input.personId]);
        if (input.verdict === "yes") {
          await putFacesOnPerson([face!], input.personId);
          return token;
        }
        await db
          .insert(FaceRejectionTable)
          .values({ faceId: input.faceId, personId: input.personId })
          .onConflictDoNothing();
        if (face!.personId === input.personId) {
          if (await pinViewerHiddenFaces([face!.fileId])) clearScopeCache();
          await db
            .update(FaceTable)
            .set({ personId: null, confirmed: false, updatedAt: new Date().toISOString() })
            .where(eq(FaceTable.id, input.faceId));
          setPersonInIndexes([input.faceId], null);
          await refreshPeople([input.personId]);
        }
        return token;
      });
      return { ok: true as const, undoToken };
    }),

  // Undo removeFaces / assignFaces / createPersonFromFaces / confirmFace within
  // UNDO_MERGE_MS: faces, answers and the people they touched go back to how
  // they were (a person deleted because it went empty comes back).
  undoFaceEdit: adminProcedure
    .input(z.object({ undoToken: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const u = faceEditUndo.get(input.undoToken);
      if (!u || Date.now() - u.at > UNDO_MERGE_MS) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This change can no longer be undone" });
      }
      faceEditUndo.delete(input.undoToken);
      await withFaceLock(async () => {
        const now = new Date().toISOString();
        for (const p of u.people) {
          await db.insert(PersonTable).values(p).onConflictDoUpdate({
            target: PersonTable.id,
            set: { name: p.name, pinned: p.pinned, hidden: p.hidden, coverFaceId: p.coverFaceId, updatedAt: now },
          });
        }
        const ids = u.faces.map((f) => f.id);
        const fileIds = (
          await db.select({ fileId: FaceTable.fileId }).from(FaceTable).where(inArray(FaceTable.id, ids))
        ).map((r) => r.fileId);
        if (await pinViewerHiddenFaces([...new Set(fileIds)])) clearScopeCache();
        for (const f of u.faces) {
          await db
            .update(FaceTable)
            .set({ personId: f.personId, confirmed: f.confirmed, updatedAt: now })
            .where(eq(FaceTable.id, f.id));
          setPersonInIndexes([f.id], f.personId);
        }
        await db.delete(FaceRejectionTable).where(inArray(FaceRejectionTable.faceId, ids));
        if (u.rejections.length > 0) {
          await db.insert(FaceRejectionTable).values(u.rejections).onConflictDoNothing();
        }
        const touched = new Set(u.people.map((p) => p.id));
        if (u.createdPersonId) {
          const left = await db
            .select({ id: FaceTable.id })
            .from(FaceTable)
            .where(eq(FaceTable.personId, u.createdPersonId))
            .limit(1);
          if (left.length === 0) await deletePeopleRows([u.createdPersonId]);
        }
        await refreshPeople(touched);
      });
      clearScopeCache();
      return { ok: true as const };
    }),

  // Tag a face the detector missed. It has no embedding, so it never votes in
  // matching, but it shows in the person's photos and in the viewer.
  addManualFace: adminProcedure
    .input(
      z
        .object({
          fileId: z.string().uuid(),
          box: boxInput,
          personId: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(120).optional(),
        })
        .refine((v) => !!v.personId !== !!v.name, "Give either personId or name"),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const libraryId = await resolveLibraryId(input.fileId);
      if (!libraryId) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
      if (input.personId) {
        const person = await loadAuthorizedPerson(input.personId, scope);
        if (person.libraryId !== libraryId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Photo and person are in different libraries" });
        }
      }
      return withFaceLock(async () => {
        let personId = input.personId;
        if (!personId) {
          const [p] = await db
            .insert(PersonTable)
            .values({ libraryId, name: input.name!, pinned: true })
            .returning({ id: PersonTable.id });
          personId = p!.id;
        }
        const [face] = await db
          .insert(FaceTable)
          .values({
            fileId: input.fileId,
            boxX: input.box.x,
            boxY: input.box.y,
            boxW: input.box.width,
            boxH: input.box.height,
            manual: true,
          })
          .returning({ id: FaceTable.id });
        await putFacesOnPerson([{ id: face!.id, fileId: input.fileId, personId: null }], personId);
        return { faceId: face!.id, personId };
      });
    }),

  // Admin-only: find pairs of clusters that look like the same person split in
  // two, so they can be merged from one place (Google-Photos style). Two-phase:
  // a cheap O(n²) centroid pre-filter per library, then a member-level check
  // (one face pair must clear the vote threshold), so a coincidental centroid match doesn't
  // surface a false suggestion. Computed on demand — clusters change rarely and
  // the bounded candidate set keeps this well within a single request.
  listMergeSuggestions: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const libIds = [...scope.accessibleLibraryIds];
      if (libIds.length === 0) return [];

      const threshold = await getVoteThreshold();
      const memberFloor = threshold;
      const centroidFloor = threshold - SUGGEST_CENTROID_OFFSET;

      const people = await db
        .select({
          id: PersonTable.id,
          libraryId: PersonTable.libraryId,
          name: PersonTable.name,
          coverFaceId: PersonTable.coverFaceId,
          faceCount: PersonTable.faceCount,
          centroid: PersonTable.centroid,
        })
        .from(PersonTable)
        .where(
          and(
            inArray(PersonTable.libraryId, libIds),
            gt(PersonTable.faceCount, 0),
          ),
        )
        .orderBy(desc(PersonTable.faceCount))
        .limit(SUGGEST_MAX_PEOPLE_PER_LIBRARY * libIds.length);

      const dismissedRows = await db
        .select({
          low: PersonMergeDismissedTable.personIdLow,
          high: PersonMergeDismissedTable.personIdHigh,
        })
        .from(PersonMergeDismissedTable)
        .where(inArray(PersonMergeDismissedTable.libraryId, libIds));
      const dismissed = new Set(dismissedRows.map((d) => `${d.low}|${d.high}`));

      type P = {
        id: string;
        name: string | null;
        coverFaceId: string | null;
        faceCount: number;
        centroid: Float32Array;
      };
      // People only merge within their own library, so scan per-library.
      const byLibrary = new Map<string, P[]>();
      for (const p of people) {
        const centroid = parseCentroid(p.centroid);
        if (!centroid) continue;
        const list = byLibrary.get(p.libraryId) ?? [];
        list.push({
          id: p.id,
          name: p.name,
          coverFaceId: p.coverFaceId,
          faceCount: p.faceCount,
          centroid,
        });
        byLibrary.set(p.libraryId, list);
      }

      // Phase 1: centroid pre-filter, bounded to the top-faceCount slice so a
      // long singleton tail can't blow up the O(n²) scan.
      type Cand = { a: P; b: P; sim: number };
      const candidates: Cand[] = [];
      for (const list of byLibrary.values()) {
        const pool = list
          .sort((x, y) => y.faceCount - x.faceCount)
          .slice(0, SUGGEST_MAX_PEOPLE_PER_LIBRARY);
        for (let i = 0; i < pool.length; i++) {
          for (let j = i + 1; j < pool.length; j++) {
            const a = pool[i]!;
            const b = pool[j]!;
            // Only ever suggest folding an UNNAMED cluster into a NAMED one.
            // Two unnamed clusters aren't actionable (there's no identity to grow
            // into), and two already-named clusters are left alone — the admin
            // named them deliberately, so don't second-guess that here.
            if (!!a.name === !!b.name) continue;
            const { low, high } = pairKey(a.id, b.id);
            if (dismissed.has(`${low}|${high}`)) continue;
            if (a.centroid.length !== b.centroid.length) continue;
            const sim = dot(a.centroid, b.centroid);
            if (sim >= centroidFloor) candidates.push({ a, b, sim });
          }
        }
      }
      candidates.sort((x, y) => y.sim - x.sim);
      const top = candidates.slice(0, SUGGEST_CANDIDATE_CAP);

      // Phase 2: confirm against the clusters' actual stored faces, not just
      // their mean centroids — the strongest cross-pair member match must clear
      // the same floor a live face needs to join a cluster.
      // Batch all face lookups into one query instead of 2 per candidate.
      const candidatePersonIds = [
        ...new Set(top.flatMap((c) => [c.a.id, c.b.id])),
      ];
      // Window function caps MAX_CONFIRM_MEMBERS per person in SQL so we don't
      // pull the entire face table for popular clusters.
      const placeholders = candidatePersonIds.map(() => "?").join(", ");
      const rawFaceRows = db.$client
        .prepare(
          `SELECT person_id AS personId, embedding, vec, model
           FROM (
             SELECT person_id, embedding, vec, model,
                    ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY created_at DESC) AS rn
             FROM face
             WHERE person_id IN (${placeholders})
           )
           WHERE rn <= ?`,
        )
        .all(...candidatePersonIds, MAX_CONFIRM_MEMBERS) as Array<{
        personId: string;
        embedding: string | null;
        vec: Buffer | null;
        model: string | null;
      }>;
      // Mid-rescan two models are in use: compare only current-model faces.
      const currentModel = await resolveCurrentModel();

      const facesByPerson = new Map<string, Float32Array[]>();
      for (const row of rawFaceRows) {
        const arr = facesByPerson.get(row.personId) ?? [];
        if ((row.model ?? "buffalo_l") !== currentModel) continue;
        const e = faceVec(row);
        if (e) {
          arr.push(e);
          facesByPerson.set(row.personId, arr);
        }
      }

      const confirmed: Cand[] = [];
      for (const c of top) {
        const ae = facesByPerson.get(c.a.id) ?? [];
        const be = facesByPerson.get(c.b.id) ?? [];
        let bestMember = -1;
        for (const x of ae) {
          for (const y of be) {
            if (x.length !== y.length) continue;
            const s = dot(x, y);
            if (s > bestMember) bestMember = s;
          }
        }
        if (bestMember >= memberFloor) confirmed.push(c);
      }

      confirmed.sort((x, y) => y.sim - x.sim);

      // Orient each pair: keep the named cluster (or, failing that, the bigger
      // one) as the merge target and fold the other into it.
      return confirmed.slice(0, input?.limit ?? 20).map((c) => {
        const aIsTarget =
          (!!c.a.name && !c.b.name) ||
          (!!c.a.name === !!c.b.name && c.a.faceCount >= c.b.faceCount);
        const target = aIsTarget ? c.a : c.b;
        const source = aIsTarget ? c.b : c.a;
        const summary = (p: P) => ({
          id: p.id,
          name: p.name,
          coverFaceId: p.coverFaceId,
          faceCount: p.faceCount,
        });
        return {
          similarity: c.sim,
          target: summary(target),
          source: summary(source),
        };
      });
    }),

  // Admin-only: record that two clusters are NOT the same person, so
  // listMergeSuggestions stops offering the pair. Order-independent.
  dismissMergeSuggestion: adminProcedure
    .input(
      z.object({
        personIdA: z.string().uuid(),
        personIdB: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (input.personIdA === input.personIdB) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A suggestion needs two different people",
        });
      }
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const a = await loadAuthorizedPerson(input.personIdA, scope);
      const b = await loadAuthorizedPerson(input.personIdB, scope);
      if (a.libraryId !== b.libraryId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "People are in different libraries",
        });
      }
      const { low, high } = pairKey(input.personIdA, input.personIdB);
      await db
        .insert(PersonMergeDismissedTable)
        .values({ libraryId: a.libraryId, personIdLow: low, personIdHigh: high })
        .onConflictDoNothing();
      return { ok: true };
    }),

  // Paginated grid of photos containing a person. Mirrors camera.getFilesByCamera.
  getPersonFiles: privateProcedure
    .input(
      z.object({
        personId: z.string().uuid(),
        limit: z.number().int().positive().max(200).default(60),
        cursor: z.string().uuid().nullable().optional(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input.personId, scope);

      let cursorCondition: ReturnType<typeof sql> | undefined;
      if (input.cursor) {
        const [cursorRecord] = await db
          .select({ sortTs: fileSortExpr })
          .from(FileTable)
          .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
          .where(eq(FileTable.id, input.cursor))
          .limit(1);
        if (cursorRecord?.sortTs) {
          // Full (sortTs, id) keyset so files sharing the cursor's timestamp
          // (burst shots) are not skipped at a page boundary.
          cursorCondition = keysetBefore(fileSortExpr, cursorRecord.sortTs, input.cursor);
        }
      }

      const rows = await db
        .select({
          file: FileTable,
          libraryId: LibraryFileTable.libraryId,
          libraryFileId: LibraryFileTable.id,
          blurhash: ImageMetadataTable.blurhash,
          width: ImageMetadataTable.width,
          height: ImageMetadataTable.height,
          sortTs: fileSortExpr,
        })
        .from(FaceTable)
        .innerJoin(FileTable, eq(FileTable.id, FaceTable.fileId))
        .innerJoin(LibraryFileTable, eq(LibraryFileTable.fileId, FileTable.id))
        .innerJoin(LibraryTable, eq(LibraryTable.id, LibraryFileTable.libraryId))
        .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
        .where(
          and(
            eq(FaceTable.personId, input.personId),
            buildFileAccessFilter(scope, FileTable.id),
            isNull(LibraryFileTable.deletedAt),
            sql`EXISTS (
              SELECT 1 FROM ${FileVariantTable}
              WHERE ${FileVariantTable.originalFileId} = ${FileTable.id}
              AND ${FileVariantTable.type} = 'thumbnail'
            )`,
            ...(cursorCondition ? [cursorCondition] : []),
          ),
        )
        // One row per file even if the person appears multiple times in it.
        .groupBy(FileTable.id)
        .orderBy(...galleryOrderBy(fileSortExpr))
        .limit(input.limit + 1);

      const data = rows.map((r) => ({
        ...r.file,
        libraryId: r.libraryId,
        libraryFileId: r.libraryFileId,
        blurhash: r.blurhash,
        width: r.width,
        height: r.height,
      }));

      const hasMore = data.length > input.limit;
      const items = hasMore ? data.slice(0, input.limit) : data;
      const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

      return { items, nextCursor };
    }),
});
