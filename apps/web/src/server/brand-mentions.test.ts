import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	manage: vi.fn(),
	register: vi.fn(),
	status: vi.fn(),
	retry: vi.fn(),
	enqueue: vi.fn(),
	readOnly: false,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (schema: { parse: (input: unknown) => unknown }) => ({
			handler: (fn: (input: { data: unknown }) => unknown) => async (input: { data: unknown }) =>
				fn({ data: schema.parse(input.data) }),
		}),
	}),
}));
vi.mock("@/lib/auth/helpers", () => ({
	requireAuthSession: mocks.auth,
	requireOrgAccess: mocks.access,
	requireOrgManageAccess: mocks.manage,
}));
vi.mock("@workspace/lib/brand-mention-recount", () => ({
	registerMentionBrand: mocks.register,
	getMentionRecountStatus: mocks.status,
	retryMentionRecount: mocks.retry,
}));
vi.mock("@/lib/mention-recount-client", () => ({ enqueueMentionRecount: mocks.enqueue }));
vi.mock("@/lib/config/server", () => ({ getDeployment: () => ({ features: { readOnly: mocks.readOnly } }) }));

import { getMentionRecountStatusFn, registerMentionBrandFn, retryMentionRecountFn } from "./brand-mentions";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.readOnly = false;
	mocks.auth.mockResolvedValue({ user: { id: "owner" } });
	mocks.access.mockResolvedValue(undefined);
	mocks.manage.mockResolvedValue(undefined);
});

describe("brand mention registration access", () => {
	it("requires management access and keeps name-only manual registration", async () => {
		const data = { brandId: "brand", name: "New Agent", target: "new" as const };
		await registerMentionBrandFn({ data });
		expect(mocks.manage).toHaveBeenCalledWith("owner", "brand");
		expect(mocks.register).toHaveBeenCalledWith(data, mocks.enqueue);
	});
	it("blocks cross-brand writes before loading or queueing", async () => {
		mocks.manage.mockRejectedValue(new Error("Forbidden"));
		await expect(
			registerMentionBrandFn({ data: { brandId: "foreign", name: "New Agent", target: "new" } }),
		).rejects.toThrow("Forbidden");
		expect(mocks.register).not.toHaveBeenCalled();
		await expect(retryMentionRecountFn({ data: { brandId: "foreign" } })).rejects.toThrow("Forbidden");
		expect(mocks.retry).not.toHaveBeenCalled();
	});
	it("requires an existing competitor selection and caps input", async () => {
		await expect(
			registerMentionBrandFn({ data: { brandId: "brand", name: "Agent", target: "competitor" } }),
		).rejects.toThrow();
		await expect(
			registerMentionBrandFn({ data: { brandId: "brand", name: "x".repeat(201), target: "new" } }),
		).rejects.toThrow();
		expect(mocks.register).not.toHaveBeenCalled();
	});
	it("read-only deployments reject both write actions", async () => {
		mocks.readOnly = true;
		await expect(registerMentionBrandFn({ data: { brandId: "brand", name: "Agent", target: "new" } })).rejects.toThrow(
			"Read-only",
		);
		await expect(retryMentionRecountFn({ data: { brandId: "brand" } })).rejects.toThrow("Read-only");
		expect(mocks.register).not.toHaveBeenCalled();
		expect(mocks.retry).not.toHaveBeenCalled();
	});
	it("status reads are scoped to authorized organization", async () => {
		mocks.status.mockResolvedValue({ status: "running", processed: 100, total: 500 });
		expect(await getMentionRecountStatusFn({ data: { brandId: "brand" } })).toEqual({
			status: "running",
			processed: 100,
			total: 500,
		});
		expect(mocks.access).toHaveBeenCalledWith("owner", "brand");
		mocks.access.mockRejectedValue(new Error("Forbidden"));
		mocks.status.mockClear();
		await expect(getMentionRecountStatusFn({ data: { brandId: "foreign" } })).rejects.toThrow("Forbidden");
		expect(mocks.status).not.toHaveBeenCalled();
	});
});
