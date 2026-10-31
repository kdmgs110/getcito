import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromptRunContext } from "./prompt-run-context";

describe("prompt run context", () => {
	it("shows the recorded locale and original prompt instead of current brand settings", () => {
		const html = renderToStaticMarkup(
			<PromptRunContext
				context={{
					version: 1,
					prompt: "Rails <案件> & 比較",
					targetLanguage: "Japanese",
					targetMarket: "Japan",
					languageCode: "ja",
					countryCode: "JP",
				}}
			/>,
		);
		expect(html).toContain("日本語");
		expect(html).toContain("日本");
		expect(html).toContain("Rails &lt;案件&gt; &amp; 比較");
		expect(html).not.toContain("未記録");
	});
	it("does not infer a historical run's locale or question from the current prompt", () => {
		const html = renderToStaticMarkup(<PromptRunContext context={null} />);
		expect(html).toContain("未記録");
		expect(html).not.toContain("日本語");
		expect(html).not.toContain("English");
	});
	it("distinguishes a newly recorded unset locale from a legacy run with no snapshot", () => {
		const html = renderToStaticMarkup(
			<PromptRunContext context={{ version: 1, prompt: "Rails jobs", targetLanguage: null, targetMarket: null }} />,
		);
		expect(html).toContain("指定なし");
		expect(html).toContain("Rails jobs");
		expect(html).not.toContain("未記録");
	});
	it("warns without rewriting a likely mismatched answer, but never guesses legacy request language", () => {
		const responseText =
			"Compare the leading freelance platforms and their available opportunities. Choose a service based on your experience and desired working conditions. Review contract terms, payment timing, remote work policies, and support options before making your decision.";
		const context = {
			version: 1 as const,
			prompt: "案件を比較して",
			targetLanguage: "Japanese",
			languageCode: "ja",
			targetMarket: "Japan",
		};
		expect(renderToStaticMarkup(<PromptRunContext context={context} responseText={responseText} />)).toContain(
			"指定した言語と回答の言語が異なる可能性",
		);
		expect(renderToStaticMarkup(<PromptRunContext context={null} responseText={responseText} />)).not.toContain(
			"異なる可能性",
		);
	});
});
