import type { MissingEnvVar } from "@workspace/config/env";
import type { DeploymentMode } from "@workspace/config/types";
import { APP_LANGUAGE, type AppLanguage, createTranslator } from "@workspace/ui/lib/i18n";

/** Display translations only: environment names and configuration values stay unchanged. */
export const environmentMessages = {
	DATABASE_URL: {
		en: "PostgreSQL connection string.",
		ja: "PostgreSQLの接続文字列です。",
	},
	DATABASE_SSL_MODE: {
		en: "Explicit PostgreSQL TLS policy: disable, verify-full, or no-verify; omitted preserves URL behavior.",
		ja: "PostgreSQLのTLS方針です。disable、verify-full、no-verifyを指定でき、省略時は接続URLの設定を使用します。",
	},
	DB_POOL_MAX: {
		en: "Application PostgreSQL pool limit per web or worker process (default 20).",
		ja: "Webまたはワーカープロセスごとのアプリ用PostgreSQL接続数の上限です（既定値20）。",
	},
	PG_BOSS_POOL_MAX: {
		en: "pg-boss PostgreSQL pool limit per web or worker process (default 10).",
		ja: "Webまたはワーカープロセスごとのpg-boss用PostgreSQL接続数の上限です（既定値10）。",
	},
	WORKER_PROMPT_CONCURRENCY: {
		en: "Concurrent prompt jobs per worker process (default 10).",
		ja: "ワーカープロセスごとに同時実行するプロンプト処理ジョブ数です（既定値10）。",
	},
	WORKER_REPORT_CONCURRENCY: {
		en: "Concurrent report jobs per worker process (default 2).",
		ja: "ワーカープロセスごとに同時実行するレポート生成ジョブ数です（既定値2）。",
	},
	WORKER_ANALYSIS_CONCURRENCY: {
		en: "Concurrent brand analysis jobs per worker process (default 2).",
		ja: "ワーカープロセスごとに同時実行するブランド分析ジョブ数です（既定値2）。",
	},
	APP_URL: {
		en: "Public base URL of the web app (written by `Getcito init`).",
		ja: "Webアプリの公開URLです。`Getcito init` で設定されます。",
	},
	BETTER_AUTH_SECRET: {
		en: "Session cookie encryption secret.",
		ja: "セッションCookieの暗号化に使用するシークレットです。",
	},
	GOOGLE_ANALYTICS_CLIENT_ID: {
		en: "Google OAuth web client ID for the optional GA4 traffic integration.",
		ja: "GA4トラフィック連携に使用するGoogle OAuthのWebクライアントIDです（任意）。",
	},
	GOOGLE_ANALYTICS_CLIENT_SECRET: {
		en: "Google OAuth web client secret for the optional GA4 traffic integration.",
		ja: "GA4トラフィック連携に使用するGoogle OAuthのWebクライアントシークレットです（任意）。",
	},
	GOOGLE_ANALYTICS_REDIRECT_URI: {
		en: "Absolute OAuth callback URL registered for the GA4 traffic integration.",
		ja: "GA4連携用にGoogleへ登録したOAuthコールバックの絶対URLです。",
	},
	ANALYTICS_TOKEN_ENCRYPTION_KEY: {
		en: "32-byte encryption key for server-side GA4 refresh tokens (64 hexadecimal characters).",
		ja: "GA4の更新トークンをサーバーで暗号化する32バイトの鍵です（16進数64文字）。",
	},
	AUTH0_DOMAIN: {
		en: "Auth0 tenant domain (used for whitelabel logout redirects).",
		ja: "Auth0のテナントドメインです。ホワイトラベル環境のログアウト後の転送先に使用します。",
	},
	AUTH0_CLIENT_ID: {
		en: "Auth0 client ID.",
		ja: "Auth0のクライアントIDです。",
	},
	AUTH0_CLIENT_SECRET: {
		en: "Auth0 client secret.",
		ja: "Auth0のクライアントシークレットです。",
	},
	AUTH0_AUDIENCE: {
		en: "Auth0 API audience.",
		ja: "Auth0 APIのオーディエンスです。",
	},
	AUTH0_SCOPE: {
		en: "Auth0 OAuth scopes.",
		ja: "Auth0のOAuthスコープです。",
	},
	AUTH0_MGMT_API_DOMAIN: {
		en: "Auth0 Management API domain.",
		ja: "Auth0 Management APIのドメインです。",
	},
	DATAFORSEO_LOGIN: {
		en: "DataForSEO account login.",
		ja: "DataForSEOアカウントのログイン名です。",
	},
	DATAFORSEO_PASSWORD: {
		en: "DataForSEO account password.",
		ja: "DataForSEOアカウントのパスワードです。",
	},
	OPENAI_API_KEY: {
		en: "OpenAI API key.",
		ja: "OpenAIのAPIキーです。",
	},
	ANTHROPIC_API_KEY: {
		en: "Anthropic API key.",
		ja: "AnthropicのAPIキーです。",
	},
	MISTRAL_API_KEY: {
		en: "Mistral API key.",
		ja: "MistralのAPIキーです。",
	},
	AZURE_FOUNDRY_API_KEY: {
		en: "Azure AI Foundry API key.",
		ja: "Azure AI FoundryのAPIキーです。",
	},
	AZURE_FOUNDRY_BASE_URL: {
		en: "Azure AI Foundry endpoint URL (with or without a trailing /chat/completions).",
		ja: "Azure AI FoundryのエンドポイントURLです。末尾の /chat/completions は省略できます。",
	},
	SCRAPE_TARGETS: {
		en: "Comma-separated model:provider[:version][:online] entries. Example: chatgpt:olostep:online,google-ai-mode:olostep:online,copilot:olostep:online",
		ja: "計測するモデルを model:provider[:version][:online] の形式で、カンマ区切りで指定してください。例：chatgpt:olostep:online,google-ai-mode:olostep:online,copilot:olostep:online",
	},
	ONBOARDING_LLM_TARGET: {
		en: "Overrides which provider runs brand analysis and other structured research, as a model:provider entry (e.g. chatgpt:olostep). Defaults to the first configured direct API provider.",
		ja: "ブランド分析などの調査に使用するプロバイダーを model:provider の形式で指定します（例：chatgpt:olostep）。省略時は、設定済みの直接APIプロバイダーの先頭を使用します。",
	},
	OLOSTEP_API_KEY: {
		en: "Olostep API key.",
		ja: "OlostepのAPIキーです。",
	},
	BRIGHTDATA_API_TOKEN: {
		en: "BrightData API token.",
		ja: "BrightDataのAPIトークンです。",
	},
	OXYLABS_USERNAME: {
		en: "Oxylabs Web Scraper API username.",
		ja: "Oxylabs Web Scraper APIのユーザー名です。",
	},
	OXYLABS_PASSWORD: {
		en: "Oxylabs Web Scraper API password.",
		ja: "Oxylabs Web Scraper APIのパスワードです。",
	},
	CLORO_API_KEY: {
		en: "Cloro API key.",
		ja: "CloroのAPIキーです。",
	},
	OPENROUTER_API_KEY: {
		en: "OpenRouter API key.",
		ja: "OpenRouterのAPIキーです。",
	},
	DEPLOYMENT_MODE: {
		en: "Deployment mode: local, demo, whitelabel, or cloud.",
		ja: "デプロイモードです。local、demo、whitelabel、cloud のいずれかを指定してください。",
	},
	ADMIN_AUTH0_SUB: {
		en: "Auth0 subject claim granted admin access.",
		ja: "管理者権限を付与するAuth0のsubjectクレームです。",
	},
	ADMIN_API_KEYS: {
		en: "Comma-separated bearer tokens accepted by the admin API.",
		ja: "管理APIで受け付けるBearerトークンをカンマ区切りで指定します。",
	},
	DEFAULT_BRAND_DOMAINS: {
		en: "Comma-separated domains added as default brands.",
		ja: "初期ブランドとして追加するドメインをカンマ区切りで指定します。",
	},
	ENVIRONMENT: {
		en: "Environment name reported to Sentry (e.g. production).",
		ja: "Sentryに通知する環境名です（例：production）。",
	},
	VITE_DEPLOYMENT_MODE: {
		en: "Client-visible copy of DEPLOYMENT_MODE.",
		ja: "ブラウザー側で使用するDEPLOYMENT_MODEの値です。",
	},
	VITE_APP_TIMEZONE: {
		en: "IANA timezone used consistently for application dates and chart buckets.",
		ja: "アプリの日付表示とグラフの日別集計に使用するIANAタイムゾーンです。",
	},
	VITE_APP_LOCALE: {
		en: "BCP 47 locale for dates, numbers, and UI language. Defaults to ja-JP; ja/ja-* selects Japanese, other locales select English.",
		ja: "アプリの日付・数値の表示形式に使用するBCP 47言語タグです。",
	},
	VITE_APP_NAME: {
		en: "Application display name (e.g., 'Acme AI Search').",
		ja: "アプリの表示名です（例：Acme AI Search）。",
	},
	VITE_APP_ICON: {
		en: "Application icon URL (must be an external URL, e.g., 'https://cdn.example.com/icon.png').",
		ja: "アプリのアイコンURLです。外部URLを指定してください（例：https://cdn.example.com/icon.png）。",
	},
	VITE_APP_URL: {
		en: "Application URL (e.g., 'https://ai.example.com/').",
		ja: "アプリのURLです（例：https://ai.example.com/）。",
	},
	VITE_APP_PARENT_NAME: {
		en: "Parent application name (e.g., 'Acme').",
		ja: "親アプリの名前です（例：Acme）。",
	},
	VITE_APP_PARENT_URL: {
		en: "Parent application URL (e.g., 'https://app.example.com/').",
		ja: "親アプリのURLです（例：https://app.example.com/）。",
	},
	VITE_OPTIMIZATION_URL_TEMPLATE: {
		en: "URL template for optimization with placeholders {brandId}, {prompt}, {webQuery} (e.g., 'https://app.example.com/optimize?org_id={brandId}&prompt={prompt}&web_query={webQuery}').",
		ja: "改善ページのURLテンプレートです。{brandId}、{prompt}、{webQuery} を使用できます（例：https://app.example.com/optimize?org_id={brandId}&prompt={prompt}&web_query={webQuery}）。",
	},
	VITE_PLAUSIBLE_DOMAIN: {
		en: "Plausible analytics domain.",
		ja: "Plausibleで計測するドメインです。",
	},
	VITE_CLARITY_PROJECT_ID: {
		en: "Microsoft Clarity project ID.",
		ja: "Microsoft ClarityのプロジェクトIDです。",
	},
	VITE_ONBOARDING_REDIRECT_URL_TEMPLATE: {
		en: "Redirect URL template (with {brandId} placeholder) for sending users back to the parent app after onboarding.",
		ja: "初期設定後に親アプリへ戻すURLテンプレートです。{brandId} を使用できます。",
	},
	VITE_AUTH0_DOMAIN: {
		en: "Auth0 domain exposed to the client.",
		ja: "ブラウザー側で使用するAuth0ドメインです。",
	},
	VITE_AUTH0_CLIENT_ID: {
		en: "Auth0 client ID exposed to the client.",
		ja: "ブラウザー側で使用するAuth0クライアントIDです。",
	},
	DBOS_SYSTEM_DATABASE_URL: {
		en: "Override for the DBOS system database URL (read by the DBOS runtime).",
		ja: "DBOSランタイムが使用するシステムデータベースのURLを個別に指定します。",
	},
	SENTRY_DSN: {
		en: "Sentry DSN for server-side error reporting.",
		ja: "サーバー側のエラーをSentryに通知するDSNです。",
	},
	SENTRY_ORG: {
		en: "Sentry org slug for sourcemap upload at build time.",
		ja: "ビルド時のソースマップ送信先となるSentry組織のスラッグです。",
	},
	SENTRY_PROJECT: {
		en: "Sentry project slug for sourcemap upload at build time.",
		ja: "ビルド時のソースマップ送信先となるSentryプロジェクトのスラッグです。",
	},
	SENTRY_AUTH_TOKEN: {
		en: "Sentry auth token for sourcemap upload at build time.",
		ja: "ビルド時のソースマップ送信に使用するSentry認証トークンです。",
	},
	VITE_SENTRY_DSN: {
		en: "Sentry DSN for browser error reporting.",
		ja: "ブラウザー側のエラーをSentryに通知するDSNです。",
	},
	VITE_POSTHOG_KEY: {
		en: "PostHog project API key override.",
		ja: "PostHogのプロジェクトAPIキーを個別に指定します。",
	},
	VITE_CHART_COLORS: {
		en: "Comma-separated chart color palette override.",
		ja: "グラフの配色をカンマ区切りで個別に指定します。",
	},
	DISABLE_TELEMETRY: {
		en: "Set to any value to disable telemetry.",
		ja: "値を設定すると、利用状況の送信を無効にします。",
	},
} as const;

