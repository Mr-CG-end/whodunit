// 把 pid 此刻能合法看到的一切渲染成可塞进 prompt 的文本。
// 只读 VisibilityGate 的产物 + 公开发言事件 —— 结构上不触碰别人的秘密、真相、未公开线索。
import type { GameState } from "./models";
import type { Scenario } from "./scenario";
import { visibleInfoFor } from "./visibility";

export function visibleContext(pid: string, scenario: Scenario, state: GameState): string {
  const items = visibleInfoFor(pid, scenario, state);
  const secrets = items.filter((i) => i.scope === "private");
  const publicClues = items.filter((i) => i.scope === "public");
  const directed = items.filter((i) => i.scope === "directed");

  const parts: string[] = [];
  for (const s of secrets) parts.push(`【你的秘密 · 只有你知道】${s.text}`);
  if (publicClues.length > 0) {
    parts.push(`【已公开的线索】\n${publicClues.map((i) => `[${i.id}] ${i.text}`).join("\n")}`);
  }
  if (directed.length > 0) {
    parts.push(`【只发给你的线索】\n${directed.map((i) => `[${i.id}] ${i.text}`).join("\n")}`);
  }
  const utterances = state.publicEvents.filter((e) => e.type === "utterance");
  if (utterances.length > 0) {
    const lines = utterances.map((e) => `${e.actor}：${String(e.payload.text ?? "")}`).join("\n");
    parts.push(`【目前公开发言】\n${lines}`);
  }
  return parts.join("\n\n");
}
