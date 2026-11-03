import {
	type EnqueueMentionRecount,
	MENTION_RECOUNT_POLICY,
	MENTION_RECOUNT_QUEUE,
} from "@workspace/lib/brand-mention-recount";
import { getBoss } from "@/lib/boss-client";

/** Queue insert shares the transaction that changes the registered definitions. */
export const enqueueMentionRecount: EnqueueMentionRecount = async (data, client) => {
	const boss = await getBoss();
	await boss.send(MENTION_RECOUNT_QUEUE, data, {
		...MENTION_RECOUNT_POLICY,
		db: { executeSql: async (text, values) => client.query(text, values) },
	});
};
