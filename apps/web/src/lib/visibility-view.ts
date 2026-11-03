export type VisibilityView = "graph" | "spreadsheet";

export function coerceVisibilityView(value: unknown): VisibilityView {
	return value === "spreadsheet" ? "spreadsheet" : "graph";
}
