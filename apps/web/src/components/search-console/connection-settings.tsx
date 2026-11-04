import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { useState } from "react";
import { t } from "@/i18n";
import {
	beginSearchConsoleOAuthFn,
	connectSearchConsolePropertyFn,
	disconnectSearchConsoleFn,
	getSearchConsolePropertiesFn,
} from "@/server/search-console";
import { SearchConsoleError, type SearchConsoleStatus, selectClassName } from "./shared";

export function SearchConsoleSettings({
	brandId,
	status,
	onClose,
	onChanged,
}: {
	brandId: string;
	status: SearchConsoleStatus;
	onClose: () => void;
	onChanged: () => Promise<void>;
}) {
	const [property, setProperty] = useState(status.propertyId ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>();
	const [confirm, setConfirm] = useState(false);
	const properties = useQuery({
		queryKey: ["gsc-properties", brandId, status.connectionRevision],
		queryFn: () => getSearchConsolePropertiesFn({ data: { brandId } }),
		enabled: status.configured && status.canManage && status.oauthConnected && !status.needsReauth,
		staleTime: 60_000,
		retry: false,
	});
	async function begin() {
		setError(undefined);
		setBusy(true);
		try {
			window.location.assign((await beginSearchConsoleOAuthFn({ data: { brandId } })).url);
		} catch (e) {
			setError(e);
			setBusy(false);
		}
	}
	async function save() {
		setError(undefined);
		setBusy(true);
		try {
			await connectSearchConsolePropertyFn({ data: { brandId, siteUrl: property } });
			await onChanged();
			onClose();
		} catch (e) {
			setError(e);
			setBusy(false);
		}
	}
	async function disconnect() {
		setError(undefined);
		setBusy(true);
		try {
			await disconnectSearchConsoleFn({ data: { brandId } });
			await onChanged();
			onClose();
		} catch (e) {
			setError(e);
			setBusy(false);
		}
	}
	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent className="sm:max-w-xl" aria-busy={busy}>
				<DialogHeader>
					<DialogTitle>{t("keywords.settings")}</DialogTitle>
					<DialogDescription>{t("keywords.settingsHelp")}</DialogDescription>
				</DialogHeader>
				{!status.canManage ? (
					<p className="text-sm">{t("keywords.ownerRequired")}</p>
				) : !status.configured ? (
					<p className="text-sm">{t("keywords.notConfigured")}</p>
				) : (
					<div className="space-y-4">
						{status.oauthConnected && !status.needsReauth && (
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="gsc-property">
									{t("keywords.chooseProperty")}
								</label>
								{properties.isPending ? (
									<p role="status" className="text-sm text-muted-foreground">
										{t("keywords.loading")}
									</p>
								) : properties.isError ? (
									<SearchConsoleError error={properties.error} onRetry={() => void properties.refetch()} />
								) : properties.data?.length ? (
									<select
										id="gsc-property"
										className={`${selectClassName} w-full`}
										value={property}
										onChange={(e) => setProperty(e.target.value)}
										disabled={busy}
									>
										<option value="">{t("keywords.chooseProperty")}</option>
										{properties.data.map((entry) => (
											<option key={entry.siteUrl} value={entry.siteUrl}>
												{entry.siteUrl}
											</option>
										))}
									</select>
								) : (
									<p className="text-sm text-muted-foreground">{t("keywords.noProperties")}</p>
								)}
							</div>
						)}
						<Button variant="outline" onClick={() => void begin()} disabled={busy}>
							{t(status.oauthConnected ? "keywords.reconnect" : "keywords.connect")}
						</Button>
						{status.needsReauth && (
							<p role="status" className="text-sm">
								{t("keywords.reauth")}
							</p>
						)}
						{confirm && (
							<div className="space-y-3 rounded-lg border p-3">
								<p className="text-sm">{t("keywords.disconnectHelp")}</p>
								<div className="flex flex-wrap gap-2">
									<Button variant="destructive" size="sm" disabled={busy} onClick={() => void disconnect()}>
										{t("keywords.confirmDisconnect")}
									</Button>
									<Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm(false)}>
										{t("keywords.cancel")}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
				{error !== undefined && <SearchConsoleError error={error} />}
				<DialogFooter className="gap-2 sm:justify-between">
					<div>
						{status.oauthConnected && status.canManage && !confirm && (
							<Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirm(true)}>
								{t("keywords.disconnect")}
							</Button>
						)}
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="outline" disabled={busy} onClick={onClose}>
							{t("keywords.close")}
						</Button>
						{status.canManage && status.oauthConnected && !status.needsReauth && (
							<Button
								disabled={busy || !property || !properties.data?.some((entry) => entry.siteUrl === property)}
								onClick={() => void save()}
							>
								{t("keywords.saveProperty")}
							</Button>
						)}
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
