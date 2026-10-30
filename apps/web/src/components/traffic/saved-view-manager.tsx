import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { SavedTrafficView } from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { t, UI_LOCALE } from "@/i18n";
import { conditionsSummary } from "./condition-editor";
import { useTrafficMeasurement } from "./traffic-measurement";
import { trafficError } from "./shared";
import { reorderSiteViewIds } from "./traffic-state";
export function SavedViewManager({
	views,
	hostname,
	timeZone,
	canManage,
	onClose,
	onOpen,
	onEdit,
	onDuplicate,
	onDelete,
	onReorder,
}: {
	views: SavedTrafficView[];
	hostname: string;
	timeZone: string;
	canManage: boolean;
	onClose: () => void;
	onOpen: (view: SavedTrafficView) => void;
	onEdit: (view: SavedTrafficView) => void;
	onDuplicate: (view: SavedTrafficView) => void;
	onDelete: (view: SavedTrafficView) => Promise<void>;
	onReorder: (ids: string[]) => Promise<void>;
}) {
	const measurement = useTrafficMeasurement();
	const [search, setSearch] = useState("");
	const [deleting, setDeleting] = useState<SavedTrafficView>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const activeViews = views.filter((view) => view.hostname === hostname);
	const filtered = views.filter((view) =>
		`${view.name} ${conditionsSummary(view.conditions, measurement.mode)}`
			.toLocaleLowerCase()
			.includes(search.toLocaleLowerCase()),
	);
	async function move(id: string, direction: number) {
		setError(undefined);
		setBusy(true);
		try {
			const ids = reorderSiteViewIds(views, hostname, id, direction);
			await onReorder(ids);
		} catch (e) {
			setError(trafficError(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<Dialog open onOpenChange={(open) => !open && onClose()}>
				<DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>{t("traffic.manage")}</DialogTitle>
						<DialogDescription>{t("traffic.saveNote")}</DialogDescription>
					</DialogHeader>
					<Input
						aria-label={t("traffic.viewSearch")}
						placeholder={t("traffic.viewSearch")}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<div className="space-y-3">
						{filtered.length === 0 && (
							<p className="py-6 text-center text-sm text-muted-foreground">{t("traffic.noViews")}</p>
						)}
						{filtered.map((view) => (
							<div key={view.id} className="rounded-lg border p-3">
								<div className="flex flex-wrap items-center gap-2">
									<p className="min-w-0 flex-1 break-all text-sm font-semibold">{view.name}</p>
									<Button
										size="sm"
										variant="outline"
										disabled={view.hostname !== hostname}
										onClick={() => onOpen(view)}
									>
										{t("traffic.open")}
									</Button>
									{canManage && (
										<>
											<Button
												size="sm"
												variant="ghost"
												disabled={view.hostname !== hostname}
												onClick={() => onEdit(view)}
											>
												{t("traffic.edit")}
											</Button>
											<Button size="sm" variant="ghost" onClick={() => onDuplicate(view)}>
												{view.hostname === hostname ? t("traffic.duplicate") : t("traffic.copyToSite")}
											</Button>
											<Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(view)}>
												{t("traffic.delete")}
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={`${t("traffic.moveUp")}: ${view.name}`}
												disabled={busy || !!search || view.hostname !== hostname || activeViews[0]?.id === view.id}
												onClick={() => move(view.id, -1)}
											>
												<ArrowUp className="size-4" />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={`${t("traffic.moveDown")}: ${view.name}`}
												disabled={busy || !!search || view.hostname !== hostname || activeViews.at(-1)?.id === view.id}
												onClick={() => move(view.id, 1)}
											>
												<ArrowDown className="size-4" />
											</Button>
										</>
									)}
								</div>
								<p className="mt-2 break-all text-xs text-muted-foreground">
									{view.hostname} {view.hostname !== hostname && `· ${t("traffic.viewMismatch")}`}
								</p>
								{view.hostname !== hostname && (
									<p className="mt-1 text-pretty text-xs text-muted-foreground">{t("traffic.copyToSiteHelp")}</p>
								)}
								<p className="mt-1 break-all text-xs text-muted-foreground">
									{conditionsSummary(view.conditions, measurement.mode)}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{t("traffic.updatedAt")}:{" "}
									{new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "short", timeStyle: "short", timeZone }).format(
										new Date(view.updatedAt),
									)}
								</p>
							</div>
						))}
					</div>
				</DialogContent>
			</Dialog>
			<Dialog open={!!deleting} onOpenChange={(open) => !open && !busy && setDeleting(undefined)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("traffic.deleteTitle")}</DialogTitle>
						<DialogDescription>{t("traffic.deleteDescription", { name: deleting?.name ?? "" })}</DialogDescription>
					</DialogHeader>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button variant="outline" disabled={busy} onClick={() => setDeleting(undefined)}>
							{t("traffic.cancel")}
						</Button>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={async () => {
								if (!deleting) return;
								setBusy(true);
								setError(undefined);
								try {
									await onDelete(deleting);
									setDeleting(undefined);
								} catch (e) {
									setError(trafficError(e));
								} finally {
									setBusy(false);
								}
							}}
						>
							{busy ? t("traffic.updating") : t("traffic.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
