/**
 * Functions for extracting text content and citations from stored rawOutput.
 *
 * Each provider stores rawOutput in a different format. These functions handle
 * re-reading that stored data for display in the UI (prompt detail pages, reports).
 *
 * For new prompt runs, the Provider.run() method normalizes output into ScrapeResult
 * at write time, so these functions are primarily for reading historical data.
 */

import { safeEvidenceUrl } from "./measurement";

// ============================================================================
// Text extraction by provider
// ============================================================================

export function extractTextFromOpenAI(rawOutput: any): string {
	try {
		if (rawOutput?.output && Array.isArray(rawOutput.output)) {
			const messageOutputs = rawOutput.output.filter((item: any) => item.type === "message");
			if (messageOutputs.length > 0) {
				const texts: string[] = [];
				for (const messageOutput of messageOutputs) {
					if (messageOutput.content && Array.isArray(messageOutput.content)) {
						for (const c of messageOutput.content) {
							if (c.type === "output_text" && c.text) texts.push(c.text);
						}
					}
				}
				if (texts.length > 0) return texts.join("\n");
			}
		}
		if (rawOutput?.choices?.[0]?.message?.content) return rawOutput.choices[0].message.content;
		if (typeof rawOutput?.text === "string") return rawOutput.text;
		return "No text content found in OpenAI output.";
	} catch (error) {
		console.error("Error extracting text from OpenAI output:", error);
		return "Error extracting text content.";
	}
}

export function extractTextFromAnthropic(rawOutput: any): string {
	try {
		if (rawOutput && Array.isArray(rawOutput.content)) {
			const textBlocks = rawOutput.content.filter((block: any) => block.type === "text");
			return textBlocks.map((block: any) => block.text).join("\n");
		}
		return "No text content found in Anthropic output.";
	} catch (error) {
		console.error("Error extracting text from Anthropic output:", error);
		return "Error extracting text content.";
	}
}

export function extractTextFromGoogle(rawOutput: any): string {
	return extractTextFromDataforseo(rawOutput);
}

export function extractTextFromDataforseo(rawOutput: any): string {
	try {
		const result = rawOutput?.tasks?.[0]?.result?.[0];
		if (result) {
			const items = result.items || [];
			// AI Optimization LLM Responses (chatgpt/perplexity/gemini) use
			// items[].sections[].text; the SERP Google AI Mode shape below uses
			// items[].type === "ai_overview". Detect and delegate.
			if (items.some((item: any) => Array.isArray(item?.sections))) {
				return extractTextFromDataforseoLlm(rawOutput);
			}
			const aiOverviewItems = items.filter((item: any) => item.type === "ai_overview");
			if (aiOverviewItems.length > 0 && aiOverviewItems[0].markdown) {
				return aiOverviewItems[0].markdown;
			}
		}
		return "No AI overview content found.";
	} catch (error) {
		console.error("Error extracting text from DataForSEO output:", error);
		return "Error extracting text content.";
	}
}

/**
 * Text extraction for DataForSEO's AI Optimization "LLM Responses" API
 * (chatgpt / perplexity / gemini), which has a different shape from the SERP
 * Google AI Mode response handled by extractTextFromDataforseo:
 *   tasks[].result[].items[].sections[].{type:"text", text}
 * The reasoning items (type "reasoning") are skipped; only message text is kept.
 */
export function extractTextFromDataforseoLlm(rawOutput: any): string {
	try {
		const result = rawOutput?.tasks?.[0]?.result?.[0];
		if (!result) return "No text content found in DataForSEO LLM output.";
		const texts: string[] = [];
		for (const item of result.items ?? []) {
			if (item?.type === "reasoning") continue;
			for (const section of item?.sections ?? []) {
				if (typeof section?.text === "string" && section.text.trim()) {
					texts.push(section.text.trim());
				}
			}
		}
		if (texts.length) return texts.join("\n");
		return "No text content found in DataForSEO LLM output.";
	} catch (error) {
		console.error("Error extracting text from DataForSEO LLM output:", error);
		return "Error extracting text content.";
	}
}

