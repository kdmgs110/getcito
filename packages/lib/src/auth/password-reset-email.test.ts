import { afterEach, describe, expect, it, vi } from "vitest";
import { passwordResetEmailOptions } from "./password-reset-email";

const env = {
	DEPLOYMENT_MODE: "local",
	APP_URL: "https://llmo.example.com",
	BREVO_API_KEY: "private-test-key",
	AUTH_EMAIL_FROM: "info@example.com",
};
const data = {
	user: {
		id: "user-1",
		email: "owner@example.com",
		name: "Owner",
		emailVerified: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	},
	token: "private-reset-token",
	url: "https://llmo.example.com/api/auth/reset-password/private-reset-token?callbackURL=https%3A%2F%2Fllmo.example.com%2Fauth%2Freset-password",
};

afterEach(() => vi.unstubAllGlobals());

describe("password reset email delivery", () => {
	it("stays disabled without delivery credentials and in demo/SSO modes", () => {
		expect(passwordResetEmailOptions({})).toEqual({});
		expect(passwordResetEmailOptions({ ...env, BREVO_API_KEY: "" })).toEqual({});
		for (const mode of ["demo", "whitelabel"])
			expect(passwordResetEmailOptions({ ...env, DEPLOYMENT_MODE: mode })).toEqual({});
	});

	it("rejects invalid senders and insecure public origins", () => {
		expect(() => passwordResetEmailOptions({ ...env, AUTH_EMAIL_FROM: "invalid\r\nBcc:other@example.com" })).toThrow();
		expect(() => passwordResetEmailOptions({ ...env, APP_URL: "http://llmo.example.com" })).toThrow();
		expect(passwordResetEmailOptions({ ...env, APP_URL: "http://localhost:3001" }).sendResetPassword).toBeTypeOf(
			"function",
		);
	});

	it("emails only the requested user through Brevo with an expiring single-use link", async () => {
		const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "receipt" }), { status: 201 }));
		vi.stubGlobal("fetch", send);
		const options = passwordResetEmailOptions(env);
		expect(options.resetPasswordTokenExpiresIn).toBe(3600);
		expect(options.revokeSessionsOnPasswordReset).toBe(true);
		await options.sendResetPassword?.(data);
		const [endpoint, request] = send.mock.calls[0];
		expect(endpoint).toBe("https://api.brevo.com/v3/smtp/email");
		const body = JSON.parse(request.body);
		expect(body.to).toEqual([{ email: data.user.email }]);
		expect(body.sender.email).toBe(env.AUTH_EMAIL_FROM);
		expect(body.textContent).toContain(data.url);
		expect(body.bcc).toBeUndefined();
		expect(body.cc).toBeUndefined();
		expect(request.headers["api-key"]).toBe(env.BREVO_API_KEY);
	});

	it("refuses to email reset URLs belonging to other apps", async () => {
		const send = vi.fn();
		vi.stubGlobal("fetch", send);
		await expect(
			passwordResetEmailOptions(env).sendResetPassword?.({
				...data,
				url: "https://attacker.example/api/auth/reset-password/token",
			}),
		).rejects.toThrow("Invalid password reset URL");
		expect(send).not.toHaveBeenCalled();
	});

	it("does not leak provider error bodies containing credentials or reset tokens", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("private-test-key private-reset-token", { status: 401 })),
		);
		await expect(passwordResetEmailOptions(env).sendResetPassword?.(data)).rejects.toThrow(
			"Password reset email delivery failed (401)",
		);
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-test-key private-reset-token")));
		await expect(passwordResetEmailOptions(env).sendResetPassword?.(data)).rejects.toThrow(
			/^Password reset email delivery failed$/,
		);
	});
});
