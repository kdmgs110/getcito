import { describe, expect, it } from "vitest";
import { databaseConnection, positiveIntegerEnv } from "./runtime";

describe("positiveIntegerEnv", () => {
	it("preserves existing defaults and accepts constrained deployment limits", () => {
		expect(positiveIntegerEnv("DB_POOL_MAX", 20, {})).toBe(20);
		expect(positiveIntegerEnv("DB_POOL_MAX", 20, { DB_POOL_MAX: "4" })).toBe(4);
	});
	it.each(["0", "-1", "1.5", "Infinity", "NaN", " 4 ", "9007199254740992"])("rejects unsafe limit %s", (value) => {
		expect(() => positiveIntegerEnv("DB_POOL_MAX", 20, { DB_POOL_MAX: value })).toThrow("DB_POOL_MAX");
	});
});

describe("databaseConnection", () => {
	const connectionString =
		"postgres://user:private-password@example.com/db?ssl=true&sslmode=require&application_name=test";
	it("leaves existing URL behavior intact unless explicitly configured", () => {
		expect(databaseConnection({ DATABASE_URL: connectionString })).toEqual({ connectionString });
	});
	it.each([
		["disable", false],
		["verify-full", { rejectUnauthorized: true }],
		["no-verify", { rejectUnauthorized: false }],
	] as const)("applies explicit TLS policy %s across URL and options", (mode, ssl) => {
		const config = databaseConnection({ DATABASE_URL: connectionString, DATABASE_SSL_MODE: mode });
		expect(config.ssl).toEqual(ssl);
		const url = new URL(config.connectionString ?? "");
		expect(url.searchParams.has("sslmode")).toBe(false);
		expect(url.searchParams.has("ssl")).toBe(false);
		expect(url.searchParams.get("application_name")).toBe("test");
	});
	it("does not include credential values in configuration errors", () => {
		expect(() => databaseConnection({ DATABASE_URL: "private-password", DATABASE_SSL_MODE: "verify-full" })).toThrow(
			"DATABASE_URL must be a PostgreSQL URL",
		);
		expect(() => databaseConnection({ DATABASE_SSL_MODE: "invalid" })).toThrow("DATABASE_SSL_MODE");
	});
});
