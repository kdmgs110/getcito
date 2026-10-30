import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
	AI_CLASSIFICATION_VERSION,
	ANALYTICS_MEASUREMENT_VERSION,
	type AnalyticsMeasurementMode,
	FILTER_SCHEMA_VERSION,
} from "@workspace/lib/analytics";

export function analyticsEncryptionKey(): Buffer {
	const value = process.env.ANALYTICS_TOKEN_ENCRYPTION_KEY ?? "";
	const key = /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
	if (key.length !== 32) throw new Error("ANALYTICS_NOT_CONFIGURED");
	return key;
}

/** Context authenticates the brand and purpose, preventing encrypted secret swaps. */
export function sealAnalyticsSecret(secret: string, context: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", analyticsEncryptionKey(), iv);
	cipher.setAAD(Buffer.from(context));
	const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
	return [
		"v1",
		iv.toString("base64url"),
		cipher.getAuthTag().toString("base64url"),
		encrypted.toString("base64url"),
	].join(".");
}

export function openAnalyticsSecret(value: string, context: string): string {
	try {
		const [version, iv, tag, encrypted, extra] = value.split(".");
		if (version !== "v1" || !iv || !tag || !encrypted || extra) throw new Error();
		const decipher = createDecipheriv("aes-256-gcm", analyticsEncryptionKey(), Buffer.from(iv, "base64url"));
		decipher.setAAD(Buffer.from(context));
		decipher.setAuthTag(Buffer.from(tag, "base64url"));
		return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
	} catch {
		throw new Error("ANALYTICS_RECONNECT_REQUIRED");
	}
}

export function analyticsStateHash(state: string): string {
	return createHash("sha256").update(state).digest("hex");
}

export function normalizeAnalyticsHostname(value: string): string {
	try {
		const url = new URL(value.includes("://") ? value : `https://${value}`);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || url.port)
			throw new Error();
		return url.hostname.toLowerCase().replace(/\.$/, "");
	} catch {
		throw new Error("TRAFFIC_INVALID_SITE");
	}
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, canonical(v)]),
		);
	return value;
}

/** Pure helper also used by fixtures. Never keys a result solely by a mutable view id. */
export function trafficCacheKey(
	kind: "overview" | "pages" | "detail",
	connection: {
		brandId: string;
		revision: string;
		propertyId: string | null;
		hostname: string | null;
		measurementMode?: AnalyticsMeasurementMode;
	},
	input: unknown,
): string {
	return createHash("sha256")
		.update(
			JSON.stringify(
				canonical({
					version: 1,
					classificationVersion: AI_CLASSIFICATION_VERSION,
					filterSchemaVersion: FILTER_SCHEMA_VERSION,
					measurementVersion: ANALYTICS_MEASUREMENT_VERSION,
					kind,
					connection: { ...connection, measurementMode: connection.measurementMode ?? "landing_sessions" },
					input,
				}),
			),
		)
		.digest("hex");
}
