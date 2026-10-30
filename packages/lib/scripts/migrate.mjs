import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { databaseConnection } from "../../config/src/runtime.ts";

export const migrationsFolder = fileURLToPath(new URL("../src/db/migrations/", import.meta.url));

export async function migrateDatabase({
	env = process.env,
	poolFactory = (options) => new pg.Pool(options),
	migrateFn = migrate,
} = {}) {
	if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for migrations");
	const pool = poolFactory({ ...databaseConnection(env), max: 1 });
	try {
		await migrateFn(drizzle(pool), { migrationsFolder });
	} finally {
		await pool.end();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	migrateDatabase().catch(() => {
		// Drivers can include credentials in error details; keep release logs generic.
		console.error("Database migration failed. Check database connectivity and migration state.");
		process.exitCode = 1;
	});
}
