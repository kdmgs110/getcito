import type { AIProvider } from "./types";
import { escapeRegex, stringFilter, type GAFilterExpression } from "./filters";
export const AI_CLASSIFICATION_VERSION = 1;
const DOMAINS: Record<AIProvider, string[]> = {
	chatgpt: ["chatgpt.com", "chat.openai.com"],
	perplexity: ["perplexity.ai"],
	gemini: ["gemini.google.com", "bard.google.com"],
	claude: ["claude.ai"],
	copilot: ["copilot.microsoft.com"],
	other: [
		"grok.com",
		"deepseek.com",
		"poe.com",
		"you.com",
		"phind.com",
		"kimi.com",
		"kimi.moonshot.cn",
		"doubao.com",
		"tongyi.aliyun.com",
	],
};
const NAMES: Record<AIProvider, string[]> = {
	chatgpt: ["chatgpt", "chatgpt (openai)"],
	perplexity: ["perplexity"],
	gemini: ["gemini", "google gemini"],
	claude: ["claude"],
	copilot: ["copilot", "microsoft copilot"],
	other: ["deepseek", "grok", "kimi"],
};
export function classifyAISource(source: string, medium = "", channel = ""): AIProvider | null {
	const normalized = source.trim().toLowerCase();
	let hostname = normalized;
	try {
		hostname = new URL(normalized.includes("://") ? normalized : `https://${normalized}`).hostname;
	} catch {
		/* Named sources are handled below. */
	}
	for (const provider of Object.keys(DOMAINS) as AIProvider[]) {
		if (
			NAMES[provider].includes(normalized) ||
			DOMAINS[provider].some((d) => hostname === d || hostname.endsWith(`.${d}`))
		)
			return provider;
	}
	return medium.toLowerCase() === "ai-assistant" || channel.toLowerCase() === "ai assistant" ? "other" : null;
}
export function buildAIFilter(): GAFilterExpression {
	const domains = Object.values(DOMAINS).flat().map(escapeRegex).join("|");
	const names = Object.values(NAMES).flat().map(escapeRegex).join("|");
	return {
		orGroup: {
			expressions: [
				stringFilter("sessionDefaultChannelGroup", "AI Assistant", "EXACT", false),
				stringFilter("sessionMedium", "ai-assistant", "EXACT", false),
				stringFilter(
					"sessionSource",
					`(?:(?:https?://)?(?:[a-z0-9-]+\\.)*(?:${domains})(?:/.*)?|${names})`,
					"FULL_REGEXP",
					false,
				),
			],
		},
	};
}
