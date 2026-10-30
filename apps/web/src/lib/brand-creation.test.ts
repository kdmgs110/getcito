import { describe, expect, it } from "vitest";
import { normalizeBrandCreation } from "./brand-creation";

const input = { brandName: "  日本語のブランド  ", website: "example.com/path?q=1" };

describe("normalizeBrandCreation", () => {
	it("normalizes Japanese names, website origins and absent optional fields", () => {
		expect(normalizeBrandCreation({ ...input, targetMarket: "", targetLanguage: "  " })).toEqual({
			ok: true,
			value: { name: "日本語のブランド", website: "https://example.com/", targetMarket: null, targetLanguage: null },
		});
	});
	it.each(["", "   ", "a".repeat(101)])("rejects invalid name %s", (brandName) => {
		expect(normalizeBrandCreation({ ...input, brandName })).toEqual({
			ok: false,
			error: { code: "INVALID_NAME", field: "brandName" },
		});
	});
	it.each(["", "not a domain", "ftp://example.com", "http://localhost"])("rejects invalid website %s", (website) => {
		expect(normalizeBrandCreation({ ...input, website })).toEqual({
			ok: false,
			error: { code: "INVALID_WEBSITE", field: "website" },
		});
	});
	it("validates known markets and the selected market's language", () => {
		expect(normalizeBrandCreation({ ...input, targetMarket: "invented" })).toMatchObject({
			ok: false,
			error: { code: "INVALID_MARKET" },
		});
		expect(normalizeBrandCreation({ ...input, targetMarket: "Japan", targetLanguage: "Japanese" })).toMatchObject({
			ok: true,
		});
		expect(normalizeBrandCreation({ ...input, targetMarket: "Japan", targetLanguage: "Albanian" })).toMatchObject({
			ok: false,
			error: { code: "INVALID_LANGUAGE" },
		});
		expect(normalizeBrandCreation({ ...input, targetLanguage: "Japanese" })).toMatchObject({
			ok: false,
			error: { code: "INVALID_LANGUAGE" },
		});
	});
	it("accepts browser UUID request keys and rejects arbitrary identities", () => {
		expect(normalizeBrandCreation({ ...input, requestId: "00000000-0000-4000-8000-000000000001" })).toMatchObject({
			ok: true,
		});
		expect(normalizeBrandCreation({ ...input, requestId: "old-brand" })).toMatchObject({
			ok: false,
			error: { code: "INVALID_REQUEST" },
		});
	});
});
