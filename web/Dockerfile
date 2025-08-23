# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# --- deps: install workspace deps (web + shared types) for caching ---
FROM base AS deps
# copy manifests first for better layer caching
COPY package*.json ./
COPY web/package*.json ./web/
COPY packages/types/package*.json ./packages/types/
WORKDIR /app
RUN npm ci || npm install

# --- build: copy sources and build Angular (SSR) ---
FROM base AS build
# bring in node_modules from deps stage
COPY --from=deps /app /app
# copy the actual source
COPY web/ ./web/
COPY packages/types/ ./packages/types/
WORKDIR /app/web
# build the Angular app
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
