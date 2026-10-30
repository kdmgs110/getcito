import { BRIGHTDATA_COUNTRIES } from "./brightdata-locations";

/** Country codes for localized display labels; provider-facing market values are unchanged. */
export function marketCountryCode(market: string): string | undefined {
	return BRIGHTDATA_COUNTRIES[market]?.toUpperCase();
}

/**
 * Location names DataForSEO accepts as `location_name`. Sending anything else
 * makes their API reject the task rather than fall back to a default, so the
 * DataForSEO provider only forwards a market that appears here.
 */
export const DATAFORSEO_LOCATIONS = [
	"Argentina",
	"Australia",
	"Austria",
	"Azerbaijan",
	"Bangladesh",
	"Belgium",
	"Canada",
	"Chile",
	"Colombia",
	"Croatia",
	"Czech Republic",
	"Czechia",
	"Denmark",
	"Egypt",
	"Finland",
	"Germany",
	"Greece",
	"Hungary",
	"India",
	"Indonesia",
	"Ireland",
	"Israel",
	"Japan",
	"Lithuania",
	"Malaysia",
	"Malta",
	"Mexico",
	"Morocco",
	"Netherlands",
	"Netherlands, Kingdom of the",
	"New Zealand",
	"Nigeria",
	"Norway",
	"Pakistan",
	"Peru",
	"Philippines",
	"Poland",
	"Portugal",
	"Romania",
	"Saudi Arabia",
	"Serbia",
	"Singapore",
	"Slovakia",
	"Slovenia",
	"South Africa",
	"South Korea",
	"Spain",
	"Sweden",
	"Switzerland",
	"Taiwan",
	"Thailand",
	"Turkiye",
	"Türkiye",
	"Ukraine",
	"United Arab Emirates",
	"United Kingdom",
	"United States",
	"Vietnam",
];

const DATAFORSEO_LOCATION_SET = new Set(DATAFORSEO_LOCATIONS);

/**
 * Markets offered in the brand pickers: every country BrightData can proxy,
 * which is also every name `localeCountryCode` can resolve to an ISO-2 code for
 * the LLM providers' web-search tools (OpenAI, Anthropic, Grok).
 *
 * A handful of countries appear twice in BRIGHTDATA_COUNTRIES under a long and
 * a short form ("Moldova, Republic of" / "Moldova"). Keep one name per country
 * code, preferring the DataForSEO spelling so Google targets keep their
 * location, then the shorter form.
 */
export const TARGET_MARKETS: string[] = (() => {
	const rank = (name: string) => (DATAFORSEO_LOCATION_SET.has(name) ? 0 : 1);
	const byCode = new Map<string, string>();

	for (const [name, code] of Object.entries(BRIGHTDATA_COUNTRIES)) {
		const current = byCode.get(code);
		if (!current || rank(name) < rank(current) || (rank(name) === rank(current) && name.length < current.length)) {
			byCode.set(code, name);
		}
	}

	return [...byCode.values()].sort((a, b) => a.localeCompare(b));
})();

/** True when DataForSEO will accept this market as a `location_name`. */
export function isDataforseoLocation(market: string): boolean {
	return DATAFORSEO_LOCATION_SET.has(market);
}
