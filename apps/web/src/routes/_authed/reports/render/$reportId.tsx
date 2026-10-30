import { t } from "@/i18n";
import { reportStatusLabel } from "@/i18n/report-status";
/**
 * /reports/render/$reportId - Standalone report rendering page
 *
 * Production-quality printable report (US Letter 8.5 x 11 in).
 * Uses Share of Voice as the primary metric with rich competitive analysis.
 */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { formatDateTime } from "@/lib/app-locale";
import { requireAuthSession, hasReportAccess } from "@/lib/auth/helpers";
import { getReportByIdFn } from "@/server/reports";
import { PromptChartPrint } from "@/components/prompt-chart-print";
import { Target, BarChart3, Rocket } from "lucide-react";
import { Logo } from "@/components/logo";
import { useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import {
	computeOverallSoV,
	computePromptSoV,
	computeCompetitorSoVs,
	selectRepresentativePrompts,
	findContentGaps,
	analyzeWebQueries,
	analyzeCompetitorFrequency,
	analyzeByEngine,
	getSoVColor,
	type ReportPromptRun,
	type FullPromptRun,
	type PromptCategory,
} from "@workspace/lib/report-metrics";

// ---------- Types ----------

interface ReportData {
	competitors: CompetitorResult[];
	prompts: PromptData[];
	promptRuns: PromptRunResult[];
}

interface CompetitorResult {
	name: string;
	domain: string;
}
interface PromptData {
	value: string;
}

interface PromptRunResult {
	promptValue: string;
	runs: Array<{
		model: string;
		version: string;
		webSearchEnabled: boolean;
		rawOutput: any;
		webQueries: string[];
		textContent: string;
		brandMentioned: boolean;
		competitorsMentioned: string[];
	}>;
}

interface MockPrompt {
	id: string;
	brandId: string;
	value: string;
	enabled: boolean;
	createdAt: Date;
}

// ---------- Server function ----------

const loadReportData = createServerFn({ method: "GET" })
	.validator((d: string) => d)
	.handler(async ({ data: reportId }) => {
		const session = await requireAuthSession();
		if (!hasReportAccess(session)) throw new Error(t("reports.notAuthorized"));
		return getReportByIdFn({ data: { reportId } });
	});

function isPromptBranded(promptValue: string, brandName: string, brandWebsite: string): boolean {
	const promptLower = (promptValue || "").toLowerCase();
	const brandNameLower = (brandName || "").toLowerCase();
	try {
		const website = brandWebsite || "";
		const url = new URL(website.startsWith("http") ? website : `https://${website}`);
		const domain = url.hostname.replace(/^www\./, "").toLowerCase();
		const domainWithoutTld = domain.split(".")[0];
		return (
			promptLower.includes(brandNameLower) || promptLower.includes(domain) || promptLower.includes(domainWithoutTld)
		);
	} catch {
		return promptLower.includes(brandNameLower);
	}
}

// ---------- Route ----------

export const Route = createFileRoute("/_authed/reports/render/$reportId")({
	loader: async ({ params }) => {
		const report = await loadReportData({ data: params.reportId });
		if (!report) throw notFound();
		return { report };
	},
	head: () => ({
		meta: [{ title: t("reports.aiShareOfVoiceReport") }, { name: "robots", content: "noindex, nofollow" }],
	}),
	component: ReportRenderPage,
});

// ---------- Color helpers ----------

function sovBgColor(sov: number | null): string {
	if (sov === null) return "bg-slate-300";
	if (sov >= 40) return "bg-emerald-500";
	if (sov >= 20) return "bg-amber-500";
	return "bg-rose-500";
}

// ---------- Main component ----------

function ReportRenderPage() {
	const { report } = Route.useLoaderData();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const branding = context.clientConfig?.branding;

	if (report.status !== "completed") {
		return (
			<div className="max-w-3xl mx-auto p-8 text-center">
				<p className="text-slate-500">
					{t("reports.reportStatus")} <span className="font-medium">{reportStatusLabel(report.status)}</span>
				</p>
			</div>
		);
	}

	const rawData = report.rawOutput;
	let data: ReportData | null = null;
	try {
		data = (typeof rawData === "string" ? JSON.parse(rawData) : rawData) as ReportData;
	} catch (err) {
		console.error("Failed to parse report rawOutput:", err);
	}

	// Build mock data structures for chart component compatibility
	const mockBrand = {
		id: "brand-1",
		name: report.brandName,
		website: report.brandWebsite,
		enabled: true,
		onboarded: true,
		delayOverrideHours: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const mockCompetitors = (data?.competitors || []).map((comp, i) => ({
		id: `comp-${i + 1}`,
		name: comp.name,
		domain: comp.domain,
		brandId: mockBrand.id,
		createdAt: new Date(),
		updatedAt: new Date(),
	}));
	const mockPrompts: MockPrompt[] = (data?.prompts || []).map((p, i) => ({
		id: `prompt-${i + 1}`,
		brandId: mockBrand.id,
		value: p?.value || "",
		enabled: true,
		createdAt: new Date(),
	}));

	// Build run arrays
	const simpleRuns: ReportPromptRun[] = [];
	const fullRuns: FullPromptRun[] = [];
	const chartRuns: any[] = [];

	(data?.promptRuns || []).forEach((pr, pi) => {
		(pr.runs || []).forEach((run, ri) => {
			const promptId = `prompt-${pi + 1}`;
			simpleRuns.push({
				promptId,
				brandMentioned: run.brandMentioned,
				competitorsMentioned: run.competitorsMentioned || [],
			});
			fullRuns.push({
				promptId,
				promptValue: pr?.promptValue || "",
				brandMentioned: run?.brandMentioned || false,
				competitorsMentioned: run?.competitorsMentioned || [],
				webQueries: run?.webQueries || [],
				textContent: run?.textContent || "",
				model: run?.model || "",
			});
			chartRuns.push({
				id: `run-${pi}-${ri}`,
				promptId,
				brandMentioned: run.brandMentioned,
				competitorsMentioned: run.competitorsMentioned || [],
				createdAt: new Date(),
				model: run.model,
				version: run.version,
				webSearchEnabled: run.webSearchEnabled,
				rawOutput: run.rawOutput,
				webQueries: run.webQueries,
			});
		});
	});

	// Deduplicate competitors by name (case-insensitive) and filter out brand
	const brandNameLower = (report.brandName || "").toLowerCase().trim();
	const isBrandName = (name: string) => (name || "").toLowerCase().trim() === brandNameLower;
	const seenCompetitorNames = new Set<string>();
	const filteredCompetitors = (data?.competitors || []).filter((c) => {
		const key = (c?.name || "").toLowerCase().trim();
		if (isBrandName(c.name) || seenCompetitorNames.has(key)) return false;
		seenCompetitorNames.add(key);
		return true;
	});

	// Core metrics
	const overallSoV = computeOverallSoV(simpleRuns, filteredCompetitors);
	const competitorSoVs = computeCompetitorSoVs(simpleRuns, filteredCompetitors);
	const promptSoVs = mockPrompts.map((p) => computePromptSoV(p.id, simpleRuns, filteredCompetitors));
	const promptMap = new Map(mockPrompts.map((p) => [p.id, p]));

	const selectedPrompts = selectRepresentativePrompts(promptSoVs, (id: string) => {
		const p = promptMap.get(id);
		return p ? isPromptBranded(p.value, report.brandName, report.brandWebsite) : false;
	});

	// Rich analysis
	const contentGaps = findContentGaps(fullRuns, 5);
	const allWebQueries = analyzeWebQueries(fullRuns, 1000);
	const competitorFreq = analyzeCompetitorFrequency(fullRuns, filteredCompetitors);
	const engineBreakdown = analyzeByEngine(fullRuns);

	// Enrich web queries with competitor mention data
	const queryCompetitorMap = new Map<string, { brandMentioned: boolean; competitorCount: number }>();
	for (const run of fullRuns) {
		for (const query of run.webQueries || []) {
			const normalized = (query || "").toLowerCase().trim();
			if (!normalized || normalized.length < 3) continue;
			const existing = queryCompetitorMap.get(normalized);
			const compCount = run.competitorsMentioned.length;
			if (!existing) {
				queryCompetitorMap.set(normalized, { brandMentioned: run.brandMentioned, competitorCount: compCount });
			} else {
				if (run.brandMentioned) existing.brandMentioned = true;
				existing.competitorCount = Math.max(existing.competitorCount, compCount);
			}
		}
	}
	// Mix of top-frequency + brand-mentioned queries
	const enrichedQueries = allWebQueries.map((q) => {
		const extra = queryCompetitorMap.get(q.query);
		return { ...q, brandMentioned: extra?.brandMentioned ?? false, competitorCount: extra?.competitorCount ?? 0 };
	});
	const topSearchQueries: typeof enrichedQueries = [];
	const usedQueries = new Set<string>();
	const byFrequency = [...enrichedQueries].sort((a, b) => b.count - a.count);
	const withBrand = enrichedQueries.filter((q) => q.brandMentioned).sort((a, b) => b.count - a.count);
	for (const q of byFrequency) {
		if (topSearchQueries.length >= 3) break;
		if (!usedQueries.has(q.query)) {
			topSearchQueries.push(q);
			usedQueries.add(q.query);
		}
	}
	for (const q of withBrand) {
		if (topSearchQueries.length >= 6) break;
		if (!usedQueries.has(q.query)) {
			topSearchQueries.push(q);
			usedQueries.add(q.query);
		}
	}
	for (const q of byFrequency) {
		if (topSearchQueries.length >= 6) break;
		if (!usedQueries.has(q.query)) {
			topSearchQueries.push(q);
			usedQueries.add(q.query);
		}
	}
	topSearchQueries.sort((a, b) => b.competitorCount - a.competitorCount);

	const sovSummary =
		overallSoV === null
			? t("reports.sovNoData")
			: overallSoV >= 40
				? t("reports.sovStrong")
				: overallSoV >= 20
					? t("reports.sovModerate")
					: t("reports.sovLow");
	const sovColor = getSoVColor(overallSoV);
	const totalPrompts = mockPrompts.length;
	const promptsWithMentions = promptSoVs.filter((p) => p.brandMentionCount > 0).length;
	const mentionRate = totalPrompts > 0 ? Math.round((promptsWithMentions / totalPrompts) * 100) : 0;

	// Charts: 2 per page
	const chartPairs: Array<typeof selectedPrompts> = [];
	for (let i = 0; i < selectedPrompts.length; i += 2) {
		chartPairs.push(selectedPrompts.slice(i, i + 2));
	}

	return (
		<div className="report-document max-w-[780px] mx-auto bg-white print:max-w-none text-slate-900">
			<style
				dangerouslySetInnerHTML={{
					__html: `
				.report-document { font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif; overflow-wrap: anywhere; line-height: 1.6; }
				@media print {
					@page { size: letter; margin: 0.5in 0.6in; }
					body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
					.report-document tr { break-inside: avoid; }
				}
			`,
				}}
			/>

			{/* ===== PAGE 1: COVER ===== */}
			<div className="print:min-h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<div className="h-[3px] bg-slate-800 -mx-10 print:-mx-0 mb-8" />

				<div className="flex items-center justify-between mb-16">
					<Logo iconClassName="!size-5" textClassName="text-sm font-semibold text-slate-400" />
					<span className="text-xs tracking-wide text-slate-400">
						{formatDateTime(report.createdAt, { year: "numeric", month: "long", day: "numeric" })}
					</span>
				</div>

				<div className="flex-1 flex flex-col justify-center">
					<div className="text-[10px] font-semibold tracking-[0.25em] uppercase text-slate-400 mb-4">
						{t("reports.aiShareOfVoiceReport")}
					</div>
					<h1 className="text-4xl font-bold tracking-tight mb-2">{report.brandName}</h1>
					<div className="w-16 h-[2px] bg-slate-800 mb-12" />

					<div className="bg-slate-50 rounded-xl p-8 max-w-md mb-12">
						<div className="flex items-baseline gap-4">
							<span
								className={`shrink-0 whitespace-nowrap ${overallSoV !== null ? "text-6xl" : "text-xl"} font-extrabold tracking-tighter ${sovColor}`}
							>
								{overallSoV !== null ? `${overallSoV}%` : t("reports.noDataAvailable")}
							</span>
							<div className="min-w-0">
								<div className="text-sm font-semibold">{t("reports.shareOfVoice")}</div>
								<div className="text-xs text-slate-500">{sovSummary}</div>
							</div>
						</div>
						<div className="mt-4 w-full bg-slate-200 rounded-full h-2">
							<div
								className={`h-2 rounded-full ${sovBgColor(overallSoV)}`}
								style={{ width: `${Math.max(2, overallSoV ?? 0)}%` }}
							/>
						</div>
					</div>

					<div className="grid grid-cols-3 gap-6 max-w-lg">
						<CoverStat value={String(totalPrompts)} label={t("reports.promptsTested")} />
						<CoverStat value={String(promptsWithMentions)} label={t("reports.brandMentions")} />
						<CoverStat value={String(filteredCompetitors.length)} label={t("reports.competitors")} />
					</div>
				</div>

				<PageFooter branding={branding} />
			</div>

			{/* ===== PAGE 2: COMPETITIVE OVERVIEW ===== */}
			<div className="print:break-before-page print:min-h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section
					title={t("reports.aiEnginePerformance")}
					subtitle={t("reports.engineEvaluations", { count: engineBreakdown.reduce((s, e) => s + e.totalRuns, 0) })}
				/>
				<div className="grid grid-cols-3 gap-3 mb-8">
					{engineBreakdown.map((eng) => (
						<div key={eng.engine} className="border border-slate-200 rounded-lg p-4">
							<div className="text-[11px] font-medium text-slate-500 mb-2">{eng.engine}</div>
							<div className={`text-3xl font-bold ${getSoVColor(eng.mentionRate)}`}>{eng.mentionRate}%</div>
							<div className="text-[10px] text-slate-400 mt-1">
								{t("reports.engineRuns", { mentioned: eng.brandMentions, total: eng.totalRuns })}
							</div>
							<div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5">
								<div
									className={`h-1.5 rounded-full ${sovBgColor(eng.mentionRate)}`}
									style={{ width: `${Math.max(2, eng.mentionRate)}%` }}
								/>
							</div>
						</div>
					))}
				</div>

				<Section
					title={t("reports.competitiveLandscape")}
					subtitle={t("reports.shareOfVoiceComparisonAcrossAllTestedPrompts")}
				/>
				<div className="border border-slate-200 rounded-lg overflow-hidden mb-8 print:pb-px">
					<table className="w-full">
						<thead>
							<tr className="bg-slate-50 border-b border-slate-200">
								<TH align="left">{t("reports.brand")}</TH>
								<TH align="right" className="w-16">
									{t("reports.sov")}
								</TH>
								<TH align="left" className="w-[40%]">
									{t("reports.share")}
								</TH>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{[
								{ name: report.brandName, sov: overallSoV ?? 0, isBrand: true },
								...competitorSoVs
									.filter((c) => !isBrandName(c.name))
									.slice(0, 3)
									.map((c) => ({ name: c.name, sov: c.sov, isBrand: false })),
							]
								.sort((a, b) => b.sov - a.sov)
								.map((row, i) => (
									<tr key={`sov-${i}`} className={row.isBrand ? "bg-blue-50/30" : ""}>
										<td className={`py-2.5 px-4 text-sm ${row.isBrand ? "font-semibold" : "text-slate-600"}`}>
											{row.name}
										</td>
										<td className="py-2.5 px-4 text-right">
											<span className={`text-sm font-bold ${row.isBrand ? sovColor : "text-slate-500"}`}>
												{row.sov}%
											</span>
										</td>
										<td className="py-2.5 px-4">
											<Bar value={row.sov} color={row.isBrand ? "bg-blue-500" : "bg-slate-300"} />
										</td>
									</tr>
								))}
						</tbody>
					</table>
				</div>

				{competitorFreq.length > 0 && (
					<>
						<Section
							title={t("reports.mentionRate")}
							subtitle={t("reports.eachPromptIsEvaluatedMultipleTimesAcrossAiEnginesMentionsShowTotal")}
						/>
						<div className="border border-slate-200 rounded-lg overflow-hidden print:pb-px">
							<table className="w-full">
								<thead>
									<tr className="bg-slate-50 border-b border-slate-200">
										<TH align="left">{t("reports.brand")}</TH>
										<TH align="center">{t("reports.mentions")}</TH>
										<TH align="center">{t("reports.uniquePrompts")}</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{[
										{
											name: report.brandName,
											mentionCount: simpleRuns.filter((r) => r.brandMentioned).length,
											promptCount: promptsWithMentions,
											isBrand: true,
										},
										...competitorFreq
											.filter((c) => !isBrandName(c.name))
											.slice(0, 3)
											.map((c) => ({ ...c, isBrand: false })),
									]
										.sort((a, b) => b.mentionCount - a.mentionCount)
										.map((c, i) => (
											<tr key={`mention-${i}`} className={c.isBrand ? "bg-blue-50/30" : ""}>
												<td
													className={`py-2 px-4 text-xs font-medium ${c.isBrand ? "text-slate-900" : "text-slate-700"}`}
												>
													{c.name}
												</td>
												<td className="py-2 px-4 text-center text-xs text-slate-600">
													{c.mentionCount}
													<span className="text-slate-400">/{simpleRuns.length}</span>
												</td>
												<td className="py-2 px-4 text-center text-xs text-slate-600">
													{c.promptCount}
													<span className="text-slate-400">/{totalPrompts}</span>
												</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</>
				)}

				<div className="mt-auto">
					<PageFooter branding={branding} />
				</div>
			</div>

			{/* ===== CHART PAGES ===== */}
			{chartPairs.map((pair, pageIdx) => (
				<div
					key={pageIdx}
					className="print:break-before-page print:min-h-[9.5in] print:flex print:flex-col p-10 print:p-0"
				>
					<RunningHeader brand={report.brandName} />

					{pageIdx === 0 ? (
						<Section
							title={t("reports.promptAnalysis")}
							subtitle={t("reports.shareOfVoiceForRepresentativePromptsStrengthsAndGrowthOpportunities")}
						/>
					) : (
						<div className="text-xs text-slate-400 italic mb-4">{t("reports.promptAnalysisContinued")}</div>
					)}

					<div className="flex-1 flex flex-col gap-5">
						{pair.map((selected) => {
							const prompt = promptMap.get(selected.promptId);
							if (!prompt) return null;
							return (
								<div key={selected.promptId} className="flex-1 flex flex-col">
									<PromptChartPrint
										lookback="1m"
										promptName={prompt.value}
										promptId={prompt.id}
										brand={mockBrand as any}
										competitors={mockCompetitors as any}
										promptRuns={chartRuns}
										category={selected.category}
									/>
								</div>
							);
						})}
					</div>

					<div className="mt-auto">
						<PageFooter branding={branding} />
					</div>
				</div>
			))}

			{/* ===== OPPORTUNITIES ===== */}
			<div className="print:break-before-page print:min-h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section
					title={t("reports.contentGaps")}
					subtitle={t("reports.contentGapsBrand", { brand: report.brandName })}
				/>

				{contentGaps.length > 0 ? (
					<div className="border border-slate-200 rounded-lg overflow-hidden mb-8">
						<table className="w-full">
							<thead>
								<tr className="bg-slate-50 border-b border-slate-200">
									<TH align="left">{t("reports.prompt")}</TH>
									<TH align="left" className="w-[50%]">
										{t("reports.competitorsFound")}
									</TH>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{contentGaps.map((gap) => (
									<tr key={gap.promptId}>
										<td className="py-2.5 px-4 text-xs text-slate-700 leading-relaxed max-w-[320px]">
											{gap.promptValue}
										</td>
										<td className="py-2.5 px-4">
											<div className="flex flex-wrap gap-1">
												{gap.competitorsMentioned.slice(0, 3).map((c) => (
													<span
														key={c}
														className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium"
													>
														{c}
													</span>
												))}
												{gap.competitorsMentioned.length > 3 && (
													<span className="text-[10px] text-slate-400">+{gap.competitorsMentioned.length - 3}</span>
												)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="border border-slate-200 rounded-lg p-6 text-center mb-8">
						<p className="text-slate-500 text-sm">{t("reports.brandAllPrompts", { brand: report.brandName })}</p>
					</div>
				)}

				{topSearchQueries.length > 0 && (
					<>
						<Section
							title={t("reports.topAiSearchQueries")}
							subtitle={t("reports.commonWebSearchQueriesAiModelsRunWhenAnsweringPromptsInYour")}
						/>
						<div className="border border-slate-200 rounded-lg overflow-hidden">
							<table className="w-full">
								<thead>
									<tr className="bg-slate-50 border-b border-slate-200">
										<TH align="left">{t("reports.query")}</TH>
										<TH align="center" className="w-28">
											{t("reports.competitorsFound")}
										</TH>
										<TH align="center" className="w-24">
											{t("reports.brandMentioned")}
										</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{topSearchQueries.map((q) => (
										<tr key={q.query}>
											<td className="py-2.5 px-4 text-xs text-slate-700 max-w-[350px] break-words">{q.query}</td>
											<td className="py-2.5 px-4 text-center text-xs text-slate-600">{q.competitorCount}</td>
											<td className="py-2.5 px-4 text-center">
												{q.brandMentioned ? (
													<span className="text-emerald-600 font-semibold text-xs">&#10003;</span>
												) : (
													<span className="text-slate-300 text-xs">&mdash;</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}

				<div className="mt-auto">
					<PageFooter branding={branding} />
				</div>
			</div>

			{/* ===== SoV OPPORTUNITY + WHAT TO DO NEXT ===== */}
			<div className="print:break-before-page print:min-h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section
					title={t("reports.shareOfVoiceOpportunity")}
					subtitle={t("reports.overviewOfYourCurrentAiShareOfVoiceAndGrowthPotential")}
				/>

				<div className="border border-slate-200 rounded-lg overflow-hidden mb-8">
					<table className="w-full">
						<thead>
							<tr className="bg-slate-50 border-b border-slate-200">
								<TH align="center">{t("reports.promptsWithMentions")}</TH>
								<TH align="center">{t("reports.totalPromptsTested")}</TH>
								<TH align="center">{t("reports.overallSov")}</TH>
								<TH align="center">{t("reports.opportunity")}</TH>
								<TH align="left">{t("reports.recommendation")}</TH>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td className="text-center py-3 px-4 text-sm font-semibold">{promptsWithMentions}</td>
								<td className="text-center py-3 px-4 text-sm text-slate-600">{totalPrompts}</td>
								<td className="text-center py-3 px-4">
									<span className={`text-sm font-bold ${sovColor}`}>{overallSoV ?? 0}%</span>
								</td>
								<td className="text-center py-3 px-4">
									<span
										className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${(overallSoV ?? 0) < 20 ? "bg-rose-50 text-rose-700" : (overallSoV ?? 0) < 40 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
									>
										{(overallSoV ?? 0) < 20
											? t("reports.high")
											: (overallSoV ?? 0) < 40
												? t("reports.medium")
												: t("reports.low")}
									</span>
								</td>
								<td className="py-3 px-4 text-xs text-slate-600">
									{(overallSoV ?? 0) < 20
										? t("reports.prioritizeContentCreationToEstablishAiPresence")
										: (overallSoV ?? 0) < 40
											? t("reports.expandContentToIncreaseBrandShareOfVoice")
											: t("reports.maintainLeadershipAndDefendCompetitivePosition")}
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<Section
					title={t("reports.whatShouldIDoNext")}
					subtitle={t("reports.competitorOutperformBrand", { brand: report.brandName })}
				/>

				{(() => {
					const opportunities = promptSoVs
						.filter((p) => p.totalCompetitorMentions > 0)
						.map((p) => {
							const prompt = promptMap.get(p.promptId);
							const brandSoV = p.sov ?? 0;
							// Find the single highest competitor's SoV for this prompt
							const topCompMentions = Math.max(...Object.values(p.competitorMentions), 0);
							const denom = p.brandMentionCount + p.totalCompetitorMentions;
							const maxCompSoV = denom > 0 ? Math.round((topCompMentions / denom) * 100) : 0;
							const gap = maxCompSoV - brandSoV;
							// Goal: match or slightly beat the top competitor
							const margin = gap > 30 ? 5 : gap > 15 ? 8 : 10;
							const goalSoV = Math.min(100, maxCompSoV + margin);
							// Article count scales with gap
							const articleCount = gap > 40 ? 8 : gap > 25 ? 6 : gap > 10 ? 5 : 4;
							return {
								promptValue: prompt?.value ?? p.promptId,
								brandSoV,
								maxCompSoV,
								gap,
								goalSoV,
								articleCount,
							};
						})
						.filter((o) => o.gap > 0)
						// Prefer prompts where brand has SOME presence (more actionable), then by gap
						.sort((a, b) => {
							if (a.brandSoV > 0 && b.brandSoV === 0) return -1;
							if (a.brandSoV === 0 && b.brandSoV > 0) return 1;
							return b.gap - a.gap;
						})
						.slice(0, 5);

					if (opportunities.length === 0) {
						return (
							<div className="border border-slate-200 rounded-lg p-6 text-center">
								<p className="text-slate-500 text-sm">{t("reports.brandLeads", { brand: report.brandName })}</p>
							</div>
						);
					}

					return (
						<div className="border border-slate-200 rounded-lg overflow-hidden">
							<table className="w-full">
								<thead>
									<tr className="bg-slate-50 border-b border-slate-200">
										<TH align="left">{t("reports.prompt")}</TH>
										<TH align="center">{t("reports.currentSov")}</TH>
										<TH align="center">{t("reports.topCompetitorSov")}</TH>
										<TH align="center">{t("reports.goalSov")}</TH>
										<TH align="left">{t("reports.recommendation")}</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{opportunities.map((o) => (
										<tr key={o.promptValue}>
											<td className="py-2.5 px-4 text-xs text-slate-700 max-w-[200px] break-words leading-relaxed">
												{o.promptValue}
											</td>
											<td className="py-2.5 px-4 text-center">
												<span className={`text-xs font-semibold ${getSoVColor(o.brandSoV)}`}>{o.brandSoV}%</span>
											</td>
											<td className="py-2.5 px-4 text-center text-xs font-semibold text-slate-600">{o.maxCompSoV}%</td>
											<td className="py-2.5 px-4 text-center text-xs font-semibold text-emerald-600">{o.goalSoV}%</td>
											<td className="py-2.5 px-4 text-xs text-slate-600">
												{t("reports.writeArticles", { count: o.articleCount, prompt: o.promptValue })}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				})()}

				<div className="mt-auto">
					<PageFooter branding={branding} />
				</div>
			</div>

			{/* ===== CTA ===== */}
			<div className="print:break-before-page print:min-h-[9.5in] print:flex print:flex-col print:justify-center p-10 print:p-0">
				<div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-10 text-center">
					<h2 className="text-2xl font-bold text-slate-800 mb-2">{t("reports.readyToOptimizeYourAiVisibility")}</h2>
					<p className="text-slate-600 text-base mb-8">
						{t("reports.brandPresenceCta", { app: branding?.name || "Getcito" })}
					</p>

					<div className="grid grid-cols-3 gap-6 mb-8">
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<Target className="h-8 w-8 text-slate-600" />
							</div>
							<h3 className="font-semibold text-slate-800 mb-2">{t("reports.strategicOptimization")}</h3>
							<p className="text-sm text-slate-600 leading-relaxed">
								{t("reports.developContentStrategiesThatIncreaseYourBrandSShareOfVoiceIn")}
							</p>
						</div>
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<BarChart3 className="h-8 w-8 text-slate-600" />
							</div>
							<h3 className="font-semibold text-slate-800 mb-2">{t("reports.continuousMonitoring")}</h3>
							<p className="text-sm text-slate-600 leading-relaxed">
								{t("reports.trackYourAiShareOfVoiceAcrossHundredsOfRelevantPromptsAnd")}
							</p>
						</div>
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<Rocket className="h-8 w-8 text-slate-600" />
							</div>
							<h3 className="font-semibold text-slate-800 mb-2">{t("reports.competitiveAdvantage")}</h3>
							<p className="text-sm text-slate-600 leading-relaxed">
								{t("reports.stayAheadOfCompetitorsInTheRapidlyEvolvingAiSearchLandscape")}
							</p>
						</div>
					</div>

					<div className="pt-6 border-t border-blue-200">
						<p className="text-slate-800 font-medium mb-2">
							{t("reports.getStartedApp", { app: branding?.name || "Getcito" })}
						</p>
						<p className="text-slate-600 text-sm text-balance">
							{t("reports.visit")}{" "}
							<a
								href={branding?.url || "https://getcito.chat"}
								target="_blank"
								rel="noopener noreferrer"
								className="font-bold text-blue-600 hover:underline hover:text-blue-700"
							>
								{branding?.url || "Getcito.chat"}
							</a>{" "}
							{t("reports.toLearnMoreAboutOurAiVisibilityPlatformAndServices")}
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------- Sub-components ----------

function RunningHeader({ brand }: { brand: string }) {
	return (
		<div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-100">
			<span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-slate-400">
				{t("reports.aiShareOfVoiceReport")}
			</span>
			<span className="text-[10px] font-medium text-slate-400">{brand}</span>
		</div>
	);
}

function Section({ title, subtitle }: { title: string; subtitle?: string }) {
	return (
		<div className="border-l-[3px] border-slate-800 pl-3 mb-4">
			<h2 className="text-base font-semibold">{title}</h2>
			{subtitle && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
		</div>
	);
}

function TH({
	children,
	align,
	className = "",
}: {
	children: React.ReactNode;
	align: "left" | "center" | "right";
	className?: string;
}) {
	const alignCls = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
	return (
		<th
			className={`py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${alignCls} ${className}`}
		>
			{children}
		</th>
	);
}

function CoverStat({ value, label }: { value: string; label: string }) {
	return (
		<div className="border-t-2 border-slate-800 pt-3">
			<div className="text-2xl font-bold">{value}</div>
			<div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
		</div>
	);
}

function Bar({ value, color }: { value: number | null; color: string }) {
	return (
		<div className="w-full bg-slate-100 rounded-full h-2.5">
			<div className={`${color} h-2.5 rounded-full`} style={{ width: `${Math.max(2, value ?? 0)}%` }} />
		</div>
	);
}

function Badge({ category }: { category: PromptCategory }) {
	const cls =
		category === "strength"
			? "bg-emerald-50 text-emerald-700 border-emerald-200"
			: "bg-amber-50 text-amber-700 border-amber-200";
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${cls}`}>
			{category === "strength" ? t("reports.strength") : t("reports.opportunity")}
		</span>
	);
}

function SummaryRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between items-center">
			<span className="text-xs text-slate-500">{label}</span>
			<span className="text-xs font-semibold">{value}</span>
		</div>
	);
}

function Finding({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex gap-3 items-start">
			<div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-[7px] shrink-0" />
			<p className="text-sm text-slate-700 leading-relaxed">{children}</p>
		</div>
	);
}

function PageFooter({ branding }: { branding?: ClientConfig["branding"] }) {
	return (
		<div className="pt-4 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400">
			<Logo iconClassName="!size-3" textClassName="text-[10px] font-medium text-slate-400" />
			<span>{branding?.url || "Getcito.chat"}</span>
		</div>
	);
}
