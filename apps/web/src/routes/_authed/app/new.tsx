import { displayMarket, displayLanguage, settingsError } from "@/i18n/settings-labels";
import { t } from "@/i18n";
/**
 * /app/new - Create a new brand (local mode only).
 *
 * Provisions a new organization + admin membership for the current user
 * and seeds the brand row with the supplied name + website. Whitelabel and
 * demo are blocked at both the loader (redirect to /app) and the server
 * function (canCreateBrands policy).
 */

import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { DATAFORSEO_LOCATION_LANGUAGES } from "@workspace/lib/location-languages";
import { TARGET_MARKETS } from "@workspace/lib/locations";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { useState } from "react";
import FullPageCard from "@/components/full-page-card";
import { getDeployment } from "@/lib/config/server";
import { trackEvent } from "@/lib/posthog";
import { createBrandWithOrgFn } from "@/server/brands";

const getCanCreateBrands = createServerFn({ method: "GET" }).handler(async () => {
	return { canCreateBrands: getDeployment().features.canCreateBrands };
});

export const Route = createFileRoute("/_authed/app/new")({
	loader: async () => {
		const { canCreateBrands } = await getCanCreateBrands();
		if (!canCreateBrands) {
			throw redirect({ to: "/app" });
		}
		return { canCreateBrands };
	},
	component: NewBrandPage,
});

function NewBrandPage() {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [targetMarket, setTargetMarket] = useState<string>("");
	const [targetLanguage, setTargetLanguage] = useState<string>("");
	const navigate = useNavigate();
	const router = useRouter();

	const handleTargetMarketChange = (val: string) => {
		setTargetMarket(val);
		if (targetLanguage) {
			const validLangs = DATAFORSEO_LOCATION_LANGUAGES[val] || DATAFORSEO_LANGUAGES;
			if (!validLangs.some((l) => l.name === targetLanguage)) {
				setTargetLanguage("");
			}
		}
	};

	const availableLanguages =
		targetMarket && DATAFORSEO_LOCATION_LANGUAGES[targetMarket]
			? DATAFORSEO_LOCATION_LANGUAGES[targetMarket]
			: DATAFORSEO_LANGUAGES;

	const handleSubmit = async (formData: FormData) => {
		setIsLoading(true);
		setError("");

		try {
			const brandName = (formData.get("brandName") as string)?.trim() ?? "";
			const website = (formData.get("website") as string)?.trim() ?? "";

			// Read the selects from state, not FormData: the empty-string default
			// would otherwise be persisted as "" instead of NULL, and the value only
			// reaches FormData through Radix's hidden native select.
			const { brandId } = await createBrandWithOrgFn({
				data: {
					brandName,
					website,
					targetMarket: targetMarket || undefined,
					targetLanguage: targetLanguage || undefined,
				},
			});
			trackEvent("brand_created", { has_website: Boolean(website) });

			await router.invalidate();
			await navigate({ to: "/app/$brand", params: { brand: brandId } });
		} catch (err) {
			setError(settingsError(err, t("settings.anErrorOccurred")));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<FullPageCard
			title={t("settings.createANewBrand")}
			subtitle={t("settings.setUpABrandToStartTracking")}
			showBackButton
		>
			<form action={handleSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="brandName">{t("settings.brandName")}</Label>
					<Input id="brandName" name="brandName" type="text" placeholder="Acme" required disabled={isLoading} />
				</div>

				<div className="space-y-2">
					<Label htmlFor="website">{t("settings.website")}</Label>
					<Input id="website" name="website" type="text" placeholder="example.com" required disabled={isLoading} />
				</div>

				<div className="space-y-2">
					<Label htmlFor="targetMarket">{t("settings.targetMarketOptional")}</Label>
					<Select
						name="targetMarket"
						value={targetMarket}
						onValueChange={handleTargetMarketChange}
						disabled={isLoading}
					>
						<SelectTrigger id="targetMarket">
							<SelectValue placeholder={t("settings.selectTargetMarketEGUnitedStates")} />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{TARGET_MARKETS.map((location) => (
									<SelectItem key={location} value={location}>
										{displayMarket(location)}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2">
					<Label htmlFor="targetLanguage">{t("settings.targetLanguageOptional")}</Label>
					<Select
						name="targetLanguage"
						value={targetLanguage}
						onValueChange={setTargetLanguage}
						disabled={isLoading || !targetMarket}
					>
						<SelectTrigger id="targetLanguage">
							<SelectValue
								placeholder={targetMarket ? t("settings.selectTargetLanguage") : t("settings.selectAMarketFirst")}
							/>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{availableLanguages.map((lang) => (
									<SelectItem key={lang.name} value={lang.name}>
										{displayLanguage(lang.code, lang.name)}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}

				<Button type="submit" className="w-full" disabled={isLoading}>
					{isLoading ? t("settings.creating") : t("settings.createBrand")}
				</Button>
			</form>
		</FullPageCard>
	);
}
