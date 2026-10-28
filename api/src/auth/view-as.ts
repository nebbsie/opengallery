import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { UserTable } from "../db/schema.js";
import { getCachedSession } from "./session-cache.js";

// "View as": an admin can browse exactly as another (non-admin) user sees the
// app, to check what a share or a hidden person looks like from their side.
// The web app sets this cookie; every request (tRPC, /asset, /face, /ws) then
// resolves to the target user with type "user", so all access rules apply as
// they would for that user. The tRPC middleware makes these sessions
// read-only. The cookie alone grants nothing: it is honoured only when the
// real session is an admin.
export const VIEW_AS_COOKIE = "og_view_as";

type SessionResult = Awaited<ReturnType<typeof getCachedSession>>;

export type EffectiveSession = SessionResult & {
  viewAs?: { adminUserId: string; adminName: string };
};

function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function getEffectiveSession(
  headers: Headers,
): Promise<EffectiveSession | null> {
  const session = (await getCachedSession(headers)) as EffectiveSession | null;
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return session;
  }

  const targetId = readCookie(headers, VIEW_AS_COOKIE);
  if (!targetId || targetId === session.user.id) return session;

  const [target] = await db
    .select()
    .from(UserTable)
    .where(eq(UserTable.id, targetId))
    .limit(1);
  // Only non-admin users can be impersonated; anything else is ignored.
  if (!target || target.type === "admin") return session;

  return {
    ...session,
    user: { ...session.user, ...target, type: "user" },
    viewAs: { adminUserId: session.user.id, adminName: session.user.name },
  } as EffectiveSession;
}
