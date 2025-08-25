// context.ts
import type { FastifyRequest, FastifyReply } from "fastify";

export type Context = {
  req: FastifyRequest;
  res: FastifyReply;
  userId: string | null;
  session: unknown | null;
};

export type PrivateContext = Context & { userId: string; isInternal: boolean };

// wherever you build context
export async function createContext({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<Context> {
  return { req, res, userId: null, session: null };
}
