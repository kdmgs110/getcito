import type { BrandMentionAnalysis } from "@workspace/lib/brand-mentions";
import type { MeasurementEvidence } from "@workspace/lib/measurement";

export const SPREADSHEET_BATCH_SIZE = 20;

export interface SpreadsheetPage {
	url: string;
	domain: string;
	title: string;
	/** Null means the provider did not expose search-result evidence. */
	appearances: number | null;
	/** Null means the provider did not expose citation evidence. */
	citations: number | null;
}

export interface SpreadsheetDomain {
	domain: string;
	appearances: number | null;
	citations: number | null;
}

export interface SpreadsheetAnswer {
	runId: string;
	createdAt: string;
	answerText: string;
	answerStatus: MeasurementEvidence["answerStatus"];
	mentionedBrands: string[];
	/** Older API fixtures may omit it; persisted answers are enriched on read. */
	mentionAnalysis?: BrandMentionAnalysis | null;
	webQueries: string[];
	queryStatus: MeasurementEvidence["queryStatus"];
	searchResultsStatus: "known" | "unknown";
	citationsStatus: "known" | "unknown";
	pages: SpreadsheetPage[];
	domains: SpreadsheetDomain[];
}

export interface VisibilitySpreadsheetRow {
	id: string;
	value: string;
	/** Existing user-assigned prompt tags, without inferred system labels. */
	tags: string[];
	lastRunAt: string | null;
	chatgpt: SpreadsheetAnswer | null;
	aiMode: SpreadsheetAnswer | null;
}

export interface VisibilitySpreadsheetResponse {
	rows: VisibilitySpreadsheetRow[];
	asOf: string;
	/** Changes when definitions or a published recount change, even for old acquisitions. */
	mentionRevision?: string;
}
