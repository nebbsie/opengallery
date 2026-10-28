import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { clearScopeCache } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import {
  AlbumTable,
  FaceTable,
  LibraryTable,
  PersonTable,
  SharedItemTable,
  UserTable,
  ViewerHiddenFileTable,
  ViewerHiddenPersonTable,
} from "../db/schema.js";
import { adminProcedure, router } from "../trpc.js";

// Admin-only management of what each non-admin user can see: which libraries
// or albums are shared with them, and which people or single photos are hidden
// from them. The rules themselves are enforced in authz/shared-access.ts.

export type ViewerAccessScope = "library" | "albums";

async function requireViewer(userId: string) {
  const [user] = await db
    .select({ id: UserTable.id, type: UserTable.type })
    .from(UserTable)
    .where(eq(UserTable.id, userId))
    .limit(1);
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  if (user.type === "admin") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Admins always see everything",
    });
  }
}

async function nonAdminUserIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: UserTable.id })
    .from(UserTable)
    .where(and(inArray(UserTable.id, ids), ne(UserTable.type, "admin")));
  return rows.map((r) => r.id);
}

// Libraries owned by the admin acting now. "Whole library" access shares these.
async function adminLibraryIds(adminUserId: string): Promise<string[]> {
  const rows = await db
    .select({ id: LibraryTable.id })
    .from(LibraryTable)
    .where(eq(LibraryTable.userId, adminUserId));
  return rows.map((r) => r.id);
}

// Replace a viewer's view shares with "whole library" (the admin's libraries)
// or a set of albums. Runs inside the caller's transaction.
export function applyViewerAccess(
  tx: Pick<typeof db, "delete" | "insert">,
  viewerUserId: string,
  scope: ViewerAccessScope,
  libraryIds: string[],
  albumIds: string[],
): void {
  tx.delete(SharedItemTable)
    .where(
      and(
        eq(SharedItemTable.sharedToUserId, viewerUserId),
        eq(SharedItemTable.shareType, "user"),
        inArray(SharedItemTable.sourceType, ["library", "album"]),
      ),
    )
    .run();
  const rows =
    scope === "library"
      ? libraryIds.map((id) => ({ sourceType: "library" as const, sourceId: id }))
      : albumIds.map((id) => ({ sourceType: "album" as const, sourceId: id }));
  if (rows.length === 0) return;
  tx.insert(SharedItemTable)
    .values(
      rows.map((r) => ({
        ...r,
        shareType: "user" as const,
        accessLevel: "view" as const,
        sharedToUserId: viewerUserId,
      })),
    )
    .run();
}

export function applyHiddenPeople(
  tx: Pick<typeof db, "delete" | "insert">,
  viewerUserId: string,
  personIds: string[],
): void {
  tx.delete(ViewerHiddenPersonTable)
    .where(eq(ViewerHiddenPersonTable.viewerUserId, viewerUserId))
    .run();
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return;
  tx.insert(ViewerHiddenPersonTable)
    .values(unique.map((personId) => ({ viewerUserId, personId })))
    .run();
}

