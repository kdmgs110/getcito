import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { GoStack } from "react-icons/go";
import { t } from "@/i18n";

interface HistoryButtonProps {
	brandId?: string;
	promptName?: string;
	promptId?: string;
	/** Prompt-details tab to land on (e.g. "web-queries"); defaults to the first tab. */
	tab?: "mentions" | "web-queries" | "citations" | "responses";
}

export function HistoryButton({ brandId, promptId, tab }: HistoryButtonProps) {
	if (!brandId || !promptId) {
		return null;
	}

	return (
		<Button size="sm" variant="secondary" className="text-xs cursor-pointer h-6 flex items-center px-2" asChild>
			<Link
				to="/app/$brand/prompts/$promptId"
				params={{ brand: brandId, promptId }}
				search={(previous) => ({ ...previous, tab })}
			>
				<GoStack className="size-3 mr-0.5" />
				<span className="text-xs font-normal">{t("core.viewDetails")}</span>
			</Link>
		</Button>
	);
}
