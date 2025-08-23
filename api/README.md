# 🚀 OpenGallery API

> **TLDR**: Fast, type-safe API server built with Fastify, tRPC, and Drizzle ORM for the OpenGallery photo management system.

## 📋 Overview

The OpenGallery API is a high-performance backend service that provides a type-safe, real-time API for the OpenGallery photo management system. Built with modern technologies including Fastify, tRPC, Drizzle ORM, and PostgreSQL, it offers excellent developer experience with full TypeScript support.

## 🛠 Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: [Fastify](https://fastify.io/) - High-performance web framework
- **API Layer**: [tRPC](https://trpc.io/) - End-to-end typesafe APIs
- **Database**: [PostgreSQL](https://www.postgresql.org/) with [Drizzle ORM](https://orm.drizzle.team/)
- **Authentication**: [Better Auth](https://better-auth.com/) - Modern authentication solution
- **Validation**: [Zod](https://zod.dev/) - TypeScript-first schema validation

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Docker (optional, for containerized setup)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database and configuration settings

# Push database schema
npm run db:push

# Start development server
npm start
```

The API will be available at `http://localhost:3000`

## 📚 Available Scripts

| Command               | Description                                 |
| --------------------- | ------------------------------------------- |
| `npm start`           | Start development server with hot reload    |
| `npm run build`       | Build for production                        |
| `npm run db:push`     | Push database schema to PostgreSQL          |
| `npm run db:generate` | Generate new migration files                |
| `npm run db:migrate`  | Run database migrations                     |
| `npm run db:studio`   | Open Drizzle Studio for database management |

## 🏗 Project Structure

```
src/
├── auth/           # Authentication configuration
├── db/            # Database schema and connection
├── routers/       # tRPC router definitions
├── context.ts     # tRPC context setup
├── index.ts       # Main application entry point
└── router.ts      # Root router configuration
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/opengallery

# Server
PORT=3000
HOST=0.0.0.0

# Authentication
AUTH_SECRET=your-secret-key
AUTH_URL=http://localhost:3000

# CORS
CORS_ORIGIN=http://localhost:4200
```

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t opengallery-api .

# Run the container
docker run -p 3000:3000 --env-file .env opengallery-api
```

## 🔍 Development

### Database Management

The API uses Drizzle ORM for database management:

```bash
# Generate a new migration
npm run db:generate

# Apply migrations
npm run db:migrate

# Open Drizzle Studio for visual database management
npm run db:studio
```

### API Testing

The API provides a tRPC client that can be used for testing:

```typescript
import { createTRPCClient } from "@trpc/client";
import { AppRouter } from "./router";

const client = createTRPCClient<AppRouter>({
  url: "http://localhost:3000/trpc",
});
```

## 📖 API Documentation

The API is built with tRPC, providing automatic type inference and excellent developer experience. All endpoints are type-safe and self-documenting.

### Key Endpoints

- `POST /trpc/auth.login` - User authentication
- `GET /trpc/health` - Health check endpoint
- `GET /trpc/directory.*` - Directory and file management
- `GET /trpc/media-sources-settings.*` - Media source configuration

## 🤝 Contributing

1. Follow the project's coding standards
2. Ensure all tests pass
3. Update documentation as needed
4. Use conventional commit messages

## 📄 License

This project is part of OpenGallery and follows the same license terms.
