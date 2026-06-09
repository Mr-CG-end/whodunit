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
        `${ctx}\n\n请从这些人里指认一名凶手：${candidates.join("、")}。只回复一个名字。`,
      );
      const hit = candidates.filter((c) => reply.includes(c));
      return hit.length === 1 ? hit[0] : null;
    },
  };
}
