import type { ConversionGoal } from "@workspace/lib/analytics";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import { conditionsSummary } from "./condition-editor";
import {
	conversionGoalOptions,
	conversionGoalRevisionKey,
	conversionNumber,
	conversionRate,
	resolveConversionGoal,
	resolveConversionSelection,
} from "./conversion-state";
import { duplicateViewDraft, newViewDraft, scopeChange, validateTrafficSearch } from "./traffic-state";

const goal: ConversionGoal = {
	id: "signup",
	brandId: "brand",
	propertyId: "123",
	hostname: "example.com",
	eventName: "応募完了",
	displayName: "応募完了",
	enabled: true,
	revision: 1,
	ga4Name: "properties/123/keyEvents/1",
	ga4CreateTime: null,
	countingMethod: "ONCE_PER_EVENT",
	updatedAt: "2026-10-30",
};
describe("conversion selection and measurement state", () => {
	it("keeps unavailable denominators distinct from measured zero and displays fractional rates", () => {
		expect(conversionNumber(null)).toBe("—");
		expect(conversionNumber(0)).toBe("0");
		expect(conversionRate(null)).toBe("—");
		expect(conversionRate(0)).toBe("0.00%");
		expect(conversionRate(0.125)).toBe("12.50%");
	});
	it("does not silently replace missing or disabled saved goals with a different event", () => {
		const disabled = { ...goal, id: "disabled", enabled: false };
		expect(resolveConversionGoal("deleted", [goal, disabled])).toEqual({ goal: undefined, invalid: true });
		expect(resolveConversionGoal("disabled", [goal, disabled])).toEqual({ goal: undefined, invalid: true });
		expect(resolveConversionGoal(undefined, [disabled, goal])).toEqual({ goal, invalid: false });
	});
	it("restores conversion URL preferences and rejects unknown analysis tabs", () => {
		expect(validateTrafficSearch({ analysisTab: "conversions", conversionGoalId: goal.id, grain: "month" })).toEqual({
			analysisTab: "conversions",
			conversionGoalId: goal.id,
			grain: "month",
		});
		expect(validateTrafficSearch({ analysisTab: "admin", conversionGoalId: 42 })).toEqual({});
	});
	it("resets pagination and detail when changing conversion goals while retaining the reporting period", () => {
		const previous = { from: "2026-10-01", to: "2026-10-28", page: 5, pageSearch: "/old", detail: "/old" };
		expect({ ...previous, ...scopeChange({ analysisTab: "conversions", conversionGoalId: goal.id }) }).toEqual({
			...previous,
			analysisTab: "conversions",
			conversionGoalId: goal.id,
			page: undefined,
			pageSearch: undefined,
			detail: undefined,
			detailHostname: undefined,
		});
	});
	it("copies a saved view's conversion preference without carrying its identity", () => {
		const draft = duplicateViewDraft(
			{
				id: "view",
				brandId: "brand",
				hostname: "example.com",
				name: "応募",
				conditions: [],
				sortOrder: 0,
				revision: 1,
				updatedAt: "2026-10-30",
				analysisTab: "conversions",
				conversionGoalId: goal.id,
			},
			"応募 コピー",
		);
		expect(draft).toMatchObject({ analysisTab: "conversions", conversionGoalId: goal.id });
		expect(draft).not.toHaveProperty("id");
	});
});

describe("conversion scope across domains", () => {
	const content = { ...goal, id: "content-signup", hostname: "content.example.com" };
	it("invalidates combined and individual reports when an applicable host goal changes", () => {
		const original = conversionGoalRevisionKey([goal, content], "all");
		expect(conversionGoalRevisionKey([content, goal], "all")).toBe(original);
		expect(conversionGoalRevisionKey([goal, { ...content, revision: 2 }], "all")).not.toBe(original);
		expect(conversionGoalRevisionKey([goal, { ...content, enabled: false }], "all")).not.toBe(original);
		expect(conversionGoalRevisionKey([goal, { ...content, revision: 2 }], goal.hostname)).toBe(
			conversionGoalRevisionKey([goal, content], goal.hostname),
		);
	});
	it("defaults to the sum of enabled events and deduplicates equivalent host definitions", () => {
		const goals = [goal, content, { ...goal, id: "disabled", eventName: "purchase", enabled: false }];
		expect(conversionGoalOptions(goals, "all")).toEqual([goal]);
		expect(resolveConversionSelection(undefined, goals, "all")).toMatchObject({ id: "all", invalid: false });
		expect(conversionGoalOptions(goals, content.hostname)).toEqual([content]);
	});
	it("restores the same event from a different domain's saved selection", () => {
		expect(resolveConversionSelection(goal.id, [goal, content], content.hostname)).toMatchObject({
			id: content.id,
			goal: content,
			invalid: false,
		});
		expect(resolveConversionSelection("missing", [goal, content], "all").invalid).toBe(true);
		expect(resolveConversionSelection(content.id, [content], goal.hostname).invalid).toBe(true);
		expect(resolveConversionSelection(goal.id, [{ ...goal, enabled: false }, content], "all").invalid).toBe(true);
	});
});

describe("registering the current conversion scope", () => {
	it("keeps an all-path scope empty rather than silently narrowing it to the homepage", () => {
		const draft = newViewDraft([], "conversions", goal.id);
		expect(draft).toEqual({ name: "", conditions: [], analysisTab: "conversions", conversionGoalId: goal.id });
		expect(newViewDraft([], "traffic").conditions).toEqual([]);
		expect(conditionsSummary(draft.conditions, "observed_session_start", t("conversions.allPaths"))).toBe(
			t("conversions.allPaths"),
		);
	});
	it("copies current conditions so editing the registration does not change the active report", () => {
		const conditions = [{ mode: "include" as const, operator: "subtree" as const, value: "/jobs" }];
		const draft = newViewDraft(conditions, "conversions", goal.id);
		draft.conditions[0].value = "/other";
		expect(conditions[0].value).toBe("/jobs");
	});
});
