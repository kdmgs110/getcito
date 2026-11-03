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

	it("does not turn job headings, prices, evaluation labels or escaped list markers into brands", () => {
		const text = [
			"## 即日参画候補の案件",
			"**\\. Rails受託システム開発**",
			"1. Rails受託システム開発",
			"### Rails受託システム開発メンバー",
			"**受託システム開発 Railsエンジニア**",
			"### 毎年11月3日時点で見つかった案件",
			"**ファンクラブSNS向けバックエンド開発**",
			"**〜60万円/月**",
			"### 評価",
			"**Rating**",
			"**リモート**",
			"**必要スキル**",
			"**合同会社サンプル**",
			"1. **サンプルエージェント**",
			"2. Rails案件.com",
			"3. Legacy Force",
		].join("\n");
		expect(analyzeBrandMentions(text, catalog).mentions.map((item) => [item.name, item.kind])).toEqual([
			["サンプルエージェント", "unregistered"],
			["Rails案件.com", "own"],
			["Legacy Force", "competitor"],
			["合同会社サンプル", "unregistered"],
		]);
	});

	it("extracts base brands from recruitment links without counting citation domains or follow-up requirements", () => {
		const text = [
			"## 即日参画候補の案件",
			"### 1\\. Rails受託システム開発",
			"**50〜60万円/月**",
			"- 勤務形態：リモート",
			"- 技術：Rails",
			"掲載元：Legacy Force・新着案件",
			"[案件詳細・応募はこちら](https://jobs.example.com/item/123)",
			"[FreelanceBoxの応募・募集一覧](https://freelancebox.example.com/jobs)",
			"[TechDirectの案件詳細](https://techdirect.example.com/item/1)",
			"[TechHeroの案件詳細](https://techhero.example.com/item/2)",
			"[freelancebox.example.com](https://freelancebox.example.com/jobs)",
			"[techdirect.example.com +1](https://techdirect.example.com/item/1)",
			"[techhero.example.com](https://techhero.example.com/item/2)",
			"## 追加で確認したい案件",
			"1\\. Railsの実務経験",
			"2\\. 希望勤務形態",
			"3\\. 希望月額単価",
			"4\\. 契約形態",
			"**評価**",
		].join("\n");
		expect(analyzeBrandMentions(text, catalog).mentions.map((item) => [item.name, item.kind])).toEqual([
			["Legacy Force", "competitor"],
			["FreelanceBox", "unregistered"],
			["TechDirect", "unregistered"],
			["TechHero", "unregistered"],
		]);
	});

	it("rejects descriptive headings, follow-up questions and skill or contract labels in realistic answers", () => {
		const text = [
			"## 案件を探す際におすすめのサイト",
			"## 追加で確認したい案件",
			"[TechDirect](https://techdirect.example.com)",
			"**案件詳細・応募ページ**",
			"### Rails以外に実務経験がある技術は何ですか？",
			"**インフルエンサー管理システム**",
			"**コアタイムなし**",
			"- **開発環境・技術スタック**：Ruby on Rails、React",
			"- **IT専門エージェント（Sample Agent、Example Techなど）**",
			"### リモートワーク事情",
			"**React併用Webサービス**",
			"**大規模自社サービス**",
			"### 週3日・柔軟な稼働に強いおすすめエージェント",
			"**フロントエンド**",
			"**非同期コミュニケーション**",
			"**周辺技術のセット要件**",
			"**希望ポジション**",
			"**フリーランス・業務委託**",
			"### 次のステップ",
			"1. **サンプルエージェント**",
			"2. **Example Tech**",
		].join("\n");
		expect(analyzeBrandMentions(text, catalog).mentions.map((item) => item.name)).toEqual([
			"サンプルエージェント",
			"Example Tech",
			"TechDirect",
		]);
	});

	it("normalizes recruiting links and duplicated bold link labels to one entity per brand", () => {
		const text = [
			"[TechDirectで求人詳細・応募](https://techdirect.example.com/jobs/1)",
			"[ITプロパートナーズ・案件詳細](https://partner.example.com/jobs/2)",
			"[Findy FreelanceのRails案件一覧](https://findy.example.com/rails)",
			"[TechDirect](https://techdirect.example.com)",
			"- **Freelance Hub[Freelance Hub](https://hub.example.com/jobs)**",
			"- **サンプルエージェント[サンプルエージェント](https://agent.example.com/jobs)**",
			"[FLEXYの案件紹介](https://flexy.example.com/jobs)",
			"[ZAICOの求人詳細・応募](https://zaico.example.com/jobs)",
			"[SOKUDANのRails求人](https://sokudan.example.com/jobs)",
		].join("\n");
		expect(analyzeBrandMentions(text, catalog).mentions.map((item) => item.name)).toEqual([
			"TechDirect",
			"ITプロパートナーズ",
			"Findy Freelance",
			"Freelance Hub",
			"サンプルエージェント",
			"FLEXY",
			"ZAICO",
			"SOKUDAN",
		]);
	});

	it("keeps a directly linked job-title candidate with its observed destination and alias", () => {
		const title = "Railsフルリモート開発案件";
		const url = "https://jobs.example.com/projects/rails-remote?utm_source=answer";
		const result = analyzeBrandMentions(`1. [${title}](${url})\n2. Rails案件.com`, catalog);
		expect(result.mentions[0]).toMatchObject({
			name: title,
			kind: "unregistered",
			rank: 1,
			rankBasis: "explicit",
			url,
			domain: "jobs.example.com",
			suggestedAliases: [title],
		});
	});

	it("pairs escaped-numbered job titles with their own action links through a price subheading", () => {
		const url = "https://jobs.example.com/project/101";
		const text = [
			"**1\\. Rails受託システム開発メンバー**",
			"# 50〜60万円/月",
			"- 勤務形態：フルリモート",
			`[案件詳細・応募はこちら](${url})`,
			`[jobs.example.com](${url})`,
			"**2\\. Rails案件.com**",
		].join("\n");
		const result = analyzeBrandMentions(text, catalog);
		expect(result.mentions[0]).toMatchObject({
			name: "Rails受託システム開発メンバー",
			url,
			domain: "jobs.example.com",
			suggestedAliases: ["Rails受託システム開発メンバー"],
			rank: 1,
			rankBasis: "explicit",
		});
		expect(result.mentions.map((item) => item.name)).toEqual(["Rails受託システム開発メンバー", "Rails案件.com"]);
	});

	it("does not borrow a URL from a following numbered item or different heading", () => {
		for (const boundary of ["2\\. Rails案件.com", "## 別の候補", "- **Example Tech**", "- Example Tech：別の候補"]) {
			const result = analyzeBrandMentions(
				["1\\. Rails受託システム開発メンバー", boundary, "[案件詳細・応募はこちら](https://next.example.com/job)"].join(
					"\n",
				),
				catalog,
			);
			expect(result.mentions.some((item) => item.name === "Rails受託システム開発メンバー")).toBe(false);
		}
	});

	it("leaves ambiguous or missing sources empty rather than inferring a URL from a domain", () => {
		for (const links of [
			"[詳細](https://one.example.com/job) [応募](https://two.example.com/job)",
			"source.example.com に掲載。",
		]) {
			const result = analyzeBrandMentions(`**サンプルエージェント**\n${links}`, catalog);
			expect(result.mentions.find((item) => item.name === "サンプルエージェント")?.url).toBeUndefined();
		}
	});

	it("keeps configured names and registered link domains even when their labels look generic", () => {
		const result = analyzeBrandMentions("**評価**\n[月額60万円の開発案件](https://legacy.example.com/jobs)", {
			own: { id: "own", name: "評価" },
			competitors: catalog.competitors,
		});
		expect(result.mentions.map((item) => [item.name, item.kind])).toEqual([
			["評価", "own"],
			["Legacy Force", "competitor"],
		]);
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
