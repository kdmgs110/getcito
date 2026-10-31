import { useHydrated } from "@/hooks/use-hydrated";
import { t } from "@/i18n";
import { authErrorMessage } from "@/i18n/settings-labels";
/**
 * /auth/login - Login page
 *
 * Local/cloud modes: email/password form.
 * Whitelabel mode: auto-redirects to Auth0 SSO (no form shown).
 */

import { IconInfoCircle } from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { authClient } from "@workspace/lib/auth/client";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useEffect, useState } from "react";
import { z } from "zod";
import FullPageCard from "@/components/full-page-card";

export const Route = createFileRoute("/auth/login")({
	validateSearch: z.object({
		returnTo: z.string().optional(),
	}),
	component: LoginPage,
});

/** Reject cross-origin returnTo values to prevent open redirects. */
function safeReturnTo(returnTo: string | undefined): string {
	if (!returnTo) return "/app";
	if (returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
	try {
		const url = new URL(returnTo, window.location.origin);
		if (url.origin !== window.location.origin) return "/app";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/app";
	}
}

function LoginPage() {
	const { returnTo } = Route.useSearch();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const mode = context.clientConfig?.mode;
	const canRegister = context.clientConfig?.canRegister ?? false;

	if (mode === "whitelabel") {
		return <SSOLogin returnTo={returnTo} />;
	}

	return <EmailPasswordLogin returnTo={returnTo} isDemo={mode === "demo"} canRegister={canRegister} />;
}

function SSOLogin({ returnTo }: { returnTo?: string }) {
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		authClient.signIn
			.sso({ providerId: "auth0-whitelabel", callbackURL: safeReturnTo(returnTo) })
			.then((result) => {
				if (cancelled) return;
				if (result.error) {
					setError(authErrorMessage(result.error, t("settings.failedToStartSignIn")));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setError(t("settings.somethingWentWrongPleaseTryAgain"));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [returnTo]);

	if (error) {
		return (
			<FullPageCard title={t("settings.signIn")}>
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
				<Button className="w-full" onClick={() => window.location.reload()}>
					{t("settings.tryAgain")}
				</Button>
			</FullPageCard>
		);
	}

	return <FullPageCard title={t("settings.signingIn")} subtitle={t("settings.redirectingToYourIdentityProvider")} />;
}

export function EmailPasswordLogin({
	returnTo,
	isDemo,
	canRegister,
}: {
	returnTo?: string;
	isDemo?: boolean;
	canRegister?: boolean;
}) {
	const navigate = useNavigate();
	const demoEmail = import.meta.env.VITE_DEMO_EMAIL || "team@Getcito.com";
	const demoPassword = import.meta.env.VITE_DEMO_PASSWORD || "getcito123";
	const [email, setEmail] = useState(isDemo ? demoEmail : "");
	const [password, setPassword] = useState(isDemo ? demoPassword : "");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const hydrated = useHydrated();

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);

		try {
			const result = await authClient.signIn.email({
				email,
				password,
			});

			if (result.error) {
				setError(authErrorMessage(result.error, t("settings.invalidEmailOrPassword")));
				setLoading(false);
				return;
			}

			navigate({ to: safeReturnTo(returnTo) });
		} catch {
			setError(t("settings.somethingWentWrongPleaseTryAgain"));
			setLoading(false);
		}
	}

	return (
		<FullPageCard
			title={t("settings.signIn")}
			subtitle={isDemo ? undefined : t("settings.enterYourEmailAndPasswordToContinue")}
		>
			<form onSubmit={handleSubmit} className="space-y-4 w-full">
				{isDemo && <DemoCredentialsCallout />}
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				{!isDemo && (
					<>
						<div className="space-y-2">
							<Label htmlFor="email">{t("settings.email")}</Label>
							<Input
								id="email"
								type="email"
								placeholder="you@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								disabled={!hydrated || loading}
								autoComplete="email"
								autoFocus
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">{t("settings.password")}</Label>
							<Input
								id="password"
								type="password"
								placeholder={t("settings.password")}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								disabled={!hydrated || loading}
								autoComplete="current-password"
							/>
						</div>
					</>
				)}
				<Button type="submit" className="w-full" disabled={loading || !hydrated}>
					{loading ? t("settings.signingIn") : t("settings.signIn")}
				</Button>
			</form>
			{!isDemo && (
				<p className="pt-4 text-center text-sm">
					<Link to="/auth/forgot-password" className="font-medium text-primary hover:underline">
						パスワードをお忘れの方
					</Link>
				</p>
			)}
			{canRegister && (
				<p className="text-center text-sm text-muted-foreground pt-4">
					{t("settings.donTHaveAnAccount")}{" "}
					<Link
						to="/auth/register"
						search={returnTo ? { returnTo } : {}}
						className="text-primary hover:underline font-medium"
					>
						{t("settings.createOne")}
					</Link>
				</p>
			)}
		</FullPageCard>
	);
}

function DemoCredentialsCallout() {
	const demoEmail = import.meta.env.VITE_DEMO_EMAIL || "team@getcito.com";
	const demoPassword = import.meta.env.VITE_DEMO_PASSWORD || "getcito123";
	return (
		<div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
			<IconInfoCircle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
			<div className="space-y-2">
				<p className="font-medium text-amber-900 dark:text-amber-100">{t("settings.demoAccount")}</p>
				<dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-900/90 dark:text-amber-100/80">
					<div className="flex items-center gap-1.5">
						<dt className="opacity-70">{t("settings.email")}</dt>
						<dd className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px]">{demoEmail}</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<dt className="opacity-70">{t("settings.password")}</dt>
						<dd className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px]">{demoPassword}</dd>
					</div>
				</dl>
			</div>
		</div>
	);
}
