import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";

const schema = JSON.parse(
	await readFile(new URL("../node_modules/wrangler/config-schema.json", import.meta.url), "utf8"),
);
const config = JSON.parse(await readFile(new URL("../wrangler.json", import.meta.url), "utf8"));
const validate = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }).compile(schema);
if (!validate(config)) {
	throw new Error(JSON.stringify(validate.errors, null, 2));
}
assert.equal(config.containers.length, 1, "one container application only");
assert.equal(config.containers[0].max_instances, 1, "no automatic scaling beyond budget");
assert.equal(config.containers[0].instance_type, "basic");
assert.equal(config.workers_dev, false, "no alternative public hostname");
assert.equal(config.preview_urls, false, "production database must not be reachable through previews");
assert.equal(config.vars.APP_URL, config.containers[0].image_vars.VITE_APP_URL, "server/client origins must match");
assert.equal(config.containers[0].image_vars.DEPLOYMENT_MODE, "local");
assert.equal(config.containers[0].image_vars.VITE_DEPLOYMENT_MODE, "local");
assert.deepEqual(config.triggers.crons, ["* * * * *"], "background worker wake-up schedule is required");
console.log("Wrangler schema and singleton/auth-origin configuration checks passed.");
