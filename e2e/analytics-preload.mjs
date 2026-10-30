/** Test-server-only Google boundary. Never imported by the application bundle. */
import { createRequire, registerHooks } from "node:module";

const database = new URL(process.env.DATABASE_URL || "postgres://invalid/invalid");
if (
	process.env.E2E_ANALYTICS_PRELOAD !== "1" ||
	process.env.DEPLOYMENT_MODE !== "local" ||
	!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
	!database.pathname.includes("test") ||
	process.env.E2E_DATABASE_URL !== process.env.DATABASE_URL
) {
	throw new Error("Analytics preload requires an explicitly selected local test database");
}

// Nitro can trace an external copy; patch that instance as well as the source dependency.
const patched = new Set();
for (const location of ["../packages/lib/package.json", "../apps/web/.output/server/index.mjs"]) {
	const require = createRequire(new URL(location, import.meta.url));
	let OAuth2Client;
	try {
		({ OAuth2Client } = require("google-auth-library"));
	} catch {
		continue;
	}
	if (patched.has(OAuth2Client)) continue;
	patched.add(OAuth2Client);
	const original = OAuth2Client.prototype.getAccessToken;
	OAuth2Client.prototype.getAccessToken = function (...args) {
		if (this.credentials.refresh_token === "e2e-cache-refresh") {
			const value = { token: "e2e-cache-access" };
			if (typeof args[0] === "function") return args[0](null, value.token);
			return Promise.resolve(value);
		}
		return original.apply(this, args);
	};
}
if (!patched.size) throw new Error("Google OAuth dependency was not found for E2E preload");

// Nitro bundles the SDK in its SSR chunk. Patch the known SDK method only in
// memory while loading that built test server; keep the generated artifact intact.
const builtSsr = new URL("../apps/web/.output/server/_ssr/", import.meta.url).href;
registerHooks({
	load(url, context, nextLoad) {
		const result = nextLoad(url, context);
		if (!url.startsWith(builtSsr) || !url.endsWith(".mjs") || !result.source) return result;
		const source = String(result.source);
		if (!source.includes("exports.OAuth2Client = class OAuth2Client")) return result;
		const signature = "getAccessToken(callback) {";
		if (!source.includes(signature)) throw new Error("Bundled Google OAuth SDK changed; update the E2E preload");
		return {
			...result,
			source: source.replace(
				signature,
				`${signature}
				if (this.credentials.refresh_token === "e2e-cache-refresh") {
					if (callback) return callback(null, "e2e-cache-access");
					return Promise.resolve({ token: "e2e-cache-access" });
				}`,
			),
		};
	},
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
	if (headers.get("authorization") !== "Bearer e2e-cache-access") return originalFetch(input, init);
	const request = new Request(input, init);
	const url = new URL(request.url);
	if (
		url.protocol !== "https:" ||
		url.port !== "" ||
		!["analyticsadmin.googleapis.com", "analyticsdata.googleapis.com"].includes(url.hostname)
	)
		throw new Error("E2E analytics credential may only be used on the official analytics API hosts");
	if (
		url.hostname === "analyticsadmin.googleapis.com" &&
		/^\/v1beta\/properties\/123456\/keyEvents$/.test(url.pathname)
	) {
		return Response.json({
			keyEvents: ["affiliate_link_click", "応募完了", "purchase"].map((eventName, index) => ({
				name: `properties/123456/keyEvents/${index + 1}`,
				eventName,
				createTime: "2026-01-01T00:00:00Z",
				countingMethod: "ONCE_PER_EVENT",
			})),
		});
	}
	// Settings invalidate cached reports. Return an empty, explicitly unsupported-rate
	// dataset for newly created/revised goals; deterministic nonzero reports are seeded.
	if (url.hostname === "analyticsdata.googleapis.com" && url.pathname === "/v1beta/properties/123456/metadata")
		return Response.json({ metrics: [] });
	if (
		url.hostname === "analyticsdata.googleapis.com" &&
		url.pathname === "/v1beta/properties/123456:checkCompatibility"
	) {
		const body = await request.json();
		return Response.json({
			dimensionCompatibilities: body.dimensions.map(({ name }) => ({
				dimensionMetadata: { apiName: name },
				compatibility: "COMPATIBLE",
			})),
			metricCompatibilities: body.metrics.map(({ name }) => ({
				metricMetadata: { apiName: name },
				compatibility: "COMPATIBLE",
			})),
		});
	}
	if (url.hostname === "analyticsdata.googleapis.com" && url.pathname === "/v1beta/properties/123456:runReport") {
		const body = await request.json();
		return Response.json({
			rowCount: body.dimensions.some(({ name }) => name === "hostName") ? 1 : 0,
			rows: body.dimensions.some(({ name }) => name === "hostName")
				? [
						{
							dimensionValues: body.dimensions.map(() => ({ value: "example.com" })),
							metricValues: body.metrics.map(() => ({ value: "1" })),
						},
					]
				: [],
			metadata: { timeZone: "Asia/Tokyo" },
		});
	}
	throw new Error(`Unexpected E2E analytics endpoint: ${url.hostname}${url.pathname}`);
};
