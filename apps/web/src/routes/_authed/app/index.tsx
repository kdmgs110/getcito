import { t } from "@/i18n";
import { displayMarket } from "@/i18n/settings-labels";

/**
 * /app - Brand switcher page
 *
 * Local and whitelabel deployments show accessible brands. Read-only demo
 * deployments retain the single-brand redirect.
 */

import { IconArrowRight, IconBuilding, IconPlus } from "@tabler/icons-react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { syncAuth0UserById } from "@workspace/whitelabel/auth-hooks";
import { inArray } from "drizzle-orm";
import { useState } from "react";
import FullPageCard from "@/components/full-page-card";
import { bt } from "@/i18n/brand-labels";
import { listUserOrganizations, requireAuthSession } from "@/lib/auth/helpers";
import { brandDomain } from "@/lib/brand-navigation";
import { getDeployment } from "@/lib/config/server";

const getOrganizations = createServerFn({ method: "GET" }).handler(
	async (): Promise<{
		organizations: {
			id: string;
			name: string;
			website?: string | null;
			targetMarket?: string | null;
			author?: string | null;
		}[];
		supportsMultiOrg: boolean;
		canCreateBrands: boolean;
	}> => {
		const session = await requireAuthSession();
		const deployment = getDeployment();

		if (deployment.mode === "whitelabel") {
			// Keep /app usable during Auth0 Management API incidents; background sync will reconcile memberships later.
			try {
				await syncAuth0UserById(session.user.id);
			} catch (error) {
				console.error("[auth0-sync] Failed to sync user on /app load; continuing with cached memberships", error);
			}
		}

		const organizations = await listUserOrganizations(session.user.id);
		const websites = organizations.length
			? await db
					.select({ id: brands.id, website: brands.website })
					.from(brands)
					.where(
						inArray(
							brands.id,
							organizations.map((org) => org.id),
						),
					)
			: [];
		const websiteById = new Map(websites.map((row) => [row.id, row.website]));
		return {
			organizations: organizations.map((org) => ({ ...org, website: websiteById.get(org.id) })),
			supportsMultiOrg: deployment.features.supportsMultiOrg,
			canCreateBrands: deployment.features.canCreateBrands,
		};
	},
);

function OrgSwitcherSkeleton() {
	return (
		<FullPageCard title="" subtitle="">
			<div className="flex flex-col space-y-3 min-w-[200px]">
				<Skeleton className="h-14 w-full" />
				<Skeleton className="h-14 w-full" />
				<Skeleton className="h-14 w-full" />
			</div>
		</FullPageCard>
	);
}

export const Route = createFileRoute("/_authed/app/")({
	pendingComponent: OrgSwitcherSkeleton,
	errorComponent: BrandListError,
	loader: async () => {
		const result = await getOrganizations();

		// Single-org mode: redirect to the user's one org (created on signup).
		if (!result.supportsMultiOrg && result.organizations.length > 0) {
			throw redirect({ to: "/app/$brand", params: { brand: result.organizations[0].id } });
		}

		return result;
	},
	component: BrandSwitcherPage,
});

function BrandListError() {
	const router = useRouter();
	return (
		<FullPageCard title={bt("list")}>
			<div role="alert" className="space-y-4 text-center">
				<p>{bt("error")}</p>
				<Button
					onClick={() => {
						void router.invalidate();
					}}
				>
					{bt("retry")}
				</Button>
			</div>
		</FullPageCard>
	);
}

function BrandSwitcherPage() {
	const { organizations, canCreateBrands } = Route.useLoaderData();
	const [query, setQuery] = useState("");
	const filtered = organizations.filter((org) =>
		`${org.name} ${org.website || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
	);

	return (
		<FullPageCard title={bt("list")} subtitle={bt("listDescription")} className="w-full max-w-2xl">
			<div className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row">
					<Input
						aria-label={bt("search")}
						placeholder={bt("search")}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						className="flex-1"
					/>
					{canCreateBrands && (
						<Button asChild>
							<Link to="/app/new">
								<IconPlus className="size-4" />
								{bt("add")}
							</Link>
						</Button>
					)}
				</div>
				<div className="max-h-[60dvh] space-y-2 overflow-y-auto">
					{filtered.length > 0 ? (
						filtered.map((org) => (
							<Button key={org.id} asChild variant="outline" className="h-auto min-h-20 w-full justify-start py-3">
								<Link to="/app/$brand" params={{ brand: org.id }} className="flex items-center gap-3 text-left">
									<IconBuilding className="size-5 shrink-0 text-muted-foreground" />
									<div className="min-w-0 flex-1 space-y-1">
										<div className="truncate text-base font-semibold">{org.name}</div>
										{org.website && (
											<div className="truncate text-xs text-muted-foreground">{brandDomain(org.website)}</div>
										)}
										{(org.targetMarket || org.author) && (
											<span className="text-xs text-muted-foreground font-normal">
												{[
													org.targetMarket && t("settings.marketLabel", { market: displayMarket(org.targetMarket) }),
													org.author && t("settings.authorLabel", { author: org.author }),
												]
													.filter(Boolean)
													.join(" • ")}
											</span>
										)}
									</div>
									<IconArrowRight className="size-4 shrink-0 text-muted-foreground" />
								</Link>
							</Button>
						))
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">
							{query ? bt("noResults") : t("settings.noBrandsAvailable")}
						</p>
					)}
				</div>
			</div>
		</FullPageCard>
	);
}
