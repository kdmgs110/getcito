import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { DATAFORSEO_LOCATION_LANGUAGES } from "@workspace/lib/location-languages";
import { TARGET_MARKETS } from "@workspace/lib/locations";
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
	targetMarket?: string;
	targetLanguage?: string;
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
	const targetMarket = input.targetMarket?.trim() || null;
	const targetLanguage = input.targetLanguage?.trim() || null;
	if (targetMarket && !(TARGET_MARKETS as readonly string[]).includes(targetMarket)) {
		return { ok: false, error: { code: "INVALID_MARKET", field: "targetMarket" } } as const;
	}
	const languages = targetMarket ? DATAFORSEO_LOCATION_LANGUAGES[targetMarket] || DATAFORSEO_LANGUAGES : [];
	if (targetLanguage && !languages.some((language) => language.name === targetLanguage)) {
		return { ok: false, error: { code: "INVALID_LANGUAGE", field: "targetLanguage" } } as const;
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
