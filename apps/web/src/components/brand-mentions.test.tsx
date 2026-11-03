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

import { BrandMentionList, mentionRankLabel } from "./brand-mentions";

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
});
