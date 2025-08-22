# -------- Base image --------
FROM node:22-alpine AS base

WORKDIR /app

# Use production npm config
ENV NODE_ENV=production

# -------- Dependencies --------
FROM base AS deps

# Install OS deps (if needed later)
RUN apk add --no-cache libc6-compat

# Copy package manifests
COPY package.json package-lock.json ./

# Install only production deps first to enable better layer caching for final image
RUN npm ci --omit=dev

# -------- Builder --------
FROM base AS builder

WORKDIR /app

# Copy lockfiles and install full deps to build TS
COPY package.json package-lock.json ./
# Ensure devDependencies are installed for build tools (e.g., drizzle-kit)
ENV NODE_ENV=development
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle

# Build TypeScript
RUN npm run build

# -------- Runtime --------
FROM base AS runner

WORKDIR /app

# Copy only needed runtime files
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=builder /app/dist ./dist

# Expose port (default 3000)
EXPOSE 3000

# Default envs (can be overridden by compose or env files)
ENV HOST=0.0.0.0
ENV PORT=3000

# Start the compiled server
CMD ["node", "dist/server.js"]


