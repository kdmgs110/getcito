import { describe, expect, it } from "vitest";
import { ENV_REGISTRY } from "../../../../packages/config/src/env-registry";
import { describeEnvironmentRequirement, environmentMessages, environmentSetupHint } from "./environment-labels";

describe("environment configuration guidance", () => {
	it("covers every registry description in Japanese and preserves its English source", () => {
		for (const spec of ENV_REGISTRY) {
			const message = environmentMessages[spec.name as keyof typeof environmentMessages];
			expect(message, spec.name).toBeDefined();
			expect(message.en, spec.name).toBe(spec.description);
			expect(message.ja, spec.name).toMatch(/[ぁ-んァ-ヶ一-龯]/);
			const item = { id: spec.name, label: spec.name, description: spec.description };
			expect(describeEnvironmentRequirement(item, "ja")).toBe(message.ja);
			expect(describeEnvironmentRequirement(item, "en")).toBe(spec.description);
		}
	});

	it("keeps provider names and environment identifiers in dynamic requirements", () => {
		const item = {
			id: "PROVIDER_AZURE_FOUNDRY_API",
			label: "AZURE_FOUNDRY_API_KEY + AZURE_FOUNDRY_BASE_URL",
			description: 'Required by SCRAPE_TARGETS provider "azure-foundry-api".',
		};
		expect(describeEnvironmentRequirement(item, "ja")).toBe(
			"SCRAPE_TARGETSで指定したプロバイダー「azure-foundry-api」に必要な認証情報です。",
		);
		expect(describeEnvironmentRequirement(item, "en")).toBe(item.description);
		expect(item.label).toBe("AZURE_FOUNDRY_API_KEY + AZURE_FOUNDRY_BASE_URL");
	});

	it("explains missing and malformed scrape targets in Japanese", () => {
		const item = { id: "SCRAPE_TARGETS", label: "SCRAPE_TARGETS" };
		expect(
			describeEnvironmentRequirement(
				{
					...item,
					description: "SCRAPE_TARGETS environment variable is required. Set it to configure which AI models to track.",
				},
				"ja",
			),
		).toContain("計測するAIモデルを model:provider[:version][:online]");
		expect(
			describeEnvironmentRequirement(
				{ ...item, description: "Invalid SCRAPE_TARGETS: empty entry (check for trailing commas)" },
				"ja",
			),
		).toContain("末尾のカンマ");
		expect(
			describeEnvironmentRequirement(
				{ ...item, description: 'Invalid SCRAPE_TARGETS entry: "chatgpt" (need at least model:provider)' },
				"ja",
			),
		).toContain("「chatgpt」の形式が不正");
	});

	it("provides Japanese fallback for unknown guidance and retains English details in English", () => {
		const item = { id: "FUTURE_API_KEY", label: "FUTURE_API_KEY", description: "New provider credential is required." };
		expect(describeEnvironmentRequirement(item, "ja")).toBe("必要な環境変数 FUTURE_API_KEY を設定してください。");
		expect(describeEnvironmentRequirement(item, "en")).toBe(item.description);
	});

	it("uses detailed guidance for known variables even when the server omits the description", () => {
		expect(describeEnvironmentRequirement({ id: "DATABASE_URL", label: "DATABASE_URL" }, "ja")).toBe(
			"PostgreSQLの接続文字列です。",
		);
		expect(describeEnvironmentRequirement({ id: "NEW_SETTING", label: "NEW_SETTING" }, "ja")).toContain("NEW_SETTING");
	});

	it("preserves copyable URL templates and configuration syntax", () => {
		const id = "VITE_OPTIMIZATION_URL_TEMPLATE";
		const result = describeEnvironmentRequirement({ id, label: id }, "ja");
		expect(result).toContain("{brandId}");
		expect(result).toContain("{prompt}");
		expect(result).toContain("{webQuery}");
		expect(result).toContain("https://app.example.com/optimize?org_id={brandId}&prompt={prompt}&web_query={webQuery}");
	});

	it("shows local and deployment instructions in the selected language", () => {
		expect(environmentSetupHint("local", "ja")).toContain("ローカルの .env ファイル");
		expect(environmentSetupHint("whitelabel", "ja")).toContain("再デプロイまたは再起動");
		expect(environmentSetupHint("local", "en")).toContain("local .env file");
		expect(environmentSetupHint("whitelabel", "en")).toBe(
			"Set these in the deployment environment, then redeploy or restart.",
		);
	});
});