const guidanceMessages = {
	provider: {
		en: 'Required by SCRAPE_TARGETS provider "{provider}".',
		ja: "SCRAPE_TARGETSで指定したプロバイダー「{provider}」に必要な認証情報です。",
	},
	missingTargets: {
		en: "SCRAPE_TARGETS is required. Configure which AI models to track using model:provider[:version][:online]. Example: chatgpt:olostep:online",
		ja: "SCRAPE_TARGETSが未設定です。計測するAIモデルを model:provider[:version][:online] の形式で指定してください。例：chatgpt:olostep:online",
	},
	emptyTarget: {
		en: "Invalid SCRAPE_TARGETS: empty entry (check for trailing commas)",
		ja: "SCRAPE_TARGETSに空の項目があります。末尾のカンマや、カンマが連続していないか確認してください。",
	},
	invalidTarget: {
		en: 'Invalid SCRAPE_TARGETS entry: "{entry}" (need at least model:provider)',
		ja: "SCRAPE_TARGETSの「{entry}」の形式が不正です。少なくとも model:provider を指定してください。",
	},
	unknown: {
		en: "Configure the required environment variable: {label}.",
		ja: "必要な環境変数 {label} を設定してください。",
	},
	local: {
		en: "Set these via the CLI or in the local .env file, then restart the app.",
		ja: "CLIまたはローカルの .env ファイルで設定し、アプリを再起動してください。",
	},
	deployment: {
		en: "Set these in the deployment environment, then redeploy or restart.",
		ja: "デプロイ先の環境変数を設定し、再デプロイまたは再起動してください。",
	},
};

