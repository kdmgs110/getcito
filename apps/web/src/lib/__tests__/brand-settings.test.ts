import { describe, expect, it } from "vitest";
import { normalizeBrandUpdate } from "@/lib/brand-settings";

describe("normalizeBrandUpdate", () => {
	it("returns an empty update set when no fields are provided", () => {
		const result = normalizeBrandUpdate({});
		expect(result).toEqual({ ok: true, updates: {} });
	});

	it("only touches fields that are present (partial edit)", () => {
		const result = normalizeBrandUpdate({ name: "Acme" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.updates).toEqual({ name: "Acme" });
			expect(result.updates).not.toHaveProperty("website");
			expect(result.updates).not.toHaveProperty("aliases");
		}
	});

	it("normalizes language independently and preserves omitted market", () => {
		expect(normalizeBrandUpdate({ targetLanguage: "ja-JP" })).toEqual({
			ok: true,
			updates: { targetLanguage: "Japanese" },
		});
	});
	it("clears explicitly null or blank locale fields", () => {
		expect(normalizeBrandUpdate({ targetLanguage: null, targetMarket: "" })).toEqual({
			ok: true,
			updates: { targetLanguage: null, targetMarket: null },
		});
	});
	it("rejects unsupported locale values", () => {
		expect(normalizeBrandUpdate({ targetLanguage: "invented" }).ok).toBe(false);
		expect(normalizeBrandUpdate({ targetMarket: "invented" }).ok).toBe(false);
	});

	describe("name", () => {
		it("trims surrounding whitespace", () => {
			const result = normalizeBrandUpdate({ name: "  Acme  " });
			expect(result).toEqual({ ok: true, updates: { name: "Acme" } });
		});

		it.each([
			["empty string", ""],
			["whitespace only", "   "],
		])("rejects a %s name", (_label, name) => {
			expect(normalizeBrandUpdate({ name })).toEqual({
				ok: false,
				error: "Brand name must be a non-empty string",
			});
		});
	});

	describe("website", () => {
		it("normalizes a bare domain to an origin URL", () => {
			const result = normalizeBrandUpdate({ website: "acme.com/products" });
			expect(result).toEqual({ ok: true, updates: { website: "https://acme.com/" } });
		});

		it("rejects an invalid website", () => {
			const result = normalizeBrandUpdate({ website: "not a url" });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toMatch(/valid/i);
		});
	});

	describe("additionalDomains", () => {
		it("cleans and de-duplicates valid domains", () => {
			const result = normalizeBrandUpdate({
				additionalDomains: ["https://www.acme.com/path", "acme.com", "blog.acme.io"],
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.updates.additionalDomains).toEqual(["acme.com", "blog.acme.io"]);
			}
		});

		it("reports every invalid domain in the input", () => {
			const result = normalizeBrandUpdate({
				additionalDomains: ["acme.com", "not a domain", "also bad"],
			});
			expect(result).toEqual({
				ok: false,
				error: "Invalid domain(s): not a domain, also bad",
			});
		});

		it("accepts an empty list", () => {
			const result = normalizeBrandUpdate({ additionalDomains: [] });
			expect(result).toEqual({ ok: true, updates: { additionalDomains: [] } });
		});
	});

	describe("aliases", () => {
		it("trims, drops empties, and de-duplicates", () => {
			const result = normalizeBrandUpdate({ aliases: ["Acme", "  Acme Inc ", "", "  ", "Acme"] });
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.updates.aliases).toEqual(["Acme", "Acme Inc"]);
		});
	});

	it("validates all provided fields together", () => {
		const result = normalizeBrandUpdate({
			name: " Acme ",
			website: "acme.com",
			additionalDomains: ["acme.io", "acme.io"],
			aliases: [" Acme ", "Acme"],
		});
		expect(result).toEqual({
			ok: true,
			updates: {
				name: "Acme",
				website: "https://acme.com/",
				additionalDomains: ["acme.io"],
				aliases: ["Acme"],
			},
		});
	});
});
