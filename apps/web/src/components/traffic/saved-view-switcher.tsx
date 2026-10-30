import { Bookmark, ListFilter, Plus } from "lucide-react";
import type { SavedTrafficView } from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { t } from "@/i18n";
import { conditionsSummary } from "./condition-editor";
import { useTrafficMeasurement } from "./traffic-measurement";
export function SavedViewSwitcher({
	views,
	hostname,
	selected,
	dirty,
	canManage,
	onSelect,
	onCreate,
	onManage,
	onSave,
	onRestore,
}: {
	views: SavedTrafficView[];
	hostname: string;
	selected?: SavedTrafficView;
	dirty: boolean;
	canManage: boolean;
	onSelect: (id?: string) => void;
	onCreate: () => void;
	onManage: () => void;
	onSave: () => void;
	onRestore: () => void;
}) {
	const measurement = useTrafficMeasurement();
	const available = views.filter((v) => v.hostname === hostname);
	const shown = available.slice(0, 5);
	const overflow = available.length > 5 || (selected && !shown.some((v) => v.id === selected.id));
	return (
		<section className="space-y-3 rounded-xl border bg-card p-4">
			<div className="flex flex-wrap items-center gap-3">
				<p className="text-xs font-semibold">{t("traffic.saved")}</p>
				<div className="hidden min-w-0 flex-1 md:block">
					<Tabs value={selected?.id ?? "all"} onValueChange={(v) => onSelect(v === "all" ? undefined : v)}>
						<TabsList className="h-auto flex-wrap justify-start bg-transparent p-0" aria-label={t("traffic.saved")}>
							<TabsTrigger
								className="h-9 border px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
								value="all"
							>
								{t("traffic.all")}
							</TabsTrigger>
							{shown.map((view) => (
								<TabsTrigger
									className="h-9 max-w-48 truncate border px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
									key={view.id}
									value={view.id}
								>
									{view.name}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
				</div>
				<select
					aria-label={t("traffic.saved")}
					className={cn("h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm", !overflow && "md:hidden")}
					value={selected?.id ?? "all"}
					onChange={(e) => onSelect(e.target.value === "all" ? undefined : e.target.value)}
				>
					<option value="all">{t("traffic.all")}</option>
					{available.map((view) => (
						<option key={view.id} value={view.id}>
							{view.name}
						</option>
					))}
				</select>
				{canManage && (
					<Button size="sm" variant="outline" onClick={onCreate}>
						<Plus className="size-4" />
						{t("traffic.register")}
					</Button>
				)}
				<Button size="sm" variant="outline" onClick={onManage}>
					<ListFilter className="size-4" />
					{t("traffic.manage")}
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2 text-xs">
				<Bookmark className="size-3.5" />
				<span className="font-medium">
					{t("traffic.selected")}: {selected?.name ?? t("traffic.all")}
				</span>
				{dirty && (
					<span className="rounded bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
						{t("traffic.temporary")}
					</span>
				)}
				<span className="min-w-0 break-all text-muted-foreground">
					{conditionsSummary(selected?.conditions ?? [], measurement.mode)}
				</span>
				{dirty && selected && (
					<div className="ml-auto flex gap-2">
						{canManage && (
							<Button size="sm" variant="outline" onClick={onSave}>
								{t("traffic.saveChanges")}
							</Button>
						)}
						<Button size="sm" variant="ghost" onClick={onRestore}>
							{t("traffic.restore")}
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}
