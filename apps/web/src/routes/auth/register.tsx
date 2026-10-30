import { useHydrated } from "@/hooks/use-hydrated";
import { authErrorMessage } from "@/i18n/settings-labels";
import { t } from "@/i18n";
/**
 * /auth/register - Account registration page
 *
 * Available in local/demo modes for self-service signup.
 * No email verification required.
 */

import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { authClient } from "@workspace/lib/auth/client";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useState } from "react";
import { z } from "zod";
import FullPageCard from "@/components/full-page-card";

export const Route = createFileRoute("/auth/register")({
	validateSearch: z.object({
		returnTo: z.string().optional(),
	}),
	component: RegisterPage,
});

function RegisterPage() {
	const { returnTo } = Route.useSearch();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const canRegister = context.clientConfig?.canRegister ?? false;
	const hasUsers = context.clientConfig?.hasUsers ?? false;
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const hydrated = useHydrated();

	if (!canRegister) {
		window.location.href = "/auth/login";
		return null;
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);

		try {
			const result = await authClient.signUp.email({
				email,
				password,
				name,
			});

			if (result.error) {
				setError(authErrorMessage(result.error, t("settings.registrationFailed")));
				setLoading(false);
				return;
			}

			navigate({ to: returnTo ?? "/app" });
		} catch {
			setError(t("settings.somethingWentWrongPleaseTryAgain"));
			setLoading(false);
		}
	}

	return (
		<FullPageCard title={t("settings.createAccount")} subtitle={t("settings.signUpToGetStarted")}>
			<form onSubmit={handleSubmit} className="space-y-4 w-full">
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<div className="space-y-2">
					<Label htmlFor="name">{t("settings.name")}</Label>
					<Input
						id="name"
						type="text"
						placeholder={t("settings.yourName")}
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						disabled={!hydrated || loading}
						autoComplete="name"
						autoFocus
					/>
				</div>
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
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="password">{t("settings.password")}</Label>
					<Input
						id="password"
						type="password"
						placeholder={t("settings.createAPassword")}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						disabled={!hydrated || loading}
						autoComplete="new-password"
						minLength={6}
					/>
				</div>
				<Button type="submit" className="w-full" disabled={loading || !hydrated}>
					{loading ? t("settings.creatingAccount") : t("settings.createAccount")}
				</Button>
			</form>
			{hasUsers && (
				<p className="text-center text-sm text-muted-foreground pt-4">
					{t("settings.alreadyHaveAnAccount")}{" "}
					<Link
						to="/auth/login"
						search={returnTo ? { returnTo } : {}}
						className="text-primary hover:underline font-medium"
					>
						{t("settings.signIn")}
					</Link>
				</p>
			)}
		</FullPageCard>
	);
}
