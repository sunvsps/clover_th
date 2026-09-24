# Clover_TH: single-container build (frontend static build served by the backend, see
# backend/src/plugins/frontend.ts). Verified with `docker build` against a throwaway Postgres (see README.md,
# "Deploy เวอร์ชันทดลอง (staging) บน Railway").
#
# Layout expected by backend/src/plugins/frontend.ts's default resolution (no FRONTEND_DIST_DIR needed, though the
# runtime stage sets it explicitly anyway): the compiled backend at /app/backend/dist/src/... and the built frontend
# as a SIBLING directory at /app/frontend/dist (one level up from backend/, same as the two folders in this repo).

# ---------- stage 1: frontend build ----------
FROM node:22-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# -> /frontend/dist

# ---------- stage 2: backend build ----------
FROM node:22-slim AS backend-build
# `prisma generate` needs to see the libssl actually present to pick the matching query-engine binary; node:22-slim
# (Debian bookworm) ships none by default, and without it Prisma silently GUESSES "openssl-1.1.x", which then does
# not match the openssl 3.x this same apt install puts in the runtime stage. Installing it here too keeps them in
# sync (verified: without this, `prisma generate` printed exactly that mismatch warning).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
# The frontend build lives one level above backend/ in the final image too, matching the repo layout and what
# plugins/frontend.ts resolves by default.
COPY --from=frontend-build /frontend/dist /app/frontend/dist
RUN npx prisma generate
RUN npm run build
# Drop devDependencies (typescript, tsx, vitest, eslint, ...) but keep the `prisma` CLI: Railway's Pre-Deploy Command
# runs `prisma migrate deploy` (and the seed script) against this same image, so the migrate CLI must stay available.
RUN npm prune --omit=dev \
  && npm install --no-save --no-audit --no-fund prisma@^6.19.3

# ---------- stage 3: runtime ----------
FROM node:22-slim AS runtime
# libssl3/ca-certificates: Prisma's query engine and outbound HTTPS (Discord OAuth token/user endpoints) need them;
# node:22-slim does not ship openssl by default.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system app && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app/backend
COPY --from=backend-build --chown=app:app /app/backend/package.json ./package.json
COPY --from=backend-build --chown=app:app /app/backend/dist ./dist
COPY --from=backend-build --chown=app:app /app/backend/node_modules ./node_modules
# schema + migrations (+ prisma.config.ts, which points at prisma/schema.prisma) for `prisma migrate deploy` as a
# pre-deploy command against this image; the compiled seed at dist/prisma/seed.js only needs the schema at runtime.
COPY --from=backend-build --chown=app:app /app/backend/prisma ./prisma
COPY --from=backend-build --chown=app:app /app/backend/prisma.config.ts ./prisma.config.ts
COPY --from=backend-build --chown=app:app /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production \
    PORT=3000 \
    # Fail loudly at startup if the frontend build is somehow missing, instead of silently serving API-only.
    SERVE_FRONTEND=on \
    FRONTEND_DIST_DIR=/app/frontend/dist

EXPOSE 3000
USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]
