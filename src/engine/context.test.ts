// 可见上下文不得含他人秘密 / 真相 / 未公开线索。
import { describe, expect, it } from "vitest";
import { publicContext, visibleContext } from "./context";
import { createGameState, type GameState } from "./models";
import { revealCluesForPhase } from "./release";
import { WUYE } from "./scenario";

function stateAfterSearch1(): GameState {
  const state = createGameState(WUYE.participants);
  revealCluesForPhase(WUYE, state, "搜证1");
  state.publicEvents.push({
    id: "u1",
    type: "utterance",
    actor: "陈博",
    visibility: "public",
    payload: { text: "我和周明远是多年老友。" },
  });
  return state;
}

it("含自己秘密与公开信息；不含他人秘密/真相/未来线索", () => {
  const ctx = visibleContext("林雅", WUYE, stateAfterSearch1());
  expect(ctx).toContain("遗嘱"); // 林雅自己的秘密
  expect(ctx).toContain("我和周明远是多年老友"); // 公开发言
  expect(ctx).toContain("C1"); // 已公开线索
  expect(ctx).not.toContain("你就是凶手"); // 陈博秘密
  expect(ctx).not.toContain("凶手是陈博"); // 真相
  expect(ctx).not.toContain("42 码"); // C3 属搜证2，尚未公开
});

it("定向线索只对收件人出现", () => {
  const state = stateAfterSearch1(); // C4 定向给林雅
  expect(visibleContext("林雅", WUYE, state)).toContain("遗嘱副本是你拿走的");
  expect(visibleContext("陈博", WUYE, state)).not.toContain("遗嘱副本是你拿走的");
});

describe("publicContext DM 视角", () => {
  it("含案情简介与已公开线索，不含未发布线索", () => {
    const s = createGameState(WUYE.participants);
    s.revealedInfo.add("C1");
    const ctx = publicContext(WUYE, s);
    expect(ctx).toContain("雨夜，收藏家周明远"); // caseIntro
    expect(ctx).toContain("法医报告"); // C1 已发布
    expect(ctx).not.toContain("42 码男鞋"); // C3 未发布
  });

  it("含公开发言", () => {
    const s = createGameState(WUYE.participants);
    s.publicEvents.push({
      id: "u1",
      type: "utterance",
      actor: "林雅",
      visibility: "public",
      payload: { text: "我整晚都在房间。" },
    });
    expect(publicContext(WUYE, s)).toContain("林雅：我整晚都在房间。");
  });

  it("永不含秘密、真相与定向线索——即使已投递（隔离铁律）", () => {
    const s = createGameState(WUYE.participants);
    for (const id of ["C1", "C2", "C5", "C4", "C3", "C6", "C8", "C9", "C7"]) s.revealedInfo.add(id);
    const ctx = publicContext(WUYE, s);
    expect(ctx).not.toContain("你就是凶手"); // 陈博的秘密
    expect(ctx).not.toContain("安眠药"); // 苏婉的秘密
    expect(ctx).not.toContain("凶手是陈博"); // 真相
    expect(ctx).not.toContain("遗嘱副本是你拿走的"); // C4 定向（已投递也不进 DM 视野）
  });
});
