/** Deterministic, provider-independent interpretation of the visible answer, not a new AI request. */
export interface MentionEntity {
	id: string;
	name: string;
	aliases?: string[];
	domains?: string[];
}

export interface MentionCatalog {
	own: MentionEntity;
	competitors: MentionEntity[];
}

export interface BrandMention {
	key: string;
	entityId: string | null;
	name: string;
	kind: "own" | "competitor" | "unregistered";
	rank: number | null;
	rankBasis: "explicit" | "appearance" | "unknown";
	/** UTF-16 offset in the original answer, suitable for showing the evidence. */
	firstOffset: number;
	evidence: string;
	matchedText: string;
	domain?: string;
	/** Exact destination observed in the saved answer; never inferred from a hostname. */
	url?: string;
	suggestedAliases?: string[];
}

export interface BrandMentionAnalysis {
	version: 1;
	mentions: BrandMention[];
	/** Candidate extraction is conservative; this is not a claim to find every brand in arbitrary prose. */
	coverage: "detected";
}

interface Occurrence {
	start: number;
	end: number;
	mention: BrandMention;
}

interface AnswerLine {
	text: string;
	start: number;
	end: number;
	number: number | null;
	itemStart: number;
	list: number;
}

function normalized(value: string): string {
	return value.normalize("NFKC").toLowerCase().trim();
}

function domainOf(value: string): string | undefined {
	try {
		const url = new URL(value.includes("://") ? value : `https://${value}`);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
		return url.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return undefined;
	}
}

/** Preserve source offsets even when full-width or combining characters normalize to different lengths. */
function normalizedSource(text: string): { value: string; starts: number[]; ends: number[] } {
	let value = "";
	const starts: number[] = [];
	const ends: number[] = [];
	for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
		const part = segment.segment.normalize("NFKC").toLowerCase();
		value += part;
		for (let i = 0; i < part.length; i++) {
			starts.push(segment.index);
			ends.push(segment.index + segment.segment.length);
		}
	}
	return { value, starts, ends };
}

const asciiWord = /[\p{Script=Latin}\p{N}_]/u;

function bounded(source: string, start: number, end: number, needle: string, domain = false): boolean {
	const before = source[start - 1] ?? "";
	const after = source[end] ?? "";
	// Latin names should not match inside other words (e.g. "AI" in "Rails").
	if (asciiWord.test(needle[0]) && asciiWord.test(before)) return false;
	if (asciiWord.test(needle.at(-1) ?? "") && asciiWord.test(after)) return false;
	// Avoid accepting a configured domain as a suffix/prefix in a different hostname.
	if (domain && (/[\w.-]/.test(before) || /[\w.-]/.test(after))) return false;
	return true;
}

function evidenceAt(text: string, offset: number): string {
	const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
	const next = text.indexOf("\n", offset);
	const end = next === -1 ? text.length : next;
	const start = Math.max(lineStart, offset - 100);
	return text.slice(start, Math.min(end, offset + 200)).trim();
}

/** Mask non-answer markup and citation-only sections rather than treating publishers as recommended brands. */
function visibleAnswer(text: string): string {
	let value = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|<[^>]*>/g, (match) => match.replace(/[^\n]/g, " "));
	const sourceHeading =
		/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:sources?|references?|citations?|出典|参考|参考情報|参考資料|参考文献|参考リンク|参照|参照元|引用元)\s*[:：]?(?:\*\*)?\s*$/im.exec(
			value,
		);
	if (sourceHeading)
		value = value.slice(0, sourceHeading.index) + value.slice(sourceHeading.index).replace(/[^\n]/g, " ");
	// Footnote definitions and numeric citation links do not assert a brand mention.
	value = value.replace(/^\s*\[\^?\d+\]:.*$/gm, (match) => " ".repeat(match.length));
	value = value.replace(/\[(?:\^?\d+(?:[,、\s-]+\d+)*|source|出典|参考)\]\([^\n)]*\)/gi, (match) =>
		" ".repeat(match.length),
	);
	// Remove markdown destinations while retaining the readable link label.
	value = value.replace(/(!?)\[([^\]\n]*)\]\(([^\n)]*)\)/g, (match, image: string, label: string) => {
		if (image) return " ".repeat(match.length);
		return ` ${label}${" ".repeat(match.length - label.length - 1)}`;
	});
	return value;
}

