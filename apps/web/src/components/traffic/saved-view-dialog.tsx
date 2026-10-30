import { useId, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { normalizeConditions, type SavedTrafficView, type TrafficCondition } from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { t } from "@/i18n";
import { ConditionEditor, conditionsSummary } from "./condition-editor";
import { useTrafficMeasurement } from "./traffic-measurement";
import { trafficError } from "./shared";
export interface ViewDialogState {
	view?: SavedTrafficView;
	name: string;
	conditions: TrafficCondition[];
	keepDetail?: boolean;
}
export function SavedViewDialog({
	initial,
	hostname,
	onClose,
	onSave,
}: {
	initial: ViewDialogState;
	hostname: string;
	onClose: () => void;
	onSave: (value: { name: string; conditions: TrafficCondition[] }) => Promise<void>;
}) {
	const measurement = useTrafficMeasurement();
	const [name, setName] = useState(initial.name);
	const [conditions, setConditions] = useState(initial.conditions);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const id = useId();
	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError(undefined);
		try {
			const parsed = normalizeConditions(conditions, hostname);
			setBusy(true);
			await onSave({ name: name.trim(), conditions: parsed });
			onClose();
		} catch (e) {
			setError(trafficError(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-2xl">
				<form onSubmit={submit} className="space-y-5">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-balance">
							<BookmarkPlus className="size-5" />
							{initial.view ? t("traffic.editTitle") : t("traffic.savedTitle")}
						</DialogTitle>
						<DialogDescription className="text-pretty">{t("traffic.savedDescription")}</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor={`${id}-name`}>{t("traffic.viewName")}</Label>
						<Input
							id={`${id}-name`}
							autoFocus
							required
							maxLength={60}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("traffic.viewNameHint")}
							disabled={busy}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor={`${id}-site`}>{t("traffic.site")}</Label>
						<Input id={`${id}-site`} value={hostname} readOnly className="bg-muted/50" />
					</div>
					<div className="space-y-3">
						<p className="text-sm font-medium">{t("traffic.savedConditions")}</p>
						<ConditionEditor value={conditions} onChange={setConditions} disabled={busy} />
					</div>
					<div className="rounded-lg bg-muted/50 p-3 text-sm">
						<p className="font-medium">{t("traffic.savedConditions")}</p>
						<p className="mt-2 break-all text-pretty">{conditionsSummary(conditions, measurement.mode)}</p>
					</div>
					<p className="text-pretty text-xs text-muted-foreground">{t("traffic.saveNote")}</p>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={busy} onClick={onClose}>
							{t("traffic.cancel")}
						</Button>
						<Button type="submit" disabled={busy || !name.trim()}>
							{busy ? t("traffic.updating") : initial.view ? t("traffic.save") : t("traffic.registerShow")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
