import { BrandLocaleFields } from "@/components/brand-locale-fields";
import { t } from "@/i18n";
import { settingsError } from "@/i18n/settings-labels";
/**
 * /app/$brand/settings/brand - Brand settings page
 *
 * Form to edit brand name, website, additional domains, and aliases.
 */

import { IconInfoCircle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useCallback, useState } from "react";
import { WebLogo } from "@/components/web-logo";
import { useBrand } from "@/hooks/use-brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { opportunitiesKeys } from "@/lib/opportunities-query";
import { cleanAndValidateDomain } from "@/lib/domain-categories";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { deleteBrandFn, updateBrandFn } from "@/server/brands";

export const Route = createFileRoute("/_authed/app/$brand/settings/brand")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle(t("settings.brandSettings"), { appName, brandName }) },
				{ name: "description", content: t("settings.manageYourBrandNameAndWebsite") },
			],
		};
	},
	component: BrandSettingsPage,
});

function BrandSettingsPage() {
	const { brand, isLoading, revalidate } = useBrand();
	const queryClient = useQueryClient();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	// The editable fields are derived from the loaded brand, with an override that
	// holds only what the user has changed. Mirroring server values into state via
	// an effect is what broke this form twice: the query refetches on window focus,
	// reconnect and 30s staleness, so the effect either clobbered unsaved edits or,
	// once guarded, stopped applying values that arrived after the guard was set.
	// Deriving has no such ordering: whatever the server last sent shows up unless
	// the user has typed over it. `null` means "not edited", "" is a real value.
	const [domainsOverride, setDomainsOverride] = useState<string[] | null>(null);
	const [aliasesOverride, setAliasesOverride] = useState<string[] | null>(null);
	const [marketOverride, setMarketOverride] = useState<string | null>(null);
	const [languageOverride, setLanguageOverride] = useState<string | null>(null);
	const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const navigate = useNavigate();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const isReadOnly = context.clientConfig?.features.readOnly;

	const additionalDomains = domainsOverride ?? brand?.additionalDomains ?? [];
	const aliases = aliasesOverride ?? brand?.aliases ?? [];
	const targetMarket = marketOverride ?? brand?.targetMarket ?? "";
	const targetLanguage = languageOverride ?? brand?.targetLanguage ?? "";
	const shortDescription = descriptionOverride ?? brand?.shortDescription ?? "";

	/** Drop the overrides so the freshly saved server values take over again. */
	const clearOverrides = () => {
		setDomainsOverride(null);
		setAliasesOverride(null);
		setMarketOverride(null);
		setLanguageOverride(null);
		setDescriptionOverride(null);
	};

	const validateDomain = useCallback((val: string): true | string => {
		const cleaned = cleanAndValidateDomain(val);
		if (!cleaned) return t("settings.invalidDomain", { domain: val });
		return true;
	}, []);
	const handleAliasesChange = useCallback((values: string[]) => setAliasesOverride(values), []);
	const handleDomainsChange = useCallback((values: string[]) => setDomainsOverride(values), []);

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">{t("settings.brand")}</h1>
					<p className="text-muted-foreground">{t("settings.loading")}</p>
				</div>
			</div>
		);
	}

	if (!brand) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">{t("settings.brand")}</h1>
					<p className="text-destructive">{t("settings.brandNotFound")}</p>
				</div>
			</div>
		);
	}

	const handleSubmit = async (formData: FormData) => {
		setIsSubmitting(true);
		setError("");
		setSuccess("");

		try {
			const name = formData.get("name") as string;
			const website = formData.get("website") as string;

			await updateBrandFn({
				data: {
					brandId: brand.id,
					name,
					website,
					targetMarket: targetMarket || null,
					targetLanguage: targetLanguage || null,
					shortDescription: shortDescription || undefined,
					additionalDomains,
					aliases,
				},
			});

			// Domain/alias changes affect citation categorization and mention detection
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });

			setSuccess(t("settings.brandDetailsUpdatedSuccessfully"));
			// Saved values are now the server's; drop the local edits.
			clearOverrides();
			await revalidate();
			await queryClient.invalidateQueries({ queryKey: opportunitiesKeys.detail(brand.id) });
		} catch (err) {
			setError(settingsError(err, t("settings.anErrorOccurred")));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDelete = async () => {
		if (!confirm(t("settings.deleteConfirmation", { brand: brand.name }))) {
			return;
		}

		setIsDeleting(true);
		setError("");

		try {
			await deleteBrandFn({ data: { brandId: brand.id } });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			await navigate({ to: "/app" });
		} catch (err) {
			setError(settingsError(err, t("settings.failedToDeleteBrand")));
			setIsDeleting(false);
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<div className="flex items-center gap-4">
				{brand.website && <WebLogo domain={brand.website} size={48} />}
				<div>
					<h1 className="text-3xl font-bold">{t("settings.brand")}</h1>
					<p className="text-muted-foreground">{t("settings.manageYourBrandNameWebsiteAndDetails")}</p>
				</div>
			</div>

			<form action={handleSubmit} className="space-y-6">
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">{t("settings.brandName2")}</Label>
						<Input
							id="name"
							name="name"
							type="text"
							placeholder={t("settings.brandName2")}
							defaultValue={brand.name}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">{t("settings.enterYourBrandSName")}</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="website">{t("settings.website")}</Label>
						<Input
							id="website"
							name="website"
							type="text"
							placeholder="example.com"
							defaultValue={brand.website}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">{t("settings.yourBrandSPrimaryWebsite")}</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="shortDescription">{t("settings.shortDescription")}</Label>
						<Textarea
							id="shortDescription"
							name="shortDescription"
							placeholder={t("settings.eGAFastGrowingAiStartupFocusedOn")}
							value={shortDescription}
							onChange={(e) => setDescriptionOverride(e.target.value)}
							disabled={isSubmitting}
							className="min-h-[100px]"
						/>
						<p className="text-xs text-muted-foreground">{t("settings.brieflyDescribeWhatYourBrandDoes")}</p>
					</div>

					<BrandLocaleFields
						targetLanguage={targetLanguage}
						targetMarket={targetMarket}
						onLanguageChange={setLanguageOverride}
						onMarketChange={setMarketOverride}
						disabled={isSubmitting || isReadOnly}
					/>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							{t("settings.additionalDomains")}
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									{t("settings.additionalDomainsHelp")}
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={additionalDomains}
							onValueChange={handleDomainsChange}
							placeholder={t("settings.addDomain")}
							searchPlaceholder={t("settings.addDomain")}
							maxItems={10}
							normalizeValue={(raw) => cleanAndValidateDomain(raw) ?? raw.trim()}
							onValidate={validateDomain}
						/>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							{t("settings.brandAliases")}
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									{t("settings.brandAliasesHelp")}
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={aliases}
							onValueChange={handleAliasesChange}
							placeholder={t("settings.addAlias")}
							searchPlaceholder={t("settings.addAlias")}
							maxItems={10}
						/>
					</div>
				</div>

				{error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}
				{success && <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md">{success}</div>}

				<div className="flex gap-2">
					<Button type="submit" disabled={isSubmitting || isDeleting || isReadOnly} className="cursor-pointer">
						{isSubmitting ? t("settings.saving") : t("settings.saveChanges")}
					</Button>
				</div>
			</form>

			{!isReadOnly && (
				<div className="mt-12 pt-6 border-t border-border">
					<h3 className="text-lg font-medium text-destructive mb-2">{t("settings.dangerZone")}</h3>
					<p className="text-sm text-muted-foreground mb-4">
						{t("settings.permanentlyDeleteThisBrandAndAllOfItsAssociated")}
					</p>
					<Button variant="destructive" onClick={handleDelete} disabled={isSubmitting || isDeleting}>
						{isDeleting ? t("settings.deleting") : t("settings.deleteBrand")}
					</Button>
				</div>
			)}
		</div>
	);
}
