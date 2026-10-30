import { readFile, writeFile } from "node:fs/promises";

const rootDockerfile = new URL("../../../docker/Dockerfile", import.meta.url);
const source = await readFile(rootDockerfile, "utf8");
if (!/^FROM\s+worker\s+AS\s+cloudflare\s*$/im.test(source)) {
	throw new Error("docker/Dockerfile must define the cloudflare runtime stage");
}
// Wrangler has no Docker --target option. Keep the application Dockerfile as
// the only stage definition and select its target without changing its default.
await writeFile(
	new URL("../Dockerfile.generated", import.meta.url),
	`${source}\nFROM cloudflare AS cloudflare-deployment\n`,
);
console.log("Prepared Cloudflare Docker target (no secrets are copied into it).");
