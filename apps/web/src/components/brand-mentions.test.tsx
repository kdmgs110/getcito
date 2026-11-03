import type { BrandMention } from "@workspace/lib/brand-mentions";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/brand-mentions", () => ({
	registerMentionBrandFn: vi.fn(),
	getMentionRecountStatusFn: vi.fn(),
	retryMentionRecountFn: vi.fn(),
}));
vi.mock("@/server/brand-mentions-read", () => ({ getPromptBrandMentionsFn: vi.fn() }));
vi.mock("@/hooks/use-brands", () => ({ useBrand: vi.fn(), useCompetitors: vi.fn() }));

import {
	BrandMentionList,
	MentionSourceUrl,
	mentionRankLabel,
	registrationAliases,
	suggestedMentionAliases,
} from "./brand-mentions";

const mention = (
	name: string,
	kind: BrandMention["kind"],
	rank: number | null,
	rankBasis: BrandMention["rankBasis"] = "explicit",
): BrandMention => ({
	key: name,
	entityId: kind === "unregistered" ? null : name,
	name,
	kind,
	rank,
	rankBasis,
	firstOffset: rank ?? 0,
	evidence: `${name} is mentioned here`,
	matchedText: name,
});

describe("brand mention list", () => {
	it("preserves answer positions across own, competitor and unregistered brands", () => {
		const html = renderToStaticMarkup(
			<BrandMentionList
				mentions={[
					mention("First competitor", "competitor", 1),
					mention("Own brand", "own", 2),
					mention("New candidate", "unregistered", 3),
				]}
				onRegister={() => {}}
			/>,
		);
		expect(html.indexOf("First competitor")).toBeLessThan(html.indexOf("Own brand"));
		expect(html.indexOf("Own brand")).toBeLessThan(html.indexOf("New candidate"));
		expect(html).toContain("1位");
		expect(html).toContain("2位");
		expect(html).toContain("3位");
		expect(html).toContain("自社");
		expect(html).toContain("競合");
		expect(html).toContain("未登録");
		expect(html.match(/＋登録/g)).toHaveLength(1);
		expect(html).toContain("New candidateを登録");
	});
	it("labels appearance order without pretending it is a recommendation ranking", () => {
		expect(mentionRankLabel(mention("Name", "own", 2, "appearance"))).toBe("2番目");
		expect(mentionRankLabel(mention("Name", "own", null, "unknown"))).toBe("—");
		const html = renderToStaticMarkup(<BrandMentionList mentions={[mention("Name", "own", 2, "appearance")]} />);
		expect(html).toContain("登場順（検出ブランド内）");
		expect(html).not.toContain("2位");
	});
	it("escapes untrusted extracted brand names and exposes evidence through a labeled button", () => {
		const html = renderToStaticMarkup(
			<BrandMentionList
				mentions={[mention("<script>alert(1)</script>", "unregistered", 1)]}
				onEvidence={() => {}}
				onRegister={() => {}}
				compact
			/>,
		);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("根拠を見る");
		expect(html).toContain("を登録");
	});
	it("does not offer registering already tracked brands", () => {
		const html = renderToStaticMarkup(
			<BrandMentionList
				mentions={[mention("Own", "own", 1), mention("Competitor", "competitor", 2)]}
				onRegister={() => {}}
			/>,
		);
		expect(html).not.toContain("＋登録");
		expect(html).not.toContain("を登録");
	});
	it("shows a safely linked source URL without changing the extracted brand or rank", () => {
		const url = "https://jobs.example.com/projects/rails?ref=answer";
		const html = renderToStaticMarkup(
			<BrandMentionList mentions={[{ ...mention("Rails開発案件", "unregistered", 2), url }]} compact />,
		);
		expect(html).toContain(`href="${url}"`);
		expect(html).toContain(`aria-label="出典URL: ${url}"`);
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain("truncate");
		expect(html).toContain("2位");
		expect(html).toContain("Rails開発案件");
		for (const unsafe of ["javascript:alert(1)", "data:text/html,unsafe", "https://user:pass@example.com"]) {
			expect(renderToStaticMarkup(<MentionSourceUrl url={unsafe} />)).toBe("");
		}
	});
	it("prefills grounded answer aliases while excluding generic action links and URLs", () => {
		const candidate = mention("Rails開発案件", "unregistered", 1);
		expect(suggestedMentionAliases(candidate)).toEqual(["Rails開発案件"]);
		expect(
			suggestedMentionAliases({
				...candidate,
				suggestedAliases: ["Rails開発案件", "Ｒａｉｌｓ開発案件", "応募する", "詳細はこちら", "https://example.com"],
			}),
		).toEqual(["Ｒａｉｌｓ開発案件"]);
		expect(suggestedMentionAliases({ ...candidate, matchedText: "詳しくはこちら" })).toEqual([]);
	});
	it("retains an original answer spelling when the canonical name changes and deduplicates submitted aliases", () => {
		const original = "Railsフルリモート開発案件";
		const canonical = "Rails Jobs";
		const prefill = suggestedMentionAliases({
			...mention(original, "unregistered", 1),
			suggestedAliases: [original],
		}).join(", ");
		expect(registrationAliases(prefill, canonical)).toEqual([original]);
		expect(
			registrationAliases(`${original}, ${canonical}, Ｒａｉｌｓ Ｊｏｂｓ、${original}\n応募する`, canonical),
		).toEqual([original]);
		expect(registrationAliases(prefill, original)).toEqual([]);
	});
});
