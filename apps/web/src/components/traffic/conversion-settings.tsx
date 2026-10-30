import { useQuery } from "@tanstack/react-query";
import type { ConversionGoal, GA4KeyEvent } from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { useId, useState } from "react";
import { t, UI_LOCALE } from "@/i18n";
import { listConversionEventsFn, saveConversionGoalFn } from "@/server/conversions";
import { TrafficError, TrafficLoading, trafficError } from "./shared";

export function countingMethodLabel(method: string) {
	return t(
		method === "ONCE_PER_EVENT"
			? "conversions.onceEvent"
			: method === "ONCE_PER_SESSION"
				? "conversions.onceSession"
				: "conversions.unknownCounting",
	);
}
function EventDetails({ event }: { event: Pick<GA4KeyEvent, "countingMethod" | "createTime"> }) {
	return (
		<dl className="space-y-2 rounded-lg border p-3 text-xs">
			<div className="flex flex-wrap justify-between gap-2">
				<dt className="text-muted-foreground">{t("conversions.counting")}</dt>
				<dd>{countingMethodLabel(event.countingMethod)}</dd>
			</div>
			<div className="flex flex-wrap justify-between gap-2">
				<dt className="text-muted-foreground">{t("conversions.registeredDate")}</dt>
				<dd>
					{event.createTime
						? new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "medium" }).format(new Date(event.createTime))
						: "—"}
				</dd>
			</div>
		</dl>
	);
}
export function ConversionSettings({
	brandId,
	scopeKey,
	goals,
	canManage,
	onClose,
	onChanged,
}: {
	brandId: string;
	scopeKey: string;
	goals: ConversionGoal[];
	canManage: boolean;
	onClose: () => void;
	onChanged: (goal?: ConversionGoal) => Promise<void>;
}) {
	const events = useQuery({
		queryKey: ["traffic-conversion-events", brandId, scopeKey],
		queryFn: () => listConversionEventsFn({ data: { brandId } }),
		enabled: canManage,
		retry: false,
		refetchOnWindowFocus: false,
		staleTime: 30000,
	});
	const [editing, setEditing] = useState<ConversionGoal | "new">();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>();
	const [notice, setNotice] = useState(false);
	async function toggle(goal: ConversionGoal) {
		setError(undefined);
		setBusy(true);
		try {
			const saved = await saveConversionGoalFn({
				data: {
					brandId,
					id: goal.id,
					revision: goal.revision,
					displayName: goal.displayName,
					eventName: goal.eventName,
					enabled: !goal.enabled,
				},
			});
			await onChanged(saved);
			setNotice(true);
		} catch (e) {
			setError(e);
		} finally {
			setBusy(false);
		}
	}
	return (
		<Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
				<SheetHeader>
					<SheetTitle>{t("conversions.settingsTitle")}</SheetTitle>
					<SheetDescription>{t("conversions.settingsDescription")}</SheetDescription>
				</SheetHeader>
				<div className="space-y-5 px-4 pb-6">
					<p className="rounded-lg border bg-muted/30 p-3 text-sm">{t("conversions.readOnly")}</p>
					{notice && (
						<p role="status" className="text-sm">
							{t("conversions.saved")}
						</p>
					)}
					{error !== undefined && <TrafficError error={error} />}
					<section className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<h3 className="font-medium">{t("conversions.registered")}</h3>
							{canManage && (
								<Button
									size="sm"
									disabled={busy}
									onClick={() => {
										setEditing("new");
										setNotice(false);
									}}
								>
									{t("conversions.add")}
								</Button>
							)}
						</div>
						{!goals.length && <p className="text-sm text-muted-foreground">{t("conversions.notConfigured")}</p>}
						{goals.map((goal) => (
							<div key={goal.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
								<div className="min-w-0 flex-1">
									<p className="break-words text-sm font-medium">{goal.displayName}</p>
									<p className="break-all text-xs text-muted-foreground">{goal.eventName}</p>
								</div>
								<span
									className={
										goal.enabled ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-xs text-muted-foreground"
									}
								>
									{t(goal.enabled ? "conversions.enabled" : "conversions.disabled")}
								</span>
								{canManage && (
									<>
										<Button
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => setEditing(goal)}
											aria-label={`${t("conversions.editAction")}: ${goal.displayName}`}
										>
											{t("conversions.editAction")}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											disabled={busy}
											onClick={() => void toggle(goal)}
											aria-label={`${t(goal.enabled ? "conversions.disable" : "conversions.enable")}: ${goal.displayName}`}
										>
											{t(goal.enabled ? "conversions.disable" : "conversions.enable")}
										</Button>
									</>
								)}
							</div>
						))}
					</section>
					{!canManage ? (
						<p className="text-sm text-muted-foreground">{t("conversions.ownerRequired")}</p>
					) : (
						<>
							<div className="flex justify-end">
								<Button
									size="sm"
									variant="ghost"
									disabled={events.isFetching || busy}
									onClick={() => void events.refetch()}
								>
									{t("conversions.refreshEvents")}
								</Button>
							</div>
							{events.isPending && <TrafficLoading />}
							{events.isError && <TrafficError error={events.error} retry={() => void events.refetch()} />}
							{events.data?.length === 0 && (
								<div className="space-y-3 rounded-lg border p-4">
									<h3 className="font-medium">{t("conversions.noEvents")}</h3>
									<p className="text-sm text-muted-foreground">{t("conversions.noEventsHelp")}</p>
									<a
										className="text-sm underline underline-offset-4"
										href="https://analytics.google.com/analytics/web/"
										target="_blank"
										rel="noreferrer"
									>
										{t("conversions.openGA4")}
									</a>
								</div>
							)}
							{editing && events.data && (
								<GoalEditor
									key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
									goal={editing === "new" ? undefined : editing}
									events={events.data}
									disabled={busy}
									onCancel={() => setEditing(undefined)}
									onSave={async (value) => {
										setBusy(true);
										setError(undefined);
										try {
											const saved = await saveConversionGoalFn({
												data: {
													brandId,
													...value,
													...(editing !== "new" ? { id: editing.id, revision: editing.revision } : {}),
													enabled: editing === "new" ? true : editing.enabled,
												},
											});
											await onChanged(saved);
											setEditing(undefined);
											setNotice(true);
										} finally {
											setBusy(false);
										}
									}}
								/>
							)}
						</>
					)}
					<p className="text-xs leading-relaxed text-muted-foreground">{t("conversions.beforeRegistration")}</p>
					<Button variant="outline" disabled={busy} onClick={onClose}>
						{t("conversions.close")}
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
function GoalEditor({
	goal,
	events,
	disabled,
	onCancel,
	onSave,
}: {
	goal?: ConversionGoal;
	events: GA4KeyEvent[];
	disabled: boolean;
	onCancel: () => void;
	onSave: (value: { displayName: string; eventName: string }) => Promise<void>;
}) {
	const id = useId();
	const [name, setName] = useState(goal?.displayName ?? "");
	const [eventName, setEventName] = useState(goal?.eventName ?? "");
	const [error, setError] = useState<string>();
	const event = events.find((item) => item.eventName === eventName);
	return (
		<form
			className="space-y-4 rounded-xl border p-4"
			aria-label={t(goal ? "conversions.edit" : "conversions.add")}
			onSubmit={async (e) => {
				e.preventDefault();
				setError(undefined);
				if (!name.trim() || name.trim().length > 60) {
					setError(t("conversions.invalidName"));
					return;
				}
				if (!eventName) return;
				try {
					await onSave({ displayName: name.trim(), eventName });
				} catch (err) {
					setError(trafficError(err));
				}
			}}
		>
			<h3 className="font-semibold">{t(goal ? "conversions.edit" : "conversions.add")}</h3>
			<div className="space-y-2">
				<Label htmlFor={`${id}-name`}>{t("conversions.name")}</Label>
				<Input
					id={`${id}-name`}
					required
					maxLength={60}
					value={name}
					disabled={disabled}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor={`${id}-event`}>{t("conversions.event")}</Label>
				<select
					id={`${id}-event`}
					required
					disabled={disabled || !!goal}
					className="h-10 w-full rounded-md border bg-background px-3 text-sm"
					value={eventName}
					onChange={(e) => setEventName(e.target.value)}
				>
					<option value="">{t("conversions.selectEvent")}</option>
					{goal && !event && <option value={goal.eventName}>{goal.eventName}</option>}
					{events.map((item) => (
						<option key={item.name} value={item.eventName}>
							{item.eventName}
						</option>
					))}
				</select>
			</div>
			{event && <EventDetails event={event} />}
			<div className="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="outline" disabled={disabled} onClick={onCancel}>
					{t("conversions.cancel")}
				</Button>
				<Button type="submit" disabled={disabled || !eventName || (!event && !goal)}>
					{t(disabled ? "conversions.saving" : "conversions.save")}
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</form>
	);
}
