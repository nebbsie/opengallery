import { TRPCError } from "@trpc/server";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, exists, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildFileAccessFilter,
  getAccessScope,
  type AccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { fileSortExpr, galleryOrderBy } from "../db/file-sort.js";
import {
  FaceTable,
  FileTable,
  FileTaskTable,
  FileVariantTable,
  ImageMetadataTable,
  LibraryFileTable,
  LibraryTable,
  PersonTable,
  PersonMergeDismissedTable,
  SystemSettingsTable,
} from "../db/schema.js";
import {
  adminProcedure,
  internalProcedure,
  privateProcedure,
  router,
} from "../trpc.js";
import { getCachedSystemSettings } from "../utils/settings-cache.js";
import { removeFacesForFiles } from "../utils/file-operations.js";

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

// Cosine similarity in [-1, 1]. Scale-invariant, so it works whether or not the
// embeddings are unit-normalized. Higher = more similar.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Default cosine-similarity threshold for joining a face to an existing person.
// Overridden per-instance by SystemSettingsTable.faceMatchThreshold (Settings →
// Faces). Higher = stricter (fewer false merges, more fragmentation, which is
// fixable via mergePeople). Tuned for ArcFace (buffalo_l) normed embeddings,
// where same-person cosine sits well above different-person.
const DEFAULT_FACE_MATCH_THRESHOLD = 0.4;
// A candidate must beat the runner-up cluster by at least this margin, otherwise
// the match is ambiguous (two clusters look about equally similar) and we start a
// new cluster rather than guess wrong.
const MATCH_MARGIN = 0.05;
// Beyond the centroid check, confirm against the cluster's *actual* stored faces:
// its single most-similar member must score at least (threshold − this). Guards
// against a drifted/blurred centroid quietly absorbing a different person.
const MEMBER_CONFIRM_OFFSET = 0.05;
// Cap how many of a cluster's faces we load for that confirmation check.
const MAX_CONFIRM_MEMBERS = 50;

// --- merge suggestions ---
// Two clusters whose mean embeddings are at least this similar are offered as a
// "might be the same person" suggestion. Set just below the per-face match
// threshold: clusters this close should plausibly have ended up as one person and
// usually stayed split only because of the margin/member gates in assignFace.
const SUGGEST_CENTROID_THRESHOLD = 0.36;
// How many centroid-passing pairs to run the (more expensive) member-level
// confirmation on. Bounds DB work while still covering the strongest matches.
const SUGGEST_CANDIDATE_CAP = 60;
// Don't load more than this many clusters per library into the O(n²) centroid
// scan. Real recurring people have the largest clusters, so rank by faceCount and
// consider the top slice; the singleton-noise tail below the cut is skipped.
const SUGGEST_MAX_PEOPLE_PER_LIBRARY = 600;

// Canonical (order-independent) key for a pair of person ids, so a dismissal
// applies regardless of which way round the pair was suggested.
function pairKey(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

// Resolve the configured match threshold, falling back to the default.
async function getFaceMatchThreshold(): Promise<number> {
  const row = await getCachedSystemSettings();
  return row?.faceMatchThreshold ?? DEFAULT_FACE_MATCH_THRESHOLD;
}

function parseEmbedding(json: string | null): number[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as number[]) : null;
  } catch {
    return null;
  }
}

// Resolve the (non-deleted) library a file belongs to. Faces are clustered
// per-library so people stay scoped to their owner.
async function resolveLibraryId(fileId: string): Promise<string | null> {
  const [row] = await db
    .select({ libraryId: LibraryFileTable.libraryId })
    .from(LibraryFileTable)
    .where(
      and(eq(LibraryFileTable.fileId, fileId), isNull(LibraryFileTable.deletedAt)),
    )
    .limit(1);
  return row?.libraryId ?? null;
}

