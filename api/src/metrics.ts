import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";

declare module "fastify" {
  interface FastifyRequest {
    _metricsStart?: bigint;
  }
}

export default fp(async function metrics(app: FastifyInstance) {
  const register = new Registry();
  collectDefaultMetrics({ register, prefix: "fastify_" });

  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code", "procedure"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  });

  app.addHook("onRequest", async (req) => {
    req._metricsStart = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const start = req._metricsStart ?? process.hrtime.bigint();
    const dur = Number(process.hrtime.bigint() - start) / 1e9;

    const u = new URL(req.url, "http://internal");
    const path = u.pathname; // no query
    let route =
      // stable low-cardinality route if Fastify has it
      (req as any).routerPath || req.routeOptions?.url || path;

    // Exact tRPC procedure label, but keep route low-cardinality
    let procedure = "-";
    if (path === "/trpc" || path.startsWith("/trpc/")) {
      route = "/trpc";
      const seg = decodeURIComponent(path.slice("/trpc/".length));
      const isBatch = u.searchParams.has("batch") || seg.includes(",");
      procedure = isBatch ? `batch:${seg || ""}` : seg || "-";
    }

    httpDuration
      .labels({
        method: req.method,
        route,
        status_code: String(reply.statusCode),
        procedure,
      })
      .observe(dur);
  });

  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", register.contentType);
    return reply.send(await register.metrics());
  });
});
