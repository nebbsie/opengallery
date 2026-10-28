import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { TrashItemTable } from "../db/schema.js";
import { adminProcedure, router } from "../trpc.js";
import { emptyTrash, restoreFromTrash } from "../utils/media-trash.js";

// Settings > Trash: files and folders deleted in the UI, kept in hidden
// ".trash" folders on the media drive until the trash is emptied.
export const trashRouter = router({
  list: adminProcedure.query(() =>
    db.select().from(TrashItemTable).orderBy(desc(TrashItemTable.createdAt)),
  ),

  restore: adminProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(1000) }))
    .mutation(({ input }) => restoreFromTrash(input.ids)),

  // ids omitted: empty the whole trash.
  empty: adminProcedure
    .input(z.object({ ids: z.array(z.string()).max(1000).optional() }))
    .mutation(({ input }) => emptyTrash(input.ids ?? null)),
});
