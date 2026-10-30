import { createTranslator } from "@/i18n";

export const bt = createTranslator({
	choose: { en: "Switch brand", ja: "ブランドを切り替える" },
	search: { en: "Search brands by name or URL", ja: "ブランド名・URLで検索" },
	add: { en: "Add brand", ja: "ブランドを追加" },
	all: { en: "View all brands", ja: "すべてのブランドを見る" },
	current: { en: "Current brand", ja: "選択中" },
	list: { en: "Brands", ja: "ブランド一覧" },
	listDescription: { en: "Choose the website you want to analyze.", ja: "分析するサイトを選択してください。" },
	noResults: { en: "No matching brands.", ja: "該当するブランドがありません。" },
	loading: { en: "Loading brands…", ja: "ブランドを読み込み中…" },
	error: { en: "Could not load brands. Please retry.", ja: "ブランドを取得できませんでした。再試行してください。" },
	retry: { en: "Retry", ja: "再試行" },
	close: { en: "Close", ja: "閉じる" },
});
