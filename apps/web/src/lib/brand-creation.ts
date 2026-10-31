import { normalizeBrandLocale } from "@workspace/lib/brand-locale";
import { validateWebsiteUrl } from "./brand-website";

export type BrandCreationErrorCode =
	| "AUTH_REQUIRED"
	| "FORBIDDEN"
	| "INVALID_NAME"
	| "INVALID_WEBSITE"
	| "INVALID_MARKET"
	| "INVALID_LANGUAGE"
	| "INVALID_REQUEST"
	| "REQUEST_CONFLICT"
	| "SAVE_FAILED";
export type BrandCreationError = {
	code: BrandCreationErrorCode;
	field?: "brandName" | "website" | "targetMarket" | "targetLanguage";
};
export type BrandCreationResult = { ok: true; brandId: string } | { ok: false; error: BrandCreationError };

export type BrandCreationInput = {
	brandName: string;
	website: string;
	targetMarket?: string | null;
	targetLanguage?: string | null;
	requestId?: string;
};

/** Validate before writing, and keep error details independent of SQL and provider responses. */
export function normalizeBrandCreation(input: BrandCreationInput) {
	const name = input.brandName.trim();
	if (!name || name.length > 100) {
		return { ok: false, error: { code: "INVALID_NAME", field: "brandName" } } as const;
	}
	const website = validateWebsiteUrl(input.website);
	if (!website.isValid || /^(?!https?:)[a-z][a-z0-9+.-]*:\/\//i.test(input.website.trim())) {
		return { ok: false, error: { code: "INVALID_WEBSITE", field: "website" } } as const;
	}
	let targetMarket: string | null;
	let targetLanguage: string | null;
	try {
		({ targetMarket, targetLanguage } = normalizeBrandLocale(input));
	} catch (error) {
		const market = error instanceof Error && error.message === "BRAND_MARKET_INVALID";
		return {
			ok: false,
			error: {
				code: market ? "INVALID_MARKET" : "INVALID_LANGUAGE",
				field: market ? "targetMarket" : "targetLanguage",
			},
		} as const;
	}

	if (
		input.requestId &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
	) {
		return { ok: false, error: { code: "INVALID_REQUEST" } } as const;
	}
	return {
		ok: true,
		value: { name, website: website.formattedUrl, targetMarket, targetLanguage },
	} as const;
}
