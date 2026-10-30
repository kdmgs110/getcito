import { IconBuilding, IconCheck, IconChevronDown, IconPlus } from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import type { BrandWithPrompts } from "@workspace/lib/db/schema";
import { Button } from "@workspace/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@workspace/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@workspace/ui/components/sheet";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@workspace/ui/components/sidebar";
import { useState } from "react";
import { useBrands } from "@/hooks/use-brands";
import { bt } from "@/i18n/brand-labels";
import { brandDomain, getBrandSection, makeBrandDestination } from "@/lib/brand-navigation";

type PickerBrand = { id: string; name: string; website: string | null; onboarded: boolean };

function BrandPicker({
	brands,
	currentId,
	loading,
	error,
	retry,
	choose,
	add,
	close,
	canCreate,
}: {
	brands: PickerBrand[];
	currentId: string;
	loading: boolean;
	error: boolean;
	retry: () => void;
	choose: (brand: PickerBrand) => void;
	add: () => void;
	close: () => void;
	canCreate: boolean;
}) {
	return (
		<>
			<Command>
				<CommandInput placeholder={bt("search")} aria-label={bt("search")} />
				<CommandList className="max-h-[min(50dvh,360px)]">
					{loading ? (
						<p role="status" className="p-4 text-sm text-muted-foreground">
							{bt("loading")}
						</p>
					) : error ? (
						<div role="alert" className="space-y-2 p-4 text-sm">
							<p>{bt("error")}</p>
							<Button variant="outline" size="sm" onClick={retry}>
								{bt("retry")}
							</Button>
						</div>
					) : (
						<>
							<CommandEmpty>{bt("noResults")}</CommandEmpty>
							<CommandGroup>
								{brands.map((item) => (
									<CommandItem
										key={item.id}
										value={`${item.id} ${item.name} ${item.website || ""}`}
										onSelect={() => choose(item)}
										className="min-h-14 cursor-pointer gap-3 px-3 py-2"
									>
										<IconBuilding className="size-4 shrink-0 text-muted-foreground" />
										<div className="min-w-0 flex-1">
											<div className="truncate font-medium">{item.name}</div>
											<div className="truncate text-xs text-muted-foreground">{brandDomain(item.website)}</div>
										</div>
										{item.id === currentId && (
											<>
												<IconCheck className="size-4 shrink-0 text-emerald-600" />
												<span className="sr-only">{bt("current")}</span>
											</>
										)}
									</CommandItem>
								))}
							</CommandGroup>
						</>
					)}
				</CommandList>
			</Command>
			<div className="space-y-1 border-t p-2">
				{canCreate && (
					<Button variant="ghost" className="min-h-10 w-full justify-start" onClick={add}>
						<IconPlus className="size-4" />
						{bt("add")}
					</Button>
				)}
				<Button asChild variant="ghost" className="min-h-10 w-full justify-start">
					<Link to="/app" onClick={close}>
						{bt("all")}
					</Link>
				</Button>
			</div>
		</>
	);
}

export function BrandSwitcher({ brand }: { brand: BrandWithPrompts }) {
	const [open, setOpen] = useState(false);
	const { isMobile, setOpenMobile } = useSidebar();
	const { brands, isLoading, isError, revalidate } = useBrands();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const location = useLocation();
	const navigate = useNavigate();
	if (!context.clientConfig?.features.supportsMultiOrg) return null;
	const section = getBrandSection(location.pathname, brand.id);
	const close = () => {
		setOpen(false);
		setOpenMobile(false);
	};
	const trigger = (
		<SidebarMenuButton
			size="lg"
			className="h-auto min-h-14 border border-sidebar-border bg-background/60"
			aria-label={`${bt("choose")}: ${brand.name}`}
		>
			<IconBuilding className="size-4 shrink-0" />
			<div className="grid min-w-0 flex-1 text-left leading-tight">
				<span className="truncate text-sm font-medium">{brand.name}</span>
				<span className="truncate text-xs text-muted-foreground">{brandDomain(brand.website)}</span>
			</div>
			<IconChevronDown className="ml-auto size-4 shrink-0" />
		</SidebarMenuButton>
	);
	const picker = (
		<BrandPicker
			brands={brands || []}
			currentId={brand.id}
			loading={isLoading}
			error={!!isError}
			retry={() => {
				void revalidate();
			}}
			choose={(item) => {
				close();
				if (item.id !== brand.id)
					void navigate(makeBrandDestination(item.id, section, location.search, item.onboarded));
			}}
			add={() => {
				close();
				void navigate({ to: "/app/new", search: { returnBrand: brand.id, returnSection: section } });
			}}
			close={close}
			canCreate={!!context.clientConfig?.features.canCreateBrands}
		/>
	);
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				{isMobile ? (
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetTrigger asChild>{trigger}</SheetTrigger>
						<SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]">
							<SheetHeader>
								<SheetTitle>{bt("choose")}</SheetTitle>
								<SheetDescription>{bt("listDescription")}</SheetDescription>
							</SheetHeader>
							{picker}
						</SheetContent>
					</Sheet>
				) : (
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverTrigger asChild>{trigger}</PopoverTrigger>
						<PopoverContent
							align="start"
							side="bottom"
							className="w-80 max-w-[calc(100vw-2rem)] p-0"
							aria-label={bt("choose")}
						>
							{picker}
						</PopoverContent>
					</Popover>
				)}
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
