#!/bin/sh
set -e

echo "Ensuring database schema is up to date..."
npx prisma db push --url "$DATABASE_URL" --schema=./src/database/schema.prisma --accept-data-loss

echo "Database schema synchronized successfully. Starting application server..."
exec "$@"
