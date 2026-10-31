import { createTranslator } from "@/i18n";

export const localeText = createTranslator({
	aggregate: {
		en: "Brand totals include all requested languages and earlier runs without language records. Filter by language on a prompt’s result page to compare like-for-like.",
		ja: "ブランド全体の集計は全言語・言語未記録の過去実行を含みます。同じ言語で比較する場合は、質問の結果画面で言語を絞り込んでください。",
	},
	settings: { en: "Change language and market in brand settings", ja: "ブランド設定で言語・対象市場を変更" },
	limits: {
		en: "Translation previews up to 30 enabled prompts at a time. Suggestions are added within the remaining prompt limit, then saved with Save prompts.",
		ja: "翻訳は有効な質問を先頭から最大30件プレビューします。候補は質問の残り枠まで追加され、「質問を保存」で確定します。",
	},
	capacity: { en: "Available prompt slots:", ja: "追加できる質問数:" },
	language: { en: "Prompt and response language", ja: "プロンプト・回答の言語" },
	market: { en: "Target market", ja: "対象市場" },
	unconfigured: { en: "Not specified", ja: "指定なし" },
	help: {
		en: "Used for generated prompts, AI responses and supported search settings. Your dashboard language stays the same.",
		ja: "候補の生成・AIの回答・対応する検索APIに反映します。管理画面の表示言語は変わりません。",
	},
	changed: {
		en: "The language or market changed. Regenerate suggestions before adopting them.",
		ja: "言語または対象市場が変わりました。候補を再生成してから採用してください。",
	},
	regenerate: { en: "Generate in this language", ja: "この言語で候補を再生成" },
	suggest: { en: "Generate prompt suggestions", ja: "プロンプト候補を生成" },
	translate: { en: "Translate existing prompts", ja: "既存の質問を翻訳" },
	preview: { en: "Review suggestions", ja: "生成候補を確認" },
	preserve: {
		en: "Adopted suggestions are added as new prompts. Existing prompts and results are preserved; disable old prompts separately if needed.",
		ja: "採用した候補は新しい質問として追加します。既存の質問・過去の結果は残ります。必要に応じて古い質問を無効にしてください。",
	},
	adopt: { en: "Add selected suggestions", ja: "選択した候補を追加" },
	working: { en: "Generating…", ja: "生成中…" },
	error: {
		en: "Could not generate suggestions. Check the language setting and retry.",
		ja: "候補を生成できませんでした。言語設定を確認して再試行してください。",
	},
	stale: {
		en: "The language setting changed. Generate suggestions again.",
		ja: "言語設定が変更されました。候補を再生成してください。",
	},
});
