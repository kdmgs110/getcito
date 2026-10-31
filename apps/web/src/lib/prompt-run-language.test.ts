import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { isPromptRunLanguageFilter, promptRunLanguageCondition } from "./prompt-run-language";

const dialect = new PgDialect();
const condition = (language: string) =>
	dialect.sqlToQuery(promptRunLanguageCondition(sql`pr.request_context`, language));

describe("prompt run language conditions", () => {
	it("preserves historical runs only in the explicit all or unrecorded scopes", () => {
		expect(condition("all").sql).toBe("TRUE");
		expect(condition("unrecorded").sql).toBe("pr.request_context IS NULL");
		expect(condition("unspecified").sql).toBe(
			"pr.request_context IS NOT NULL AND pr.request_context->>'languageCode' IS NULL",
		);
	});
	it("filters the recorded request language using a bound parameter, without guessing legacy locale", () => {
		expect(condition("ja")).toMatchObject({ sql: "pr.request_context->>'languageCode' = $1", params: ["ja"] });
		expect(condition("zh-TW").params).toEqual(["zh-TW"]);
	});
	it("rejects unsupported or malicious input before constructing SQL", () => {
		for (const input of ["Japanese", "ja-JP", "ja' OR TRUE --", null, 3])
			expect(isPromptRunLanguageFilter(input)).toBe(false);
		expect(() => condition("ja' OR TRUE --")).toThrow("Invalid run language filter");
	});
});
