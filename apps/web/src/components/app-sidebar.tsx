import { t } from "@/i18n";
import {
	IconBuilding,
	IconBuildings,
	IconChartBar,
	IconCpu,
	IconDashboard,
	IconGauge,
	IconLink,
	IconListDetails,
	IconListNumbers,
	IconReport,
	IconSitemap,
	IconSpeakerphone,
	IconTable,
	IconTarget,
	IconTimeline,
	IconTool,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { BrandWithPrompts } from "@workspace/lib/db/schema";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@workspace/ui/components/sidebar";
import type * as React from "react";
import { DemoModePill } from "@/components/demo-mode-pill";
import { Logo } from "@/components/logo";
import { NavAppInfo } from "@/components/nav-app-info";
import { type NavGroup, NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	isAdmin?: boolean;
	hasReportAccess?: boolean;
	/** When true, only show admin section (no brand-specific nav) */
	adminOnly?: boolean;
	/** Brand data from route loader — avoids a separate client-side fetch */
	brand?: BrandWithPrompts | null;
}

export function AppSidebar({
	isAdmin = false,
	hasReportAccess = false,
	adminOnly = false,
	brand,
	...props
}: AppSidebarProps) {
	const { setOpenMobile } = useSidebar();

	const showAdminSection = isAdmin || hasReportAccess;

	const groups: NavGroup[] = [];

	// Dashboard section - only show if we have a brand context and not admin-only
	if (!adminOnly) {
		const dashboardItems = [
			{
				title: t("settings.overview"),
				url: "/",
				icon: IconDashboard,
			},
		];

		// Only show Visibility and Citations if the brand is onboarded
		if (brand?.onboarded) {
			dashboardItems.push(
				{
					title: t("settings.visibility"),
					url: "/visibility",
					icon: IconChartBar,
				},
				{
					title: t("settings.shareOfVoice"),
					url: "/share-of-voice",
					icon: IconSpeakerphone,
				},
				{
					title: t("settings.queryFanOut"),
					url: "/query-fan-out",
					icon: IconSitemap,
				},
				{
					title: t("settings.citations"),
					url: "/citations",
					icon: IconLink,
				},
				{
					title: t("settings.opportunities"),
					url: "/opportunities",
					icon: IconTarget,
				},
			);
		}

		groups.push({
			label: t("settings.dashboard"),
			items: dashboardItems,
		});

		// Settings section - always show so users can access brand settings or delete the brand
		groups.push({
			label: t("settings.settings"),
			items: [
				{
					title: t("settings.brand"),
					url: "/settings/brand",
					icon: IconBuilding,
				},
				{
					title: t("settings.competitors"),
					url: "/settings/competitors",
					icon: IconBuildings,
				},
				{
					title: t("settings.prompts"),
					url: "/settings/prompts",
					icon: IconListDetails,
				},
				{
					title: t("settings.llms"),
					url: "/settings/llms",
					icon: IconCpu,
				},
			],
		});
	}

	// Admin section
	if (showAdminSection) {
		const adminItems = isAdmin
			? [
					{
						title: t("settings.brands"),
						url: "/admin",
						icon: IconTable,
						absolute: true,
					},
					{
						title: t("settings.reports"),
						url: "/reports",
						icon: IconReport,
						absolute: true,
					},
					{
						title: t("settings.workflows"),
						url: "/admin/workflows",
						icon: IconTimeline,
						absolute: true,
					},
					{
						title: t("settings.queue"),
						url: "/admin/queue",
						icon: IconListNumbers,
						absolute: true,
					},
					{
						title: t("settings.apiUsage"),
						url: "/admin/usage",
						icon: IconGauge,
						absolute: true,
					},
					{
						title: t("settings.tools"),
						url: "/admin/tools",
						icon: IconTool,
						absolute: true,
					},
				]
			: [
					{
						title: t("settings.reports"),
						url: "/reports",
						icon: IconReport,
						absolute: true,
					},
				];

		groups.push({
			label: t("settings.admin"),
			items: adminItems,
		});
	}

	return (
		<Sidebar variant="inset" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<Link to="/app" onClick={() => setOpenMobile(false)}>
								<Logo iconClassName="!size-5" />
								<div className="ml-auto group-data-[collapsible=icon]:hidden">
									<DemoModePill />
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain groups={groups} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser />
				<NavAppInfo />
			</SidebarFooter>
		</Sidebar>
	);
}
