import { describe, expect, it } from "vitest";
import { stripStageDirections } from "./leak";

describe("stripStageDirections 旁白清洗", () => {
  it("剥掉（旁白）与*动作*", () => {
    expect(stripStageDirections("（擦汗）我没杀人*紧张*")).toBe("我没杀人");
  });
  it("半角括号同样剥掉", () => {
    expect(stripStageDirections("(整理领带)你好")).toBe("你好");
  });
  it("【方括号】内心戏也剥掉", () => {
    expect(stripStageDirections("【内心】我很慌")).toBe("我很慌");
  });
  it("「」引号是合法发言，不剥", () => {
    expect(stripStageDirections("「我是苏婉」")).toBe("「我是苏婉」");
  });
  it("整句都是旁白 → 剥成空串", () => {
    expect(stripStageDirections("（沉默不语）")).toBe("");
  });
});
