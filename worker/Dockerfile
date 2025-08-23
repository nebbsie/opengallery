FROM node:22-alpine AS base
WORKDIR /app

# --- deps (workspace-aware, production only) ---
FROM base AS deps
# copy manifests first for caching
COPY package.json package-lock.json ./
COPY worker/package.json ./worker/package.json
COPY packages/types/package.json ./packages/types/package.json
# install only prod deps for the worker workspace
RUN npm ci --omit=dev --workspace ./worker

# --- build (workspace-aware) ---
FROM base AS build
ENV NODE_ENV=development
# install dev deps just for the worker workspace
COPY package.json package-lock.json ./
COPY worker/package.json ./worker/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN npm ci --workspace ./worker
# copy sources
COPY worker/tsconfig.json ./worker/tsconfig.json
COPY worker/src ./worker/src
COPY packages/types ./packages/types
# build into /app/worker/dist
RUN npm --prefix ./worker run build

# --- runtime ---
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
# use pruned production node_modules from deps
COPY --from=deps /app/node_modules ./node_modules
# copy worker package metadata (optional)
COPY worker/package.json ./package.json
# copy built output
COPY --from=build /app/worker/dist ./dist
# ensure linked workspace exists (tiny types pkg)
COPY packages/types ./packages/types
CMD ["node", "dist/index.js"]