export function extractTextFromMistral(rawOutput: any): string {
	try {
		// Conversations API (web search enabled): outputs[].content[].text chunks.
		if (Array.isArray(rawOutput?.outputs)) {
			const texts: string[] = [];
			for (const entry of rawOutput.outputs) {
				for (const chunk of entry?.content ?? []) {
					if (chunk?.type === "text" && typeof chunk.text === "string") texts.push(chunk.text);
				}
			}
			if (texts.length) return texts.join("\n");
		}
		// Chat Completions API (no web search): OpenAI-shaped.
		if (rawOutput?.choices?.[0]?.message?.content) return rawOutput.choices[0].message.content;
		return "No text content found in Mistral output.";
	} catch {
		return "Error extracting text content.";
	}
}

export function extractTextFromOpenRouter(rawOutput: any): string {
	try {
		if (rawOutput?.choices?.[0]?.message?.content) return rawOutput.choices[0].message.content;
		if (rawOutput?.output && Array.isArray(rawOutput.output)) {
			const texts: string[] = [];
			for (const msg of rawOutput.output.filter((i: any) => i.type === "message")) {
				for (const c of msg.content ?? []) {
					if (c.type === "output_text" && c.text) texts.push(c.text);
				}
			}
			if (texts.length) return texts.join("\n");
		}
		return "No text content found in OpenRouter output.";
	} catch {
		return "Error extracting text content.";
	}
}

export function extractTextFromOlostep(rawOutput: any): string {
	try {
		const jsonStr = rawOutput?.json_content ?? rawOutput?.result?.json_content;
		const parsed = typeof jsonStr === "string" ? JSON.parse(jsonStr) : rawOutput;
		if (parsed?.result?.markdown_content) return parsed.result.markdown_content;
		if (parsed?.answer_markdown) return parsed.answer_markdown;
		if (parsed?.result?.text_content) return parsed.result.text_content;
		if (typeof parsed?.answer === "string") return parsed.answer;
		return "No text content found in Olostep output.";
	} catch {
		return "Error extracting text content.";
	}
}

export function extractTextFromBrightdata(rawOutput: any): string {
	try {
		const record = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;
		if (!record) return "No content in BrightData output.";
		for (const key of [
			"aio_text",
			"answer_text_markdown",
			"answer_text",
			"answer",
			"response_raw",
			"response",
			"text",
			"content",
		]) {
			if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
		}

		if (record.general?.search_engine === "google" || record.input?.url === "https://google.com/aimode") {
			return "No Google AI mode invoked.";
		}

		return "No text content found in BrightData output.";
	} catch {
		return "Error extracting text content.";
	}
}

export function extractTextFromOxylabs(rawOutput: any): string {
	try {
		const content = rawOutput?.results?.[0]?.content;
		if (!content) return "No content in Oxylabs output.";
		for (const key of [
			"markdown_text", // ChatGPT parsed
			"answer_results_md", // Perplexity parsed
			"response_text", // ChatGPT / Google AI Mode fallback
			"answer_text",
			"answer",
		]) {
			if (typeof content[key] === "string" && content[key].trim()) return content[key].trim();
		}
		return "No text content found in Oxylabs output.";
	} catch {
		return "Error extracting text content.";
	}
}

/**
 * The answer object inside a Cloro task `response`, or null when there isn't
 * one. Chatbot tasks (ChatGPT, Perplexity, Copilot, Gemini) and Google AI Mode
 * put the answer at the top level; the Google AI Overview task nests it under
 * `aioverview`, which is null when Google showed no overview.
 */
export function cloroAnswer(rawOutput: any): Record<string, any> | null {
	const answer =
		rawOutput && typeof rawOutput === "object" && "aioverview" in rawOutput ? rawOutput.aioverview : rawOutput;
	return answer && typeof answer === "object" ? answer : null;
}

