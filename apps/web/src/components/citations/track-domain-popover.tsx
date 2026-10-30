import { t } from "@/i18n";
import { useState } from "react";
import { Input } from "@workspace/ui/components/input";
import { Button } from "@workspace/ui/components/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@workspace/ui/components/popover";
import { IconInfoCircle, IconPlus } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import * as Sentry from "@sentry/tanstackstart-react";
import { addDomainToBrandFn, addDomainToCompetitorFn, createCompetitorFromDomainFn } from "@/server/brands";

export function TrackDomainPopover({
	domain,
	brandId,
	brandName,
	competitors,
	onAdded,
}: {
	domain: string;
	brandId: string;
	brandName?: string;
	competitors: Array<{ id: string; name: string; domains: string[] }>;
	onAdded?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [newName, setNewName] = useState("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");

	const handleSuccess = () => {
		setSaving(false);
		setSaved(true);
		setError("");
		setOpen(false);
		onAdded?.();
	};

	const handleError = (e: unknown) => {
		setSaving(false);
		setError(t("dashboard.somethingWentWrongPleaseTryAgain"));
		Sentry.captureException(e);
	};

	const handleAddToBrand = async () => {
		setSaving(true);
		setError("");
		try {
			await addDomainToBrandFn({ data: { brandId, domain } });
			handleSuccess();
		} catch (e) {
			handleError(e);
		}
	};

	const handleAddToExisting = async (competitorId: string) => {
		setSaving(true);
		setError("");
		try {
			await addDomainToCompetitorFn({ data: { brandId, competitorId, domain } });
			handleSuccess();
		} catch (e) {
			handleError(e);
		}
	};

	const handleCreateNew = async () => {
		if (!newName.trim()) return;
		setSaving(true);
		setError("");
		try {
			await createCompetitorFromDomainFn({ data: { brandId, name: newName.trim(), domain } });
			setNewName("");
			handleSuccess();
		} catch (e) {
			handleError(e);
		}
	};

	if (saved) {
		return (
			<span className="shrink-0 p-1 text-muted-foreground">
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
			</span>
		);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="shrink-0 p-1 rounded hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
					title={t("dashboard.trackDomain", { domain })}
				>
					<IconPlus className="h-3.5 w-3.5" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-72 p-3" align="end">
				<div className="space-y-3">
					<p className="text-xs font-medium">
						{t("dashboard.track")} <strong>{domain}</strong>
					</p>

					{error && <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">{error}</p>}

					<div className="space-y-1">
						<div className="flex items-center gap-1">
							<p className="text-[11px] text-muted-foreground">{t("dashboard.addAsBrandDomain")}</p>
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3 w-3 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									{t("dashboard.retroactiveBrand")}
								</TooltipContent>
							</Tooltip>
						</div>
						<button
							type="button"
							onClick={handleAddToBrand}
							disabled={saving}
							className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted cursor-pointer disabled:opacity-50 transition-colors"
						>
							{brandName || t("dashboard.myBrand")}
						</button>
					</div>

					{competitors.length > 0 && (
						<div className="space-y-1">
							<div className="flex items-center gap-1">
								<p className="text-[11px] text-muted-foreground">{t("dashboard.addToExistingCompetitor")}</p>
								<Tooltip>
									<TooltipTrigger asChild>
										<IconInfoCircle className="h-3 w-3 text-muted-foreground cursor-help" />
									</TooltipTrigger>
									<TooltipContent className="max-w-xs text-xs font-normal">
										{t("dashboard.retroactiveCompetitor")}
									</TooltipContent>
								</Tooltip>
							</div>
							<div className="max-h-32 overflow-y-auto space-y-0.5">
								{competitors.map((c) => (
									<button
										key={c.id}
										type="button"
										onClick={() => handleAddToExisting(c.id)}
										disabled={saving}
										className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted cursor-pointer disabled:opacity-50 transition-colors"
									>
										{c.name}
									</button>
								))}
							</div>
						</div>
					)}

					<div className="space-y-1.5">
						<p className="text-[11px] text-muted-foreground">{t("dashboard.orCreateNewCompetitor")}</p>
						<div className="flex gap-1.5">
							<Input
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								placeholder={t("dashboard.competitorName")}
								className="h-7 text-xs"
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleCreateNew();
									}
								}}
								disabled={saving}
							/>
							<Button
								size="sm"
								onClick={handleCreateNew}
								disabled={saving || !newName.trim()}
								className="h-7 px-2 text-xs cursor-pointer shrink-0"
							>
								{t("dashboard.add")}
							</Button>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