// Ensure the requesting user is allowed to act on a person cluster, returning
// the person row. Admins can act on any cluster (their accessibleLibraryIds only
// covers their own/shared libraries, so we must short-circuit on isAdmin here).
// Throws NOT_FOUND/FORBIDDEN otherwise.
async function loadAuthorizedPerson(personId: string, scope: AccessScope) {
  const [person] = await db
    .select()
    .from(PersonTable)
    .where(eq(PersonTable.id, personId))
    .limit(1);
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
  if (!scope.isAdmin && !scope.accessibleLibraryIds.has(person.libraryId)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return person;
}

export const facesRouter = router({
  // --- worker / internal ---------------------------------------------------

  // Reconcile detect_faces tasks against the current library. Idempotent and
  // self-healing, so it's safe (and intended) to run on every worker boot:
  //   1. Delete tasks that target variant outputs (thumbnail/optimised files are
  //      stored as their own type="image" rows by files.saveVariants and must
  //      never be face-scanned — these can never lease and stall the backlog).
  //   2. Seed a task for every original image that doesn't have one.
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
          eq(FileTable.type, "image"),
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

  // Clustering core: attach a detected face to the best-matching person in the
  // same library, or create a new cluster. Centroid is the running mean of the
  // cluster's embeddings for cheap matching as the library grows.
  assignFace: internalProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        embedding: z.array(z.number()),
        box: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
        detScore: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const libraryId = await resolveLibraryId(input.fileId);
      if (!libraryId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No library for file ${input.fileId}`,
        });
      }

      const threshold = await getFaceMatchThreshold();

      const people = await db
        .select({
          id: PersonTable.id,
          centroid: PersonTable.centroid,
          faceCount: PersonTable.faceCount,
        })
        .from(PersonTable)
        .where(eq(PersonTable.libraryId, libraryId));

      // Rank clusters by centroid similarity: track the best and runner-up so we
      // can require a confident margin between them.
      let best: { id: string; sim: number; faceCount: number } | null = null;
      let secondBestSim = -1;
      for (const p of people) {
        const centroid = parseEmbedding(p.centroid);
        if (!centroid) continue;
        const sim = cosineSimilarity(input.embedding, centroid);
        if (!best || sim > best.sim) {
          secondBestSim = best?.sim ?? secondBestSim;
          best = { id: p.id, sim, faceCount: p.faceCount };
        } else if (sim > secondBestSim) {
          secondBestSim = sim;
        }
      }

      // Decide whether to JOIN the best cluster. All gates must hold, else we
      // create a new cluster — biased toward never merging different people.
      let matched: { id: string; faceCount: number } | null = null;
      if (best && best.sim >= threshold) {
        const marginOk = secondBestSim < 0 || best.sim - secondBestSim >= MATCH_MARGIN;
        if (marginOk) {
          // Confirm against the cluster's actual faces, not just its mean centroid.
          const members = await db
            .select({ embedding: FaceTable.embedding })
            .from(FaceTable)
            .where(eq(FaceTable.personId, best.id))
            .orderBy(desc(FaceTable.createdAt))
            .limit(MAX_CONFIRM_MEMBERS);
          let bestMemberSim = -1;
          for (const m of members) {
            const emb = parseEmbedding(m.embedding);
            if (!emb) continue;
            const s = cosineSimilarity(input.embedding, emb);
            if (s > bestMemberSim) bestMemberSim = s;
          }
          if (bestMemberSim >= threshold - MEMBER_CONFIRM_OFFSET) {
            matched = { id: best.id, faceCount: best.faceCount };
          }
        }
      }

      const now = new Date().toISOString();

      if (matched) {
        const [face] = await db
          .insert(FaceTable)
          .values({
            fileId: input.fileId,
            personId: matched.id,
            embedding: JSON.stringify(input.embedding),
            boxX: input.box.x,
            boxY: input.box.y,
            boxW: input.box.width,
            boxH: input.box.height,
            detScore: input.detScore ?? null,
          })
          .returning();

        // Incremental mean: (centroid * n + embedding) / (n + 1)
        const [person] = await db
          .select({ centroid: PersonTable.centroid, faceCount: PersonTable.faceCount })
          .from(PersonTable)
          .where(eq(PersonTable.id, matched.id))
          .limit(1);
        const old = parseEmbedding(person?.centroid ?? null) ?? input.embedding;
        const n = person?.faceCount ?? 0;
        const merged = input.embedding.map(
          (v, i) => ((old[i] ?? 0) * n + v) / (n + 1),
        );

        await db
          .update(PersonTable)
          .set({
            centroid: JSON.stringify(merged),
            faceCount: n + 1,
            updatedAt: now,
          })
          .where(eq(PersonTable.id, matched.id));

        return { faceId: face!.id, personId: matched.id, isNew: false };
      }

      // New cluster.
      const [person] = await db
        .insert(PersonTable)
        .values({
          libraryId,
          centroid: JSON.stringify(input.embedding),
          faceCount: 1,
        })
        .returning();

      const [face] = await db
        .insert(FaceTable)
        .values({
          fileId: input.fileId,
          personId: person!.id,
          embedding: JSON.stringify(input.embedding),
          boxX: input.box.x,
          boxY: input.box.y,
          boxW: input.box.width,
          boxH: input.box.height,
          detScore: input.detScore ?? null,
        })
        .returning();

      await db
        .update(PersonTable)
        .set({ coverFaceId: face!.id, updatedAt: now })
        .where(eq(PersonTable.id, person!.id));

      return { faceId: face!.id, personId: person!.id, isNew: true };
    }),

  // Clear all faces for a file (and repair their person clusters) so the worker
  // can re-detect from a clean slate. Makes detection idempotent across retries
  // — without this, a re-leased detect_faces task re-inserts already-saved faces,
  // inflating person counts and polluting centroids (D2).
  clearFacesForFile: internalProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await removeFacesForFiles([input.fileId]);
      return { ok: true };
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

  // Wipe all detected people + faces (and their avatar crops) and re-queue
  // detection for every image, so clustering can be re-run from scratch (e.g.
  // after tuning the match threshold). Destructive + global, hence admin-only.
  rescanAll: adminProcedure.mutation(async () => {
    // Best-effort delete the crop avatars on disk (matches createFaceCrop's
    // `${variantsPath}/faces` layout). Non-fatal if it fails.
    const [settings] = await db
      .select({ variantsPath: SystemSettingsTable.variantsPath })
      .from(SystemSettingsTable)
      .limit(1);
    if (settings?.variantsPath) {
      await rm(join(settings.variantsPath, "faces"), {
        recursive: true,
        force: true,
      }).catch(() => {});
    }

    const now = new Date().toISOString();
    // better-sqlite3 transactions must be synchronous (an async callback throws
    // "Transaction function cannot return a promise"), so use the sync .run() API
    // and read affected-row counts off the result.
    const result = db.transaction((tx) => {
      // Faces reference people, so delete faces first.
      const faces = tx.delete(FaceTable).run();
      const people = tx.delete(PersonTable).run();
      const tasks = tx
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
      return {
        facesDeleted: faces.changes,
        peopleDeleted: people.changes,
        tasksReset: tasks.changes,
      };
    });

    return result;
  }),

  listPeople: privateProcedure
    .input(z.object({ includeHidden: z.boolean().default(false) }).optional())
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const libIds = [...scope.accessibleLibraryIds];
      if (libIds.length === 0) return [];

      const where = [inArray(PersonTable.libraryId, libIds)];
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
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const libIds = [...scope.accessibleLibraryIds];
      if (libIds.length === 0) return { items: [], nextCursor: null };

      // Sort key: named (flag 0) before unnamed (flag 1), then face_count desc,
      // then id asc as a stable tiebreaker for the keyset cursor.
      const flag = sql<number>`CASE WHEN ${PersonTable.name} IS NULL THEN 1 ELSE 0 END`;

      const conds = [inArray(PersonTable.libraryId, libIds)];
      if (!input.includeHidden) conds.push(eq(PersonTable.hidden, false));

      const cursor = decodePeopleCursor(input.cursor);
      if (cursor) {
        // Rows strictly after the cursor in (flag ASC, faceCount DESC, id ASC).
        conds.push(
          sql`(${flag} > ${cursor.flag}
            OR (${flag} = ${cursor.flag} AND ${PersonTable.faceCount} < ${cursor.faceCount})
            OR (${flag} = ${cursor.flag} AND ${PersonTable.faceCount} = ${cursor.faceCount} AND ${PersonTable.id} > ${cursor.id}))`,
        );
      }

      const rows = await db
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
      await loadAuthorizedPerson(input.id, scope);
      const name = input.name && input.name.length > 0 ? input.name : null;
      await db
        .update(PersonTable)
        .set({ name, updatedAt: new Date().toISOString() })
        .where(eq(PersonTable.id, input.id));
      return { id: input.id, name };
    }),

  setCover: privateProcedure
    .input(z.object({ personId: z.string().uuid(), faceId: z.string().uuid() }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input.personId, scope);
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
      await db
        .update(PersonTable)
        .set({ hidden: input.hidden, updatedAt: new Date().toISOString() })
        .where(eq(PersonTable.id, input.id));
      return { ok: true };
    }),

  // Delete a cluster: orphan its faces (keep them for any future re-cluster)
  // and remove the person row.
  deletePerson: privateProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      await loadAuthorizedPerson(input, scope);
      await db
        .update(FaceTable)
        .set({ personId: null, updatedAt: new Date().toISOString() })
        .where(eq(FaceTable.personId, input));
      await db.delete(PersonTable).where(eq(PersonTable.id, input));
      // Drop any merge dismissals that referenced this now-gone cluster.
      await db
        .delete(PersonMergeDismissedTable)
        .where(
          or(
            eq(PersonMergeDismissedTable.personIdLow, input),
            eq(PersonMergeDismissedTable.personIdHigh, input),
          ),
        );
      return { ok: true };
    }),

  // Merge source cluster into target: reassign faces, recompute the target
  // centroid/faceCount from scratch, delete the source. The escape hatch for
  // when one person ends up split across two clusters. Admin-only.
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

      const now = new Date().toISOString();
      await db
        .update(FaceTable)
        .set({ personId: input.targetId, updatedAt: now })
        .where(eq(FaceTable.personId, input.sourceId));

      // Recompute centroid + count from the target's faces.
      const faces = await db
        .select({ embedding: FaceTable.embedding })
        .from(FaceTable)
        .where(eq(FaceTable.personId, input.targetId));

      let centroid: number[] | null = null;
      let count = 0;
      for (const f of faces) {
        const emb = parseEmbedding(f.embedding);
        if (!emb) continue;
        count++;
        if (!centroid) centroid = emb.slice();
        else for (let i = 0; i < centroid.length; i++) centroid[i] = (centroid[i] ?? 0) + (emb[i] ?? 0);
      }
      if (centroid && count > 0) {
        for (let i = 0; i < centroid.length; i++) centroid[i] = (centroid[i] ?? 0) / count;
      }

      await db
        .update(PersonTable)
        .set({
          faceCount: count,
          centroid: centroid ? JSON.stringify(centroid) : null,
          // Keep the target's name; adopt source name only if target is unnamed.
          name: target.name ?? source.name,
          updatedAt: now,
        })
        .where(eq(PersonTable.id, input.targetId));

      await db.delete(PersonTable).where(eq(PersonTable.id, input.sourceId));
      // The source cluster no longer exists, so any dismissal mentioning it is
      // dead weight — clear it (incl. a prior "not the same" between the two).
      await db
        .delete(PersonMergeDismissedTable)
        .where(
          or(
            eq(PersonMergeDismissedTable.personIdLow, input.sourceId),
            eq(PersonMergeDismissedTable.personIdHigh, input.sourceId),
          ),
        );
      return { ok: true };
    }),

  // Admin-only: find pairs of clusters that look like the same person split in
  // two, so they can be merged from one place (Google-Photos style). Two-phase:
  // a cheap O(n²) centroid pre-filter per library, then the same member-level
  // confirmation assignFace uses, so a coincidental centroid match doesn't
  // surface a false suggestion. Computed on demand — clusters change rarely and
  // the bounded candidate set keeps this well within a single request.
  listMergeSuggestions: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const scope = await getAccessScope(userId, session);
      const libIds = [...scope.accessibleLibraryIds];
      if (libIds.length === 0) return [];

      const threshold = await getFaceMatchThreshold();
      const memberFloor = threshold - MEMBER_CONFIRM_OFFSET;

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
        .where(inArray(PersonTable.libraryId, libIds));

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
        centroid: number[];
      };
      // People only merge within their own library, so scan per-library.
      const byLibrary = new Map<string, P[]>();
      for (const p of people) {
        const centroid = parseEmbedding(p.centroid);
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
            const sim = cosineSimilarity(a.centroid, b.centroid);
            if (sim >= SUGGEST_CENTROID_THRESHOLD) candidates.push({ a, b, sim });
          }
        }
      }
      candidates.sort((x, y) => y.sim - x.sim);
      const top = candidates.slice(0, SUGGEST_CANDIDATE_CAP);

      // Phase 2: confirm against the clusters' actual stored faces, not just
      // their mean centroids — the strongest cross-pair member match must clear
      // the same floor a live face needs to join a cluster.
      const confirmed: Cand[] = [];
      for (const c of top) {
        const [am, bm] = await Promise.all([
          db
            .select({ embedding: FaceTable.embedding })
            .from(FaceTable)
            .where(eq(FaceTable.personId, c.a.id))
            .orderBy(desc(FaceTable.createdAt))
            .limit(MAX_CONFIRM_MEMBERS),
          db
            .select({ embedding: FaceTable.embedding })
            .from(FaceTable)
            .where(eq(FaceTable.personId, c.b.id))
            .orderBy(desc(FaceTable.createdAt))
            .limit(MAX_CONFIRM_MEMBERS),
        ]);
        const ae = am
          .map((m) => parseEmbedding(m.embedding))
          .filter((x): x is number[] => !!x);
        const be = bm
          .map((m) => parseEmbedding(m.embedding))
          .filter((x): x is number[] => !!x);
        let bestMember = -1;
        for (const x of ae) {
          for (const y of be) {
            const s = cosineSimilarity(x, y);
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
          cursorCondition = sql`${fileSortExpr} < ${cursorRecord.sortTs}`;
        }
      }

      const rows = await db
        .select({
          file: FileTable,
          libraryId: LibraryFileTable.libraryId,
          libraryFileId: LibraryFileTable.id,
          blurhash: ImageMetadataTable.blurhash,
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
      }));

      const hasMore = data.length > input.limit;
      const items = hasMore ? data.slice(0, input.limit) : data;
      const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

      return { items, nextCursor };
    }),
});
