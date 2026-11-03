/**
 * /api/v1/brands/:brandId — single brand resource.
 *
 * GET     fetch one brand
 * PATCH   update brand-level fields (replace semantics on arrays)
 *
 * Protected by API key authentication.
 */

import { createFileRoute } from "@tanstack/react-router";
import { startMentionRecount, withMentionTransaction } from "@workspace/lib/brand-mention-recount";
import { db } from "@workspace/lib/db/db";
import * as schema from "@workspace/lib/db/schema";
import { brands } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { ApiError, createApiHandler } from "@/lib/api/handler";
import { enqueueMentionRecount } from "@/lib/mention-recount-client";
import {
	apiUpdateInputToInternal,
	BrandNotFoundError,
	buildBrandResult,
	InvalidDomainsError,
	updateBrand,
	updateBrandBodySchema,
} from "@/server/onboarding-core";

export const Route = createFileRoute("/api/v1/brands/$brandId")({
	server: {
		handlers: {
			// No params schema: brand IDs are caller-chosen strings (e.g. "acme"),
			// not UUIDs like the competitor/prompt/report routes validate.
			GET: createApiHandler({
				handle: async ({ params }) => {
					const { brandId } = params;
					const row = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
					if (!row) {
						throw new ApiError(404, "Not Found", `Brand "${brandId}" not found.`);
					}
					return buildBrandResult(row);
				},
			}),

			PATCH: createApiHandler({
				body: updateBrandBodySchema.refine(
					(body) => Object.keys(body).length > 0,
					"At least one of brandName, domains, aliases, or enabled must be provided",
				),
				mapError: (err) => {
					if (err instanceof InvalidDomainsError) {
						return new ApiError(400, "Validation Error", err.message);
					}
					if (err instanceof BrandNotFoundError) {
						return new ApiError(404, "Not Found", err.message);
					}
				},
				handle: async ({ params, body }) => {
					const internal = apiUpdateInputToInternal(params.brandId, body);
					const affectsMentions =
						body.brandName !== undefined || body.domains !== undefined || body.aliases !== undefined;
					if (!affectsMentions) return updateBrand(internal);
					return withMentionTransaction(params.brandId, async (client) => {
						const result = await updateBrand(internal, drizzle(client, { schema }));
						await startMentionRecount(client, params.brandId, enqueueMentionRecount);
						return result;
					});
				},
			}),
		},
	},
});
