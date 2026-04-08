# OpenGallery

A fast, self-hosted photo gallery alternative to Google Photos.

## Quick Start

### Docker (Recommended)

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

Access at http://localhost:4321

### Local Development

**Requirements:** Node.js 22+, PostgreSQL

```bash
# 1. Install dependencies
npm install

# 2. Copy and edit environment files
cp api/.env.sample api/.env
cp worker/.env.sample worker/.env

# 3. Start all services
npm run dev
```

Services start at:

- Web: http://localhost:4200
- API: http://localhost:3000

## Project Structure

```
api/      # Fastify + tRPC backend
web/      # Angular frontend
worker/   # File system watcher
packages/ # Shared packages
```

## Environment Variables

| Variable          | Description                  |
| ----------------- | ---------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string |
| `INTERNAL_TOKEN`  | API authentication token     |
| `TRUSTED_ORIGINS` | Allowed CORS origins         |

See individual module READMEs for more options.

## License

MIT
