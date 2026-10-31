import { queryOptions } from "@tanstack/react-query";
import type { BrandLocaleInput } from "@workspace/lib/brand-locale";
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/app-locale";
import { getOpportunitiesFn } from "@/server/opportunities";

export const opportunitiesKeys = {
	all: ["opportunities-report"] as const,
	// Keep this prefix stable for brand-scoped invalidation.
	detail: (brandId: string) => [...opportunitiesKeys.all, brandId] as const,
	localized: (brandId: string, locale: BrandLocaleInput | undefined, timezone: string, appLocale: string) =>
		[
			...opportunitiesKeys.detail(brandId),
			{
				targetLanguage: locale?.targetLanguage || null,
				targetMarket: locale?.targetMarket || null,
				timezone,
				appLocale,
			},
		] as const,
};

/** Do not show a previous language's report while fetching the current one. */
export function opportunitiesQueryOptions(
	brandId: string | undefined,
	locale: BrandLocaleInput | undefined,
	timezone = APP_TIMEZONE,
	appLocale = APP_LOCALE,
) {
	return queryOptions({
		queryKey: opportunitiesKeys.localized(brandId || "", locale, timezone, appLocale),
		// Only the brand ID is sent: the server reads the authoritative saved locale.
		queryFn: () => {
			if (!brandId) throw new Error("Brand is required");
			return getOpportunitiesFn({ data: { brandId, timezone } });
		},
		enabled: !!brandId && !!locale,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});
}
