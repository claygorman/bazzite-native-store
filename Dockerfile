# The DEMO image — not how this app ships.
#
# The product is a Tauri binary on a Bazzite box. This container exists so the thing
# can be shown to someone without them installing it, and nothing in the desktop build
# may come to depend on it. See docs/DEMO-HOSTING.md.

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
# Manifests first, so a source-only change does not re-resolve the dependency tree.
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm demo:build

FROM node:24-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* ./
# `--prod` drops vite, tailwind, the Tauri CLI and the types — the server itself needs
# only fastify and @fastify/static.
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/types ./src/types

# ⚠️ Not root. Nothing here writes to disk — the cache is in memory on purpose, so a
# restart simply re-warms rather than serving something stale from a previous deploy.
USER node

ENV PORT=8080
EXPOSE 8080
# Runs the TypeScript directly via node's type stripping, which is how the repo's tests
# already run. No build step for the server, and one less artifact to keep in sync.
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/index.ts"]
