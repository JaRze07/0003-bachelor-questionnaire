# One image: the API and the three pages it serves.
# Built on the JR07 box by `jr07 app up bachelor --port 8080` (build context = this project root).
# The provisioner injects PORT and mounts a persistent named volume at /data, which is where the database,
# its write-ahead log and the nightly backups live.
FROM node:22-slim AS build
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 WEB_DIR=/app/web DB_PATH=/data/bachelor.db BACKUP_DIR=/data/backups \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app/api
COPY --from=build /app/api/node_modules ./node_modules
COPY --from=build /app/api/dist ./dist
COPY api/package.json ./
COPY web/curated ./curated
COPY web /app/web
RUN rm -rf /app/web/test && mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
