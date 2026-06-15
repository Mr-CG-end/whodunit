// 剧本注册表 + --scenario 选择 —— 设计 §5。确定性。
import { describe, expect, it } from "vitest";
import { WUYE } from "./scenario";
import { SHENYUAN } from "./scenario-shenyuan";
import { selectScenario } from "./scenarios";

describe("selectScenario", () => {
  it("无 --scenario 时默认 wuye", () => {
    expect(selectScenario([])).toBe(WUYE);
  });

  it("--scenario=shenyuan 选难本一号", () => {
    expect(selectScenario(["--scenario=shenyuan"])).toBe(SHENYUAN);
  });

  it("--scenario=wuye 选冒烟剧本", () => {
    expect(selectScenario(["node", "play.ts", "--scenario=wuye"])).toBe(WUYE);
  });

  it("未知剧本名抛错（含可选项提示）", () => {
    expect(() => selectScenario(["--scenario=nope"])).toThrow(/nope/);
  });
});
