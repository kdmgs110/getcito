import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { measurementTargetKey } from "@workspace/lib/measurement";
import { type SQL, sql } from "drizzle-orm";

/** Exact acquisition scope, carried through the existing model filter parameter. */
export function measurementRunCondition(
	value: string,
	alias: "prompt_runs" | "pr" | "scoped_run" = "prompt_runs",
): SQL {
	const table = sql.identifier(alias);
	if (!value.includes(":")) return sql`${table}.model = ${value}`;
	const configs = parseScrapeTargets(value);
	if (configs.length !== 1 || measurementTargetKey(configs[0]) !== value) throw new Error("Invalid measurement target");
	const config = configs[0];
	// Older rows recorded the returned version rather than the requested one.
	// Only one configured target with the same provider/model/search permits a
	// historical inference. Otherwise exact identity must come from the attempt.
	let uniqueLegacy = false;
	try {
		const candidates = parseScrapeTargets(process.env.SCRAPE_TARGETS).filter(
			(candidate) =>
				candidate.model === config.model &&
				candidate.provider === config.provider &&
				candidate.webSearch === config.webSearch,
		);
		uniqueLegacy = candidates.length === 1 && measurementTargetKey(candidates[0]) === value;
	} catch {
		// No deployment metadata: preserve historical rows without guessing.
	}
	return sql`${table}.model = ${config.model} AND (
		EXISTS (SELECT 1 FROM measurement_attempts mt WHERE mt.prompt_run_id = ${table}.id AND mt.target_key = ${value})
		OR (${uniqueLegacy} AND ${table}.provider = ${config.provider} AND ${table}.web_search_enabled = ${config.webSearch}
			AND NOT EXISTS (SELECT 1 FROM measurement_attempts mt WHERE mt.prompt_run_id = ${table}.id))
	)`;
}

export function measurementModelFilter(
	value?: string,
	source: "prompt_runs" | "citations" | "pr" = "prompt_runs",
): SQL {
	if (!value) return sql``;
	if (!value.includes(":")) {
		return source === "pr" ? sql`AND pr.model = ${value}` : sql`AND model = ${value}`;
	}
	if (source === "citations") {
		return sql`AND EXISTS (SELECT 1 FROM prompt_runs scoped_run
			WHERE scoped_run.id = citations.prompt_run_id AND ${measurementRunCondition(value, "scoped_run")})`;
	}
	return sql`AND ${measurementRunCondition(value, source)}`;
}
