import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { auth, runAsAdminSignup } from "../auth/auth.js";
import { clearScopeCache } from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { InviteTable, LibraryTable, UserTable } from "../db/schema.js";
import { adminProcedure, publicProcedure, router } from "../trpc.js";
import { applyHiddenPeople, applyViewerAccess } from "./viewer-rules.router.js";

// Single-use sign-up links. The admin picks the name, email and what the new
// user can see; the invitee only sets a password. Only a hash of the token is
// stored, so a DB leak does not leak usable links.

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const parseIds = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

type InviteStatus = "pending" | "used" | "expired" | "revoked";

function statusOf(row: typeof InviteTable.$inferSelect): InviteStatus {
  if (row.revokedAt) return "revoked";
  if (row.usedAt) return "used";
  if (row.expiresAt <= new Date().toISOString()) return "expired";
  return "pending";
}

async function findByToken(token: string) {
  const [row] = await db
    .select()
    .from(InviteTable)
    .where(eq(InviteTable.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

export const invitesRouter = router({
  list: adminProcedure.query(async () => {
    const rows = await db
      .select()
      .from(InviteTable)
      .orderBy(desc(InviteTable.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      scope: row.scope,
      albumCount: parseIds(row.albumIds).length,
      hiddenPeopleCount: parseIds(row.hiddenPersonIds).length,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
      status: statusOf(row),
    }));
  }),

  // Returns the raw token once; the web app turns it into a link.
  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        email: z.string().trim().toLowerCase().email(),
        scope: z.enum(["library", "albums"]),
        albumIds: z.array(z.string()).default([]),
        hiddenPersonIds: z.array(z.string()).default([]),
        expiresInDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ id: UserTable.id })
        .from(UserTable)
        .where(eq(UserTable.email, input.email))
        .limit(1);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A user with this email already exists",
        });
      }
      if (input.scope === "albums" && input.albumIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick at least one album",
        });
      }

      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(
        Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const [row] = await db
        .insert(InviteTable)
        .values({
          tokenHash: hashToken(token),
          name: input.name,
          email: input.email,
          createdByUserId: ctx.userId,
          scope: input.scope,
          albumIds: JSON.stringify([...new Set(input.albumIds)]),
          hiddenPersonIds: JSON.stringify([...new Set(input.hiddenPersonIds)]),
          expiresAt,
        })
        .returning({ id: InviteTable.id });
      return { id: row!.id, token, expiresAt };
    }),

  revoke: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(InviteTable)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(InviteTable.id, input.id), isNull(InviteTable.usedAt)));
      return { ok: true };
    }),

  // Public: what the invite page shows before the password form. Gives no
  // detail beyond the name and email the admin typed.
  lookup: publicProcedure
    .input(z.object({ token: z.string().min(10).max(200) }))
    .query(async ({ input }) => {
      const row = await findByToken(input.token);
      if (!row) return { status: "invalid" as const };
      const status = statusOf(row);
      if (status !== "pending") return { status };
      return { status, name: row.name, email: row.email };
    }),

  // Public: create the account and apply the presets. The web app signs the
  // user in afterwards with the email and the new password.
  accept: publicProcedure
    .input(
      z.object({
        token: z.string().min(10).max(200),
        name: z.string().trim().min(1).max(100),
        password: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      const row = await findByToken(input.token);
      if (!row || statusOf(row) !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite link is no longer valid",
        });
      }

      // Claim the invite first, in one statement, so two submits of the same
      // link cannot both create an account.
      const now = new Date().toISOString();
      const claimed = db
        .update(InviteTable)
        .set({ usedAt: now })
        .where(
          and(
            eq(InviteTable.id, row.id),
            isNull(InviteTable.usedAt),
            isNull(InviteTable.revokedAt),
            gt(InviteTable.expiresAt, now),
          ),
        )
        .run();
      if (claimed.changes !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite link is no longer valid",
        });
      }

      let userId: string;
      try {
        const res = await runAsAdminSignup(() =>
          auth.api.signUpEmail({
            body: { email: row.email, password: input.password, name: input.name },
          }),
        );
        userId = res.user.id;
      } catch (err) {
        // Give the link back so the invitee can try again.
        db.update(InviteTable)
          .set({ usedAt: null })
          .where(eq(InviteTable.id, row.id))
          .run();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (err as Error)?.message || "Could not create the account",
        });
      }

      const libraryIds = (
        await db
          .select({ id: LibraryTable.id })
          .from(LibraryTable)
          .where(eq(LibraryTable.userId, row.createdByUserId))
      ).map((l) => l.id);

      db.transaction((tx) => {
        applyViewerAccess(tx, userId, row.scope, libraryIds, parseIds(row.albumIds));
        applyHiddenPeople(tx, userId, parseIds(row.hiddenPersonIds));
        tx.update(InviteTable)
          .set({ usedByUserId: userId })
          .where(eq(InviteTable.id, row.id))
          .run();
      });
      clearScopeCache(userId);

      return { email: row.email };
    }),
});
