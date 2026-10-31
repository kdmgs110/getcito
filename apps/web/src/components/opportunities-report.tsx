import { t } from "@/i18n";
/**
 * Renders the AI-generated Opportunities dashboard from getOpportunitiesFn.
 * Opportunities are grouped into Creation / Existing content / Outreach / Social;
 * each card leads with a plain-language "why", then three drill-downs — Prompts /
 * Your citations / Competitor citations — to explore the underlying data.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { CitedPage, OpportunitiesReport as OpportunitiesReportData, ReportPrompt } from "@/server/opportunities";

const CATEGORY_META = [
	{
		key: "creation",
		label: t("dashboard.creation"),
		desc: t("dashboard.netNewContentToPublishOrEarnComparisons"),
	},
	{
		key: "existing-content",
		label: t("dashboard.existingContent"),
		desc: t("dashboard.pagesAlreadyGettingCitedThatAreSlippingOr"),
	},
	{
		key: "outreach",
		label: t("dashboard.outreach"),
		desc: t("dashboard.earnPlacementsOnTheThirdPartyReviewSites"),
	},
	{
		key: "social",
		label: t("dashboard.social"),
		desc: t("dashboard.showUpInTheCommunityConversationsRedditYoutube"),
	},
] as const;

type Opportunity = OpportunitiesReportData["opportunities"][number];
type Tab = "prompts" | "your" | "comp";

function Bullet() {
	return <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />;
}

function BulletList({ items }: { items: string[] }) {
	return (
		<ul className="space-y-2.5">
			{items.map((item) => (
				<li key={item} className="flex gap-2.5 text-pretty text-base">
					<Bullet />
					<span>{item}</span>
				</li>
			))}
		</ul>
	);
}

const ROW = "block truncate rounded px-1.5 py-1 text-xs hover:bg-muted hover:text-foreground";

function PromptLink({ prompt, brandId }: { prompt: ReportPrompt; brandId: string }) {
	if (!prompt.promptId) return <span className={`${ROW} text-muted-foreground`}>{prompt.text}</span>;
	return (
		<Link to="/app/$brand/prompts/$promptId" params={{ brand: brandId, promptId: prompt.promptId }} className={ROW}>
			{prompt.text}
		</Link>
	);
}

function CiteLink({ page }: { page: CitedPage }) {
	return (
		<a href={page.url} target="_blank" rel="noopener noreferrer" className={ROW}>
			{page.title || page.domain} <span className="text-muted-foreground">· {page.domain}</span>
		</a>
	);
}

function Panel({ children }: { children: React.ReactNode }) {
	return <div className="mt-2 rounded-md bg-muted/30 p-1">{children}</div>;
}

function OpportunityCard({ o, brandId }: { o: Opportunity; brandId: string }) {
	const [open, setOpen] = useState<Tab | null>(null);
	const tabs: { key: Tab; label: string; count: number }[] = [
		{ key: "prompts", label: t("dashboard.prompts"), count: o.relatedPrompts.length },
		{ key: "your", label: t("dashboard.yourCitations"), count: o.yourCitations.length },
		{ key: "comp", label: t("dashboard.competitorCitations"), count: o.competitorCitations.length },
	];
	return (
		<div className="rounded-xl border border-border p-4">
			<h3 className="text-pretty text-base font-semibold">{o.title}</h3>
			<p className="mt-1 text-pretty text-sm text-muted-foreground">{o.why}</p>

			<div className="mt-3 border-t border-border/60 pt-3">
				<div className="flex flex-wrap gap-2">
					{tabs.map((t) => (
						<button
							key={t.key}
							type="button"
							onClick={() => setOpen(open === t.key ? null : t.key)}
							className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs ${open === t.key ? "bg-muted" : "hover:bg-muted/50"}`}
						>
							{t.label} <span className="tabular-nums text-muted-foreground">({t.count})</span>
							<span className={`text-[0.625rem] text-muted-foreground ${open === t.key ? "rotate-180" : ""}`}>▾</span>
						</button>
					))}
				</div>

				{open === "prompts" && (
					<Panel>
						{o.relatedPrompts.length === 0 ? (
							<p className="px-1.5 py-1 text-xs text-muted-foreground">{t("dashboard.noSpecificPromptsLinked")}</p>
						) : (
							o.relatedPrompts.map((p) => <PromptLink key={p.promptId || p.text} prompt={p} brandId={brandId} />)
						)}
					</Panel>
				)}
				{open === "your" && (
					<Panel>
						{o.yourCitations.length === 0 ? (
							<p className="px-1.5 py-1 text-xs text-muted-foreground">
								{t("dashboard.youReNotCitedForThesePromptsYet")}
							</p>
						) : (
							o.yourCitations.map((c) => <CiteLink key={c.url} page={c} />)
						)}
					</Panel>
				)}
				{open === "comp" && (
					<Panel>
						{o.competitorCitations.length === 0 ? (
							<p className="px-1.5 py-1 text-xs text-muted-foreground">
								{t("dashboard.noCompetitorPagesCitedForThesePrompts")}
							</p>
						) : (
							o.competitorCitations.map((c) => <CiteLink key={c.url} page={c} />)
						)}
					</Panel>
				)}
			</div>
		</div>
	);
}

export function OpportunitiesReport({ report, brandId }: { report: OpportunitiesReportData; brandId: string }) {
	return (
		<div className="space-y-8" lang={report.generationContext?.languageCode}>
			{report.summary.length > 0 && (
				<section className="rounded-xl border border-border bg-muted/30 p-5">
					<h2 className="text-sm font-semibold text-muted-foreground">{t("dashboard.summary")}</h2>
					<div className="mt-2.5">
						<BulletList items={report.summary} />
					</div>
				</section>
			)}

			{CATEGORY_META.map((c) => {
				const opps = report.opportunities.filter((o) => o.category === c.key);
				if (opps.length === 0) return null;
				return (
					<section key={c.key} className="space-y-3">
						<div className="space-y-0.5">
							<h2 className="text-base font-semibold">
								{c.label} <span className="font-normal text-muted-foreground">({opps.length})</span>
							</h2>
							<p className="text-pretty text-sm text-muted-foreground">{c.desc}</p>
						</div>
						<div className="space-y-3">
							{opps.map((o) => (
								<OpportunityCard key={`${o.category}-${o.title}`} o={o} brandId={brandId} />
							))}
						</div>
					</section>
				);
			})}

			{report.risks.length > 0 && (
				<section className="space-y-3">
					<h2 className="text-base font-semibold">{t("dashboard.realityCheck")}</h2>
					<BulletList items={report.risks} />
				</section>
			)}

			<p className="text-xs text-muted-foreground">{t("dashboard.generatedByAiFromYourTrackedCitationData")}</p>
		</div>
	);
}
