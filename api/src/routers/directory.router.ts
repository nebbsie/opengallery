// src/server/routers/directory.ts
import { TRPCError } from "@trpc/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import { privateProcedure, router } from "../trpc.js";

const ROOT = os.platform() === "win32" ? path.parse(process.cwd()).root : "/";
// When running in Docker, the host root is usually mounted at /host.
// In local dev (non-Docker), there is no such mount, so fall back to direct FS.
const HOST_PREFIX = process.env["HOST_ROOT_PREFIX"];

const expand = (p?: string) => {
  if (!p || p.trim() === "") return ROOT;
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
};

export const directoryRouter = router({
  ls: privateProcedure.input(z.string().optional()).query(async ({ input }) => {
    // Host-visible path (what we return to the client)
    const hostPath = path.resolve(expand(input));

    // Resolve container path:
    // - If HOST_ROOT_PREFIX is set (Docker), join it with hostPath (with root special-case)
    // - Otherwise (local dev), read directly from hostPath
    const containerPath =
      HOST_PREFIX && HOST_PREFIX.trim() !== ""
        ? hostPath === "/"
          ? HOST_PREFIX
          : path.join(HOST_PREFIX, hostPath)
        : hostPath;
    let dirents;
    try {
      dirents = await fs.readdir(containerPath, { withFileTypes: true });
    } catch (err: any) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: err?.message ?? "Cannot read directory",
      });
    }

    return {
      status: "ok",
      location: hostPath,
      entries: dirents.map((d) => ({
        name: d.name,
        // Return host-style path to the client, not the container path
        path:
          hostPath === "/"
            ? path.join("/", d.name)
            : path.join(hostPath, d.name),
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
