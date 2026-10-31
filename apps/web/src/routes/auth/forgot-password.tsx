import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { authClient } from "@workspace/lib/auth/client";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useState } from "react";
import FullPageCard from "@/components/full-page-card";
import { useHydrated } from "@/hooks/use-hydrated";

export const Route = createFileRoute("/auth/forgot-password")({
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const mode = context.clientConfig?.mode;

	if (mode === "whitelabel" || mode === "demo") {
		return (
			<FullPageCard title="パスワードの再発行">
				<p className="text-pretty text-sm text-muted-foreground">
					この環境ではパスワードを再発行できません。ログイン画面からお進みください。
				</p>
				<LoginLink />
			</FullPageCard>
		);
	}

	return <ForgotPasswordForm />;
}

function ForgotPasswordForm() {
	const hydrated = useHydrated();
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		setLoading(true);
		setError(null);

		try {
			const result = await authClient.requestPasswordReset({
				email: email.trim(),
				redirectTo: `${window.location.origin}/auth/reset-password`,
			});
			if (result.error) {
				setError("メールの送信を受け付けられませんでした。時間をおいて再度お試しください。");
				return;
			}
			setSent(true);
		} catch {
			setError("メールの送信を受け付けられませんでした。時間をおいて再度お試しください。");
		} finally {
			setLoading(false);
		}
	}

	return (
		<FullPageCard title="パスワードの再発行" subtitle="登録済みのメールアドレスを入力してください。">
			{sent ? (
				<div role="status" className="space-y-3 text-pretty text-sm">
					<p>登録がある場合は、パスワードを設定するためのメールを送信します。</p>
					<p className="text-muted-foreground">受信トレイと迷惑メールフォルダをご確認ください。</p>
				</div>
			) : (
				<form onSubmit={handleSubmit} className="w-full space-y-4">
					{error && (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					<div className="space-y-2">
						<Label htmlFor="email">メールアドレス</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							autoComplete="email"
							placeholder="you@example.com"
							disabled={!hydrated || loading}
							required
						/>
					</div>
					<Button className="w-full" type="submit" disabled={!hydrated || loading}>
						{loading ? "送信中…" : "再発行メールを送信"}
					</Button>
				</form>
			)}
			<LoginLink />
		</FullPageCard>
	);
}

function LoginLink() {
	return (
		<p className="pt-4 text-center text-sm">
			<Link to="/auth/login" className="font-medium text-primary hover:underline">
				ログインに戻る
			</Link>
		</p>
	);
}
