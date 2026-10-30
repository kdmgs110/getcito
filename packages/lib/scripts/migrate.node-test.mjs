// Run explicitly with node --test; this suite must not be collected by Vitest.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrateDatabase, migrationsFolder } from "./migrate.mjs";

test("release migrations resolve the real journal independently of cwd", () => {
	const migrations = readMigrationFiles({ migrationsFolder });
	assert.ok(migrations.length > 0);
	assert.ok(migrations.every((migration) => migration.sql.length > 0));
});

test("migration failure still closes the sole database connection pool", async () => {
	let closed = false;
	let poolOptions;
	await assert.rejects(
		migrateDatabase({
			env: { DATABASE_URL: "postgres://example.com/db" },
			poolFactory(options) {
				poolOptions = options;
				return {
					query() {},
					async end() {
						closed = true;
					},
				};
			},
			async migrateFn() {
				throw new Error("migration failed");
			},
		}),
		/migration failed/,
	);
	assert.equal(poolOptions.max, 1);
	assert.equal(closed, true);
});
