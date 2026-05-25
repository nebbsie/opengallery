# OpenGallery

A fast, self-hosted photo and video gallery — a self-hosted alternative to Google Photos.

## Features

- Browse photos and videos with infinite scroll and a timeline scrubber
- Auto-import albums from folder structure
- World map view based on GPS EXIF data
- Browse by camera make/model
- Thumbnail and optimised variant generation (sharp + ffmpeg)
- GPU-accelerated encoding (NVIDIA NVENC, AMD, Intel)
- Per-file and per-album sharing (user-to-user or public link)
- Multi-user with admin roles
- SSR Angular frontend for fast initial loads

---

## Quick Start (Docker)

```yaml
# docker-compose.yml
services:
  opengallery:
    image: ghcr.io/nebbsie/opengallery:latest
    container_name: opengallery
    restart: unless-stopped
    ports:
      - "4321:4321"
    volumes:
      - opengallery-data:/data
      - /path/to/photos:/media/photos:ro
    environment:
      - INTERNAL_TOKEN=your-secure-token
      - TRUSTED_ORIGINS=http://localhost:4321

volumes:
  opengallery-data:
```

```bash
docker compose up -d
```

Open http://localhost:4321 — the first user to register becomes admin.

---

## Architecture

OpenGallery is an npm monorepo with four packages managed via workspaces:

```
api/        Fastify + tRPC backend (SQLite via Drizzle ORM)
web/        Angular 19 SSR frontend
worker/     File-system watcher and media processor
packages/
  logger/   Shared structured logger
  types/    Shared TypeScript types
```

In the Docker container, all four processes run inside a single image managed by **supervisord**, with **nginx** on port 4321 routing `/api/` to the API (port 3219) and everything else to the Angular SSR server (port 4200).

### API (`api/`)

| Technology | Role |
|---|---|
| Fastify 5 | HTTP server |
| tRPC 11 | Type-safe API layer |
| Drizzle ORM | SQLite ORM + migrations |
| better-sqlite3 | SQLite driver |
| BetterAuth | Session-based auth |
| BullMQ | Background job queue |
| Zod | Input validation |
| prom-client | Prometheus metrics endpoint |

### Web (`web/`)

| Technology | Role |
|---|---|
| Angular 19 | Framework (with SSR via Angular Universal) |
| TanStack Query | Server-state and infinite-scroll pagination |
| Spartan UI (Helm) | Component library (Tailwind-based) |
| tRPC client | Communicates with API |

### Worker (`worker/`)

| Technology | Role |
|---|---|
| chokidar | File-system watcher |
| sharp | Image thumbnail + optimised variant generation |
| ffmpeg / ffprobe | Video transcoding and poster frames |
| exifr | EXIF metadata extraction |
| BullMQ | Picks up encoding jobs from the API queue |

---

## Local Development

**Requirements:** Node.js 22+

```bash
# 1. Install all workspace dependencies
npm install

# 2. Copy environment files
cp api/.env.sample api/.env
cp worker/.env.sample worker/.env

# 3. Run database migrations
npm run migrate

# 4. Start all services in parallel
npm run dev
```

| Service | URL |
|---|---|
| Web | http://localhost:4200 |
| API | http://localhost:3000 |

The first user to register at `/register` is automatically made admin.

### Useful scripts

| Command | Description |
|---|---|
| `npm run dev` | Start API, worker, and web in parallel |
| `npm run migrate` | Apply pending DB migrations |
| `npm run generate` | Generate a new Drizzle migration after schema changes |
| `npm run reset` | Reset the local environment |
| `npm run build` | Build shared packages |

### Database

The API uses SQLite (file-based, no separate database server required). The schema lives in `api/src/db/schema.ts`. After changing the schema, generate and apply a migration:

```bash
npm run generate   # creates a new SQL file in migrations/
npm run migrate    # applies it
```

Use Drizzle Studio for a local GUI:

```bash
npm run db:studio --prefix api
```

---

## Environment Variables

### API (`api/.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `./data/opengallery.db` | Path to the SQLite database file |
| `BETTER_AUTH_SECRET` | — | Secret key for session signing (required) |
| `BETTER_AUTH_URL` | `http://localhost:4200` | Public URL of the frontend |
| `TRUSTED_ORIGINS` | — | Comma-separated list of allowed CORS origins |
| `INTERNAL_TOKEN` | — | Shared secret between API and worker |
| `STORAGE_PATH` | `/tmp/opengallery` | Root path for uploaded and generated files |

### Worker (`worker/.env`)

| Variable | Default | Description |
|---|---|---|
| `API_URL` | `http://localhost:3000` | Internal URL of the API |
| `INTERNAL_TOKEN` | — | Must match the API's `INTERNAL_TOKEN` |

### Docker container defaults

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `/data/opengallery.db` | |
| `STORAGE_PATH` | `/data` | Mount a volume here to persist files |
| `HOST_ROOT_PREFIX` | `/host` | Prefix for paths shown from the host filesystem |
| `INTERNAL_TOKEN` | `changeme` | **Change this in production** |
| `TRUSTED_ORIGINS` | `*` | Lock this down in production |
| `API_PORT` | `3219` | Internal API port (nginx proxies it) |

---

## Project Structure

```
api/src/
  routers/      tRPC routers (one file per domain)
  db/
    schema.ts   Drizzle table definitions
    index.ts    DB client
  auth/         BetterAuth setup
  authz/        Shared-access authorization helpers
  utils/        File operations, task helpers

worker/src/
  watcher/      chokidar file watcher and library scanner
  encoding/     sharp + ffmpeg encoding pipeline
  utils/        EXIF, ffprobe, hashing, path helpers

web/src/
  app/          Route-level page components
  @core/
    components/ Shared UI components
    services/   Auth, tRPC client, cache keys
    ui/         Spartan UI wrappers
```

---

## License

MIT
