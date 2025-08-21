// src/server/routers/directory.ts
import { privateProcedure, router } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const ROOT = os.platform() === "win32" ? path.parse(process.cwd()).root : "/";

const expand = (p?: string) => {
  if (!p || p.trim() === "") return ROOT;
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
};

export const directoryRouter = router({
  ls: privateProcedure.input(z.string().optional()).query(async ({ input }) => {
    const location = path.resolve(expand(input));
    let dirents;
    try {
      dirents = await fs.readdir(location, { withFileTypes: true });
    } catch (err: any) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: err?.message ?? "Cannot read directory",
      });
    }

    return {
      status: "ok",
      location,
      entries: dirents.map((d) => ({
        name: d.name,
        path: path.join(location, d.name), // full path
        kind: d.isDirectory()
          ? "dir"
          : d.isFile()
            ? "file"
            : d.isSymbolicLink()
              ? "symlink"
              : "other",
      })),
    };
  }),
});
