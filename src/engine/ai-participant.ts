// AIParticipant —— 用真 LLM 实现 Participant（设计 §3 / §6 / §11）。
// 复用现成的 visibleContext 产物作输入；system prompt 显式授权欺骗，否则 AI 不肯演坏人。
import type { LLMRouter } from "./llm";
import type { Participant } from "./participant";

function systemPrompt(pid: string): string {
  return (
    `你正在参加一场剧本杀，扮演玩家「${pid}」。这是虚构推理游戏：为达成你的角色目标，` +
    `你可以隐瞒信息、避重就轻、误导他人——这是游戏的正常部分。\n` +
    `铁律：只能依据下面提供给你的信息发言，严禁编造不存在的线索或他人信息。` +
    `保持角色，发言简洁自然，像真人玩家一样。`
  );
}

/**
 * 解析投票回复 —— 容忍带推理的长回复。
 * 优先取末行「最终指认：X」标记；无标记时回退到全文唯一候选名匹配（向后兼容简短回复）。
 * 仅当匹配到「恰好一个」候选才计为有效票，否则（弃权 / 没命中 / 命中多个）算弃权返回 null。
 */
function parseVote(reply: string, candidates: string[]): string | null {
  const marker = [...reply.matchAll(/最终指认[：:]\s*(.+)/g)].pop();
  const scope = marker ? marker[1] : reply;
  const hit = candidates.filter((c) => scope.includes(c));
  return hit.length === 1 ? hit[0] : null;
}

export function aiParticipant(pid: string, router: LLMRouter): Participant {
  return {
    id: pid,
    async speak(ctx, instruction) {
      return router.complete("player", systemPrompt(pid), `${ctx}\n\n${instruction}`);
    },
    async vote(ctx, candidates) {
      const reply = await router.complete(
        "player",
        systemPrompt(pid),
        `${ctx}\n\n你必须从这些人里指认凶手：${candidates.join("、")}。` +
          `先简要说明你的推理，然后另起一行、只用固定格式给出结论：「最终指认：名字」；` +
          `若实在无法确定，写「最终指认：弃权」。`,
      );
      return parseVote(reply, candidates);
    },
  };
}
