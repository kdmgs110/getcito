import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	provision: vi.fn(),
	canCreate: true,
	readOnly: false,
	org: vi.fn(),
	update: vi.fn(),
	set: vi.fn(),
	where: vi.fn(),
	returning: vi.fn(),
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
	requireOrgAccess: mocks.org,
	requireOrgManageAccess: mocks.org,
	listUserOrganizations: vi.fn(),
}));
vi.mock("@/lib/config/server", () => ({
	getDeployment: () => ({ features: { canCreateBrands: mocks.canCreate, readOnly: mocks.readOnly } }),
}));
vi.mock("@workspace/lib/db/provisioning", async (original) => {
	const actual = await original<typeof import("@workspace/lib/db/provisioning")>();
	return { ...actual, provisionAdditionalLocalBrand: mocks.provision };
});

import { BrandCreationConflictError } from "@workspace/lib/db/provisioning";

vi.mock("@workspace/lib/db/db", () => ({ db: { update: mocks.update } }));

import { createBrandWithOrgFn, updateBrandMeasurementTargetsFn } from "./brands";

const data = {
	brandName: "  日本語ブランド  ",
	website: "example.com/path",
	requestId: "00000000-0000-4000-8000-000000000001",
};

beforeEach(() => {
	mocks.auth.mockReset().mockResolvedValue({ user: { id: "owner" } });
	mocks.provision.mockReset().mockResolvedValue({ orgId: "new-brand" });
	mocks.canCreate = true;
	mocks.readOnly = false;
	mocks.org.mockReset().mockResolvedValue(undefined);
	mocks.update.mockReset().mockReturnValue({ set: mocks.set });
	mocks.set.mockReset().mockReturnValue({ where: mocks.where });
	mocks.where.mockReset().mockReturnValue({ returning: mocks.returning });
	mocks.returning.mockReset().mockResolvedValue([{ id: "brand" }]);
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

describe("updateBrandMeasurementTargetsFn", () => {
	it("authorizes brand access and saves exact targets without enabling sibling providers", async () => {
		vi.stubEnv("SCRAPE_TARGETS", "chatgpt:openai-api:gpt-5:online,chatgpt:brightdata:online");
		try {
			await expect(
				updateBrandMeasurementTargetsFn({ data: { brandId: "brand", targetKeys: ["chatgpt:brightdata:online"] } }),
			).resolves.toEqual({ targetKeys: ["chatgpt:brightdata:online"] });
			expect(mocks.org).toHaveBeenCalledWith("owner", "brand");
			expect(mocks.set).toHaveBeenCalledWith(
				expect.objectContaining({ enabledTargets: ["chatgpt:brightdata:online"] }),
			);
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("rejects nonmember access before writing", async () => {
		mocks.org.mockRejectedValue(new Error("Forbidden"));
		await expect(updateBrandMeasurementTargetsFn({ data: { brandId: "other", targetKeys: [] } })).rejects.toThrow(
			"Forbidden",
		);
		expect(mocks.update).not.toHaveBeenCalled();
	});
	it("rejects read-only deployments before writing", async () => {
		mocks.readOnly = true;
		await expect(updateBrandMeasurementTargetsFn({ data: { brandId: "brand", targetKeys: [] } })).rejects.toThrow(
			"Read-only",
		);
		expect(mocks.update).not.toHaveBeenCalled();
	});
	it("validates targets against deployment configuration", async () => {
		vi.stubEnv("SCRAPE_TARGETS", "chatgpt:brightdata:online");
		try {
			await expect(
				updateBrandMeasurementTargetsFn({
					data: { brandId: "brand", targetKeys: ["chatgpt:openai-api:gpt-5:online"] },
				}),
			).rejects.toThrow("enabledTargets");
			expect(mocks.update).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
