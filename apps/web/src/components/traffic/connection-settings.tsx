import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TrafficConnectionStatus } from "@workspace/lib/analytics";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { t } from "@/i18n";
import {
	beginTrafficOAuthFn,
	connectTrafficPropertyFn,
	disconnectTrafficFn,
	getAnalyticsPropertiesFn,
} from "@/server/traffic";
import { trafficError } from "./shared";
export function ConnectionSettings({
	brandId,
	status,
	onClose,
	onChanged,
}: {
	brandId: string;
	status: TrafficConnectionStatus;
	onClose: () => void;
	onChanged: () => Promise<void>;
}) {
	const [propertyId, setPropertyId] = useState(status.propertyId ?? "");
	const [hostname, setHostname] = useState(status.hostname);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [confirmDisconnect, setConfirmDisconnect] = useState(false);
	const properties = useQuery({
		queryKey: ["traffic-properties", brandId, status.connectionRevision],
		queryFn: () => getAnalyticsPropertiesFn({ data: { brandId } }),
		enabled: status.configured && status.oauthConnected && status.canManage,
		staleTime: 60000,
		retry: false,
	});
	async function begin() {
		setBusy(true);
		setError(undefined);
		try {
			const result = await beginTrafficOAuthFn({ data: { brandId } });
			window.location.assign(result.url);
		} catch (e) {
			setError(trafficError(e));
			setBusy(false);
		}
	}
	return (
		<>
			<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>{t("traffic.settings")}</DialogTitle>
						<DialogDescription className="text-pretty">{t("traffic.choosePropertyHelp")}</DialogDescription>
					</DialogHeader>
					{!status.configured ? (
						<div className="space-y-3 text-sm">
							<p>{t("traffic.configRequired")}</p>
							<p className="break-words text-pretty text-xs text-muted-foreground">{t("traffic.configHelp")}</p>
							<a
								className="underline"
								href="https://developers.google.com/identity/protocols/oauth2/web-server"
								target="_blank"
								rel="noreferrer"
							>
								{t("traffic.setupGuide")}
							</a>
						</div>
					) : !status.canManage ? (
						<p className="text-sm">{t("traffic.ownerRequired")}</p>
					) : (
						<>
							{(!status.oauthConnected || status.needsReconnect) && (
								<Button disabled={busy} onClick={begin}>
									{status.needsReconnect ? t("traffic.reconnect") : t("traffic.connect")}
								</Button>
							)}
							{status.oauthConnected && (
								<>
									<div className="space-y-2">
										<label className="block text-sm font-medium" htmlFor="analytics-property">
											{t("traffic.property")}
										</label>
										<select
											id="analytics-property"
											className="h-10 w-full rounded-md border bg-background px-3 text-sm"
											value={propertyId}
											onChange={(e) => setPropertyId(e.target.value)}
											disabled={busy || properties.isPending}
										>
											<option value="">
												{properties.isPending ? t("traffic.loading") : t("traffic.chooseProperty")}
											</option>
											{properties.data?.map((property) => (
												<option key={property.id} value={property.id}>
													{property.name} ({property.id})
												</option>
											))}
										</select>
										{properties.data?.length === 0 && (
											<p className="text-xs text-muted-foreground">{t("traffic.noProperties")}</p>
										)}
										{properties.isError && (
											<div role="alert" className="text-xs text-destructive">
												{trafficError(properties.error)}
												<Button variant="link" size="sm" onClick={() => properties.refetch()}>
													{t("traffic.retry")}
												</Button>
											</div>
										)}
									</div>
									<div className="space-y-2">
										<label className="block text-sm font-medium" htmlFor="analytics-site">
											{t("traffic.site")}
										</label>
										<select
											id="analytics-site"
											className="h-10 w-full rounded-md border bg-background px-3 text-sm"
											value={hostname}
											onChange={(e) => setHostname(e.target.value)}
											disabled={busy}
										>
											{[...new Set([status.hostname, ...status.availableSites])].filter(Boolean).map((site) => (
												<option key={site} value={site}>
													{site}
												</option>
											))}
										</select>
									</div>
									<Button
										disabled={busy || !propertyId || !hostname}
										onClick={async () => {
											setBusy(true);
											setError(undefined);
											try {
												await connectTrafficPropertyFn({ data: { brandId, propertyId, hostname } });
												await onChanged();
												onClose();
											} catch (e) {
												setError(trafficError(e));
											} finally {
												setBusy(false);
											}
										}}
									>
										{busy ? t("traffic.updating") : t("traffic.connectProperty")}
									</Button>
								</>
							)}
							{status.oauthConnected && (
								<div className="flex flex-wrap gap-2 border-t pt-4">
									<Button variant="outline" disabled={busy} onClick={begin}>
										{t("traffic.reconnect")}
									</Button>
									<Button
										variant="outline"
										className="text-destructive"
										disabled={busy}
										onClick={() => setConfirmDisconnect(true)}
									>
										{t("traffic.disconnect")}
									</Button>
								</div>
							)}
						</>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</DialogContent>
			</Dialog>
			<Dialog open={confirmDisconnect} onOpenChange={(open) => !busy && setConfirmDisconnect(open)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("traffic.disconnectConfirm")}</DialogTitle>
						<DialogDescription>{t("traffic.disconnectHelp")}</DialogDescription>
					</DialogHeader>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button disabled={busy} variant="outline" onClick={() => setConfirmDisconnect(false)}>
							{t("traffic.cancel")}
						</Button>
						<Button
							disabled={busy}
							variant="destructive"
							onClick={async () => {
								setBusy(true);
								setError(undefined);
								try {
									await disconnectTrafficFn({ data: { brandId } });
									await onChanged();
									setConfirmDisconnect(false);
									onClose();
								} catch (e) {
									setError(trafficError(e));
								} finally {
									setBusy(false);
								}
							}}
						>
							{busy ? t("traffic.updating") : t("traffic.disconnect")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
