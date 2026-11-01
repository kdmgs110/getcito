import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { measurementModelFilter, measurementRunCondition } from "./measurement-scope";

const dialect = new PgDialect();
afterEach(() => vi.unstubAllEnvs());
describe("measurement SQL target scope", () => {
	it("uses exact attempts and only unambiguous legacy provider/model/search evidence", () => {
		vi.stubEnv("SCRAPE_TARGETS", "chatgpt:direct:gpt-5:online,chatgpt:brightdata:online");
		const query = dialect.sqlToQuery(measurementRunCondition("chatgpt:brightdata:online"));
		expect(query.sql).toContain('mt.prompt_run_id = "prompt_runs".id AND mt.target_key =');
		expect(query.sql).toContain("NOT EXISTS");
		expect(query.sql).toContain('"prompt_runs".provider =');
		expect(query.sql).not.toContain("provider IS NULL");
		expect(query.params).toEqual(["chatgpt", "chatgpt:brightdata:online", true, "brightdata", true]);
	});
	it("never guesses a requested version from an upstream returned version", () => {
		vi.stubEnv("SCRAPE_TARGETS", "chatgpt:direct:v1:online,chatgpt:direct:v2:online");
		const query = dialect.sqlToQuery(measurementRunCondition("chatgpt:direct:v1:online", "pr"));
		expect(query.params).toEqual(["chatgpt", "chatgpt:direct:v1:online", false, "direct", true]);
		expect(query.sql).not.toContain(".version");
	});
	it("disables legacy inference without deployment metadata", () => {
		vi.stubEnv("SCRAPE_TARGETS", "");
		expect(dialect.sqlToQuery(measurementRunCondition("chatgpt:brightdata:online")).params).toContain(false);
	});
	it("scopes citation counts through their exact run and preserves legacy raw-model callers", () => {
		const citations = dialect.sqlToQuery(measurementModelFilter("chatgpt:brightdata:online", "citations"));
		expect(citations.sql).toContain("scoped_run.id = citations.prompt_run_id");
		expect(citations.params).toContain("chatgpt:brightdata:online");
		expect(dialect.sqlToQuery(measurementModelFilter("chatgpt")).params).toEqual(["chatgpt"]);
		expect(dialect.sqlToQuery(measurementModelFilter()).sql).toBe("");
	});
	it("rejects multiple targets instead of silently blending them", () => {
		expect(() => measurementRunCondition("chatgpt:brightdata:online,chatgpt:direct:v1")).toThrow(
			"Invalid measurement target",
		);
	});
});
