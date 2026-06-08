// VisibilityGate 不变量 —— 设计文档 §8 第 1 层「最重要、必须稳过」的确定性测试。
import { expect, it } from "vitest";
import { createGameState, type GameState } from "./models";
import { WUYE } from "./scenario";
import { visibleInfoFor } from "./visibility";

function stateWith(revealed: string[] = []): GameState {
  const s = createGameState(WUYE.participants);
  s.revealedInfo = new Set(revealed);
  return s;
}

function visibleIds(pid: string, state: GameState): Set<string> {
  return new Set(visibleInfoFor(pid, WUYE, state).map((i) => i.id));
}

it("每人看得到自己的秘密；永远看不到别人的秘密或真相", () => {
  const state = stateWith(["C1", "C2", "C5"]);
  for (const pid of WUYE.participants) {
    const seen = visibleIds(pid, state);
    expect(seen.has(`secret_${pid}`)).toBe(true);
    for (const other of WUYE.participants) {
      if (other !== pid) expect(seen.has(`secret_${other}`)).toBe(false);
    }
    expect(seen.has("truth")).toBe(false);
  }
});

it("公开线索只有已公布后才可见", () => {
  const empty = stateWith([]);
  for (const pid of WUYE.participants) {
    expect(visibleInfoFor(pid, WUYE, empty).some((i) => i.scope === "public")).toBe(false);
  }
  const after = stateWith(["C1"]);
  const seen = visibleIds("林雅", after);
  expect(seen.has("C1")).toBe(true);
  expect(seen.has("C3")).toBe(false); // 搜证2，尚未公布
});

it("定向线索须 owner 且已发布（受 revealPhase 约束）", () => {
  const empty = stateWith([]);
  for (const pid of WUYE.participants) {
    expect(visibleIds(pid, empty).has("C4")).toBe(false); // 未发布 → 对谁都不可见
  }
  const after = stateWith(["C4"]);
  expect(visibleIds("林雅", after).has("C4")).toBe(true);
  for (const other of ["陈博", "苏婉"]) {
    expect(visibleIds(other, after).has("C4")).toBe(false);
  }
});

it("未来阶段的线索绝不可见", () => {
  const state = stateWith(["C1", "C2", "C5", "C4"]); // 只发布搜证1那批
  const future = ["C3", "C6", "C8", "C9", "C7"]; // 搜证2 那批（含定向 C7）
  for (const pid of WUYE.participants) {
    const seen = visibleIds(pid, state);
    for (const f of future) expect(seen.has(f)).toBe(false);
    expect(seen.has("truth")).toBe(false);
  }
});
