import { eq } from "drizzle-orm";

/** Durable submission receipt: a retry may GET again, but may never POST again. */
export interface DataForSeoTask {
	key: string;
	requestHash: string;
	taskId: string | null;
	status: "submitting" | "submitted" | "failed";
	errorCode: string | null;
}

export interface DataForSeoTaskStore {
	claim(key: string, requestHash: string): Promise<{ task: DataForSeoTask; created: boolean }>;
	submitted(key: string, taskId: string): Promise<void>;
	failed(key: string, errorCode: string): Promise<void>;
}

export const databaseDataForSeoTaskStore: DataForSeoTaskStore = {
	async claim(key, requestHash) {
		// Lazy imports keep provider validation and CLI help independent of the DB.
		const [{ db }, { dataforseoTasks }] = await Promise.all([import("../db/db.js"), import("../db/schema.js")]);
		const [created] = await db
			.insert(dataforseoTasks)
			.values({ key, requestHash, status: "submitting" })
			.onConflictDoNothing()
			.returning();
		if (created) return { task: created, created: true };
		const existing = await db.query.dataforseoTasks.findFirst({ where: eq(dataforseoTasks.key, key) });
		if (!existing) throw new Error("DATAFORSEO_RECEIPT_NOT_FOUND");
		return { task: existing, created: false };
	},
	async submitted(key, taskId) {
		const [{ db }, { dataforseoTasks }] = await Promise.all([import("../db/db.js"), import("../db/schema.js")]);
		await db
			.update(dataforseoTasks)
			.set({ taskId, status: "submitted", updatedAt: new Date() })
			.where(eq(dataforseoTasks.key, key));
	},
	async failed(key, errorCode) {
		const [{ db }, { dataforseoTasks }] = await Promise.all([import("../db/db.js"), import("../db/schema.js")]);
		await db
			.update(dataforseoTasks)
			.set({ status: "failed", errorCode, updatedAt: new Date() })
			.where(eq(dataforseoTasks.key, key));
	},
};
