import assert from "node:assert/strict";
import { test } from "node:test";
import { blockedPublicPath, canonicalOrigin, forwardRequest, runtimeEnvironment } from "./environment.ts";

const bindings = {
	APP_URL: "https://getcito.example.org",
	DATABASE_URL: "postgresql://user:password@db.example.org/getcito?sslmode=require",
	BETTER_AUTH_SECRET: "a".repeat(32),
};
test("runtime forwards only application bindings and fixes production/auth settings", () => {
	const environment = runtimeEnvironment({
		...bindings,
		GOOGLE_ANALYTICS_CLIENT_SECRET: "oauth-secret",
		...{ CLOUDFLARE_API_TOKEN: "must-stay-in-worker", DEPLOYMENT_MODE: "demo", NODE_OPTIONS: "--inspect=0.0.0.0" },
	});
	assert.equal(environment.DEPLOYMENT_MODE, "local");
	assert.equal(environment.NODE_ENV, "production");
	assert.equal(environment.GOOGLE_ANALYTICS_CLIENT_SECRET, "oauth-secret");
	assert.equal(environment.CLOUDFLARE_API_TOKEN, undefined);
	assert.equal(environment.NODE_OPTIONS, undefined);
});
test("runtime refuses missing auth secret, local database and a noncanonical public origin", () => {
	assert.throws(() => runtimeEnvironment({ ...bindings, BETTER_AUTH_SECRET: "short" }));
	assert.throws(() => runtimeEnvironment({ ...bindings, DATABASE_URL: "postgres://localhost/getcito" }));
	for (const APP_URL of [
		"http://getcito.example.org",
		"https://getcito.example.org/subpath",
		"https://replace-before-deploy.example",
		"https://user:password@getcito.example.org",
		"https://getcito.example.org?token=x",
	]) {
		assert.throws(() => canonicalOrigin({ APP_URL }));
	}
});
test("public signup and supervisor endpoints cannot bypass the path guard with encoding", () => {
	for (const path of [
		"/api/auth/sign-up/email",
		"/api/auth/sign-up/",
		"/auth/register",
		"/__container/health",
		"/api/auth/%73ign-up/email",
		"/api/auth%2Fsign-up/email",
		"/api/auth/%2573ign-up/email",
		"/api//auth/sign-up/email",
		"/api/auth/sign-up%ZZ",
	])
		assert.equal(blockedPublicPath(path), true, path);
	assert.equal(blockedPublicPath("/api/auth/sign-in/email"), false);
	assert.equal(blockedPublicPath("/api/analytics/google/callback"), false);
});
test("proxy preserves POST payload and cookies but replaces untrusted forwarded origins", async () => {
	const request = new Request("https://getcito.example.org/api/auth/sign-in/email?redirect=%2Fapp", {
		method: "POST",
		body: "email=test%40example.org",
		headers: {
			Cookie: "session=test",
			Forwarded: "host=attacker.example",
			"X-Forwarded-Host": "attacker.example",
			"X-Forwarded-Proto": "http",
		},
	});
	const result = forwardRequest(request, canonicalOrigin(bindings));
	assert.equal(result.url, "http://container/api/auth/sign-in/email?redirect=%2Fapp");
	assert.equal(result.method, "POST");
	assert.equal(result.headers.get("cookie"), "session=test");
	assert.equal(result.headers.get("forwarded"), null);
	assert.equal(result.headers.get("x-forwarded-host"), "getcito.example.org");
	assert.equal(result.headers.get("x-forwarded-proto"), "https");
	assert.equal(await result.text(), "email=test%40example.org");
});
