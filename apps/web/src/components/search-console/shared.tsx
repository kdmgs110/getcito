import { Button } from "@workspace/ui/components/button";
import { AlertCircle } from "lucide-react";
import { t } from "@/i18n";

const errors = {
	GSC_NOT_CONFIGURED: "keywords.notConfigured",
	GSC_RECONNECT_REQUIRED: "keywords.reauth",
	GSC_PROPERTY_REQUIRED: "keywords.chooseProperty",
	GSC_PROPERTY_FORBIDDEN: "keywords.forbidden",
	GSC_RATE_LIMITED: "keywords.quota",
	GSC_CONNECTION_CHANGED: "keywords.changed",
	GSC_INVALID_FILTER: "keywords.invalid",
} as const;
export function searchConsoleError(error: unknown): string {
	const message = error instanceof Error ? error.message : "";
	const code = Object.keys(errors).find((key) => message.includes(key)) as keyof typeof errors | undefined;
	return t(code ? errors[code] : "keywords.failed");
}
export function SearchConsoleError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
	return (
		<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
			<p className="flex items-start gap-2">
				<AlertCircle className="mt-0.5 size-4 shrink-0" />
				{searchConsoleError(error)}
			</p>
			{onRetry && (
				<Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
					{t("keywords.retry")}
				</Button>
			)}
		</div>
	);
}

export type SearchConsoleStatus = {
	configured: boolean;
	canManage: boolean;
	oauthConnected: boolean;
	needsReauth: boolean;
	propertyId: string | null;
	connectionRevision: string | null;
};

export const selectClassName =
	"h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";
