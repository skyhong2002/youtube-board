# Build from repository root: docker build -f platform/Dockerfile -t youtube-board-ts:REV .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY platform/package.json platform/package-lock.json ./
COPY platform/api/package.json api/package.json
COPY platform/web/package.json web/package.json
COPY platform/jobs/package.json jobs/package.json
COPY platform/ingestion/package.json ingestion/package.json
COPY platform/ai/package.json ai/package.json
COPY platform/notifications/package.json notifications/package.json
RUN npm ci
COPY platform/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# Dynamic pages are built without touching any database or provider.
RUN mkdir -p web/public && npm run typecheck && npx tsc -p runtime/tsconfig.json && npm run build --workspace=@youtube-board/web

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# tsx is needed for the TypeScript entrypoints; dependencies are lockfile-pinned.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/api ./api
COPY --from=build --chown=node:node /app/jobs ./jobs
COPY --from=build --chown=node:node /app/ingestion ./ingestion
COPY --from=build --chown=node:node /app/ai ./ai
COPY --from=build --chown=node:node /app/notifications ./notifications
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/runtime ./runtime
COPY --from=build --chown=node:node /app/inventory ./inventory
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.base.json ./
COPY --from=build --chown=node:node /app/web/.next/standalone ./web/.next/standalone
COPY --from=build --chown=node:node /app/web/.next/static ./web/.next/standalone/web/.next/static
COPY --from=build --chown=node:node /app/web/public ./web/.next/standalone/web/public
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8000 RUNTIME_ROLE=web
RUN mkdir -p /var/lib/youtube-board/media && chown node:node /var/lib/youtube-board/media
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 CMD ["node", "runtime/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "runtime/launcher.mjs", "web"]
