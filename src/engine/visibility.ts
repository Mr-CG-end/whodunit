// VisibilityGate —— 设计文档 §4 标星核心组件。事前隔绝：算出某参与者此刻【能合法看到】的 InfoItem 集合。
// 物理上不把不该看的装进来，就没有“无从说起”。这是“用架构约束全知模型”的第一道闸。
import type { GameState, InfoItem } from "./models";
import type { Scenario } from "./scenario";

/**
 * 参与者 pid 此刻能合法看到的信息。铁律：
 * - private（秘密）：仅 owner 可见，对 owner 恒可见。
 * - directed（定向线索）：仅 owner 可见，且须已发布（revealedInfo 含其 id，受 revealPhase 约束）。
 * - public：仅当 info_id 已进入 revealedInfo（已公布）才可见。
 * - omniscient（真相）：玩家永不可见 —— 不在任何分支里返回。
 */
export function visibleInfoFor(pid: string, scenario: Scenario, state: GameState): InfoItem[] {
  const out: InfoItem[] = [];
  for (const item of scenario.infoItems) {
    if (item.scope === "private") {
      if (item.owners.includes(pid)) out.push(item);
    } else if (item.scope === "directed") {
      if (item.owners.includes(pid) && state.revealedInfo.has(item.id)) out.push(item);
    } else if (item.scope === "public") {
      if (state.revealedInfo.has(item.id)) out.push(item);
    }
    // omniscient：故意不处理 —— 玩家无论如何拿不到
  }
  return out;
}
