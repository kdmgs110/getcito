import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { TARGET_MARKETS } from "@workspace/lib/locations";
import { Label } from "@workspace/ui/components/label";
import { useId } from "react";
import { localeText as lt } from "@/i18n/brand-locale-labels";
import { displayLanguage, displayMarket } from "@/i18n/settings-labels";

export function BrandLocaleFields({
	targetLanguage,
	targetMarket,
	onLanguageChange,
	onMarketChange,
	disabled = false,
}: {
	targetLanguage: string;
	targetMarket: string;
	onLanguageChange: (value: string) => void;
	onMarketChange: (value: string) => void;
	disabled?: boolean;
}) {
	const id = useId();
	const style = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50";
	return (
		<div className="space-y-2">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor={`${id}-language`}>{lt("language")}</Label>
					<select
						id={`${id}-language`}
						value={targetLanguage}
						onChange={(e) => onLanguageChange(e.target.value)}
						disabled={disabled}
						className={style}
					>
						<option value="">{lt("unconfigured")}</option>
						{DATAFORSEO_LANGUAGES.map((language) => (
							<option key={language.code} value={language.name}>
								{displayLanguage(language.code, language.name)}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-2">
					<Label htmlFor={`${id}-market`}>{lt("market")}</Label>
					<select
						id={`${id}-market`}
						value={targetMarket}
						onChange={(e) => onMarketChange(e.target.value)}
						disabled={disabled}
						className={style}
					>
						<option value="">{lt("unconfigured")}</option>
						{TARGET_MARKETS.map((market) => (
							<option key={market} value={market}>
								{displayMarket(market)}
							</option>
						))}
					</select>
				</div>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground">{lt("help")}</p>
		</div>
	);
}
