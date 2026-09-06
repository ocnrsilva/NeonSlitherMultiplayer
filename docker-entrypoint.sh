#!/bin/sh
set -e

echo "[Entrypoint] Checking and applying database migrations via Prisma..."

MAX_RETRIES=5
RETRY_COUNT=0
MIGRATION_SUCCESS=0

until [ $RETRY_COUNT -ge $MAX_RETRIES ]
do
  if npx prisma migrate deploy; then
    MIGRATION_SUCCESS=1
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT+1))
  echo "[Entrypoint] Migration attempt $RETRY_COUNT failed. Retrying in 2 seconds..."
  sleep 2
done

if [ $MIGRATION_SUCCESS -ne 1 ]; then
  echo "[Entrypoint] CRITICAL ERROR: 'prisma migrate deploy' failed after $MAX_RETRIES attempts."
  echo "[Entrypoint] Refusing to start application on unmigrated database. Exiting."
  exit 1
fi

echo "[Entrypoint] Migrations successfully verified and applied."
echo "[Entrypoint] Starting Node server on port 3010..."
exec node dist/server.cjs
