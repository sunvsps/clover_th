#!/usr/bin/env bash
# CI entry point. Expects Postgres reachable via TEST_DATABASE_ADMIN_URL (defaults to docker-compose db)
# and DATABASE_URL pointing at a scratch database for the Prisma diff (shadow DB separate).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL}"
: "${SHADOW_DATABASE_URL:?set SHADOW_DATABASE_URL (an empty database for prisma migrate diff)}"
npx prisma validate
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
bash scripts/check-raw-migrations.sh
npx prisma generate
npm run typecheck
npm run lint
npm run format
npx tsx scripts/generate-openapi.ts --check
npm test
