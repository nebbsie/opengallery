import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { appRouter, type AppRouter } from "./router.js";
import { createContext } from "./context.js";
import cors from "@fastify/cors";

const server: FastifyInstance = Fastify();

await server.register(cors);

server.get("/health", async () => ({ status: "ok" }));

server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({ path, error }) {
      console.error(`Error in tRPC handler on path '${path}':`, error);
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

const start = async () => {
  try {
    console.log("Starting server on port 3000 ...");
    await server.listen({ port: 3000 });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
