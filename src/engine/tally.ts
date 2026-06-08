// 计票：统计票数 / 取唯一多数。纯函数。
type Votes = Record<string, string | null>;

/** votes: { 投票人: 被投者 | null } → { 被投者: 票数 }，忽略弃权(null)。 */
export function tallyVotes(votes: Votes): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const target of Object.values(votes)) {
    if (target) counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

/** 得票唯一最高者；并列第一或无有效票时返回 null（不强行裁决）。 */
export function majority(votes: Votes): string | null {
  const entries = Object.entries(tallyVotes(votes));
  if (entries.length === 0) return null;
  const top = Math.max(...entries.map(([, c]) => c));
  const leaders = entries.filter(([, c]) => c === top).map(([name]) => name);
  return leaders.length === 1 ? leaders[0] : null;
}
