import { t } from "@/i18n";
import { describeEnvironmentRequirement, environmentSetupHint } from "@/i18n/environment-labels";
import type { DeploymentMode } from "@workspace/config/types";
import type { MissingEnvVar } from "@workspace/config/env";
import FullPageCard from "@/components/full-page-card";

interface MissingEnvPageProps {
	mode: DeploymentMode;
	missing: MissingEnvVar[];
}

export default function MissingEnvPage({ mode, missing }: MissingEnvPageProps) {
	const sortedMissing = [...missing].sort((a, b) => a.label.localeCompare(b.label));

	const localHint = environmentSetupHint(mode);

	return (
		<FullPageCard
			title={t("core.missingEnvironmentConfiguration")}
			subtitle={t("core.deploymentMode", { mode })}
			className="max-w-2xl"
		>
			<div className="space-y-4 text-sm">
				<p>{localHint}</p>
				<ul className="space-y-3 rounded-md border bg-background p-4">
					{sortedMissing.map((item) => (
						<li key={item.id} className="flex flex-col gap-1">
							<span className="font-mono text-xs text-foreground">{item.label}</span>
							<span className="text-muted-foreground">{describeEnvironmentRequirement(item)}</span>
						</li>
					))}
				</ul>
			</div>
		</FullPageCard>
	);
}
