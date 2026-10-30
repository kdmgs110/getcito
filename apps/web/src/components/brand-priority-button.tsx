import { settingsError } from "@/i18n/settings-labels";
import { t } from "@/i18n";
/**
 * Moves a brand's waiting prompts to the front of the `process-prompt` queue.
 *
 * Shared between the admin brand table and the queue page because both offer the
 * same action on the same row of data, and the failure/confirmation handling is
 * the only interesting part of it.
 */

import { Button } from "@workspace/ui/components/button";
import { ArrowUp, Check, Loader2, Undo2 } from "lucide-react";
import { useState } from "react";
import { setBrandQueuePriorityFn } from "@/server/admin";

export function BrandPriorityButton({
	brandId,
	isPrioritised,
	onUpdate,
}: {
	brandId: string;
	/** Omit when the caller has no priority data - the button then only offers to promote. */
	isPrioritised?: boolean;
	onUpdate?: () => void;
}) {
	const [isUpdating, setIsUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	const demote = isPrioritised === true;

	const handleClick = async () => {
		setIsUpdating(true);
		setError(null);
		try {
			await setBrandQueuePriorityFn({ data: { brandId, priority: demote ? "normal" : "high" } });
			setDone(true);
			setTimeout(() => {
				setDone(false);
				onUpdate?.();
			}, 1000);
		} catch (err) {
			setError(settingsError(err, t("settings.failedToUpdatePriority")));
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<div className="flex flex-col gap-1">
			<Button
				variant="outline"
				size="sm"
				onClick={handleClick}
				disabled={isUpdating || done}
				className="cursor-pointer"
				title={
					demote
						? t("settings.returnThisBrandSQueuedPromptsToNormalPriority")
						: t("settings.runThisBrandSPromptsBeforeTheRestOf")
				}
			>
				{isUpdating ? (
					<Loader2 className="h-3 w-3 animate-spin" />
				) : done ? (
					<Check className="h-3 w-3 text-emerald-500" />
				) : demote ? (
					<Undo2 className="h-3 w-3" />
				) : (
					<ArrowUp className="h-3 w-3" />
				)}
				<span className="ml-1">
					{done ? t("settings.updated") : demote ? t("settings.normal") : t("settings.runFirst")}
				</span>
			</Button>
			{error && <span className="text-xs text-red-500">{error}</span>}
		</div>
	);
}
