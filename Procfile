web: node --max-old-space-size=320 apps/web/.output/server/index.mjs
worker: cd apps/worker && exec node --max-old-space-size=320 --import tsx src/index.ts
release: node --max-old-space-size=320 packages/lib/scripts/migrate.mjs
