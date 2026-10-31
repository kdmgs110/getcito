import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLocaleFields } from "./brand-locale-fields";

describe("BrandLocaleFields", () => {
	it("allows language selection without choosing a market and exposes clearing", () => {
		const html = renderToStaticMarkup(
			<BrandLocaleFields
				targetLanguage="Japanese"
				targetMarket=""
				onLanguageChange={() => {}}
				onMarketChange={() => {}}
			/>,
		);
		expect(html).toContain('value="Japanese" selected=""');
		expect(html).toContain('value="" selected=""');
		expect(html).not.toContain('disabled=""');
		expect(html.match(/<label/g)).toHaveLength(2);
	});
	it("disables both controls while a generation is in flight", () => {
		const html = renderToStaticMarkup(
			<BrandLocaleFields
				targetLanguage="English"
				targetMarket="Japan"
				onLanguageChange={() => {}}
				onMarketChange={() => {}}
				disabled
			/>,
		);
		expect(html.match(/disabled=""/g)).toHaveLength(2);
	});
});
