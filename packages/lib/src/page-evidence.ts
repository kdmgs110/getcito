import { type QueryEvidence, safeEvidenceUrl } from "./measurement";

export interface EvidencePage {
	url: string;
	key: string;
	domain: string;
	displayDomain: string;
	title?: string;
	sourceField: string;
}

export interface PageEvidenceField {
	status: "known" | "unknown";
	sourceField: string;
	/** Entries are deliberately not deduplicated. */
	items: EvidencePage[];
}

export interface PageEvidence {
	version: 1;
	search: PageEvidenceField;
	citations: PageEvidenceField;
}

export interface PageEvidenceAnswer {
	id: string;
	attemptId?: string | null;
	runId?: string | null;
	createdAt: string;
	targetKey: string;
	provider: string;
	model: string;
	requestContext?: {
		languageCode?: string;
		countryCode?: string;
		targetLanguage?: string | null;
		targetMarket?: string | null;
	} | null;
	evidence: PageEvidence;
}

export interface PageEvidenceHistory {
	id: string;
	attemptId: string | null;
	runId: string | null;
	createdAt: string;
	targetKey: string;
	provider: string;
	model: string;
	searchOccurrences: number;
	searchPresent: boolean | null;
	cited: boolean | null;
}

export interface PageEvidenceRow {
	key: string;
	url: string;
	title: string;
	domain: string;
	displayDomain: string;
	searchAnswers: number;
	searchOccurrences: number;
	citationAnswers: number;
	transitionAnswers: number;
	transitionSearchAnswers: number;
	searchOnlyAnswers: number;
	history: PageEvidenceHistory[];
}

export interface PageEvidenceAggregate {
	totalAnswers: number;
	searchAnswers: number;
	citationAnswers: number;
	commonAnswers: number;
	rows: PageEvidenceRow[];
}

type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
const tracking = new Set(["gclid", "dclid", "fbclid", "msclkid", "_ga", "_gl"]);

/** RFC 3492 display decoding; the ASCII host remains the stable aggregation key. */
export function displayEvidenceDomain(hostname: string): string {
	return hostname
		.split(".")
		.map((label) => {
			if (!label.startsWith("xn--")) return label;
			try {
				const input = label.slice(4);
				const delimiter = input.lastIndexOf("-");
				const output = delimiter < 0 ? [] : Array.from(input.slice(0, delimiter), (char) => char.codePointAt(0) ?? 0);
				let offset = delimiter < 0 ? 0 : delimiter + 1;
				let n = 128;
				let index = 0;
				let bias = 72;
				while (offset < input.length) {
					const previous = index;
					let weight = 1;
					for (let k = 36; ; k += 36) {
						const code = input.charCodeAt(offset++);
						const digit =
							code >= 48 && code <= 57
								? code - 22
								: code >= 65 && code <= 90
									? code - 65
									: code >= 97 && code <= 122
										? code - 97
										: 36;
						if (digit >= 36 || !Number.isSafeInteger(index + digit * weight)) throw new Error("Invalid IDN");
						index += digit * weight;
						const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
						if (digit < threshold) break;
						weight *= 36 - threshold;
					}
					const count = output.length + 1;
					let delta = Math.floor((index - previous) / (previous === 0 ? 700 : 2));
					delta += Math.floor(delta / count);
					let k = 0;
					while (delta > 455) {
						delta = Math.floor(delta / 35);
						k += 36;
					}
					bias = k + Math.floor((36 * delta) / (delta + 38));
					n += Math.floor(index / count);
					if (n > 0x10ffff || n < 0 || (n >= 0xd800 && n <= 0xdfff)) throw new Error("Invalid code point");
					index %= count;
					output.splice(index++, 0, n);
				}
				return String.fromCodePoint(...output);
			} catch {
				return label;
			}
		})
		.join(".");
}

