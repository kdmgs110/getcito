import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	lock: vi.fn(),
	recount: vi.fn(),
	enqueue: vi.fn(),
	findCompetitor: vi.fn(),
	updateBrand: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	select: vi.fn(),
	client: {},
	currentCount: 0,
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@workspace/lib/brand-mention-recount", () => ({
	withMentionTransaction: mocks.lock,
	startMentionRecount: mocks.recount,
}));
vi.mock("@/lib/mention-recount-client", () => ({ enqueueMentionRecount: mocks.enqueue }));
vi.mock("@/lib/auth/policies", () => ({ validateApiKeyFromRequest: () => true }));
vi.mock("@workspace/lib/db/db", () => ({ db: { query: { competitors: { findFirst: mocks.findCompetitor } } } }));
vi.mock("drizzle-orm/node-postgres", () => ({
	drizzle: () => ({ select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.remove }),
}));
vi.mock("@/server/onboarding-core", async (original) => ({
	...(await original<typeof import("@/server/onboarding-core")>()),
	updateBrand: mocks.updateBrand,
}));

import { Route as brandResource } from "@/routes/api/v1/brands/$brandId";
import { Route as competitorResource } from "@/routes/api/v1/competitors/$competitorId";
import { Route as competitorCollection } from "@/routes/api/v1/competitors/index";

type ApiRoute = {
	server: {
		handlers: Record<string, (input: { request: Request; params: Record<string, string> }) => Promise<Response>>;
	};
};
const id = "00000000-0000-4000-8000-000000000001";
const row = { id, brandId: "brand", name: "New Agent", domains: [], aliases: [] };
const run = (route: unknown, method: string, body?: unknown, params: Record<string, string> = { competitorId: id }) =>
	(route as ApiRoute).server.handlers[method]({
		request: new Request("https://example.com/api/v1/competitors", {
			method,
			...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
		}),
		params,
	});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.currentCount = 0;
	mocks.lock.mockImplementation(async (_brandId, action) => action(mocks.client));
	mocks.findCompetitor.mockResolvedValue(row);
	mocks.select.mockImplementation((shape) => ({
		from: () => ({
			where: () =>
				shape ? Promise.resolve([{ count: mocks.currentCount }]) : { limit: async () => [{ id: "brand" }] },
		}),
	}));
	mocks.insert.mockReturnValue({ values: () => ({ returning: async () => [row] }) });
	mocks.update.mockReturnValue({ set: () => ({ where: () => ({ returning: async () => [row] }) }) });
	mocks.remove.mockReturnValue({ where: () => ({ returning: async () => [row] }) });
	mocks.updateBrand.mockResolvedValue({ id: "brand", brandName: "Updated" });
});

describe("REST definition changes and mention reassessment", () => {
	it("creates a competitor and queues reassessment in the brand transaction", async () => {
		const response = await run(competitorCollection, "POST", { brandId: "brand", name: "New Agent" });
		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject(row);
		expect(mocks.lock).toHaveBeenCalledWith("brand", expect.any(Function));
		expect(mocks.recount).toHaveBeenCalledWith(mocks.client, "brand", mocks.enqueue);
	});
	it("enforces the competitor limit while holding the same registration lock", async () => {
		mocks.currentCount = 100;
		expect((await run(competitorCollection, "POST", { brandId: "brand", name: "New Agent" })).status).toBe(409);
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.recount).not.toHaveBeenCalled();
	});
	it("patches and deletes a competitor under its actual brand lock", async () => {
		expect((await run(competitorResource, "PATCH", { aliases: ["Alias"] })).status).toBe(200);
		expect((await run(competitorResource, "DELETE")).status).toBe(200);
		expect(mocks.lock).toHaveBeenCalledTimes(2);
		expect(mocks.recount).toHaveBeenCalledTimes(2);
		expect(mocks.recount).toHaveBeenLastCalledWith(mocks.client, "brand", mocks.enqueue);
	});
	it("returns 404 for absent competitors without enqueueing", async () => {
		mocks.findCompetitor.mockResolvedValue(undefined);
		expect((await run(competitorResource, "DELETE")).status).toBe(404);
		expect((await run(competitorResource, "PATCH", { name: "Agent" })).status).toBe(404);
		expect(mocks.recount).not.toHaveBeenCalled();
	});
	it("reassesses brand name/domain/alias changes but leaves locale-only updates alone", async () => {
		expect((await run(brandResource, "PATCH", { aliases: ["Own Alias"] }, { brandId: "brand" })).status).toBe(200);
		expect(mocks.recount).toHaveBeenCalledWith(mocks.client, "brand", mocks.enqueue);
		mocks.recount.mockClear();
		mocks.lock.mockClear();
		expect((await run(brandResource, "PATCH", { targetLanguage: "Japanese" }, { brandId: "brand" })).status).toBe(200);
		expect(mocks.recount).not.toHaveBeenCalled();
		expect(mocks.lock).not.toHaveBeenCalled();
	});
});