export function extractTextFromCloro(rawOutput: any): string {
	try {
		const answer = cloroAnswer(rawOutput);
		if (!answer) return "No content in Cloro output.";
		for (const key of ["text", "markdown"]) {
			if (typeof answer[key] === "string" && answer[key].trim()) return answer[key].trim();
		}
		return "No text content found in Cloro output.";
	} catch {
		return "Error extracting text content.";
	}
}

/**
 * Extract text content from stored rawOutput.
 * Dispatches based on provider (how data was fetched), falling back to engine
 * (for old data where provider column may be null).
 */
export function extractTextContent(rawOutput: any, providerOrEngine: string): string {
	switch (providerOrEngine) {
		case "openai-api":
		case "openai":
		case "chatgpt":
			return extractTextFromOpenAI(rawOutput);
		case "anthropic-api":
		case "anthropic":
		case "claude":
			return extractTextFromAnthropic(rawOutput);
		case "mistral-api":
			return extractTextFromMistral(rawOutput);
		case "dataforseo-scraper": {
			const markdown = rawOutput?.tasks?.[0]?.result?.[0]?.markdown;
			return typeof markdown === "string" && markdown.trim()
				? markdown.trim()
				: "No text content found in DataForSEO LLM Scraper output.";
		}
		case "dataforseo":
		case "google":
		case "google-ai-mode":
		case "google-ai-overview":
			return extractTextFromDataforseo(rawOutput);
		case "openrouter":
			return extractTextFromOpenRouter(rawOutput);
		case "olostep":
			return extractTextFromOlostep(rawOutput);
		case "brightdata":
			return extractTextFromBrightdata(rawOutput);
		case "oxylabs":
			return extractTextFromOxylabs(rawOutput);
		case "cloro":
			return extractTextFromCloro(rawOutput);
		default:
			return tryGenericExtraction(rawOutput);
	}
}

function tryGenericExtraction(rawOutput: any): string {
	if (!rawOutput) return "No content.";
	if (typeof rawOutput === "string") return rawOutput;
	if (rawOutput?.choices?.[0]?.message?.content) return rawOutput.choices[0].message.content;
	if (rawOutput?.answer_markdown) return rawOutput.answer_markdown;
	if (rawOutput?.answer_text) return rawOutput.answer_text;
	if (rawOutput?.content?.[0]?.text) return rawOutput.content[0].text;
	return "Unknown provider format - cannot extract text content.";
}

// ============================================================================
// Citation extraction by provider
// ============================================================================

export type Citation = {
	url: string;
	title?: string;
	domain: string;
	citationIndex: number;
};

/** Only explicitly cited answer sources; retrieved search results are separate. */
export function extractCitationsFromDataforseoScraper(rawOutput: unknown): Citation[] {
	const payload = rawOutput as { tasks?: Array<{ result?: Array<{ sources?: unknown }> }> } | null;
	const sources = payload?.tasks?.[0]?.result?.[0]?.sources;
	if (!Array.isArray(sources)) return [];
	const seen = new Set<string>();
	return sources.flatMap((source: unknown) => {
		if (!source || typeof source !== "object" || Array.isArray(source)) return [];
		const value = source as Record<string, unknown>;
		const url = safeEvidenceUrl(value.url);
		if (!url || seen.has(url)) return [];
		seen.add(url);
		return [
			{
				url,
				title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : undefined,
				domain: new URL(url).hostname.replace(/^www\./, ""),
				citationIndex: seen.size - 1,
			},
		];
	});
}

function parseCitationUrl(url: string, title: string | undefined, idx: number): Citation | null {
	try {
		const parsed = new URL(url);
		return {
			url,
			title: title || undefined,
			domain: parsed.hostname.replace(/^www\./, ""),
			citationIndex: idx,
		};
	} catch {
		return null;
	}
}

