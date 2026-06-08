// 按 revealPhase 确定性发牌 —— 把该阶段的线索写进 GameState。
// public：进 revealedInfo + 广播公开事件；directed：进 revealedInfo + 投进收件人私有事件。
// private（秘密）/ omniscient（真相）不经此发布 —— 真相绝不因进入复盘就变得可见。
import type { GameState } from "./models";
import type { Scenario } from "./scenario";

export function revealCluesForPhase(scenario: Scenario, state: GameState, phase: string): void {
  for (const item of scenario.infoItems) {
    if (item.revealPhase !== phase) continue;
    if (item.scope === "public") {
      state.revealedInfo.add(item.id);
      state.publicEvents.push({
        id: `rel_${item.id}`,
        type: "clue_release",
        actor: "engine",
        visibility: "public",
        payload: { infoId: item.id, text: item.text },
      });
    } else if (item.scope === "directed") {
      state.revealedInfo.add(item.id);
      for (const owner of item.owners) {
        state.privateEvents[owner] ??= [];
        state.privateEvents[owner].push({
          id: `rel_${item.id}_${owner}`,
          type: "clue_release",
          actor: "engine",
          visibility: "directed",
          payload: { infoId: item.id, text: item.text },
        });
      }
    }
    // private / omniscient：不发布
  }
}