/** Preserve semantic query parameters, path and trailing slash; never fetch canonical URLs. */
export function normalizeEvidencePage(value: unknown, sourceField: string): EvidencePage | null {
	const entry = object(value);
	const url = safeEvidenceUrl(typeof value === "string" ? value : (entry?.url ?? entry?.link ?? entry?.href));
	if (!url) return null;
	const parsed = new URL(url);
	parsed.hash = "";
	for (const name of [...parsed.searchParams.keys()]) {
		if (name.toLowerCase().startsWith("utm_") || tracking.has(name.toLowerCase())) parsed.searchParams.delete(name);
	}
	const domain = parsed.hostname.replace(/^www\./, "");
	const title = typeof entry?.title === "string" ? entry.title.trim() : undefined;
	return {
		url,
		key: parsed.href,
		domain,
		displayDomain: displayEvidenceDomain(domain),
		...(title ? { title } : {}),
		sourceField,
	};
}

function field(value: unknown, sourceField: string, explicitEmpty = false): PageEvidenceField {
	const items = Array.isArray(value)
		? value.flatMap((item) => {
				const page = normalizeEvidencePage(item, sourceField);
				return page ? [page] : [];
			})
		: [];
	return {
		status: items.length > 0 || (explicitEmpty && Array.isArray(value) && value.length === 0) ? "known" : "unknown",
		sourceField,
		items,
	};
}

/** Only provider-reported search results and final-answer sources; no reference SERP or inferred edges. */
export function normalizePageEvidence(
	raw: unknown,
	options: { provider: string; model: string; webSearch?: boolean; queryEvidence?: QueryEvidence[] },
): PageEvidence {
	let payload = raw;
	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch {
			payload = undefined;
		}
	}
	const root = object(Array.isArray(payload) ? payload[0] : payload);
	const unknown = (): PageEvidenceField => ({ status: "unknown", sourceField: "unavailable", items: [] });
	if (!root) return { version: 1, search: unknown(), citations: unknown() };
	if (options.provider === "dataforseo-scraper") {
		const task = Array.isArray(root.tasks) ? object(root.tasks[0]) : undefined;
		const result = Array.isArray(task?.result) ? object(task.result[0]) : undefined;
		if (
			root.status_code !== 20000 ||
			task?.status_code !== 20000 ||
			!result ||
			typeof result.markdown !== "string" ||
			!result.markdown.trim()
		) {
			return { version: 1, search: unknown(), citations: unknown() };
		}
		// A forced-search request does not prove the provider returned a complete
		// empty result set. Empty/null fields remain unknown without a no-search flag.
		const noSearch = result.web_search_triggered === false;
		return {
			version: 1,
			search: field(result.search_results, "tasks[0].result[0].search_results", noSearch),
			citations: field(result.sources, "tasks[0].result[0].sources", noSearch),
		};
	}
	if (options.provider === "brightdata") {
		const noSearch = root.web_search_triggered === false;
		const citationFields =
			options.model === "google-ai-overview"
				? ["aio_citations"]
				: ["citations", "links_attached", "sources", "references"];
		const citationItems = citationFields.flatMap((name) => field(root[name], name, noSearch).items);
		const citationKnown =
			citationItems.length > 0 || citationFields.some((name) => field(root[name], name, noSearch).status === "known");
		let search =
			options.model === "google-ai-overview" ? unknown() : field(root.search_results, "search_results", noSearch);
		// An independent answer-wide result set takes precedence. Only explicit
		// provider query→search-result edges may fill an otherwise unknown set;
		// citation, visited and unknown-role URLs are never retrieval results.
		if (search.status === "unknown" && options.model !== "google-ai-overview") {
			const items = (options.queryEvidence ?? []).flatMap((entry) =>
				entry.urls.flatMap((item) => {
					if (item.role !== "search_result") return [];
					const page = normalizeEvidencePage(item, entry.sourceField);
					return page ? [page] : [];
				}),
			);
			if (items.length) search = { status: "known", sourceField: "queryEvidence", items };
		}
		return {
			version: 1,
			// Organic Google results are not AI Overview retrieval evidence.
			search,
			citations: {
				status: citationKnown ? "known" : "unknown",
				sourceField: citationFields.join(","),
				items: citationItems,
			},
		};
	}
	return { version: 1, search: unknown(), citations: unknown() };
}

