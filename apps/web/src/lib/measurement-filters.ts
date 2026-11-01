import { type ModelConfig, parseScrapeTargets } from "@workspace/config/scrape-targets";
import { measurementTargetKey, measurementTargetLabel } from "@workspace/lib/measurement";

/** Prefer a brand's active targets without hiding its historical deployment targets. */
export function orderedMeasurementConfigs(effective: ModelConfig[] = [], available: ModelConfig[] = []): ModelConfig[] {
	return [...new Map([...effective, ...available].map((config) => [measurementTargetKey(config), config])).values()];
}

export function historicalMeasurementConfig(value?: string): ModelConfig[] {
	if (!value?.includes(":")) return [];
	try {
		const configs = parseScrapeTargets(value);
		return configs.length === 1 &&
			configs[0].model.length > 0 &&
			configs[0].provider.length > 0 &&
			measurementTargetKey(configs[0]) === value
			? configs
			: [];
	} catch {
		return [];
	}
}

export function measurementFilterOptions(configs: ModelConfig[]) {
	return [...new Map(configs.map((config) => [measurementTargetKey(config), config])).values()].map((config) => ({
		value: measurementTargetKey(config),
		label: `${measurementTargetLabel(config.model, config.provider)} · ${config.provider}${config.version ? ` · ${config.version}` : ""}${!config.webSearch ? " · offline" : ""}`,
		model: config.model,
	}));
}

/** Legacy all/model URLs resolve to one visible target rather than merge Web/API. */
export function resolveMeasurementFilter(model: string | undefined, configs: ModelConfig[]): string | undefined {
	const options = measurementFilterOptions(configs);
	if (options.length === 0) return model;
	if (model && options.some((option) => option.value === model)) return model;
	if (model && model !== "all") {
		const matching = options.find((option) => option.model === model);
		if (matching) return matching.value;
		// Keep explicit historical target links even when not currently enabled.
		if (historicalMeasurementConfig(model).length === 1) return model;
	}
	return options[0].value;
}
