# OpenGallery API

Backend API built with Fastify, tRPC, Drizzle ORM and SQLite (better-sqlite3).

## Quick Start

```bash
npm install
cp .env.sample .env
npm run db:migrate
npm start
```

Runs at http://localhost:3000

## Scripts

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `npm start`           | Start development server                 |
| `npm run build`       | Build for production                     |
| `npm run db:generate` | Generate a migration from the schema     |
| `npm run db:migrate`  | Run migrations                           |
| `npm run db:studio`   | Open Drizzle Studio                      |

## Environment Variables

See `.env.sample` and the root `README.md`.
