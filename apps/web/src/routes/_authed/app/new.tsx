import { displayMarket, displayLanguage } from "@/i18n/settings-labels";
import { t } from "@/i18n";
import { brandCreationText as ct } from "@/i18n/brand-creation-labels";
import { useQueryClient } from "@tanstack/react-query";
import { brandKeys } from "@/hooks/use-brands";
import { makeBrandDestination, validateBrandReturnSearch } from "@/lib/brand-navigation";
/**
 * /app/new - Create a new brand (local mode only).
 *
 * Provisions a new organization + admin membership for the current user
 * and seeds the brand row with the supplied name + website. Whitelabel and
 * demo are blocked at both the loader (redirect to /app) and the server
 * function (canCreateBrands policy).
 */

import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
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
import { useRef, useState, type FormEvent } from "react";
import FullPageCard from "@/components/full-page-card";
import { getDeployment } from "@/lib/config/server";
import { trackEvent } from "@/lib/posthog";
import { createBrandWithOrgFn } from "@/server/brands";

const getCanCreateBrands = createServerFn({ method: "GET" }).handler(async () => {
	return { canCreateBrands: getDeployment().features.canCreateBrands };
});

export const Route = createFileRoute("/_authed/app/new")({
	validateSearch: validateBrandReturnSearch,
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
	const [errorField, setErrorField] = useState<string>();
	const [optionalOpen, setOptionalOpen] = useState(false);
	const [brandName, setBrandName] = useState("");
	const [website, setWebsite] = useState("");
	const [createdBrandId, setCreatedBrandId] = useState<string>();
	const requestId = useRef<string | undefined>(undefined);
	const submitting = useRef(false);
	const [targetMarket, setTargetMarket] = useState<string>("");
	const [targetLanguage, setTargetLanguage] = useState<string>("");
	const navigate = useNavigate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { returnBrand, returnSection } = Route.useSearch();

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

	const openCreatedBrand = async (brandId: string) => {
		await navigate(makeBrandDestination(brandId, returnSection, {}, false));
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (submitting.current || createdBrandId) return;
		submitting.current = true;
		setIsLoading(true);
		setError("");
		setErrorField(undefined);

		try {
			requestId.current ??= crypto.randomUUID();
			const result = await createBrandWithOrgFn({
				data: {
					requestId: requestId.current,
					brandName: brandName.trim(),
					website: website.trim(),
					targetMarket: targetMarket || undefined,
					targetLanguage: targetLanguage || undefined,
				},
			});
			if (!result.ok) {
				setError(ct(result.error.code));
				setErrorField(result.error.field);
				if (result.error.field === "targetMarket" || result.error.field === "targetLanguage") setOptionalOpen(true);
				return;
			}
			setCreatedBrandId(result.brandId);
			trackEvent("brand_created", { has_website: Boolean(website) });
			try {
				await queryClient.invalidateQueries({ queryKey: brandKeys.list() });
				await router.invalidate();
				await openCreatedBrand(result.brandId);
			} catch {
				setError(ct("navigationFailed"));
			}
		} catch {
			setError(ct("SAVE_FAILED"));
		} finally {
			submitting.current = false;
			setIsLoading(false);
		}
	};

	return (
		<FullPageCard
			title={t("settings.createANewBrand")}
			subtitle={ct("intro")}
			customBackButton={
				<Button asChild variant="outline" size="sm" disabled={isLoading}>
					{returnBrand ? (
						<Link {...makeBrandDestination(returnBrand, returnSection)} disabled={isLoading}>
							{ct("cancel")}
						</Link>
					) : (
						<Link to="/app" disabled={isLoading}>
							{ct("cancel")}
						</Link>
					)}
				</Button>
			}
		>
			{createdBrandId ? (
				<div className="space-y-4" role="status">
					<p className="font-medium text-emerald-700">{ct("created")}</p>
					{error && <p className="text-sm text-muted-foreground">{error}</p>}
					<Button asChild className="w-full">
						<Link {...makeBrandDestination(createdBrandId, returnSection, {}, false)}>{ct("continue")}</Link>
					</Button>
				</div>
			) : (
				<form onSubmit={handleSubmit} className="space-y-5" aria-busy={isLoading}>
					<div className="space-y-2">
						<Label htmlFor="brandName">{t("settings.brandName")}</Label>
						<Input
							id="brandName"
							name="brandName"
							type="text"
							placeholder="Acme"
							required
							maxLength={100}
							disabled={isLoading}
							value={brandName}
							onChange={(event) => setBrandName(event.target.value)}
							aria-invalid={errorField === "brandName"}
							aria-describedby={errorField === "brandName" ? "brand-creation-error" : undefined}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="website">{t("settings.website")}</Label>
						<Input
							id="website"
							name="website"
							type="text"
							placeholder="example.com"
							required
							disabled={isLoading}
							value={website}
							onChange={(event) => setWebsite(event.target.value)}
							aria-invalid={errorField === "website"}
							aria-describedby={errorField === "website" ? "brand-creation-error" : "website-hint"}
						/>
						<p id="website-hint" className="text-xs text-muted-foreground">
							{ct("websiteHint")}
						</p>
					</div>
					<details
						open={optionalOpen}
						onToggle={(event) => setOptionalOpen(event.currentTarget.open)}
						className="rounded-lg border p-4 space-y-4"
					>
						<summary className="cursor-pointer text-sm font-medium">{ct("optional")}</summary>
						<div className="space-y-2">
							<Label htmlFor="targetMarket">{t("settings.targetMarketOptional")}</Label>
							<Select
								name="targetMarket"
								value={targetMarket}
								onValueChange={handleTargetMarketChange}
								disabled={isLoading}
							>
								<SelectTrigger
									id="targetMarket"
									aria-invalid={errorField === "targetMarket"}
									aria-describedby={errorField === "targetMarket" ? "brand-creation-error" : undefined}
								>
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
								<SelectTrigger
									id="targetLanguage"
									aria-invalid={errorField === "targetLanguage"}
									aria-describedby={errorField === "targetLanguage" ? "brand-creation-error" : undefined}
								>
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
					</details>
					{error && (
						<p id="brand-creation-error" role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}

					<Button type="submit" className="w-full" disabled={isLoading}>
						{isLoading ? t("settings.creating") : t("settings.createBrand")}
					</Button>
				</form>
			)}
		</FullPageCard>
	);
}
