web: node apps/web/.output/server/index.mjs
worker: cd apps/worker && exec node --import tsx src/index.ts
release: node packages/lib/scripts/migrate.mjs
