import { describe, expect, it } from "vitest";
import { analyzeBrandMentions, type MentionCatalog, mentionFlags } from "./brand-mentions";

const catalog: MentionCatalog = {
	own: { id: "own", name: "Rails案件.com", aliases: ["Rails案件ドットコム"], domains: ["https://rails.example.com"] },
	competitors: [
		{ id: "legacy", name: "Legacy Force", aliases: ["レガシーフォース"], domains: ["legacy.example.com"] },
		{ id: "tech", name: "Sample Tech", aliases: ["サンプルテック"] },
	],
};

describe("analyzeBrandMentions", () => {
	it("orders all categories by the answer's explicit list, rather than putting the own brand first", () => {
		const result = analyzeBrandMentions(
			"おすすめは次の3社です。\n1. Legacy Force\n2. Rails案件.com\n3. **サンプルエージェント**",
			catalog,
		);
		expect(result.mentions.map((item) => [item.name, item.kind, item.rank, item.rankBasis])).toEqual([
			["Legacy Force", "competitor", 1, "explicit"],
			["Rails案件.com", "own", 2, "explicit"],
			["サンプルエージェント", "unregistered", 3, "explicit"],
		]);
		expect(mentionFlags(result)).toEqual({ brandMentioned: true, competitorsMentioned: ["Legacy Force"] });
	});

	it("shows first appearance as appearance order rather than an invented recommendation rank", () => {
		const text = "Legacy Forceの案件を比較し、Rails案件ドットコムも確認できます。レガシーフォースは再登場です。";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions.map((item) => [item.name, item.rank, item.rankBasis])).toEqual([
			["Legacy Force", 1, "appearance"],
			["Rails案件.com", 2, "appearance"],
		]);
		expect(result.mentions[1].matchedText).toBe("Rails案件ドットコム");
		expect(text.slice(result.mentions[1].firstOffset).startsWith("Rails案件ドットコム")).toBe(true);
	});

	it("normalizes full-width/case/combining characters while preserving original evidence offsets", () => {
		const text = "😀 おすすめはＬＥＧＡＣＹ ＦＯＲＣＥとCafe\u0301です。";
		const result = analyzeBrandMentions(text, { own: { id: "cafe", name: "Café" }, competitors: catalog.competitors });
		expect(result.mentions.map((item) => item.name)).toEqual(["Legacy Force", "Café"]);
		for (const item of result.mentions)
			expect(text.slice(item.firstOffset, item.firstOffset + item.matchedText.length)).toBe(item.matchedText);
		expect(result.mentions[0].matchedText).toBe("ＬＥＧＡＣＹ ＦＯＲＣＥ");
	});

	it("recognizes domains only at hostname boundaries", () => {
		const text =
			"https://legacy.example.com/jobs に掲載。fakelegacy.example.comとlegacy.example.com.evil.testは対象外。";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions).toHaveLength(1);
		expect(result.mentions[0].matchedText).toBe("legacy.example.com");
		expect(analyzeBrandMentions("fakelegacy.example.com legacy.example.com.evil.test", catalog).mentions).toEqual([]);
	});

	it("does not match blank aliases or short ASCII names inside words", () => {
		const result = analyzeBrandMentions("Rails is available, but this is not OpenAI or a retail sale.", {
			own: { id: "ai", name: "AI", aliases: ["", "  "] },
			competitors: [{ id: "sale", name: "Sale" }],
		});
		expect(result.mentions.map((item) => item.name)).toEqual(["Sale"]);
	});

	it("does not turn citation markers, footnotes, source sections or code into brands", () => {
		const text =
			"一般的な回答です。[1](https://legacy.example.com)\n```\nRails案件.com\n```\n[2]: https://legacy.example.com\n## 参考リンク\n- [Legacy Force](https://legacy.example.com)\n- **サンプルメディア**";
		expect(analyzeBrandMentions(text, catalog).mentions).toEqual([]);
	});

	it("extracts named service links, but not article titles and generic links", () => {
		const text =
			"[サンプルエージェント](https://agent.example.com)から探せます。[公式サイト](https://official.example.com)も確認。[Railsの解説記事](https://news.example.com/article)。";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions.map((item) => [item.name, item.domain])).toEqual([
			["サンプルエージェント", "agent.example.com"],
		]);
	});

	it("keeps numbered heading candidates and their evidence, while excluding generic headings", () => {
		const text =
			"### おすすめ\n### 1. **サンプルエージェント**\n短期案件を扱います。\n### 2. **Legacy Force**\n\n## 注意点\n**メリット**\n* **料金**";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions.map((item) => [item.name, item.rank])).toEqual([
			["サンプルエージェント", 1],
			["Legacy Force", 2],
		]);
		expect(result.mentions[0].evidence).toContain("### 1. **サンプルエージェント**");
	});

	it("retains source list numbers when not every introduction is recognized", () => {
		const result = analyzeBrandMentions("2. Legacy Force\n5. Rails案件.com", catalog);
		expect(result.mentions.map((item) => item.rank)).toEqual([2, 5]);
	});

	it("does not combine separate numbered lists into one absolute ranking", () => {
		const text = "短期向け\n1. Legacy Force\n2. Rails案件.com\n\n長期向け\n1. Sample Tech\n2. サンプルエージェント";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions).toHaveLength(4);
		expect(result.mentions.every((item) => item.rank === null && item.rankBasis === "unknown")).toBe(true);
	});

	it("does not ignore a second contextual list containing only one brand", () => {
		const text = "短期向け\n1. Legacy Force\n2. Rails案件.com\n\n長期向け\n1. Sample Tech";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions).toHaveLength(3);
		expect(result.mentions.every((item) => item.rank === null && item.rankBasis === "unknown")).toBe(true);
	});

	it("leaves ties and two brands in the same item unknown", () => {
		for (const text of ["1. Legacy Force\n1. Rails案件.com", "1. Legacy ForceとRails案件.com\n2. Sample Tech"]) {
			const result = analyzeBrandMentions(text, catalog);
			expect(result.mentions.every((item) => item.rank === null && item.rankBasis === "unknown")).toBe(true);
		}
	});

	it("does not let an introductory own-brand mention override its explicit list rank", () => {
		const result = analyzeBrandMentions("Rails案件.comを含む比較です。\n1. Legacy Force\n2. Rails案件.com", catalog);
		expect(result.mentions.map((item) => [item.name, item.rank])).toEqual([
			["Legacy Force", 1],
			["Rails案件.com", 2],
		]);
	});

	it("keeps the same explicit position when a candidate becomes registered", () => {
		const text = "1. Legacy Force\n2. Rails案件.com\n3. サンプルエージェント";
		const before = analyzeBrandMentions(text, catalog);
		const after = analyzeBrandMentions(text, {
			...catalog,
			competitors: [...catalog.competitors, { id: "agent", name: "サンプルエージェント" }],
		});
		expect(before.mentions[2].kind).toBe("unregistered");
		expect(after.mentions[2].kind).toBe("competitor");
		expect(after.mentions[2].rank).toBe(before.mentions[2].rank);
		expect(mentionFlags(after).competitorsMentioned).toEqual(["Legacy Force", "サンプルエージェント"]);
	});

	it("supports full-width list numbers without changing offsets", () => {
		const text = "１． Legacy Force\n２． Rails案件.com";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions.map((item) => [item.rank, item.rankBasis])).toEqual([
			[1, "explicit"],
			[2, "explicit"],
		]);
		expect(result.mentions[0].firstOffset).toBe(text.indexOf("Legacy"));
	});

	it("uses registered link domains when the visible service label is an alias not yet configured", () => {
		const result = analyzeBrandMentions(
			"[レガシー案件サービス](https://legacy.example.com/jobs)から探せます。",
			catalog,
		);
		expect(result.mentions.map((item) => [item.name, item.kind])).toEqual([["Legacy Force", "competitor"]]);
		expect(result.mentions[0].matchedText).toBe("レガシー案件サービス");
	});

	it("does not reinterpret task list numbers as a recommendation ranking", () => {
		expect(analyzeBrandMentions("1. 案件を探す\n2. 登録する", catalog).mentions).toEqual([]);
		const result = analyzeBrandMentions("1. Legacy Forceに登録する\n2. Rails案件.comの登録フォームを開く", catalog);
		expect(result.mentions.every((item) => item.rankBasis === "appearance")).toBe(true);
	});

	it("does not create a candidate from a citation-only link to an already registered domain", () => {
		for (const text of [
			"[1](https://legacy.example.com/jobs)",
			"**Sources:**\n[レガシー案件サービス](https://legacy.example.com/jobs)",
			"参考\n[レガシー案件サービス](https://legacy.example.com/jobs)",
		]) {
			expect(analyzeBrandMentions(text, catalog).mentions).toEqual([]);
		}
	});

	it("returns an explicit empty analysis for no detected brands", () => {
		expect(analyzeBrandMentions("", catalog)).toEqual({ version: 1, mentions: [], coverage: "detected" });
		expect(mentionFlags(analyzeBrandMentions("一般的な情報です。", catalog))).toEqual({
			brandMentioned: false,
			competitorsMentioned: [],
		});
	});

	it("does not register a combined unregistered introduction as one invented brand", () => {
		expect(analyzeBrandMentions("1. Alpha Agency / Beta Agency\n2. 案件を探す", catalog).mentions).toEqual([]);
	});

	it("keeps rank when a candidate's observed name is registered as an alias of a formal brand name", () => {
		const text = "1. Legacy Force\n2. **サンプルエージェント**";
		const before = analyzeBrandMentions(text, catalog);
		const after = analyzeBrandMentions(text, {
			...catalog,
			competitors: [...catalog.competitors, { id: "agent", name: "Sample Agent", aliases: ["サンプルエージェント"] }],
		});
		expect(before.mentions[1].kind).toBe("unregistered");
		expect(after.mentions[1]).toMatchObject({
			name: "Sample Agent",
			kind: "competitor",
			rank: 2,
			rankBasis: "explicit",
		});
	});

	it("recognizes Japanese circled introduction numbers with original offsets", () => {
		const text = "① Legacy Force\n② Rails案件.com";
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions.map((item) => [item.rank, item.rankBasis])).toEqual([
			[1, "explicit"],
			[2, "explicit"],
		]);
		expect(result.mentions[1].firstOffset).toBe(text.indexOf("Rails"));
	});
});
