import { t } from "@/i18n";
import { IconBrandGithub, IconWorld } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";

export function NavAppInfo() {
	const linkClass =
		"text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors";

	return (
		<div className="mx-2 mt-1 flex items-center gap-2 border-t border-sidebar-border/60 px-1 pt-2">
			<a
				href={`https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/releases/tag/v${__APP_VERSION__}`}
				target="_blank"
				rel="noreferrer"
				className="flex-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
			>
				v{__APP_VERSION__}
			</a>
			<div className="flex items-center gap-1">
				<Tooltip>
					<TooltipTrigger asChild>
						<a href="https://www.Getcito.com/" target="_blank" className={linkClass} rel="noopener">
							<IconWorld className="size-4" />
						</a>
					</TooltipTrigger>
					<TooltipContent>Getcito.com</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<a
							href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool"
							target="_blank"
							rel="noreferrer"
							className={linkClass}
						>
							<IconBrandGithub className="size-4" />
						</a>
					</TooltipTrigger>
					<TooltipContent>{t("settings.viewOnGithub")}</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
