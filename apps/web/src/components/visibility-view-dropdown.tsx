import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { ChartNoAxesCombined, Table2 } from "lucide-react";
import { FilterTriggerButton } from "@/components/filter-bar";
import { st } from "@/i18n/visibility-spreadsheet-labels";
import { coerceVisibilityView, type VisibilityView } from "@/lib/visibility-view";

export function VisibilityViewDropdown() {
	const navigate = useNavigate();
	const view = useSearch({ strict: false, select: (s) => coerceVisibilityView((s as { view?: unknown }).view) });
	const setView = (next: VisibilityView) =>
		navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({ ...prev, view: next === "graph" ? undefined : next }),
			replace: true,
			resetScroll: false,
		});
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<FilterTriggerButton
					aria-label={st("view")}
					icon={view === "spreadsheet" ? <Table2 className="size-3.5" /> : <ChartNoAxesCombined className="size-3.5" />}
					label={`${st("view")}：${st(view)}`}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup value={view} onValueChange={(value) => setView(coerceVisibilityView(value))}>
					<DropdownMenuRadioItem value="graph">{st("graph")}</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="spreadsheet">{st("spreadsheet")}</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
