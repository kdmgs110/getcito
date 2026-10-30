import { t } from "@/i18n";

import { useLocation } from "@tanstack/react-router";

import { Separator } from "@workspace/ui/components/separator";
import { SidebarTrigger } from "@workspace/ui/components/sidebar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { useBrand } from "@/hooks/use-brands";
import { Link } from "@tanstack/react-router";

/** Map of page segments to display names */
const PAGE_NAMES: Record<string, string> = {
	visibility: t("settings.visibility"),
	"share-of-voice": t("settings.shareOfVoice"),
	"query-fan-out": t("settings.queryFanOut"),
	opportunities: t("settings.opportunities"),
	prompts: t("settings.prompts"),
	citations: t("settings.citations"),
	brand: t("settings.brand"),
	competitors: t("settings.competitors"),
	llms: t("settings.llms"),
	workflows: t("settings.workflows"),
	tools: t("settings.tools"),
	queue: t("settings.queue"),
	usage: t("settings.apiUsage"),
	settings: t("settings.settings"),
};

function getPageDisplayName(segment: string): string {
	return PAGE_NAMES[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
}

function AdminBreadcrumbs({ pathname }: { pathname: string }) {
	const segments = pathname.split("/").filter(Boolean);
	// /admin -> ["admin"]
	// /admin/workflows -> ["admin", "workflows"]
	// /admin/tools -> ["admin", "tools"]
	// /reports -> ["reports"]

	if (segments[0] === "reports") {
		// /reports/render/[id] - keep existing behavior
		if (segments.length > 1) {
			return (
				<>
					<BreadcrumbItem className="hidden md:block">
						<BreadcrumbLink asChild>
							<Link to="/reports">{t("settings.reports")}</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator className="hidden md:block" />
					<BreadcrumbItem>
						<BreadcrumbPage>{t("settings.viewReport")}</BreadcrumbPage>
					</BreadcrumbItem>
				</>
			);
		}
		// /reports
		return (
			<>
				<BreadcrumbItem className="hidden md:block">
					<span className="text-muted-foreground">{t("settings.admin")}</span>
				</BreadcrumbItem>
				<BreadcrumbSeparator className="hidden md:block" />
				<BreadcrumbItem>
					<BreadcrumbPage>{t("settings.reports")}</BreadcrumbPage>
				</BreadcrumbItem>
			</>
		);
	}

	// /admin - show Admin > Brands
	if (segments.length === 1) {
		return (
			<>
				<BreadcrumbItem className="hidden md:block">
					<span className="text-muted-foreground">{t("settings.admin")}</span>
				</BreadcrumbItem>
				<BreadcrumbSeparator className="hidden md:block" />
				<BreadcrumbItem>
					<BreadcrumbPage>{t("settings.brands")}</BreadcrumbPage>
				</BreadcrumbItem>
			</>
		);
	}

	// /admin/workflows, /admin/tools, etc.
	const subPage = segments[1];
	return (
		<>
			<BreadcrumbItem className="hidden md:block">
				<span className="text-muted-foreground">{t("settings.admin")}</span>
			</BreadcrumbItem>
			<BreadcrumbSeparator className="hidden md:block" />
			<BreadcrumbItem>
				<BreadcrumbPage>{getPageDisplayName(subPage)}</BreadcrumbPage>
			</BreadcrumbItem>
		</>
	);
}

function BrandBreadcrumbs({
	pathname,
	brandId,
	brandName,
}: {
	pathname: string;
	brandId: string | undefined;
	brandName: string;
}) {
	// Extract the page segment from the path (e.g., /app/foo/prompts -> prompts)
	const pathSegments = pathname.split("/");
	const brandIndex = pathSegments.indexOf("app");
	const pageSegment = brandIndex >= 0 && pathSegments[brandIndex + 2] ? pathSegments[brandIndex + 2] : "";
	const subSegment = brandIndex >= 0 && pathSegments[brandIndex + 3] ? pathSegments[brandIndex + 3] : "";

	// Check if we're on a specific prompt detail page (e.g., /app/foo/prompts/uuid)
	const isPromptDetailPage =
		pageSegment === "prompts" &&
		subSegment &&
		subSegment !== "edit" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subSegment);

	// Check if we're on an edit page
	const isEditPage = pathname.endsWith("/edit");

	// Settings sub-pages: /app/brandId/settings/brand, /app/brandId/settings/competitors, etc.
	const isSettingsSubPage = pageSegment === "settings" && subSegment;

	// Determine page name
	const pageName = pageSegment ? getPageDisplayName(pageSegment) : t("settings.overview");

	return (
		<>
			<BreadcrumbItem className="hidden md:block">
				<BreadcrumbLink asChild>
					{brandId ? (
						<Link to="/app/$brand" params={{ brand: brandId }}>
							{brandName}
						</Link>
					) : (
						<span>{brandName}</span>
					)}
				</BreadcrumbLink>
			</BreadcrumbItem>
			<BreadcrumbSeparator className="hidden md:block" />
			{isPromptDetailPage ? (
				<>
					<BreadcrumbItem className="hidden md:block">
						<BreadcrumbLink asChild>
							{brandId ? (
								<Link to="/app/$brand/visibility" params={{ brand: brandId }}>
									{t("settings.visibility")}
								</Link>
							) : (
								<span>{t("settings.visibility")}</span>
							)}
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator className="hidden md:block" />
					<BreadcrumbItem>
						<BreadcrumbPage>{t("settings.promptHistory")}</BreadcrumbPage>
					</BreadcrumbItem>
				</>
			) : isSettingsSubPage ? (
				<>
					<BreadcrumbItem className="hidden md:block">
						<span className="text-muted-foreground">{t("settings.settings")}</span>
					</BreadcrumbItem>
					<BreadcrumbSeparator className="hidden md:block" />
					<BreadcrumbItem>
						<BreadcrumbPage>{getPageDisplayName(subSegment)}</BreadcrumbPage>
					</BreadcrumbItem>
				</>
			) : isEditPage ? (
				<>
					<BreadcrumbItem className="hidden md:block">
						<BreadcrumbLink asChild>
							<Link to={pathname.slice(0, -5)}>{pageName}</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator className="hidden md:block" />
					<BreadcrumbItem>
						<BreadcrumbPage>{t("settings.edit")}</BreadcrumbPage>
					</BreadcrumbItem>
				</>
			) : (
				<BreadcrumbItem>
					<BreadcrumbPage>{pageName}</BreadcrumbPage>
				</BreadcrumbItem>
			)}
		</>
	);
}

export function SiteHeader() {
	const { brandId, brand } = useBrand();
	const { pathname } = useLocation();

	const isAdminPage = pathname.startsWith("/admin") || pathname.startsWith("/reports");

	return (
		<header className="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
			<div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
				<SidebarTrigger className="-ml-1 cursor-pointer" />
				<Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
				<Breadcrumb>
					<BreadcrumbList>
						{isAdminPage ? (
							<AdminBreadcrumbs pathname={pathname} />
						) : (
							<BrandBreadcrumbs
								pathname={pathname}
								brandId={brandId}
								brandName={brand?.name || t("settings.dashboard")}
							/>
						)}
					</BreadcrumbList>
				</Breadcrumb>
			</div>
		</header>
	);
}
