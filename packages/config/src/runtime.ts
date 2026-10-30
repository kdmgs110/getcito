import { X509Certificate } from "node:crypto";

type RuntimeEnv = Record<string, string | undefined>;

/** Reject invalid limits instead of accidentally creating an unbounded pool. */
export function positiveIntegerEnv(name: string, fallback: number, env: RuntimeEnv = process.env): number {
	const value = env[name];
	if (value === undefined || value === "") return fallback;
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
		throw new Error(`${name} must be a positive integer`);
	}
	return Number(value);
}

/** Keep pg and both pg-boss clients on the same explicit TLS policy. */
export function databaseConnection(env: RuntimeEnv = process.env): {
	connectionString: string | undefined;
	ssl?: false | { rejectUnauthorized: boolean; ca?: string };
} {
	const mode = env.DATABASE_SSL_MODE;
	const ca = env.DATABASE_SSL_CA;
	if (ca && mode !== "verify-full") {
		throw new Error("DATABASE_SSL_CA requires DATABASE_SSL_MODE=verify-full");
	}
	if (!mode) return { connectionString: env.DATABASE_URL };
	if (!["disable", "verify-full", "no-verify"].includes(mode)) {
		throw new Error("DATABASE_SSL_MODE must be disable, verify-full, or no-verify");
	}
	if (ca) {
		const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
		try {
			if (!certificates?.length || certificates.join("").replace(/\s/g, "") !== ca.replace(/\s/g, "")) {
				throw new Error("Invalid PEM bundle");
			}
			for (const certificate of certificates) new X509Certificate(certificate);
		} catch {
			throw new Error("DATABASE_SSL_CA must contain valid PEM certificates with BEGIN/END CERTIFICATE markers");
		}
	}
	let url: URL;
	try {
		url = new URL(env.DATABASE_URL ?? "");
		if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid protocol");
	} catch {
		throw new Error("DATABASE_URL must be a PostgreSQL URL when DATABASE_SSL_MODE is set");
	}
	// pg's URL TLS parameters otherwise override its explicit ssl option.
	for (const name of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(name);
	return {
		connectionString: url.toString(),
		ssl: mode === "disable" ? false : { rejectUnauthorized: mode === "verify-full", ...(ca ? { ca } : {}) },
	};
}
