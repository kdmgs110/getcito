import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), getRuns: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query }));
vi.mock("@/server/prompts", () => ({ getPromptRunsFn: mocks.getRuns }));
import { usePromptRunsOnly } from "./use-prompt-runs-only";
beforeEach(() => {
	vi.clearAllMocks();
	mocks.query.mockReturnValue({});
});
describe("answer history target cache", () => {
	it("requests the selected exact target and separates sources in the cache", async () => {
		usePromptRunsOnly("prompt", { model: "chatgpt:brightdata:online" });
		usePromptRunsOnly("prompt", { model: "chatgpt:dataforseo-scraper:online" });
		const [first, second] = mocks.query.mock.calls.map(([query]) => query);
		expect(first.queryKey).not.toEqual(second.queryKey);
		await second.queryFn();
		expect(mocks.getRuns).toHaveBeenCalledWith({
			data: expect.objectContaining({ model: "chatgpt:dataforseo-scraper:online" }),
		});
	});
	it("keeps all and unspecified histories unfiltered", async () => {
		usePromptRunsOnly("prompt", { model: "all" });
		await mocks.query.mock.calls[0][0].queryFn();
		expect(mocks.getRuns).toHaveBeenCalledWith({ data: expect.objectContaining({ model: undefined }) });
	});
});