function answerLines(text: string): AnswerLine[] {
	let offset = 0;
	let list = 0;
	let previousNumber: number | null = null;
	return text.split("\n").map((line) => {
		const source = normalizedSource(line);
		// NFKC turns circled digits into bare digits, so capture their prefix before normalization.
		const circled = /^\s*(?:#{1,6}\s*)?(?:\*\*)?([①-⑳])\s*/u.exec(line);
		const parsed = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:(\d{1,3})\\?[.)、]\s+|第\s*(\d{1,3})\s*位\s*[:：.、]?\s*)/u.exec(
			source.value,
		);
		const number = circled ? circled[1].charCodeAt(0) - 0x2460 + 1 : parsed ? Number(parsed[1] ?? parsed[2]) : null;
		if (number !== null) {
			if (previousNumber === null || number <= previousNumber) list++;
			previousNumber = number;
		} else if (/^\s*#{1,6}\s+/.test(line) && !/(?:\d[\d,.〜～~\s]*万?円|\d.*[/／]月)/u.test(line)) {
			previousNumber = null;
		}
		const result = {
			text: line,
			start: offset,
			end: offset + line.length,
			number,
			itemStart: offset + (circled ? circled[0].length : parsed ? source.ends[parsed[0].length - 1] : 0),
			list: number === null ? 0 : list,
		};
		offset += line.length + 1;
		return result;
	});
}

const genericName =
	/^(?:おすすめ(?:の)?(?:サービス|ブランド|企業|会社|エージェント)?|サービス|ブランド|企業|会社|公式(?:サイト|ページ|ホームページ)?|こちら|詳細|詳しくはこちら|比較|比較表|まとめ|結論|注意点|メリット|デメリット|特徴|料金|価格|単価|相場|求人|案件|出典|参考|引用|sources?|references?|source|website|official(?:\s+site)?|learn more|read more|click here|details|メリット・デメリット|使い方|登録方法|選び方|フルリモート|リモートワーク|稼働日数|エージェント|案件検索|検索結果)$/i;

