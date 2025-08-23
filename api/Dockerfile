# -------- Base image --------
FROM node:22-alpine AS base

WORKDIR /app

# Use production npm config
ENV NODE_ENV=production

# -------- Dependencies (workspace-aware) --------
FROM base AS deps

# Install OS deps (if needed later)
RUN apk add --no-cache libc6-compat

# Copy root and API workspace manifests
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY packages/logger/package.json ./packages/logger/package.json

# Install only production deps for the API workspace
RUN npm ci --omit=dev --workspace ./api

# -------- Builder (workspace-aware) --------
FROM base AS builder

WORKDIR /app

# Ensure devDependencies for the API workspace are installed for building/migrations
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY packages/logger/package.json ./packages/logger/package.json
RUN npm ci --workspace ./api

# Copy API source
COPY api/tsconfig.json ./api/tsconfig.json
COPY api/drizzle.config.ts ./api/drizzle.config.ts
COPY api/src ./api/src
COPY api/drizzle ./api/drizzle
# Also copy migrations to repo root for the migrations image which runs at /app
COPY api/drizzle ./drizzle
# Copy logger package source and build
COPY packages/logger/tsconfig.json ./packages/logger/tsconfig.json
COPY packages/logger/src ./packages/logger/src
RUN npm --prefix ./packages/logger run build

# Build TypeScript for API package (prefix avoids workspace detection issues)
RUN npm --prefix ./api run build

# Keep compatibility for migrations image which expects /app/package.json scripts
COPY api/package.json ./package.json
COPY api/drizzle.config.ts ./drizzle.config.ts

# -------- Runtime --------
FROM base AS runner

WORKDIR /app

# Use builder node_modules so devDeps (drizzle-kit) are present for migrations
COPY --from=builder /app/node_modules ./node_modules
# Copy API package.json for metadata (and for potential runtime scripts)
COPY api/package.json ./package.json
# Copy compiled API dist
COPY --from=builder /app/api/dist ./dist
# Copy compiled logger dist and package.json for reference (node_modules symlink target)
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY packages/logger/package.json ./packages/logger/package.json
# Copy drizzle config and migrations directory to runtime image root
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/drizzle ./drizzle
# Copy TS source needed by drizzle (schema files)
COPY --from=builder /app/api/src ./src
# Copy migrations directory to runtime image root
COPY --from=builder /app/drizzle ./drizzle

# Expose port (default 3000)
EXPOSE 3000

# Default envs (can be overridden by compose or env files)
ENV HOST=0.0.0.0
ENV PORT=3000

# Add entrypoint script to run migrations then start server
COPY api/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Keep default command as server; entrypoint will run migrations first then exec CMD
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/server.js"]


