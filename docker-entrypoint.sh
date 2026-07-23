#!/bin/sh
set -e

echo "Ensuring database schema is up to date..."

MAX_RETRIES=30
RETRY_COUNT=0

until npx prisma db push --url "$DATABASE_URL" --schema=./src/database/schema.prisma --accept-data-loss; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "Error: Database schema synchronization failed after $MAX_RETRIES attempts."
    exit 1
  fi
  echo "Database connection failed or database is starting up. Retrying in 2 seconds... ($RETRY_COUNT/$MAX_RETRIES)"
  sleep 2
done

echo "Database schema synchronized successfully. Starting application server..."
exec "$@"

