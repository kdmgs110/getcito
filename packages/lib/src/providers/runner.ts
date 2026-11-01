import { measurementTargetKey } from "../measurement";
import type { ModelConfig } from "./types";

/**
 * Resolve which SCRAPE_TARGETS configs a brand should run.
 *
 * Non-null `enabledTargets` takes precedence and selects exact model/provider/version/search keys.
 * An empty target list disables future runs without changing historical data.
 *
 * `enabledModels` is a brand-level override keyed by model name:
 *   - `null` / `undefined`: no override — run every configured target.
 *   - `[]`: explicit empty — run nothing (caller skips the prompt).
 *   - `[...]`: run exactly these models. Every entry must correspond to a
 *     model in `configs`; an unknown model throws so the configuration error
 *     surfaces loudly instead of silently dropping runs.
 */
export function selectTargetsForBrand(
	configs: ModelConfig[],
	enabledModels: string[] | null | undefined,
	enabledTargets?: string[] | null,
): ModelConfig[] {
	// An explicit target override takes precedence over the legacy model list.
	// It never enables the other providers sharing the same model name.
	if (enabledTargets !== null && enabledTargets !== undefined) {
		const available = new Set(configs.map(measurementTargetKey));
		const unknown = enabledTargets.filter((key) => !available.has(key));
		if (unknown.length > 0) {
			throw new Error(`brand.enabledTargets references targets not in SCRAPE_TARGETS: ${unknown.join(", ")}`);
		}
		const allowed = new Set(enabledTargets);
		return configs.filter((config) => allowed.has(measurementTargetKey(config)));
	}
	if (enabledModels === null || enabledModels === undefined) return configs;
	if (enabledModels.length === 0) return [];
	const configModels = new Set(configs.map((c) => c.model));
	const unknown = enabledModels.filter((m) => !configModels.has(m));
	if (unknown.length > 0) {
		throw new Error(
			`brand.enabledModels references models not in SCRAPE_TARGETS: ${unknown.join(", ")}. ` +
				`Configured models: ${[...configModels].join(", ") || "(none)"}.`,
		);
	}
	const allowed = new Set(enabledModels);
	return configs.filter((c) => allowed.has(c.model));
}
