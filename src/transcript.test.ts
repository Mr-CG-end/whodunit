import { describe, expect, it } from "vitest";
import type { GameEvent } from "./engine/models";
import { formatEvent } from "./transcript";

function ev(partial: Partial<GameEvent> & Pick<GameEvent, "type" | "actor" | "payload">): GameEvent {
  return { id: "x", visibility: "public", ...partial };
}

describe("formatEvent", () => {
  it("阶段切换渲染成带分隔线的标题", () => {
    expect(formatEvent(ev({ type: "phase_change", actor: "engine", payload: { phase: "搜证一" } }))).toBe(
      "\n=== 搜证一 ===",
    );
  });

  it("DM 发言带〔DM〕前缀", () => {
    expect(formatEvent(ev({ type: "utterance", actor: "dm", payload: { text: "请各位开始搜证。" } }))).toBe(
      "〔DM〕请各位开始搜证。",
    );
  });

  it("玩家发言渲染成「角色：内容」", () => {
    expect(formatEvent(ev({ type: "utterance", actor: "沈砚秋", payload: { text: "我有不在场证明。" } }))).toBe(
      "沈砚秋：我有不在场证明。",
    );
  });

  it("线索发布带[线索]前缀", () => {
    expect(formatEvent(ev({ type: "clue_release", actor: "engine", payload: { text: "桌上有半杯酒。" } }))).toBe(
      "[线索] 桌上有半杯酒。",
    );
  });

  it("玩家投票渲染成「[投票] 谁 → 谁」", () => {
    expect(formatEvent(ev({ type: "vote", actor: "沈砚秋", payload: { target: "顾曼珠" } }))).toBe(
      "[投票] 沈砚秋 → 顾曼珠",
    );
  });

  it("引擎计票渲染成[计票]行", () => {
    expect(
      formatEvent(ev({ type: "vote", actor: "engine", payload: { counts: { 沈砚秋: 2 }, accused: "沈砚秋" } })),
    ).toBe('[计票] {"沈砚秋":2} → 指认 沈砚秋');
  });
});
