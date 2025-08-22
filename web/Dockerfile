# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# --- deps: install web (and api if needed) deps for caching ---
FROM base AS deps
# copy manifests first for better layer caching
COPY web/package*.json ./web/
COPY api/package*.json ./api/
WORKDIR /app/web
RUN npm ci || npm install
WORKDIR /app/api
# only needed if your web build imports from api code that relies on its node deps
RUN [ -f package.json ] && (npm ci || npm install) || true

# --- build: copy sources and build Angular (SSR) ---
FROM base AS build
# bring in node_modules from deps stages
COPY --from=deps /app /app
# copy the actual source
COPY web/ ./web/
COPY api/ ./api/
WORKDIR /app/web
# build the Angular app; it can import ../../api/src
RUN npm run build:prod

# --- runner: serve SSR ---
FROM node:20-alpine AS runner
WORKDIR /app

# copy built artifacts
COPY --from=build /app/web/dist/opengallery /app/dist/opengallery
# copy web package files for runtime metadata if needed
COPY web/package*.json ./

EXPOSE 4321
CMD ["node", "dist/opengallery/server/server.mjs"]
