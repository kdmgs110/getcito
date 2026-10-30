import { APP_LANGUAGE } from "@/i18n";

const labels = {
	intro: [
		"ブランドを追加すると、分析データやGA4連携をブランドごとに管理できます。",
		"Keep analytics and GA4 connections separate for each brand.",
	],
	optional: ["市場・言語の設定（任意）", "Market and language (optional)"],
	websiteHint: ["例: example.com または https://example.com", "For example: example.com or https://example.com"],
	cancel: ["キャンセル", "Cancel"],
	created: ["ブランドを追加しました", "Brand added"],
	continue: ["追加したブランドを開く", "Open the new brand"],
	navigationFailed: [
		"ブランドの保存は完了しています。下のボタンから開いてください。",
		"Your brand was saved. Open it using the button below.",
	],
	AUTH_REQUIRED: [
		"ログインの有効期限が切れました。再度ログインしてからお試しください。",
		"Your session expired. Sign in and try again.",
	],
	FORBIDDEN: ["この環境ではブランドを追加できません。", "Brand creation is unavailable in this deployment."],
	INVALID_NAME: ["ブランド名を1〜100文字で入力してください。", "Enter a brand name between 1 and 100 characters."],
	INVALID_WEBSITE: [
		"有効なウェブサイトのURLまたはドメインを入力してください。",
		"Enter a valid website URL or domain.",
	],
	INVALID_MARKET: ["市場を選択し直してください。", "Select a valid market."],
	INVALID_LANGUAGE: ["選択した市場に対応する言語を選んでください。", "Select a language supported by this market."],
	INVALID_REQUEST: [
		"操作を確認できませんでした。画面を再読み込みしてお試しください。",
		"Unable to verify this request. Reload the page and try again.",
	],
	setupTitle: ["ブランドの準備ができました", "Your brand is ready"],
	setupDescription: [
		"GA4のトラフィック分析はサイドバーから連携できます。AIの掲載状況も調べる場合は、ブランド分析を開始してください。",
		"Connect GA4 from the sidebar to analyze traffic. Start brand analysis when you are ready to track AI visibility.",
	],
	startAnalysis: ["ブランド分析を開始", "Start brand analysis"],
	REQUEST_CONFLICT: [
		"この操作はすでに処理されています。ブランド一覧をご確認ください。",
		"This request was already processed. Check the brand list.",
	],
	SAVE_FAILED: [
		"ブランドを保存できませんでした。入力内容は保持されています。時間をおいて再度お試しください。",
		"Unable to save the brand. Your inputs are preserved. Try again shortly.",
	],
} as const;

export function brandCreationText(key: keyof typeof labels): string {
	return labels[key][APP_LANGUAGE === "en" ? 1 : 0];
}