export const viewerRulesRouter = router({
  // Non-admin users, for the "Hide from…" pickers.
  viewers: adminProcedure.query(async () => {
    return db
      .select({ id: UserTable.id, name: UserTable.name, email: UserTable.email })
      .from(UserTable)
      .where(ne(UserTable.type, "admin"))
      .orderBy(UserTable.name);
  }),

  // Everything one viewer can and cannot see, for the "What can they see?"
  // panel.
  forUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireViewer(input.userId);
      const [shares, hiddenPeople, hiddenFiles, ownLibs] = await Promise.all([
        db
          .select({
            sourceType: SharedItemTable.sourceType,
            sourceId: SharedItemTable.sourceId,
          })
          .from(SharedItemTable)
          .where(
            and(
              eq(SharedItemTable.sharedToUserId, input.userId),
              eq(SharedItemTable.shareType, "user"),
            ),
          ),
        db
          .select({
            id: PersonTable.id,
            name: PersonTable.name,
            coverFaceId: PersonTable.coverFaceId,
            faceCount: PersonTable.faceCount,
          })
          .from(ViewerHiddenPersonTable)
          .innerJoin(
            PersonTable,
            eq(PersonTable.id, ViewerHiddenPersonTable.personId),
          )
          .where(eq(ViewerHiddenPersonTable.viewerUserId, input.userId)),
        db
          .select({ fileId: ViewerHiddenFileTable.fileId })
          .from(ViewerHiddenFileTable)
          .where(eq(ViewerHiddenFileTable.viewerUserId, input.userId)),
        adminLibraryIds(ctx.userId),
      ]);

      const sharedLibraryIds = shares
        .filter((s) => s.sourceType === "library")
        .map((s) => s.sourceId);
      const albumIds = shares
        .filter((s) => s.sourceType === "album")
        .map((s) => s.sourceId);
      const albums =
        albumIds.length > 0
          ? await db
              .select({ id: AlbumTable.id, name: AlbumTable.name })
              .from(AlbumTable)
              .where(inArray(AlbumTable.id, albumIds))
          : [];

      const scope: ViewerAccessScope =
        ownLibs.length > 0 && ownLibs.every((id) => sharedLibraryIds.includes(id))
          ? "library"
          : "albums";

      return {
        scope,
        albums,
        hiddenPeople,
        hiddenFileIds: hiddenFiles.map((f) => f.fileId),
      };
    }),

  setAccess: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        scope: z.enum(["library", "albums"]),
        albumIds: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireViewer(input.userId);
      const libraryIds = await adminLibraryIds(ctx.userId);
      db.transaction((tx) => {
        applyViewerAccess(tx, input.userId, input.scope, libraryIds, input.albumIds);
      });
      clearScopeCache(input.userId);
      return { ok: true };
    }),

  setHiddenPeopleForUser: adminProcedure
    .input(z.object({ userId: z.string(), personIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await requireViewer(input.userId);
      db.transaction((tx) => {
        applyHiddenPeople(tx, input.userId, input.personIds);
      });
      clearScopeCache(input.userId);
      return { ok: true };
    }),

  // Which viewers this person is hidden from (for the person page menu).
  forPerson: adminProcedure
    .input(z.object({ personId: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({ userId: ViewerHiddenPersonTable.viewerUserId })
        .from(ViewerHiddenPersonTable)
        .where(eq(ViewerHiddenPersonTable.personId, input.personId));
      return { hiddenFromUserIds: rows.map((r) => r.userId) };
    }),

  setPersonHiddenFrom: adminProcedure
    .input(z.object({ personId: z.string(), userIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const [person] = await db
        .select({ id: PersonTable.id })
        .from(PersonTable)
        .where(eq(PersonTable.id, input.personId))
        .limit(1);
      if (!person) throw new TRPCError({ code: "NOT_FOUND" });
      const userIds = await nonAdminUserIds(input.userIds);
      const before = await db
        .select({ userId: ViewerHiddenPersonTable.viewerUserId })
        .from(ViewerHiddenPersonTable)
        .where(eq(ViewerHiddenPersonTable.personId, input.personId));
      db.transaction((tx) => {
        tx.delete(ViewerHiddenPersonTable)
          .where(eq(ViewerHiddenPersonTable.personId, input.personId))
          .run();
        if (userIds.length > 0) {
          tx.insert(ViewerHiddenPersonTable)
            .values(
              userIds.map((viewerUserId) => ({
                viewerUserId,
                personId: input.personId,
              })),
            )
            .run();
        }
      });
      for (const id of new Set([...userIds, ...before.map((b) => b.userId)])) {
        clearScopeCache(id);
      }
      return { ok: true };
    }),

  // Which viewers this photo is hidden from, directly or through a hidden
  // person in it (for the photo menu).
  forFile: adminProcedure
    .input(z.object({ fileId: z.string() }))
    .query(async ({ input }) => {
      const [direct, viaPerson] = await Promise.all([
        db
          .select({ userId: ViewerHiddenFileTable.viewerUserId })
          .from(ViewerHiddenFileTable)
          .where(eq(ViewerHiddenFileTable.fileId, input.fileId)),
        db
          .selectDistinct({
            userId: ViewerHiddenPersonTable.viewerUserId,
            personName: PersonTable.name,
          })
          .from(FaceTable)
          .innerJoin(
            ViewerHiddenPersonTable,
            eq(ViewerHiddenPersonTable.personId, FaceTable.personId),
          )
          .innerJoin(PersonTable, eq(PersonTable.id, FaceTable.personId))
          .where(eq(FaceTable.fileId, input.fileId)),
      ]);
      return {
        hiddenFromUserIds: direct.map((r) => r.userId),
        hiddenViaPerson: viaPerson.map((r) => ({
          userId: r.userId,
          personName: r.personName,
        })),
      };
    }),

  setFileHiddenFrom: adminProcedure
    .input(z.object({ fileId: z.string(), userIds: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const userIds = await nonAdminUserIds(input.userIds);
      const before = await db
        .select({ userId: ViewerHiddenFileTable.viewerUserId })
        .from(ViewerHiddenFileTable)
        .where(eq(ViewerHiddenFileTable.fileId, input.fileId));
      db.transaction((tx) => {
        tx.delete(ViewerHiddenFileTable)
          .where(eq(ViewerHiddenFileTable.fileId, input.fileId))
          .run();
        if (userIds.length > 0) {
          tx.insert(ViewerHiddenFileTable)
            .values(
              userIds.map((viewerUserId) => ({
                viewerUserId,
                fileId: input.fileId,
              })),
            )
            .run();
        }
      });
      for (const id of new Set([...userIds, ...before.map((b) => b.userId)])) {
        clearScopeCache(id);
      }
      return { ok: true };
    }),
});