function candidateName(value: string): string | null {
	const name = value
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[*_`]/g, "")
		.replace(
			/(?:の|で|・)(?:(?:[a-zA-Z0-9 .+#-]{0,25})?(?:案件|求人)(?:詳細|一覧|紹介)?|応募(?:・募集)?一覧|募集一覧).*$/u,
			"",
		)
		.replace(/^\s*(?:[-•●]\s*|#{1,6}\s*)/, "")
		.replace(/^\s*(?:第?\s*\d+\s*位?\s*\\?[.:：、．)）-]?\s*)/, "")
		.split(/\s+[—–−-]\s+|[：:]|[（(]|\s*[|｜]\s*/)[0]
		.trim()
		.replace(/[。．、,;；]+$/, "")
		.trim()
		.replace(/^(.+?)\s+\1$/u, "$1")
		.replace(/\s+[^ \n]*(?:支店|拠点|支社)$/u, "");
	if (name.length < 2 || name.length > 60 || !/[\p{L}\p{N}]/u.test(name)) return null;
	if (genericName.test(name) || /^[\d\s.,%％¥￥$]+$/.test(name)) return null;
	// A combined label is not evidence of a single brand; manual entry can disambiguate it.
	if (/\s+[／/]\s+|[、]/u.test(name)) return null;
	if (
		/https?:\/\/|[<>\n\r]|(?:です|ます|ください|しましょう|について|する方法|する|を探す|を比較|を確認|のメリット|のデメリット|の特徴|の選び方|の使い方|の登録方法)[。！!？?]?$/u.test(
			name,
		)
	)
		return null;
	if (/^(?:おすすめ|比較|まとめ|注意|手順|条件|ポイント|選び方|まず|次に|ステップ|step\s*\d)/i.test(name)) return null;
	return name;
}

/** Formatting alone does not make an ordinary heading, job title, or price a brand. */
function plausibleUnregisteredBrand(name: string, grounded = false): boolean {
	const value = normalized(name);
	if (/\\|^[^\p{L}\p{N}]|[。！？!?]/u.test(value)) return false;
	// Bare publisher/domain citation labels are not recommendations of that publisher as a brand.
	if (/^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?:\s*\+\s*\d+)?$/u.test(value)) return false;
	if (
		/(?:[~〜～¥￥$€£]\s*\d|\d[\d,.]*\s*(?:万|千|億)?\s*(?:円|ドル)|\d\s*[%％]|[/／]\s*(?:月|年|時|日|hour|month|year))/iu.test(
			value,
		)
	)
		return false;
	if (
		/^(?:評価|評判|口コミ|総評|概要|基本情報|対象者|対象|用途|補足|備考|参考情報|関連情報|スキル|必要スキル|技術スタック|リモート|勤務条件|契約条件|報酬|月額|月単価|開発内容|仕事内容|業務内容|採用条件|おすすめポイント|ランキング|メリット|デメリット|pros|cons|overview|summary|rating|ratings|reviews?|pricing|price|cost|features?|benefits?|salary|requirements?|recommendations?|remote|skills?|conclusion|next steps)$/iu.test(
			value,
		)
	)
		return false;
	// Corporate legal forms are stronger evidence than a generic ending in a real company name.
	if (/(?:株式会社|合同会社|有限会社|合資会社|合名会社)/u.test(value)) return true;
	if (
		/(?:希望|必須|必要|環境|要件|働き方|探す|探せる|探し|使える|使いたい|べき|伝え方|アピール|成功させる|おすすめ|時点|見つかった|確認したい|教えて|質問)/u.test(
			value,
		)
	)
		return false;
	if (
		/(?:事情|状況|条件|形態|市場|特徴|傾向|方法|ポイント|コツ|ステップ|年数|情報|詳細|一覧|採用|なし|可能|コミュニケーション|インフラ|フロントエンド|バックエンド|ポジション|コメント)$/u.test(
			value,
		)
	)
		return false;
	// A descriptive job title can be an actionable candidate when its own item supplies its source URL.
	if (
		grounded &&
		/(?:開発|受託|運用|保守|構築|設計|エンジニア|デザイナー|メンバー|テックリード|テスト|システム|サービス|プロダクト|案件$|求人$)/u.test(
			value,
		)
	)
		return true;
	// Job/contract/skill labels and descriptive prose are not entity introductions, even when bold or numbered.
	if (
		/(?:案件|求人|募集|開発|経験|実務|スキル|技術|契約|稼働|勤務|業務|報酬|単価|希望|必須|必要|専門|受託|自社|併用|環境|要件|働き方|探す|探せる|探し|使える|使いたい|べき|伝え方|アピール|成功させる)/u.test(
			value,
		)
	)
		return false;
	if (
		/(?:事情|状況|条件|形態|市場|特徴|傾向|方法|ポイント|コツ|ステップ|年数|情報|詳細|一覧|採用|支援|なし|可能|メイン|サービス|システム|プロダクト|コミュニケーション|インフラ|フロントエンド|バックエンド|ポジション|コメント)$/u.test(
			value,
		)
	)
		return false;
	if (/[・／]|\s[×x+]\s/u.test(value)) return false;
	if (
		/(?:受託|システム|バックエンド|フロントエンド|アプリ|sns).*(?:開発|構築|運用)|(?:メンバー|エンジニア|デザイナー|ディレクター|テックリード|テスト|developer|engineer)$/iu.test(
			value,
		)
	)
		return false;
	if (
		/(?:案件|求人|募集|候補|参画|受託|開発|運用|保守|構築|設計|料金|価格|単価|相場|比較|評価|評判|口コミ|実務経験|について|向け|はこちら)$/u.test(
			value,
		)
	)
		return false;
	// Unknown all-kanji/hiragana headings are especially ambiguous; users can add a missed brand manually.
	return /[a-z]|[\p{Script=Katakana}ー]{2}/iu.test(value);
}

export function analyzeBrandMentions(text: string, catalog: MentionCatalog): BrandMentionAnalysis {
	if (!text.trim()) return { version: 1, mentions: [], coverage: "detected" };
	const visible = visibleAnswer(text);
	const normalizedText = normalizedSource(visible);
	const occurrences: Occurrence[] = [];
	const entities = [
		{ entity: catalog.own, kind: "own" as const },
		...catalog.competitors.map((entity) => ({ entity, kind: "competitor" as const })),
	];
	for (const { entity, kind } of entities) {
		const terms = [
			...[entity.name, ...(entity.aliases ?? [])].map((value) => ({ value: normalized(value), domain: false })),
			...(entity.domains ?? []).flatMap((value) => {
				const domain = domainOf(value);
				return domain ? [{ value: domain, domain: true }] : [];
			}),
		].filter((term) => term.value.length > 0);
		for (const term of terms) {
			let index = normalizedText.value.indexOf(term.value);
			while (index !== -1) {
				const end = index + term.value.length;
				if (bounded(normalizedText.value, index, end, term.value, term.domain)) {
					const start = normalizedText.starts[index];
					const originalEnd = normalizedText.ends[end - 1];
					occurrences.push({
						start,
						end: originalEnd,
						mention: {
							key: `${kind}:${entity.id}`,
							entityId: entity.id,
							name: entity.name,
							kind,
							rank: null,
							rankBasis: "unknown",
							firstOffset: start,
							evidence: evidenceAt(text, start),
							matchedText: text.slice(start, originalEnd),
						},
					});
				}
				index = normalizedText.value.indexOf(term.value, end);
			}
		}
	}

	const originalLines = answerLines(visible);
	const links = [...text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"\n]*")?\)/g)].flatMap((match) => {
		const start = (match.index ?? 0) + 1;
		const domain = domainOf(match[2]);
		if (!domain || !visible.slice(start, start + match[1].length).trim()) return [];
		return [{ start, label: match[1], name: candidateName(match[1]), domain, url: match[2] }];
	});
	type Candidate = { name: string; start: number; domain?: string; url?: string; suggestedAliases?: string[] };
	const candidates: Candidate[] = [];
	for (const [lineIndex, originalLine] of originalLines.entries()) {
		const line = originalLine.text;
		const contentStart = originalLine.itemStart;
		const itemText = line.slice(contentStart - originalLine.start);
		const bold = /^(?:\s*(?:[-*•●]\s*|#{1,6}\s*)?)\*\*([^*\n]+)\*\*/.exec(itemText);
		const heading = /^\s*#{1,6}\s+(.+)$/.exec(line);
		const proposed = bold?.[1] ?? heading?.[1] ?? (originalLine.number !== null ? itemText : null);
		if (!proposed) continue;
		const name = candidateName(proposed);
		if (!name) continue;
		const exactIndex = line.indexOf(name);
		const start = exactIndex === -1 ? contentStart : originalLine.start + exactIndex;
		// A following introduction/section ends this item's ownership of links. Price subheadings do not.
		let end = text.length;
		for (const next of originalLines.slice(lineIndex + 1)) {
			const nextHeading = /^\s*#{1,6}\s+(.+)$/.exec(next.text);
			const nextBold = /^\s*(?:[-*•●]\s*)?\*\*([^*\n]+)\*\*/.exec(next.text);
			const nextName = nextBold ? candidateName(nextBold[1]) : null;
			const nextBullet = /^\s*[-*•●]\s+(.+)$/.exec(next.text);
			const bulletName = nextBullet ? candidateName(nextBullet[1]) : null;
			const priceHeading = nextHeading && /(?:\d[\d,.〜～~\s]*万?円|\d.*[/／]月)/u.test(nextHeading[1]);
			if (
				next.number !== null ||
				/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(next.text) ||
				(nextHeading && !priceHeading) ||
				(nextName && plausibleUnregisteredBrand(nextName, true)) ||
				(bulletName && plausibleUnregisteredBrand(bulletName))
			) {
				end = next.start;
				break;
			}
		}
		const itemLinks = links.filter((link) => link.start >= originalLine.start && link.start < end);
		const urls = new Set(itemLinks.map((link) => link.url));
		const source = urls.size === 1 ? itemLinks[0] : undefined;
		candidates.push({
			name,
			start,
			...(source
				? {
						domain: source.domain,
						url: source.url,
						suggestedAliases: [
							...new Set([
								name,
								...itemLinks.flatMap((link) => (link.name && plausibleUnregisteredBrand(link.name) ? [link.name] : [])),
							]),
						],
					}
				: {}),
		});
	}
	// Named links carry their observed destination, including when the label is a grounded job title.
	for (const link of links) {
		const { start, name, domain, url } = link;
		if (!name || /^(?:\d+|\^\d+)$/.test(name)) continue;
		if (
			name.length > 40 ||
			/[。！？!?]|(?:の記事|ニュース|の解説|について|ガイド|解説記事|はこちら|はこちらから)/.test(name)
		)
			continue;
		const registered = entities.find(({ entity }) => (entity.domains ?? []).some((item) => domainOf(item) === domain));
		if (registered) {
			const { entity, kind } = registered;
			occurrences.push({
				start,
				end: start + link.label.length,
				mention: {
					key: `${kind}:${entity.id}`,
					entityId: entity.id,
					name: entity.name,
					kind,
					rank: null,
					rankBasis: "unknown",
					firstOffset: start,
					evidence: evidenceAt(text, start),
					matchedText: link.label,
					domain,
					url,
					suggestedAliases: [name],
				},
			});
		} else candidates.push({ name, start, domain, url, suggestedAliases: [name] });
	}
	for (const candidate of candidates) {
		const candidateEnd = candidate.start + candidate.name.length;
		// A named entity inside a heading/link takes precedence over an unregistered duplicate.
		const registeredMatches = occurrences.filter((item) => item.start < candidateEnd && item.end > candidate.start);
		if (registeredMatches.length) {
			for (const { mention } of registeredMatches)
				if (candidate.url && !mention.url) {
					mention.url = candidate.url;
					mention.domain = candidate.domain;
					mention.suggestedAliases = candidate.suggestedAliases;
				}
			continue;
		}
		if (!plausibleUnregisteredBrand(candidate.name, !!candidate.url)) continue;
		const canonical = normalized(candidate.name);
		if (!canonical) continue;
		occurrences.push({
			start: candidate.start,
			end: candidateEnd,
			mention: {
				key: `unregistered:${canonical}`,
				entityId: null,
				name: candidate.name,
				kind: "unregistered",
				rank: null,
				rankBasis: "unknown",
				firstOffset: candidate.start,
				evidence: evidenceAt(text, candidate.start),
				matchedText: text.slice(candidate.start, candidateEnd),
				...(candidate.domain ? { domain: candidate.domain } : {}),
				...(candidate.url ? { url: candidate.url, suggestedAliases: candidate.suggestedAliases } : {}),
			},
		});
	}

	// Prefer the longest match on overlaps: a short alias must not create a second entity inside a longer brand.
	const kindOrder = { own: 0, competitor: 1, unregistered: 2 };
	occurrences.sort(
		(a, b) =>
			a.start - b.start ||
			b.end - a.end ||
			kindOrder[a.mention.kind] - kindOrder[b.mention.kind] ||
			Number(!!b.mention.domain) - Number(!!a.mention.domain),
	);
	const kept: Occurrence[] = [];
	for (const occurrence of occurrences) {
		if (kept.some((item) => item.start <= occurrence.start && item.end >= occurrence.end)) continue;
		kept.push(occurrence);
	}
	const firstByKey = new Map<string, BrandMention>();
	for (const occurrence of kept) {
		const existing = firstByKey.get(occurrence.mention.key);
		if (!existing) firstByKey.set(occurrence.mention.key, occurrence.mention);
		else {
			if (!existing.domain && occurrence.mention.domain) existing.domain = occurrence.mention.domain;
			if (!existing.url && occurrence.mention.url) {
				existing.url = occurrence.mention.url;
				existing.suggestedAliases = occurrence.mention.suggestedAliases;
			}
		}
	}
	const mentions = [...firstByKey.values()];
	const numbered = new Map<number, { number: number; key: string; offset: number }[]>();
	for (const line of originalLines) {
		if (line.number === null) continue;
		const inLine = kept.filter((item) => item.start >= line.itemStart && item.start < line.end);
		// A numbered instruction merely mentioning a brand is not a ranked brand introduction.
		const first = inLine[0];
		if (!first || line.text.slice(line.itemStart - line.start, first.start - line.start).replace(/[*_[\]#\s]/g, ""))
			continue;
		const afterFirst = visible.slice(first.end, line.end).replace(/^[*_\]]+/, "");
		if (inLine.length === 1 && afterFirst && !/^[\s(（:：,、。—–−\-/／|｜]/u.test(afterFirst)) continue;
		const keys = [...new Set(inLine.map((item) => item.mention.key))];
		if (!keys.length) continue;
		const items = numbered.get(line.list) ?? [];
		for (const key of keys) items.push({ number: line.number, key, offset: line.itemStart });
		numbered.set(line.list, items);
	}
	const brandLists = [...numbered.values()].filter((items) => items.length >= 2);
	if (brandLists.length === 1 && numbered.size === 1) {
		const items = brandLists[0];
		const duplicateNumbers = items.some((item, i) => items.some((other, j) => i !== j && item.number === other.number));
		const duplicateBrands = items.some((item, i) => items.some((other, j) => i !== j && item.key === other.key));
		if (!duplicateNumbers && !duplicateBrands) {
			for (const mention of mentions) {
				const item = items.find((value) => value.key === mention.key);
				if (item) {
					mention.rank = item.number;
					mention.rankBasis = "explicit";
				}
			}
		} // Multiple brands in one numbered item are ambiguous, so their ranks remain unknown.
	} else if (brandLists.length === 0 && [...numbered.values()].flat().length < 2) {
		for (const [index, mention] of mentions.entries()) {
			mention.rank = index + 1;
			mention.rankBasis = "appearance";
		}
	}
	mentions.sort(
		(a, b) =>
			(a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.firstOffset - b.firstOffset,
	);
	return { version: 1, mentions, coverage: "detected" };
}

export function mentionFlags(analysis: BrandMentionAnalysis): {
	brandMentioned: boolean;
	competitorsMentioned: string[];
} {
	return {
		brandMentioned: analysis.mentions.some((mention) => mention.kind === "own"),
		competitorsMentioned: [
			...new Set(analysis.mentions.filter((mention) => mention.kind === "competitor").map((mention) => mention.name)),
		],
	};
}
