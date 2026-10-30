import assert from "node:assert/strict";
import { createRequire } from "node:module";

const database = new URL(process.env.DATABASE_URL ?? "");
assert.equal(database.pathname, "/getcito_cloudflare_test", "Only the dedicated integration database may be seeded");
const { Client } = createRequire(new URL("../../../packages/lib/package.json", import.meta.url))("pg");
const client = new Client({ connectionString: database.href });
await client.connect();
try {
	// No account/password is created: this fixture only satisfies the private
	// bootstrap prerequisite so the real image's health lifecycle can be tested.
	await client.query(`INSERT INTO "user" (id, name, email, role)
		VALUES ('container-ci-admin', 'Container CI', 'container-ci@example.invalid', 'admin')
		ON CONFLICT (id) DO NOTHING`);
} finally {
	await client.end();
}
