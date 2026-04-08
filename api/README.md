# OpenGallery API

Backend API built with Fastify, tRPC, and Drizzle ORM.

## Quick Start

```bash
npm install
cp .env.sample .env
# Edit .env with your DATABASE_URL
npm run db:push
npm start
```

Runs at http://localhost:3000

## Scripts

| Command              | Description              |
| -------------------- | ------------------------ |
| `npm start`          | Start development server |
| `npm run build`      | Build for production     |
| `npm run db:push`    | Push schema to database  |
| `npm run db:migrate` | Run migrations           |
| `npm run db:studio`  | Open Drizzle Studio      |

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/opengallery
PORT=3000
AUTH_SECRET=your-secret-key
INTERNAL_TOKEN=worker-token
```
