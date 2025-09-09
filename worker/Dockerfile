FROM node:22-alpine AS base
WORKDIR /app

# --- deps (workspace-aware, production only) ---
FROM base AS deps
# copy manifests first for caching
COPY package.json package-lock.json ./
COPY worker/package.json ./worker/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/logger/package.json ./packages/logger/package.json
# install only prod deps for the worker workspace
RUN npm ci --omit=dev --workspace ./worker

# --- build (workspace-aware) ---
FROM base AS build
ENV NODE_ENV=development
# install dev deps just for the worker workspace
COPY package.json package-lock.json ./
COPY worker/package.json ./worker/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/logger/package.json ./packages/logger/package.json
RUN npm ci --workspace ./worker
# copy sources
COPY worker/tsconfig.json ./worker/tsconfig.json
COPY worker/src ./worker/src
COPY packages/types ./packages/types
COPY packages/logger/tsconfig.json ./packages/logger/tsconfig.json
COPY packages/logger/src ./packages/logger/src
# build into /app/worker/dist
RUN npm --prefix ./packages/logger run build
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
# copy compiled logger dist and package.json for proper linking
COPY --from=build /app/packages/logger/dist ./packages/logger/dist
COPY packages/logger/package.json ./packages/logger/package.json
# Ensure logger package is properly linked in runtime
RUN npm install --omit=dev ./packages/logger
# ensure linked workspace exists (tiny types pkg)
COPY packages/types ./packages/types
CMD ["node", "dist/main.js"]


