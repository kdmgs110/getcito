/** RE2-compatible patterns shared by Google's filter and local ranking. */
export const LONG_JAPANESE_QUERY_REGEX = Array.from({ length: 14 }, () => "[ぁ-んァ-ヶ一-龠]").join(".*");
const trailing = String.raw`[。.!！?？ \t\r\n\f　]*$`;

export const AI_QUESTION_RULES = [
	{
		id: "request",
		points: 40,
		expression:
			"(?:(?:教えて|おしえて|説明して|紹介して|提案して|比較して|まとめて|探して|選んで|考えて|作って|調べて|おすすめして|整理して|挙げて)(?:ください|下さい|ほしい|欲しい|もらえますか|いただけますか)?|お願いします|知りたい|してください|して下さい|してほしい|して欲しい)" +
			trailing,
	},
	{
		id: "question",
		points: 20,
		expression:
			"(?:なぜ|何故|どうすれば|どうしたら|どうやって|どのように|どちらが|どれが|何が|どこで|どこに|いつから|いつまで|いくらかか)|(?:ですか|ますか|でしょうか|なのか|だろうか|できるか|出来るか)" +
			trailing +
			"|[?？]" +
			trailing,
	},
	{
		id: "context",
		points: 20,
		expression:
			"(?:未経験|初心者|会社員|学生|主婦)(?:ですが|だけど|でも|で)|(?:予算|週|月)[0-9０-９一二三四五六七八九十]+(?:万円|円|日|時間)|(?:[0-9０-９]+(?:万円|円|日|時間)以内)",
	},
	{
		id: "comparison",
		points: 15,
		expression: "どれを選|どちらを選|私に合|自分に合|メリット.{0,12}デメリット|デメリット.{0,12}メリット",
	},
	{
		id: "fourTerms",
		points: 10,
		expression: String.raw`^[ \t\r\n\f　]*[^ \t\r\n\f　]+(?:[ \t\r\n\f　]+[^ \t\r\n\f　]+){3,}[ \t\r\n\f　]*$`,
	},
	{ id: "longJapanese", points: 5, expression: LONG_JAPANESE_QUERY_REGEX },
] as const;

export type AiQuestionReason = (typeof AI_QUESTION_RULES)[number]["id"];

/** One OR expression: short requests and four-term queries need not contain 14 Japanese characters. */
export const AI_QUESTION_REGEX = AI_QUESTION_RULES.map((rule) => `(?:${rule.expression})`).join("|");
const compiledRules = AI_QUESTION_RULES.map((rule) => ({ ...rule, regex: new RegExp(rule.expression) }));

/** Heuristic priority, not a probability or evidence of AI-origin traffic. Each rule counts once. */
export function getAiQuestionSignals(query: string): { score: number; reasons: AiQuestionReason[] } {
	const matches = compiledRules.filter((rule) => rule.regex.test(query));
	return {
		score: Math.min(
			100,
			matches.reduce((total, rule) => total + rule.points, 0),
		),
		reasons: matches.map((rule) => rule.id),
	};
}
