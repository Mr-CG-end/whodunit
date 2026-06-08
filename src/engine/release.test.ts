// 按 revealPhase 发牌的确定性测试。
import { expect, it } from "vitest";
import { createGameState } from "./models";
import { revealCluesForPhase } from "./release";
import { WUYE } from "./scenario";
import { visibleInfoFor } from "./visibility";

it("搜证1 恰好发布其线索（C4 定向不进公开）", () => {
  const state = createGameState(WUYE.participants);
  revealCluesForPhase(WUYE, state, "搜证1");
  expect(state.revealedInfo).toEqual(new Set(["C1", "C2", "C5", "C4"]));
  const publicIds = new Set(state.publicEvents.filter((e) => e.type === "clue_release").map((e) => e.payload.infoId));
  expect(publicIds).toEqual(new Set(["C1", "C2", "C5"]));
  const linIds = new Set((state.privateEvents.林雅 ?? []).map((e) => e.payload.infoId));
  expect(linIds).toEqual(new Set(["C4"]));
  expect(state.privateEvents.苏婉 ?? []).toHaveLength(0);
});

it("复盘阶段绝不泄露真相", () => {
  const state = createGameState(WUYE.participants);
  revealCluesForPhase(WUYE, state, "复盘");
  expect(state.revealedInfo.has("truth")).toBe(false);
  expect(state.publicEvents.every((e) => e.payload.infoId !== "truth")).toBe(true);
});

it("发牌后 gate：C7 只在搜证2 后对苏婉可见", () => {
  const state = createGameState(WUYE.participants);
  revealCluesForPhase(WUYE, state, "搜证1");
  expect(visibleInfoFor("苏婉", WUYE, state).some((i) => i.id === "C7")).toBe(false);
  revealCluesForPhase(WUYE, state, "搜证2");
  expect(visibleInfoFor("苏婉", WUYE, state).some((i) => i.id === "C7")).toBe(true);
  for (const other of ["林雅", "陈博"]) {
    expect(visibleInfoFor(other, WUYE, state).some((i) => i.id === "C7")).toBe(false);
  }
});
