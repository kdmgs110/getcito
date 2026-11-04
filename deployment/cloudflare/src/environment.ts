/** Secrets are runtime bindings, never Docker build arguments. */
export const FORWARDED_ENVIRONMENT_KEYS = [
	"DATABASE_URL",
	"BETTER_AUTH_SECRET",
	"APP_URL",
	"APP_NAME",
	"APP_ICON",
	"APP_PARENT_NAME",
	"APP_PARENT_URL",
	"APP_TIMEZONE",
	"APP_LOCALE",
	"GOOGLE_ANALYTICS_CLIENT_ID",
	"GOOGLE_ANALYTICS_CLIENT_SECRET",
	"GOOGLE_ANALYTICS_REDIRECT_URI",
	"ANALYTICS_TOKEN_ENCRYPTION_KEY",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"PERPLEXITY_API_KEY",
	"XAI_API_KEY",
	"DEEPSEEK_API_KEY",
	"OPENROUTER_API_KEY",
	"DATAFORSEO_LOGIN",
	"DATAFORSEO_PASSWORD",
	"BRIGHTDATA_API_KEY",
	"MISTRAL_API_KEY",
	"AZURE_FOUNDRY_API_KEY",
	"AZURE_FOUNDRY_BASE_URL",
	"SCRAPE_TARGETS",
	"ONBOARDING_LLM_TARGET",
	"OLOSTEP_API_KEY",
	"BRIGHTDATA_API_TOKEN",
	"OXYLABS_USERNAME",
	"OXYLABS_PASSWORD",
	"CLORO_API_KEY",
	"DBOS_SYSTEM_DATABASE_URL",
	"BRIGHTDATA_SERP_ZONE",
	"BRIGHTDATA_UNLOCKER_ZONE",
	"SENTRY_DSN",
	"SLACK_BOT_TOKEN",
	"SLACK_SIGNING_SECRET",
	"SLACK_CHANNEL_ID",
] as const;
export type RuntimeBindings = Partial<Record<(typeof FORWARDED_ENVIRONMENT_KEYS)[number], string>> & {
	CONTAINER_ENABLED?: string;
};

export function canonicalOrigin(bindings: RuntimeBindings): URL {
	const url = new URL(bindings.APP_URL ?? "");
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		url.port ||
		url.hostname.endsWith(".example") ||
		url.hostname === "localhost"
	) {
		throw new Error("APP_URL must be the configured public HTTPS origin");
	}
	return url;
}
export function runtimeEnvironment(bindings: RuntimeBindings): Record<string, string> {
	const origin = canonicalOrigin(bindings);
	const database = new URL(bindings.DATABASE_URL ?? "");
	if (
		!["postgres:", "postgresql:"].includes(database.protocol) ||
		!database.hostname ||
		["localhost", "127.0.0.1", "::1", "[::1]"].includes(database.hostname)
	) {
		throw new Error("DATABASE_URL must point to the existing external PostgreSQL database");
	}
	if (!bindings.BETTER_AUTH_SECRET || bindings.BETTER_AUTH_SECRET.length < 32) {
		throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
	}
	const values: Record<string, string> = {};
	for (const key of FORWARDED_ENVIRONMENT_KEYS) {
		const value = bindings[key];
		if (typeof value === "string" && value.length) values[key] = value;
	}
	return {
		...values,
		APP_URL: origin.origin,
		NODE_ENV: "production",
		DEPLOYMENT_MODE: "local",
		VITE_DEPLOYMENT_MODE: "local",
		HOST: "0.0.0.0",
		PORT: "3000",
		DISABLE_TELEMETRY: "1",
	};
}

export function blockedPublicPath(pathname: string): boolean {
	let path = pathname;
	// Match route decoding as well as direct requests. Malformed encoded paths
	// are rejected instead of being forwarded to a different URL parser.
	try {
		for (let pass = 0; pass < 3 && path.includes("%"); pass++) path = decodeURIComponent(path);
		if (path.includes("%") || Array.from(path).some((character) => character.charCodeAt(0) < 32)) return true;
	} catch {
		return true;
	}
	path = path.replaceAll("\\", "/").replace(/\/+/g, "/").toLowerCase();
	path = new URL(path, "https://route-guard.invalid").pathname;
	return (
		path.startsWith("/__container") ||
		path === "/auth/register" ||
		path.startsWith("/auth/register/") ||
		path === "/signup" ||
		path.startsWith("/signup/") ||
		path === "/api/auth/sign-up" ||
		path.startsWith("/api/auth/sign-up/")
	);
}

export function forwardRequest(request: Request, origin: URL): Request {
	const url = new URL(request.url);
	url.protocol = "http:";
	// The TCP port binding chooses the destination. Keep the public host so
	// Node/H3 reconstructs the same origin used by browser auth requests.
	url.host = origin.host;
	const forwarded = new Request(url, request);
	forwarded.headers.set("host", origin.host);
	forwarded.headers.delete("forwarded");
	// Never trust client-supplied proxy values for auth redirect/cookie origins.
	forwarded.headers.set("x-forwarded-host", origin.host);
	forwarded.headers.set("x-forwarded-proto", "https");
	forwarded.headers.set("x-forwarded-port", "443");
	return forwarded;
}
