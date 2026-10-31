import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { passwordResetEmailOptions } from "./password-reset-email";

// Exercise Better Auth's actual token lifecycle so delivery changes cannot bypass
// one-time use, expiry, password verification, or session revocation.
describe("password reset lifecycle", () => {
	it("resets only the recipient account, revokes sessions, and rejects replay and expired tokens", async () => {
		const store: Record<string, Record<string, unknown>[]> = { user: [], account: [], session: [], verification: [] };
		const deliveries: { token: string; email: string }[] = [];
		const auth = betterAuth({
			database: memoryAdapter(store),
			baseURL: "https://llmo.example.com",
			secret: "test-only-password-reset-secret-at-least-32-characters",
			logger: { disabled: true },
			emailAndPassword: {
				enabled: true,
				...passwordResetEmailOptions({
					APP_URL: "https://llmo.example.com",
					BREVO_API_KEY: "test-only-key",
					AUTH_EMAIL_FROM: "sender@example.com",
				}),
				sendResetPassword: async ({ user, token }) => {
					deliveries.push({ email: user.email, token });
				},
			},
		});
		await auth.api.signUpEmail({
			body: { email: "owner@example.com", name: "Owner", password: "original-password-123" },
		});
		await auth.api.signUpEmail({ body: { email: "other@example.com", name: "Other", password: "other-password-123" } });
		const signedIn = await auth.api.signInEmail({
			body: { email: "owner@example.com", password: "original-password-123" },
		});
		expect(store.session.some((s) => s.token === signedIn.token)).toBe(true);
		const existing = await auth.api.requestPasswordReset({
			body: { email: "owner@example.com", redirectTo: "https://llmo.example.com/auth/reset-password" },
		});
		const missing = await auth.api.requestPasswordReset({
			body: { email: "absent@example.com", redirectTo: "https://llmo.example.com/auth/reset-password" },
		});
		expect(missing).toEqual(existing);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0].email).toBe("owner@example.com");
		const token = deliveries[0].token;
		await auth.api.resetPassword({ body: { token, newPassword: "replacement-password-456" } });
		expect(store.session.some((s) => s.token === signedIn.token)).toBe(false);
		await expect(auth.api.resetPassword({ body: { token, newPassword: "replayed-password-789" } })).rejects.toThrow();
		await expect(
			auth.api.signInEmail({ body: { email: "owner@example.com", password: "original-password-123" } }),
		).rejects.toThrow();
		await expect(
			auth.api.signInEmail({ body: { email: "owner@example.com", password: "replacement-password-456" } }),
		).resolves.toMatchObject({ user: { email: "owner@example.com" } });
		await expect(
			auth.api.signInEmail({ body: { email: "other@example.com", password: "other-password-123" } }),
		).resolves.toMatchObject({ user: { email: "other@example.com" } });
		await auth.api.requestPasswordReset({ body: { email: "owner@example.com" } });
		const expired = store.verification.find((v) => v.identifier === `reset-password:${deliveries[1].token}`);
		expect(expired).toBeDefined();
		if (expired) expired.expiresAt = new Date(Date.now() - 1000);
		await expect(
			auth.api.resetPassword({ body: { token: deliveries[1].token, newPassword: "expired-password-123" } }),
		).rejects.toThrow();
	});
});