/** Deduplicate by stored run identity before counting formal repeated measurements. */
export function aggregatePageEvidence(
	answers: PageEvidenceAnswer[],
	options: { groupBy?: "page" | "domain"; filter?: "all" | "cited" | "search_only" } = {},
): PageEvidenceAggregate {
	const distinct = [
		...new Map(answers.map((answer) => [answer.runId ?? answer.attemptId ?? answer.id, answer])).values(),
	];
	const result: PageEvidenceAggregate = {
		totalAnswers: distinct.length,
		searchAnswers: distinct.filter((answer) => answer.evidence.search.status === "known").length,
		citationAnswers: distinct.filter((answer) => answer.evidence.citations.status === "known").length,
		commonAnswers: distinct.filter(
			(answer) => answer.evidence.search.status === "known" && answer.evidence.citations.status === "known",
		).length,
		rows: [],
	};
	const rows = new Map<string, PageEvidenceRow>();
	const keyFor = (page: EvidencePage) => (options.groupBy === "domain" ? page.domain : page.key);
	for (const answer of distinct) {
		const { search, citations } = answer.evidence;
		const searchCounts = new Map<string, number>();
		const citedKeys = new Set<string>();
		for (const page of [...search.items, ...citations.items]) {
			const key = keyFor(page);
			if (!rows.has(key))
				rows.set(key, {
					key,
					url: page.url,
					title: options.groupBy === "domain" ? page.displayDomain : (page.title ?? page.displayDomain),
					domain: page.domain,
					displayDomain: page.displayDomain,
					searchAnswers: 0,
					searchOccurrences: 0,
					citationAnswers: 0,
					transitionAnswers: 0,
					transitionSearchAnswers: 0,
					searchOnlyAnswers: 0,
					history: [],
				});
			else {
				const row = rows.get(key);
				if (row && options.groupBy !== "domain" && page.title && row.title === page.displayDomain)
					row.title = page.title;
			}
		}
		if (search.status === "known")
			for (const page of search.items) {
				const key = keyFor(page);
				searchCounts.set(key, (searchCounts.get(key) ?? 0) + 1);
			}
		if (citations.status === "known") for (const page of citations.items) citedKeys.add(keyFor(page));
		for (const key of new Set([...searchCounts.keys(), ...citedKeys])) {
			const row = rows.get(key);
			if (!row) continue;
			const occurrences = searchCounts.get(key) ?? 0;
			row.searchOccurrences += occurrences;
			row.searchAnswers += Number(occurrences > 0);
			row.citationAnswers += Number(citedKeys.has(key));
			if (occurrences > 0 && citations.status === "known") {
				row.transitionSearchAnswers++;
				row.transitionAnswers += Number(citedKeys.has(key));
				row.searchOnlyAnswers += Number(!citedKeys.has(key));
			}
			row.history.push({
				id: answer.id,
				attemptId: answer.attemptId ?? null,
				runId: answer.runId ?? null,
				createdAt: answer.createdAt,
				targetKey: answer.targetKey,
				provider: answer.provider,
				model: answer.model,
				searchOccurrences: occurrences,
				searchPresent: search.status === "known" ? occurrences > 0 : null,
				cited: citations.status === "known" ? citedKeys.has(key) : null,
			});
		}
	}
	result.rows = [...rows.values()]
		.filter((row) =>
			options.filter === "cited"
				? row.citationAnswers > 0
				: options.filter === "search_only"
					? row.searchOnlyAnswers > 0 && row.citationAnswers === 0
					: true,
		)
		.sort(
			(a, b) =>
				b.citationAnswers - a.citationAnswers || b.searchAnswers - a.searchAnswers || a.key.localeCompare(b.key),
		);
	return result;
}
