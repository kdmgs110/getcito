import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { createTranslator } from "@/i18n";
import { displayLanguage } from "@/i18n/settings-labels";

const rt = createTranslator({
	label: { en: "Requested language", ja: "指定言語" },
	all: { en: "All languages (including unrecorded)", ja: "全言語（未記録を含む）" },
	unrecorded: { en: "Not recorded (historical runs)", ja: "未記録（過去の実行）" },
	unspecified: { en: "Not specified", ja: "指定なし" },
	mixed: {
		en: "Totals include all requested languages and historical runs with no language record. Select a language to compare the same conditions.",
		ja: "全言語と、言語が未記録の過去の実行を含む合計です。同じ条件で比較するには言語を選択してください。",
	},
	scoped: {
		en: "All tabs use this requested-language filter. This is the request setting, not automatic detection of the answer language.",
		ja: "すべてのタブに指定言語の絞り込みを適用します。回答の言語を自動判定した分類ではありません。",
	},
});

export function PromptLanguageFilter({ language, onChange }: { language: string; onChange: (value: string) => void }) {
	return (
		<div className="space-y-2 py-4">
			<div className="flex flex-wrap items-center gap-3">
				<label htmlFor="prompt-run-language" className="text-sm font-medium">
					{rt("label")}
				</label>
				<select
					id="prompt-run-language"
					value={language}
					onChange={(event) => onChange(event.target.value)}
					className="h-9 max-w-full rounded-md border bg-background px-3 text-sm"
				>
					<option value="all">{rt("all")}</option>
					<option value="unrecorded">{rt("unrecorded")}</option>
					<option value="unspecified">{rt("unspecified")}</option>
					{DATAFORSEO_LANGUAGES.map((item) => (
						<option key={item.code} value={item.code}>
							{displayLanguage(item.code, item.name)}
						</option>
					))}
				</select>
			</div>
			<p className="text-xs text-muted-foreground">{language === "all" ? rt("mixed") : rt("scoped")}</p>
		</div>
	);
}
