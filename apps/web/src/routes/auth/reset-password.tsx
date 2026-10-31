import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { authClient } from "@workspace/lib/auth/client";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useState } from "react";
import { z } from "zod";
import FullPageCard from "@/components/full-page-card";
import { useHydrated } from "@/hooks/use-hydrated";

export const Route = createFileRoute("/auth/reset-password")({
	validateSearch: z.object({
		token: z.string().max(256).optional().catch(undefined),
		error: z.string().optional().catch(undefined),
	}),
	component: ResetPasswordPage,
});

function ResetPasswordPage() {
	const { token, error } = Route.useSearch();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const mode = context.clientConfig?.mode;

	if (mode === "whitelabel" || mode === "demo") {
		return (
			<FullPageCard title="パスワードの設定">
				<p className="text-pretty text-sm text-muted-foreground">この環境ではパスワードを変更できません。</p>
				<p className="pt-4 text-center text-sm">
					<Link to="/auth/login" className="font-medium text-primary hover:underline">
						ログインに戻る
					</Link>
				</p>
			</FullPageCard>
		);
	}

	if (!token || error) {
		return <InvalidResetLink />;
	}

	return <ResetPasswordForm token={token} />;
}

function ResetPasswordForm({ token }: { token: string }) {
	const hydrated = useHydrated();
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [loading, setLoading] = useState(false);
	const [done, setDone] = useState(false);
	const [invalidToken, setInvalidToken] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		if (password.length < 8 || password.length > 128) {
			setError("パスワードは8文字以上128文字以内で入力してください。");
			return;
		}
		if (password !== confirmation) {
			setError("確認用パスワードが一致しません。");
			return;
		}
		setLoading(true);
		try {
			const result = await authClient.resetPassword({ token, newPassword: password });
			if (result.error) {
				if (result.error.code === "INVALID_TOKEN") {
					setInvalidToken(true);
				} else {
					setError("パスワードを変更できませんでした。時間をおいて再度お試しください。");
				}
				return;
			}
			setPassword("");
			setConfirmation("");
			setDone(true);
		} catch {
			setError("パスワードを変更できませんでした。時間をおいて再度お試しください。");
		} finally {
			setLoading(false);
		}
	}

	if (invalidToken) return <InvalidResetLink />;

	if (done) {
		return (
			<FullPageCard title="パスワードを設定しました">
				<p role="status" className="text-pretty text-sm text-muted-foreground">
					新しいパスワードでログインしてください。
				</p>
				<Button className="mt-4 w-full" asChild>
					<Link to="/auth/login">ログインへ</Link>
				</Button>
			</FullPageCard>
		);
	}

	return (
		<FullPageCard title="新しいパスワードを設定" subtitle="8文字以上128文字以内で入力してください。">
			<form onSubmit={handleSubmit} className="w-full space-y-4">
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<div className="space-y-2">
					<Label htmlFor="new-password">新しいパスワード</Label>
					<Input
						id="new-password"
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						autoComplete="new-password"
						minLength={8}
						maxLength={128}
						disabled={!hydrated || loading}
						required
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="confirm-password">新しいパスワード（確認）</Label>
					<Input
						id="confirm-password"
						type="password"
						value={confirmation}
						onChange={(event) => setConfirmation(event.target.value)}
						autoComplete="new-password"
						minLength={8}
						maxLength={128}
						disabled={!hydrated || loading}
						required
					/>
				</div>
				<Button type="submit" className="w-full" disabled={!hydrated || loading}>
					{loading ? "設定中…" : "パスワードを設定"}
				</Button>
			</form>
		</FullPageCard>
	);
}

function InvalidResetLink() {
	return (
		<FullPageCard title="再発行リンクを確認してください">
			<Alert variant="destructive">
				<AlertDescription>
					リンクが無効か、有効期限が切れています。再発行メールをもう一度お取り寄せください。
				</AlertDescription>
			</Alert>
			<Button className="mt-4 w-full" asChild>
				<Link to="/auth/forgot-password">再発行メールを取り寄せる</Link>
			</Button>
		</FullPageCard>
	);
}
