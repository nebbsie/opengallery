import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

declare module "fastify" {
  interface FastifyRequest {
    _metricsStart?: bigint;
  }
}

const register = new Registry();
collectDefaultMetrics({ register, prefix: "opengallery_" });

const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code", "procedure"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

const encodeDuration = new Histogram({
  name: "encode_duration_seconds",
  help: "Image/video encoding duration in seconds",
  labelNames: ["type", "status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

const filesProcessed = new Counter({
  name: "files_processed_total",
  help: "Total number of files processed",
  labelNames: ["type", "status"] as const,
  registers: [register],
});

const queueSize = new Gauge({
  name: "encoding_queue_size",
  help: "Current number of items in encoding queue",
  registers: [register],
});

const variantsGenerated = new Counter({
  name: "variants_generated_total",
  help: "Total number of variants generated",
  labelNames: ["type", "quality"] as const,
  registers: [register],
});

export const metrics = {
  register,
  httpDuration,
  encodeDuration,
  filesProcessed,
  queueSize,
  variantsGenerated,
};

export default fp(async function metrics(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    req._metricsStart = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const start = req._metricsStart ?? process.hrtime.bigint();
    const dur = Number(process.hrtime.bigint() - start) / 1e9;

    const u = new URL(req.url, "http://internal");
    const path = u.pathname;
    let route =
      (req as any).routerPath || req.routeOptions?.url || path;

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

  // Internal endpoint for worker to report encoding metrics
  app.post("/metrics/encode", async (req, reply) => {
    const body = req.body as {
      durationMs?: number;
      type?: "image" | "video";
      status?: "success" | "failed";
      variantType?: "thumbnail" | "optimized";
      quality?: number;
      queueSize?: number;
    };

    if (body.durationMs !== undefined && body.type && body.status) {
      const durSeconds = body.durationMs / 1000;
      encodeDuration.labels({ type: body.type, status: body.status }).observe(durSeconds);
      filesProcessed.labels({ type: body.type, status: body.status }).inc();
    }

    if (body.variantType && body.quality) {
      variantsGenerated.labels({ type: body.variantType, quality: String(body.quality) }).inc();
    }

    if (body.queueSize !== undefined) {
      queueSize.set(body.queueSize);
    }

    return reply.send({ ok: true });
  });
});
