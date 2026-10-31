/**
 * Server functions for report operations.
 * Replaces apps/web/src/app/api/reports/route.ts
 */
import { onboardingLocaleSchemaFields } from "@/server/onboarding-locale-schema";

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, hasReportAccess } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import { reports, type NewReport } from "@workspace/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { sendReportJob } from "@/lib/job-scheduler";

async function requireReportAccess() {
	const session = await requireAuthSession();
	if (!hasReportAccess(session)) throw new Error("Access denied. Report generator access required.");
}

/**
 * Get all reports
 */
export const getReportsFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireReportAccess();

	return db
		.select({
			id: reports.id,
			brandName: reports.brandName,
			brandWebsite: reports.brandWebsite,
			status: reports.status,
			createdAt: reports.createdAt,
			completedAt: reports.completedAt,
			updatedAt: reports.updatedAt,
		})
		.from(reports)
		.orderBy(desc(reports.createdAt));
});

/**
 * Get a single report by ID (includes rawOutput for rendering)
 */
export const getReportByIdFn = createServerFn({ method: "GET" })
	.validator(z.object({ reportId: z.string() }))
	.handler(async ({ data }) => {
		await requireReportAccess();

		const result = await db.select().from(reports).where(eq(reports.id, data.reportId)).limit(1);
		if (result.length === 0) throw new Error("Report not found");
		const report = result[0];

		// Strip massive rawOutput from promptRuns before serialization to prevent V8 memory crash (HTTP 502)
		let parsedData: any = report.rawOutput;
		if (typeof parsedData === "string") {
			try { parsedData = JSON.parse(parsedData); } catch {}
		}
		
		if (parsedData && parsedData.promptRuns) {
			for (const pr of parsedData.promptRuns) {
				if (pr.runs) {
					for (const r of pr.runs) {
						delete r.rawOutput;
					}
				}
			}
		}

		return { ...report, rawOutput: parsedData };
	});

/**
 * Create a new report and queue generation job
 */
export const createReportFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			...onboardingLocaleSchemaFields,
			brandName: z.string().min(1),
			brandWebsite: z.string().url(),
			manualPrompts: z.string().optional(),
			manualCompetitors: z.string().optional(),
			brandId: z.string().optional(),
			useExistingData: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireReportAccess();

		// Parse manual prompts
		const parsedManualPrompts: string[] = [];
		if (data.manualPrompts?.trim()) {
			parsedManualPrompts.push(
				...data.manualPrompts
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0),
			);
		}

		// Parse manual competitors
		const parsedManualCompetitors: { name: string; domain: string }[] = [];
		if (data.manualCompetitors?.trim()) {
			const lines = data.manualCompetitors.split("\n").map(l => l.trim()).filter(l => l.length > 0);
			for (const line of lines) {
				const parts = line.split(",").map(p => p.trim());
				if (parts.length >= 2) {
					parsedManualCompetitors.push({ name: parts[0], domain: parts[1] });
				} else if (parts.length === 1 && parts[0].includes(".")) {
					// Fallback if they just typed "example.com"
					const domain = parts[0];
					const name = domain.split(".")[0];
					parsedManualCompetitors.push({ name, domain });
				}
			}
		}

		// Create report
		const newReport: NewReport = {
			brandName: data.brandName.trim(),
			brandWebsite: data.brandWebsite.trim(),
			status: "pending",
		};

		const result = await db.insert(reports).values(newReport).returning();
		const createdReport = result[0];
		if (!createdReport) throw new Error("Failed to create report");

		// Queue job
		try {
			const success = await sendReportJob(
				createdReport.id,
				createdReport.brandName,
				createdReport.brandWebsite,
				parsedManualPrompts.length > 0 ? parsedManualPrompts : undefined,
				data.brandId,
				data.useExistingData,
				parsedManualCompetitors.length > 0 ? parsedManualCompetitors : undefined,
				{ targetLanguage: data.targetLanguage, targetMarket: data.targetMarket },
			);
			if (!success) throw new Error("Failed to send report job");
		} catch (error) {
			await db
				.update(reports)
				.set({ status: "failed", updatedAt: new Date() })
				.where(eq(reports.id, createdReport.id));
			throw new Error("Failed to queue report generation");
		}

		return { ...createdReport, rawOutput: createdReport.rawOutput as {} | null };
	});

/**
 * Delete a report
 */
export const deleteReportFn = createServerFn({ method: "POST" })
	.validator(z.object({ reportId: z.string() }))
	.handler(async ({ data }) => {
		await requireReportAccess();
		await db.delete(reports).where(eq(reports.id, data.reportId));
		return { success: true };
	});
