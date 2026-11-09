# Based on hjinco/synch apps/api/Dockerfile; upstream source is pinned.
FROM node:24-bookworm-slim AS source
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init . && git remote add origin https://github.com/hjinco/synch.git \
    && git fetch --depth=1 origin eef0d1d7f3d727aecb820789cab6d7f98e33b4ec \
    && git checkout --detach FETCH_HEAD

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS native-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM native-deps AS build-deps
COPY --from=source /src/pnpm-lock.yaml /src/pnpm-workspace.yaml /src/package.json ./
COPY --from=source /src/apps/api/package.json apps/api/package.json
COPY --from=source /src/apps/www/package.json apps/www/package.json
COPY --from=source /src/apps/obsidian-plugin/package.json apps/obsidian-plugin/package.json
COPY --from=source /src/packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile --filter @synch/api...

FROM build-deps AS builder
COPY --from=source /src/apps/api apps/api
RUN pnpm -C apps/api build:node

FROM native-deps AS production-deps
COPY --from=source /src/pnpm-lock.yaml /src/pnpm-workspace.yaml /src/package.json ./
COPY --from=source /src/apps/api/package.json apps/api/package.json
COPY --from=source /src/apps/www/package.json apps/www/package.json
COPY --from=source /src/apps/obsidian-plugin/package.json apps/obsidian-plugin/package.json
COPY --from=source /src/packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile --filter @synch/api... --prod

FROM base AS runtime
ARG BUILD_VERSION=0.1.1
ARG BUILD_ARCH
LABEL io.hass.type="app" io.hass.version="${BUILD_VERSION}" io.hass.arch="${BUILD_ARCH}"
ENV NODE_ENV=production
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=production-deps /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=builder /app/apps/api/dist /app/apps/api/dist
COPY --from=source /src/LICENSE /usr/share/synch/LICENSE
COPY launcher.mjs /app/ha/launcher.mjs
WORKDIR /app/apps/api
EXPOSE 8787
ENTRYPOINT ["node", "/app/ha/launcher.mjs"]
