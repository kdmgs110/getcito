import { settingsError } from "@/i18n/settings-labels";
import { t } from "@/i18n";
/**
 * /app/$brand/settings/competitors - Competitor management page
 *
 * Form to manage competitor list with multiple domains and aliases per competitor.
 */
import { useState, useEffect } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { useQueryClient } from "@tanstack/react-query";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { Button } from "@workspace/ui/components/button";
import { useBrand, useCompetitors } from "@/hooks/use-brands";
import { updateCompetitors } from "@/server/brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { CompetitorsEditor, type CompetitorEntry } from "@/components/competitors-editor";
import { WebLogo } from "@/components/web-logo";

export const Route = createFileRoute("/_authed/app/$brand/settings/competitors")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("settings.competitors"), { appName, brandName }) },
				{ name: "description", content: t("settings.manageYourTrackedCompetitors") },
			],
		};
	},
	component: CompetitorsSettingsPage,
});

function CompetitorsSettingsPage() {
	const { brand: brandId } = Route.useParams();
	const { brand, isLoading } = useBrand(brandId);
	const { competitors: existingCompetitors, isLoading: competitorsLoading } = useCompetitors(brandId);
	const queryClient = useQueryClient();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const isReadOnly = context.clientConfig?.features.readOnly;
	useEffect(() => {
		if (existingCompetitors.length > 0) {
			setCompetitors(
				existingCompetitors.map((c) => ({
					_key: crypto.randomUUID(),
					name: c.name,
					domains: c.domains ?? [],
					aliases: c.aliases || [],
					expanded: false,
				})),
			);
		}
	}, [existingCompetitors]);

	if (isLoading || competitorsLoading) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">{t("settings.competitors")}</h1>
					<p className="text-muted-foreground">{t("settings.loading")}</p>
				</div>
			</div>
		);
	}

	if (!brand) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">{t("settings.competitors")}</h1>
					<p className="text-destructive">{t("settings.brandNotFound")}</p>
				</div>
			</div>
		);
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsSubmitting(true);
		setError("");
		setSuccess("");

		try {
			const validCompetitors = competitors
				.filter((c) => c.name.trim() && c.domains.some((d) => d.trim()))
				.map((c) => ({
					name: c.name.trim(),
					domains: c.domains.map((d) => d.trim()).filter(Boolean),
					aliases: c.aliases.map((a) => a.trim()).filter(Boolean),
				}));

			await updateCompetitors({
				data: { brandId: brand.id, competitors: validCompetitors },
			});

			// Domain changes affect citation categorization retroactively
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });

			setSuccess(t("settings.competitorsUpdatedSuccessfully"));
		} catch (err) {
			setError(settingsError(err, t("settings.anErrorOccurred")));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<WebLogo domain={brand.website} size={48} />
					<div>
						<h1 className="text-3xl font-bold tracking-tight">{t("settings.competitors")}</h1>
						<p className="text-muted-foreground">{t("settings.manageYourTrackedCompetitors")}</p>
					</div>
				</div>
			</div>

			<Alert variant="default" className="border-yellow-200 bg-yellow-50 text-yellow-800">
				<AlertTriangle className="h-4 w-4 text-yellow-600" />
				<AlertTitle>{t("settings.warning")}</AlertTitle>
				<AlertDescription className="text-yellow-700">
					{t("settings.updatingCompetitorsWillOnlyApplyToFuturePromptEvaluations")}
				</AlertDescription>
			</Alert>

			<form onSubmit={handleSubmit} className="space-y-4">
				<CompetitorsEditor competitors={competitors} onChange={setCompetitors} disabled={isSubmitting} />

				{error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}
				{success && <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md">{success}</div>}

				<div className="flex gap-2">
					<Button type="submit" disabled={isSubmitting || isReadOnly} className="cursor-pointer">
						{isSubmitting ? t("settings.saving") : t("settings.saveChanges")}
					</Button>
				</div>
			</form>
		</div>
	);
}
