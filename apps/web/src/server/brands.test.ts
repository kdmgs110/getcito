import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	provision: vi.fn(),
	canCreate: true,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const builder = {
			validator: (schema: { parse: (input: unknown) => unknown }) => ({
				handler: (fn: (input: { data: unknown }) => unknown) => (input: { data: unknown }) =>
					fn({ data: schema.parse(input.data) }),
			}),
			handler: (fn: () => unknown) => fn,
		};
		return builder;
	},
}));
vi.mock("@/lib/auth/helpers", () => ({
	requireAuthSession: mocks.auth,
	requireOrgAccess: vi.fn(),
	listUserOrganizations: vi.fn(),
}));
vi.mock("@/lib/config/server", () => ({ getDeployment: () => ({ features: { canCreateBrands: mocks.canCreate } }) }));
vi.mock("@workspace/lib/db/provisioning", async (original) => {
	const actual = await original<typeof import("@workspace/lib/db/provisioning")>();
	return { ...actual, provisionAdditionalLocalBrand: mocks.provision };
});

import { BrandCreationConflictError } from "@workspace/lib/db/provisioning";
import { createBrandWithOrgFn } from "./brands";

const data = {
	brandName: "  日本語ブランド  ",
	website: "example.com/path",
	requestId: "00000000-0000-4000-8000-000000000001",
};

beforeEach(() => {
	mocks.auth.mockReset().mockResolvedValue({ user: { id: "owner" } });
	mocks.provision.mockReset().mockResolvedValue({ orgId: "new-brand" });
	mocks.canCreate = true;
});

describe("createBrandWithOrgFn", () => {
	it("normalizes inputs and delegates the entire write to the atomic provisioner", async () => {
		await expect(createBrandWithOrgFn({ data })).resolves.toEqual({ ok: true, brandId: "new-brand" });
		expect(mocks.provision).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "owner",
				name: "日本語ブランド",
				website: "https://example.com/",
				targetMarket: null,
				targetLanguage: null,
				requestId: data.requestId,
			}),
		);
	});
	it("rejects unauthenticated creation before touching the database", async () => {
		mocks.auth.mockRejectedValue(new Error("Unauthorized"));
		await expect(createBrandWithOrgFn({ data })).resolves.toEqual({ ok: false, error: { code: "AUTH_REQUIRED" } });
		expect(mocks.provision).not.toHaveBeenCalled();
	});
	it("keeps demo/whitelabel creation blocked", async () => {
		mocks.canCreate = false;
		await expect(createBrandWithOrgFn({ data })).resolves.toEqual({ ok: false, error: { code: "FORBIDDEN" } });
		expect(mocks.provision).not.toHaveBeenCalled();
	});
	it("returns field errors without writing", async () => {
		await expect(createBrandWithOrgFn({ data: { ...data, website: "bad domain" } })).resolves.toEqual({
			ok: false,
			error: { code: "INVALID_WEBSITE", field: "website" },
		});
		expect(mocks.provision).not.toHaveBeenCalled();
	});
	it("does not expose database details in a save failure", async () => {
		mocks.provision.mockRejectedValue(new Error("SQL private detail"));
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await expect(createBrandWithOrgFn({ data })).resolves.toEqual({ ok: false, error: { code: "SAVE_FAILED" } });
		} finally {
			log.mockRestore();
		}
	});
	it("distinguishes a request already saved with different values", async () => {
		mocks.provision.mockRejectedValue(new BrandCreationConflictError());
		await expect(createBrandWithOrgFn({ data })).resolves.toEqual({ ok: false, error: { code: "REQUEST_CONFLICT" } });
	});
});
