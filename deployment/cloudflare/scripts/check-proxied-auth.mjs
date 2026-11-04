import assert from "node:assert/strict";
import { request } from "node:http";
import { canonicalOrigin, forwardRequest } from "../src/environment.ts";

const origin = canonicalOrigin({ APP_URL: process.env.APP_URL });
async function throughProxy(path, browserOrigin = origin.origin) {
	const isPost = path.startsWith("/api/");
	const forwarded = forwardRequest(
		new Request(new URL(path, origin), {
			method: isPost ? "POST" : "GET",
			headers: {
				Host: "untrusted.invalid",
				Origin: browserOrigin,
				"X-Forwarded-Host": "untrusted.invalid",
				"X-Forwarded-Proto": "http",
				"Content-Type": "application/json",
			},
			...(isPost ? { body: JSON.stringify({ email: "nobody@example.invalid", password: "invalid-password" }) } : {}),
		}),
		origin,
	);
	const body = isPost ? await forwarded.text() : undefined;
	return new Promise((resolve, reject) => {
		// Model the fixed TCP destination while retaining the adapter's HTTP host.
		const outgoing = request(
			{
				hostname: "127.0.0.1",
				port: 3000,
				path: new URL(forwarded.url).pathname,
				method: forwarded.method,
				headers: Object.fromEntries(forwarded.headers),
				timeout: 10000,
			},
			(response) => {
				response.resume();
				response.on("end", () => resolve(response.statusCode));
			},
		);
		outgoing.on("error", reject);
		outgoing.on("timeout", () => outgoing.destroy(new Error("Proxy auth check timed out")));
		outgoing.end(body);
	});
}
assert.equal(await throughProxy("/auth/login"), 200);
// Invalid credentials must reach authentication, rather than fail origin checks.
assert.equal(await throughProxy("/api/auth/sign-in/email"), 401);
assert.equal(await throughProxy("/api/auth/sign-in/email", "https://attacker.invalid"), 403);
console.log("Canonical HTTPS proxy login and cross-origin rejection passed");
