/** Deployment-wide language, resolved identically during SSR and in the browser. */
export type AppLanguage = "ja" | "en";
export type Messages = Record<string, { en: string; ja?: string }>;
export type TranslationParams = Record<string, string | number>;

export function resolveLanguage(locale?: string): AppLanguage {
	if (!locale?.trim()) return "ja";
	return /^ja(?:-|$)/i.test(locale.trim()) ? "ja" : "en";
}

declare global {
	interface ImportMetaEnv { readonly VITE_APP_LOCALE?: string; }
	interface ImportMeta { readonly env: ImportMetaEnv; }
}

export const APP_FORMAT_LOCALE = import.meta.env?.VITE_APP_LOCALE?.trim() || "ja-JP";
export const APP_LANGUAGE = resolveLanguage(import.meta.env?.VITE_APP_LOCALE);

/** Keys are checked at compile time; missing translations fall back to English. */
export function createTranslator<T extends Messages>(messages: T, language: AppLanguage = APP_LANGUAGE) {
	return (key: keyof T & string, params: TranslationParams = {}): string => {
		const entry = messages[key];
		if (!entry) return key;
		const template = entry[language] || entry.en;
		return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
			Object.hasOwn(params, name) ? String(params[name]) : placeholder,
		);
	};
}

const uiMessages = {
	commandDescription: { en: "Search for a command to run...", ja: "実行するコマンドを検索…" },
	mobileSidebar: { en: "Displays the mobile sidebar.", ja: "モバイル用のサイドバーを表示します。" },
	close: { en: "Close", ja: "閉じる" },
	sidebar: { en: "Sidebar", ja: "サイドバー" },
	toggleSidebar: { en: "Toggle Sidebar", ja: "サイドバーを切り替える" },
	commandPalette: { en: "Command Palette", ja: "コマンドパレット" },
	select: { en: "Select...", ja: "選択…" },
	search: { en: "Search...", ja: "検索…" },
	noResults: { en: "No results.", ja: "該当する項目がありません。" },
	maximumReached: { en: "Maximum reached", ja: "上限に達しました" },
	addHint: { en: "Type to add a value", ja: "値を入力して追加" },
	add: { en: "Add “{value}”", ja: "「{value}」を追加" },
	remove: { en: "Remove {value}", ja: "{value}を削除" },
};
export const uiT = createTranslator(uiMessages);
