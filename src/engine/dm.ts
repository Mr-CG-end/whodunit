// DMSpeaker —— DM 主持话术（design 3b §2，docs/specs/2026-06-12-dm-speaker-design.md）。
// 拆角色边界：只拿 public-safe context + 上层递来的 instruction，无权看全量真相。
import type { LLMRouter } from "./llm";

export interface DMSpeaker {
  /** 生成主持话术。publicCtx 来自 publicContext()；要宣布的文本由上层装进 instruction。 */
  speak(publicCtx: string, instruction: string): Promise<string>;
}

const SYSTEM =
  "你是一场剧本杀的主持人（DM），负责渲染气氛、推进流程。\n" +
  "铁律：只能基于下面提供的案情、公开信息与主持指令说话，严禁编造线索内容，严禁猜测或暗示谁是凶手。\n" +
  "话术简短而有氛围感，不超过 3 句。";

export function aiDMSpeaker(router: LLMRouter): DMSpeaker {
  return {
    async speak(publicCtx, instruction) {
      return router.complete("dm", SYSTEM, `${publicCtx}\n\n【主持指令】${instruction}`);
    },
  };
}
