import { db } from "@workspace/lib/db/db";
import { prompts } from "@workspace/lib/db/schema";
import { translatePrompts } from "@workspace/lib/onboarding";
import { and, asc, eq } from "drizzle-orm";
import { type OnboardingLocaleInput, resolveOnboardingLocale } from "./onboarding-locale";

export async function translateBrandPrompts(
	input: OnboardingLocaleInput & {
		brandId: string;
		prompts?: { prompt: string; tags?: string[] }[];
	},
) {
	const locale = await resolveOnboardingLocale(input.brandId, input);
	const source =
		input.prompts ??
		(
			await db.query.prompts.findMany({
				where: and(eq(prompts.brandId, input.brandId), eq(prompts.enabled, true)),
				orderBy: asc(prompts.id),
				limit: 31,
			})
		).map((row) => ({ prompt: row.value, tags: row.tags }));
	return translatePrompts({ ...locale, prompts: source.map((row) => ({ prompt: row.prompt, tags: row.tags ?? [] })) });
}
