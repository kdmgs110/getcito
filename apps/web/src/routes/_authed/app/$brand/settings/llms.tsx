import { useQueryClient } from "@tanstack/react-query";
/**
 * /app/$brand/settings/llms - LLM configuration page
 *
 * Lists the AI models this brand is tracked against, data-driven from the
 * deployment's `SCRAPE_TARGETS` + `brand.enabledModels`. Each card renders
 * from `brand.effectiveModelConfigs` rather than a hardcoded model list so
 * any deployment-configured model shows up automatically.
 */
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { measurementTargetKey } from "@workspace/lib/measurement";
import { useEffect, useState } from "react";
import { iconForModel } from "@/components/filter-bar";
import { LlmSettingsView, llmSettingsLabels } from "@/components/llm-settings-view";
import { useBrand } from "@/hooks/use-brands";
import { t } from "@/i18n";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { updateBrandMeasurementTargetsFn } from "@/server/brands";

export const Route = createFileRoute("/_authed/app/$brand/settings/llms")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("settings.llms"), { appName, brandName }) },
				{ name: "description", content: t("settings.viewTrackedAiModelsAndConfiguration") },
			],
		};
	},
	component: LlmsSettingsPage,
});

function LlmsSettingsPage() {
	const { brand, isLoading, revalidate } = useBrand();
	const configs = brand?.availableModelConfigs ?? brand?.effectiveModelConfigs ?? [];
	const queryClient = useQueryClient();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const readOnly = context.clientConfig?.features.readOnly ?? false;
	const selectedSignature = (
		brand?.enabledTargets ??
		brand?.effectiveModelConfigs?.map(measurementTargetKey) ??
		[]
	).join(",");
	const [selected, setSelected] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => {
		if (!brand?.id) return;
		setSelected(selectedSignature ? selectedSignature.split(",") : []);
		setMessage("");
	}, [brand?.id, selectedSignature]);
	const save = async () => {
		if (!brand || saving || readOnly) return;
		setSaving(true);
		setMessage("");
		try {
			await updateBrandMeasurementTargetsFn({ data: { brandId: brand.id, targetKeys: selected } });
			await revalidate();
			await queryClient.invalidateQueries({ queryKey: ["brands"] });
			setMessage(llmSettingsLabels("saved"));
		} catch {
			setMessage(llmSettingsLabels("failed"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<LlmSettingsView
			renderModelIcon={iconForModel}
			configs={configs}
			isLoading={isLoading}
			hasBrand={!!brand}
			selected={selected}
			saving={saving}
			readOnly={readOnly}
			message={message}
			onSave={save}
			onToggleTarget={(key, checked) => {
				setSelected((old) => (checked ? [...new Set([...old, key])] : old.filter((value) => value !== key)));
				setMessage("");
			}}
		/>
	);
}
