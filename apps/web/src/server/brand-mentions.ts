import { createServerFn } from "@tanstack/react-start";
import {
	getMentionRecountStatus,
	registerMentionBrand,
	retryMentionRecount,
} from "@workspace/lib/brand-mention-recount";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess, requireOrgManageAccess } from "@/lib/auth/helpers";
import { getDeployment } from "@/lib/config/server";
import { enqueueMentionRecount } from "@/lib/mention-recount-client";

const brandScope = z.object({ brandId: z.string().min(1).max(200) });

export const registerMentionBrandFn = createServerFn({ method: "POST" })
	.validator(
		brandScope
			.extend({
				name: z.string().trim().min(1).max(200),
				domain: z.string().trim().max(500).optional(),
				aliases: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
				target: z.enum(["new", "own", "competitor"]),
				competitorId: z.string().uuid().optional(),
				sourceRunId: z.string().uuid().optional(),
			})
			.refine((data) => data.target !== "competitor" || !!data.competitorId, "競合ブランドを選んでください。"),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");
		return registerMentionBrand(data, enqueueMentionRecount);
	});

export const getMentionRecountStatusFn = createServerFn({ method: "GET" })
	.validator(brandScope)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return getMentionRecountStatus(data.brandId);
	});

export const retryMentionRecountFn = createServerFn({ method: "POST" })
	.validator(brandScope)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgManageAccess(session.user.id, data.brandId);
		if (getDeployment().features.readOnly) throw new Error("Read-only deployment");
		return retryMentionRecount(data.brandId, enqueueMentionRecount);
	});
