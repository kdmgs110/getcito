import { hasLikelyResponseLanguageMismatch, type PromptRunRequestContext } from "@workspace/lib/prompt-run-context";
import { createTranslator } from "@/i18n";
import { displayLanguage, displayMarket } from "@/i18n/settings-labels";

const rt = createTranslator({
	language: { en: "Requested language", ja: "指定言語" },
	market: { en: "Requested market", ja: "対象市場" },
	prompt: { en: "Original prompt submitted for this run", ja: "この実行で送信した質問原文" },
	unrecorded: { en: "Not recorded", ja: "未記録" },
	unset: { en: "Not specified", ja: "指定なし" },
	mismatch: {
		en: "The answer may differ from the requested language. Review the original response; it has not been translated or rerun.",
		ja: "指定した言語と回答の言語が異なる可能性があります。回答原文を確認してください（自動翻訳・再実行はしていません）。",
	},
	legacy: {
		en: "The language, market, and original prompt were not recorded for this run.",
		ja: "この実行の言語・対象市場・質問原文は記録されていません。",
	},
});

export function PromptRunContext({
	context,
	responseText = "",
}: {
	context: PromptRunRequestContext | null | undefined;
	responseText?: string;
}) {
	return (
		<div className="space-y-3 text-sm">
			{hasLikelyResponseLanguageMismatch(context?.languageCode, responseText) && (
				<p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
					{rt("mismatch")}
				</p>
			)}
			<dl className="grid grid-cols-2 gap-4">
				<div>
					<dt className="mb-1 text-xs text-muted-foreground">{rt("language")}</dt>
					<dd>
						{!context
							? rt("unrecorded")
							: context.targetLanguage
								? displayLanguage(context.languageCode ?? "", context.targetLanguage)
								: rt("unset")}
					</dd>
				</div>
				<div>
					<dt className="mb-1 text-xs text-muted-foreground">{rt("market")}</dt>
					<dd>
						{!context ? rt("unrecorded") : context.targetMarket ? displayMarket(context.targetMarket) : rt("unset")}
					</dd>
				</div>
			</dl>
			{context ? (
				<div>
					<p className="mb-1 text-xs text-muted-foreground">{rt("prompt")}</p>
					<p className="whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3">{context.prompt}</p>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">{rt("legacy")}</p>
			)}
		</div>
	);
}
