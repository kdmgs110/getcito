import type { BetterAuthOptions } from "better-auth";
import { z } from "zod";

type EmailOptions = NonNullable<BetterAuthOptions["emailAndPassword"]>;

/** Mail credentials and reset links stay on the server; never log provider response bodies. */
export function passwordResetEmailOptions(env: Record<string, string | undefined>): Partial<EmailOptions> {
	if (env.DEPLOYMENT_MODE === "demo" || env.DEPLOYMENT_MODE === "whitelabel") return {};
	const apiKey = env.BREVO_API_KEY?.trim();
	const from = env.AUTH_EMAIL_FROM?.trim();
	const appUrl = env.APP_URL || env.VITE_APP_URL;
	if (!apiKey || !from || !appUrl) return {};
	if (!z.email().safeParse(from).success) throw new Error("AUTH_EMAIL_FROM must be an email address");
	const origin = new URL(appUrl).origin;
	if (new URL(appUrl).protocol !== "https:" && !["localhost", "127.0.0.1"].includes(new URL(appUrl).hostname)) {
		throw new Error("Password reset emails require HTTPS outside localhost");
	}

	return {
		resetPasswordTokenExpiresIn: 3600,
		revokeSessionsOnPasswordReset: true,
		sendResetPassword: async ({ user, url }) => {
			const link = new URL(url);
			if (link.origin !== origin || !link.pathname.startsWith("/api/auth/reset-password/")) {
				throw new Error("Invalid password reset URL");
			}
			const escapedLink = link.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
			let response: Response;
			try {
				response = await fetch("https://api.brevo.com/v3/smtp/email", {
					method: "POST",
					headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
					signal: AbortSignal.timeout(10000),
					body: JSON.stringify({
						sender: { email: from, name: env.AUTH_EMAIL_FROM_NAME || "GetCito" },
						to: [{ email: user.email }],
						subject: "【GetCito】パスワードの再設定",
						textContent: `GetCitoのパスワード再設定を受け付けました。\n\n次のリンクから新しいパスワードを設定してください（有効期限：1時間、1回のみ使用可能）。\n${link.href}\n\nログインID：${user.email}\n\nお心当たりがない場合は、このメールを無視してください。パスワードは変更されません。`,
						htmlContent: `<p>GetCitoのパスワード再設定を受け付けました。</p><p><a href="${escapedLink}">新しいパスワードを設定する</a></p><p>有効期限は1時間です。リンクは1回のみ使用できます。</p><p>お心当たりがない場合は、このメールを無視してください。パスワードは変更されません。</p>`,
						tags: ["getcito-password-reset"],
					}),
				});
			} catch {
				throw new Error("Password reset email delivery failed");
			}
			if (!response.ok) throw new Error(`Password reset email delivery failed (${response.status})`);
		},
	};
}