export function extractCitationsFromOpenAI(rawOutput: any): Citation[] {
	try {
		const citations: Citation[] = [];
		let idx = 0;
		if (rawOutput?.output && Array.isArray(rawOutput.output)) {
			for (const msg of rawOutput.output.filter((i: any) => i.type === "message")) {
				for (const content of msg.content ?? []) {
					if (content.type === "output_text" && Array.isArray(content.annotations)) {
						for (const ann of content.annotations) {
							if (ann.type === "url_citation" && ann.url) {
								const c = parseCitationUrl(ann.url, ann.title, idx);
								if (c) {
									citations.push(c);
									idx++;
								}
							}
						}
					}
				}
			}
		}
		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromGoogle(rawOutput: any): Citation[] {
	return extractCitationsFromDataforseo(rawOutput);
}

export function extractCitationsFromDataforseo(rawOutput: any): Citation[] {
	try {
		const citations: Citation[] = [];
		let idx = 0;
		const items = rawOutput?.tasks?.[0]?.result?.[0]?.items ?? [];
		// AI Optimization LLM Responses (chatgpt/perplexity/gemini) carry
		// citations in items[].sections[].annotations[]; delegate when present.
		if (items.some((item: any) => Array.isArray(item?.sections))) {
			return extractCitationsFromDataforseoLlm(rawOutput);
		}
		for (const aiOverview of items.filter((i: any) => i.type === "ai_overview")) {
			for (const ref of aiOverview.references ?? []) {
				if (ref.url) {
					const c = parseCitationUrl(ref.url, ref.title, idx);
					if (c) {
						citations.push(c);
						idx++;
					}
				}
			}
		}
		return citations;
	} catch {
		return [];
	}
}

/**
 * Citation extraction for DataForSEO's AI Optimization "LLM Responses" API.
 * Sources live at tasks[].result[].items[].sections[].annotations[].{title,url}.
 * annotations is null when web_search was disabled, and may be empty when web
 * search ran but cited nothing. Duplicate URLs are de-duped.
 */
export function extractCitationsFromDataforseoLlm(rawOutput: any): Citation[] {
	try {
		const citations: Citation[] = [];
		const seen = new Set<string>();
		let idx = 0;
		const result = rawOutput?.tasks?.[0]?.result?.[0];
		for (const item of result?.items ?? []) {
			for (const section of item?.sections ?? []) {
				for (const ann of section?.annotations ?? []) {
					const url = ann?.url;
					if (!url || typeof url !== "string" || !url.startsWith("http")) continue;
					if (seen.has(url)) continue;
					seen.add(url);
					const c = parseCitationUrl(url, ann.title, idx);
					if (c) {
						citations.push(c);
						idx++;
					}
				}
			}
		}
		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromMistral(rawOutput: any): Citation[] {
	try {
		const citations: Citation[] = [];
		const seen = new Set<string>();
		let idx = 0;
		const outputs = Array.isArray(rawOutput?.outputs) ? rawOutput.outputs : [];
		for (const entry of outputs) {
			for (const chunk of entry?.content ?? []) {
				if (chunk?.type !== "tool_reference" || typeof chunk.url !== "string") continue;
				if (seen.has(chunk.url)) continue;
				seen.add(chunk.url);
				const c = parseCitationUrl(chunk.url, chunk.title, idx);
				if (c) {
					citations.push(c);
					idx++;
				}
			}
		}
		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromOpenRouter(rawOutput: any): Citation[] {
	try {
		const citations: Citation[] = [];
		const seen = new Set<string>();
		let idx = 0;
		for (const ann of rawOutput?.choices?.[0]?.message?.annotations ?? []) {
			if (ann?.type !== "url_citation") continue;
			const cite = ann.url_citation ?? ann;
			const url = cite.url;
			if (!url || typeof url !== "string" || !url.startsWith("http")) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			const c = parseCitationUrl(url, cite.title, idx);
			if (c) {
				citations.push(c);
				idx++;
			}
		}
		return citations;
	} catch {
		return [];
	}
}

/**
 * Citations from an OpenAI-compatible /chat/completions response (Azure AI
 * Foundry, xAI Grok, DeepSeek, etc.). Two shapes are seen in the wild:
 *  - `choices[0].message.annotations[]` with `type: "url_citation"` (OpenAI/
 *    OpenRouter web-search style)
 *  - a top-level `citations[]` array of URL strings or `{url,title}` objects
 *    (xAI Grok Live Search)
 * Web-search-less models return neither, so this yields an empty list.
 */
export function extractCitationsFromChatCompletion(rawOutput: any): Citation[] {
	try {
		const citations: Citation[] = [];
		const seen = new Set<string>();
		let idx = 0;
		const push = (url: unknown, title?: unknown) => {
			if (typeof url !== "string" || !url.startsWith("http") || seen.has(url)) return;
			const c = parseCitationUrl(url, typeof title === "string" ? title : undefined, idx);
			if (c) {
				seen.add(url);
				citations.push(c);
				idx++;
			}
		};
		for (const ann of rawOutput?.choices?.[0]?.message?.annotations ?? []) {
			if (ann?.type !== "url_citation") continue;
			const cite = ann.url_citation ?? ann;
			push(cite?.url, cite?.title);
		}
		for (const cite of rawOutput?.citations ?? []) {
			if (typeof cite === "string") push(cite);
			else push(cite?.url, cite?.title);
		}
		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromOlostep(rawOutput: any): Citation[] {
	try {
		const jsonStr = rawOutput?.json_content ?? rawOutput?.result?.json_content;
		const parsed = typeof jsonStr === "string" ? JSON.parse(jsonStr) : rawOutput;
		const citations: Citation[] = [];
		let idx = 0;
		for (const source of parsed?.sources ?? parsed?.result?.links_on_page ?? parsed?.inline_references ?? []) {
			const url = typeof source === "string" ? source : source?.url;
			if (url && typeof url === "string") {
				const c = parseCitationUrl(url, source?.title ?? source?.label, idx);
				if (c) {
					citations.push(c);
					idx++;
				}
			}
		}
		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromAnthropic(rawOutput: any): Citation[] {
	try {
		const content = rawOutput?.content ?? [];
		const seen = new Set<string>();
		const citations: Citation[] = [];
		let idx = 0;

		for (const block of content) {
			if (block.type === "text") {
				for (const cit of block.citations ?? []) {
					if (cit.type === "web_search_result_location" && cit.url && !seen.has(cit.url)) {
						seen.add(cit.url);
						const c = parseCitationUrl(cit.url, cit.title, idx);
						if (c) {
							citations.push(c);
							idx++;
						}
					}
				}
			}
			if (block.type === "web_search_tool_result") {
				for (const result of block.content ?? []) {
					if (result.type === "web_search_result" && result.url && !seen.has(result.url)) {
						seen.add(result.url);
						const c = parseCitationUrl(result.url, result.title, idx);
						if (c) {
							citations.push(c);
							idx++;
						}
					}
				}
			}
		}

		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromBrightdata(rawOutput: any): Citation[] {
	try {
		const record = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;
		if (!record) return [];
		const citations: Citation[] = [];
		const seen = new Set<string>();
		let idx = 0;
		for (const field of ["citations", "links_attached", "sources"]) {
			if (!Array.isArray(record[field])) continue;
			for (const item of record[field]) {
				const url = typeof item === "string" ? item : item?.url;
				if (!url || typeof url !== "string" || !url.startsWith("http") || seen.has(url)) continue;
				seen.add(url);
				const c = parseCitationUrl(url, item?.title, idx);
				if (c) {
					citations.push(c);
					idx++;
				}
			}
		}
		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromOxylabs(rawOutput: any): Citation[] {
	try {
		const content = rawOutput?.results?.[0]?.content;
		if (!content) return [];
		const citations: Citation[] = [];
		const seen = new Set<string>();
		let idx = 0;

		const pushUrl = (url: any, title: any) => {
			if (typeof url !== "string" || !url.startsWith("http") || seen.has(url)) return;
			seen.add(url);
			const c = parseCitationUrl(url, typeof title === "string" ? title : undefined, idx);
			if (c) {
				citations.push(c);
				idx++;
			}
		};

		// Common citation fields across Oxylabs parsed AI sources.
		// - ChatGPT: top-level `citations` with `{ url, title }`
		// - Google AI Mode: top-level `citations` with `{ text, urls: [...] }`
		// - Perplexity: nested under `additional_results.sources_results`
		const sourceArrays: any[][] = [];
		for (const field of ["citations", "external_links", "links", "sources"]) {
			if (Array.isArray(content[field])) sourceArrays.push(content[field]);
		}
		const perpSources = content?.additional_results?.sources_results;
		if (Array.isArray(perpSources)) sourceArrays.push(perpSources);

		for (const arr of sourceArrays) {
			for (const item of arr) {
				if (typeof item === "string") {
					pushUrl(item, undefined);
				} else if (Array.isArray(item?.urls)) {
					// Google AI Mode groups one or more source URLs under each citation.
					for (const u of item.urls) pushUrl(u, item?.title ?? item?.name);
				} else {
					pushUrl(item?.url ?? item?.link, item?.title ?? item?.name);
				}
			}
		}
		return citations;
	} catch {
		return [];
	}
}

export function extractCitationsFromCloro(rawOutput: any): Citation[] {
	try {
		const answer = cloroAnswer(rawOutput);
		if (!answer) return [];
		const citations: Citation[] = [];
		const seen = new Set<string>();
		let idx = 0;

		const push = (url: any, title: any) => {
			if (typeof url !== "string" || !url.startsWith("http") || seen.has(url)) return;
			seen.add(url);
			const c = parseCitationUrl(url, typeof title === "string" ? title : undefined, idx);
			if (c) {
				citations.push(c);
				idx++;
			}
		};

		// `sources` is the answer's reference panel and `citationPills` are the
		// inline citations (a denormalized subset). Each entry exposes the source
		// URL as `url` and its title as `label`. AI Overview's `relatedLinks` is
		// the block of links Google offers alongside the answer, not sources it
		// drew on, so it is not read.
		for (const field of ["sources", "citationPills"]) {
			if (!Array.isArray(answer[field])) continue;
			for (const item of answer[field]) {
				push(item?.url ?? item?.link, item?.label ?? item?.title);
			}
		}
		return citations;
	} catch {
		return [];
	}
}

/**
 * Extract citations from stored rawOutput.
 * Dispatches based on provider (how data was fetched), falling back to engine
 * (for old data where provider column may be null).
 */
export function extractCitations(rawOutput: any, providerOrEngine: string): Citation[] {
	switch (providerOrEngine) {
		case "dataforseo-scraper":
			return extractCitationsFromDataforseoScraper(rawOutput);
		case "openai-api":
		case "openai":
		case "chatgpt":
			return extractCitationsFromOpenAI(rawOutput);
		case "dataforseo":
		case "google":
		case "google-ai-mode":
		case "google-ai-overview":
			return extractCitationsFromDataforseo(rawOutput);
		case "openrouter":
			return extractCitationsFromOpenRouter(rawOutput);
		case "olostep":
			return extractCitationsFromOlostep(rawOutput);
		case "brightdata":
			return extractCitationsFromBrightdata(rawOutput);
		case "oxylabs":
			return extractCitationsFromOxylabs(rawOutput);
		case "cloro":
			return extractCitationsFromCloro(rawOutput);
		case "anthropic-api":
		case "anthropic":
		case "claude":
			return extractCitationsFromAnthropic(rawOutput);
		case "mistral-api":
			return extractCitationsFromMistral(rawOutput);
		case "azure-foundry-api":
			return extractCitationsFromChatCompletion(rawOutput);
		default:
			return [];
	}
}
