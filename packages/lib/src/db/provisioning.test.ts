import { beforeEach, describe, expect, it, vi } from "vitest";
import { brands, member, organization } from "./schema";

const mocks = vi.hoisted(() => ({
	existing: vi.fn(),
	membership: vi.fn(),
	execute: vi.fn(),
	writes: [] as { table: unknown; value: unknown }[],
	committed: [] as { table: unknown; value: unknown }[],
	failTable: null as unknown,
	transaction: vi.fn(),
}));

vi.mock("./db", () => ({
	db: {
		transaction: mocks.transaction,
	},
}));

import {
	BrandCreationConflictError,
	localBrandId,
	provisionAdditionalLocalBrand,
	slugifyOrgName,
} from "./provisioning";

beforeEach(() => {
	mocks.existing.mockReset().mockResolvedValue(undefined);
	mocks.membership.mockReset().mockResolvedValue(undefined);
	mocks.execute.mockReset().mockResolvedValue(undefined);
	mocks.writes.length = 0;
	mocks.committed.length = 0;
	mocks.failTable = null;
	mocks.transaction.mockReset().mockImplementation(async (callback) => {
		await callback({
			execute: mocks.execute,
			query: { brands: { findFirst: mocks.existing }, member: { findFirst: mocks.membership } },
			insert: (table: unknown) => ({
				values: async (value: unknown) => {
					if (table === mocks.failTable) throw new Error("database failure");
					mocks.writes.push({ table, value });
				},
			}),
		});
		mocks.committed.push(...mocks.writes);
	});
});

describe("slugifyOrgName", () => {
	it("lowercases", () => {
		expect(slugifyOrgName("Acme")).toBe("acme");
	});

	it("replaces runs of non-alphanumerics with single hyphens", () => {
		expect(slugifyOrgName("Acme Co!")).toBe("acme-co");
		expect(slugifyOrgName("Foo   Bar")).toBe("foo-bar");
	});

	it("trims leading and trailing hyphens", () => {
		expect(slugifyOrgName("  hello world  ")).toBe("hello-world");
		expect(slugifyOrgName("!!!brand!!!")).toBe("brand");
	});

	it("falls back to 'brand' for empty / non-alphanumeric input", () => {
		expect(slugifyOrgName("")).toBe("brand");
		expect(slugifyOrgName("!!!")).toBe("brand");
	});

	it("preserves digits", () => {
		expect(slugifyOrgName("Acme 2")).toBe("acme-2");
	});
});

describe("provisionAdditionalLocalBrand", () => {
	const input = { userId: "owner", name: "日本語", website: "https://example.com/", requestId: "request-1" };
	it("creates organization, administrator and brand using one transaction", async () => {
		const result = await provisionAdditionalLocalBrand(input);
		expect(result.orgId).toBe(localBrandId(input.userId, input.requestId));
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.execute).toHaveBeenCalledTimes(1);
		expect(mocks.committed.map((write) => write.table)).toEqual([organization, member, brands]);
		expect(mocks.committed[1]?.value).toMatchObject({ organizationId: result.orgId, userId: "owner", role: "admin" });
		expect(mocks.committed[2]?.value).toMatchObject({
			id: result.orgId,
			targetMarket: null,
			targetLanguage: null,
			enabled: true,
		});
	});
	it("does not commit partial organization rows when brand insertion fails", async () => {
		mocks.failTable = brands;
		await expect(provisionAdditionalLocalBrand(input)).rejects.toThrow("database failure");
		expect(mocks.writes).toHaveLength(2);
		expect(mocks.committed).toHaveLength(0);
	});
	it("returns an existing matching request without inserting any rows", async () => {
		mocks.existing.mockResolvedValue({ ...input, targetMarket: null, targetLanguage: null });
		mocks.membership.mockResolvedValue({ role: "admin" });
		await expect(provisionAdditionalLocalBrand(input)).resolves.toEqual({
			orgId: localBrandId(input.userId, input.requestId),
		});
		expect(mocks.committed).toHaveLength(0);
	});
	it("rejects reuse of a saved request identity with different input", async () => {
		mocks.existing.mockResolvedValue({ ...input, name: "another", targetMarket: null, targetLanguage: null });
		mocks.membership.mockResolvedValue({ role: "admin" });
		await expect(provisionAdditionalLocalBrand(input)).rejects.toBeInstanceOf(BrandCreationConflictError);
		expect(mocks.committed).toHaveLength(0);
	});
	it("does not return an existing brand without the creating user's membership", async () => {
		mocks.existing.mockResolvedValue({ ...input, targetMarket: null, targetLanguage: null });
		await expect(provisionAdditionalLocalBrand(input)).rejects.toBeInstanceOf(BrandCreationConflictError);
	});
	it("scopes request keys to users and keeps route-reserved names out of IDs", () => {
		expect(localBrandId("owner", "one")).not.toBe(localBrandId("other", "one"));
		expect(localBrandId("owner", "one")).not.toBe(localBrandId("owner", "two"));
		expect(localBrandId("owner", "one")).toMatch(/^brand-[a-f0-9]{64}$/);
	});
});
