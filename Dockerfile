# syntax=docker/dockerfile:1.7
#
# OMEGA Infinity – Produktions-Image
#   docker compose up -d --build        (siehe docs/DEPLOYMENT.md)
#
# Stufe 1 baut Web-App, Server und MCP-Server; Stufe 2 enthält nur das Nötigste zur Laufzeit
# und läuft als unprivilegierter Benutzer "node" (UID 1000).

ARG NODE_IMAGE=node:22-bookworm-slim

# ── Build ────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# better-sqlite3 liefert fertige Binaries für linux x64 und arm64 (glibc und musl) mit, daher läuft npm ci
# ohne Install-Skripte (kein Python/Compiler nötig). Auf anderen CPUs (z. B. 32-Bit-ARM) mit
#   --build-arg INSTALL_BUILD_TOOLS=true
# bauen: dann werden Compiler installiert und better-sqlite3 aus dem Quellcode übersetzt.
ARG INSTALL_BUILD_TOOLS=false
RUN if [ "$INSTALL_BUILD_TOOLS" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*; \
    fi
COPY package.json package-lock.json ./
# Optional für Firmen-Proxys mit eigener CA:  docker build --secret id=ca,src=/pfad/ca.pem .
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund \
    && if [ "$INSTALL_BUILD_TOOLS" = "true" ]; then npm rebuild better-sqlite3 --foreground-scripts; fi \
    && node -e "new (require('better-sqlite3'))(':memory:').prepare('select sqlite_version() v').get()"
COPY . .
RUN npm run build && npm prune --omit=dev && npm cache clean --force

# ── Laufzeit ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    OMEGA_HOST=0.0.0.0 \
    OMEGA_PORT=4317 \
    OMEGA_DATA_DIR=/data \
    OMEGA_BACKUP_DIR=/backups \
    OMEGA_WEB_DIST=/app/dist/web
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME ["/data", "/backups"]
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OMEGA_PORT||4317)+'/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "dist/server/index.js"]
