// 把一条公开事件渲染成一行 transcript 文本。play.ts 与 eval 实时输出共用，保持单一真相。
import type { GameEvent } from "./engine/models";

/** 渲染一条公开事件；不需展示的事件返回 null。 */
export function formatEvent(e: GameEvent): string | null {
  switch (e.type) {
    case "phase_change":
      return `\n=== ${String(e.payload.phase)} ===`;
    case "utterance":
      return e.actor === "dm" ? `〔DM〕${String(e.payload.text)}` : `${e.actor}：${String(e.payload.text)}`;
    case "clue_release":
      return `[线索] ${String(e.payload.text)}`;
    case "vote":
      return e.actor === "engine"
        ? `[计票] ${JSON.stringify(e.payload.counts)} → 指认 ${String(e.payload.accused)}`
        : `[投票] ${e.actor} → ${String(e.payload.target)}`;
    default:
      return null;
  }
}