export function environmentSetupHint(mode: DeploymentMode, language: AppLanguage = APP_LANGUAGE): string {
	return createTranslator(guidanceMessages, language)(mode === "local" ? "local" : "deployment");
}

/** Maps registry guidance and dynamic validation messages without translating technical identifiers. */
export function describeEnvironmentRequirement(item: MissingEnvVar, language: AppLanguage = APP_LANGUAGE): string {
	const translateGuidance = createTranslator(guidanceMessages, language);
	const description = item.description;
	const entry = environmentMessages[item.id as keyof typeof environmentMessages];
	if (language === "en") return description || entry?.en || translateGuidance("unknown", { label: item.label });

	const provider = description?.match(/^Required by SCRAPE_TARGETS provider "([^"]+)"\.$/);
	if (provider) return translateGuidance("provider", { provider: provider[1] });
	if (description?.startsWith("SCRAPE_TARGETS environment variable is required."))
		return translateGuidance("missingTargets");
	if (description === "Invalid SCRAPE_TARGETS: empty entry (check for trailing commas)")
		return translateGuidance("emptyTarget");
	const invalidEntry = description?.match(
		/^Invalid SCRAPE_TARGETS entry: "([\s\S]+)" \(need at least model:provider\)$/,
	);
	if (invalidEntry) return translateGuidance("invalidTarget", { entry: invalidEntry[1] });

	if (entry && (!description || description === entry.en)) return entry.ja;
	const registeredDescription = Object.values(environmentMessages).find((message) => message.en === description);
	return registeredDescription?.ja || translateGuidance("unknown", { label: item.label });
}
