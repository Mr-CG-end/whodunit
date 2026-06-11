import { describe, expect, it } from "vitest";
import { detectLeak, stripStageDirections } from "./leak";
import { createGameState } from "./models";
import { WUYE } from "./scenario";

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
  it("半角方括号同样剥掉", () => {
    expect(stripStageDirections("[内心]我很慌")).toBe("我很慌");
  });
  it("「」引号是合法发言，不剥", () => {
    expect(stripStageDirections("「我是苏婉」")).toBe("「我是苏婉」");
  });
  it("整句都是旁白 → 剥成空串", () => {
    expect(stripStageDirections("（沉默不语）")).toBe("");
  });
});

/** 造一个已发布指定线索的对局状态。 */
const stateWith = (...revealed: string[]) => {
  const s = createGameState(WUYE.participants);
  for (const id of revealed) s.revealedInfo.add(id);
  return s;
};

describe("detectLeak 不可见信息规则", () => {
  it("说出别人的秘密 → 命中该秘密", () => {
    expect(detectLeak("陈博", "我怀疑苏婉给他下了安眠药。", WUYE, stateWith())).toBe("secret_苏婉");
  });
  it("自己的秘密对自己可见 → 不触发", () => {
    expect(detectLeak("苏婉", "我给过他安眠药，常规剂量吃不死人。", WUYE, stateWith())).toBe(null);
  });
  it("提前说出未发布的线索 → 命中该线索", () => {
    expect(detectLeak("林雅", "那尊鼎是仿品。", WUYE, stateWith())).toBe("C6");
  });
  it("线索发布后同样的话放行（禁止集合随 revealedInfo 动态收缩）", () => {
    expect(detectLeak("林雅", "那尊鼎是仿品。", WUYE, stateWith("C6"))).toBe(null);
  });
  it("基于公开线索的合法指认不误伤", () => {
    expect(
      detectLeak("林雅", "我认为凶手是陈博，湿皮鞋说明他出过房间。", WUYE, stateWith("C3", "C6", "C8", "C9")),
    ).toBe(null);
  });
});

describe("detectLeak 凶手自爆规则", () => {
  it("凶手说出认罪短语 → self_bury", () => {
    expect(detectLeak("陈博", "对不起，人是我杀的。", WUYE, stateWith())).toBe("self_bury");
  });
  it("非凶手说同样的话不触发", () => {
    expect(detectLeak("林雅", "对不起，人是我杀的。", WUYE, stateWith())).toBe(null);
  });
  it("凶手正常否认放行", () => {
    expect(detectLeak("陈博", "我没杀人，我整夜都在房间里。", WUYE, stateWith())).toBe(null);
  });
});

describe("detectLeak 凶手辩护不误伤", () => {
  it("否认句放行：人不是我杀的", () => {
    expect(detectLeak("陈博", "人不是我杀的。", WUYE, stateWith())).toBe(null);
  });
  it("假设句放行：如果我杀了人", () => {
    expect(detectLeak("陈博", "如果我杀了人，何必留在山庄？", WUYE, stateWith())).toBe(null);
  });
  it("转述/反问放行：你们觉得是我杀的吗", () => {
    expect(detectLeak("陈博", "你们觉得是我杀的吗？拿出证据来。", WUYE, stateWith())).toBe(null);
  });
  it("部分承认放行：承认卖鼎不等于认罪", () => {
    expect(detectLeak("陈博", "我承认是我卖的鼎，但我没有杀人。", WUYE, stateWith())).toBe(null);
  });
  it("真认罪仍拦：失手自白", () => {
    expect(detectLeak("陈博", "是我失手打死了他。", WUYE, stateWith())).toBe("self_bury");
  });
});

describe("detectLeak 剧本内合法发言不误伤（线索 aliases 调参）", () => {
  it("凶手的剧本口供放行：整夜没出过房间", () => {
    expect(detectLeak("陈博", "我整夜没出过房间。", WUYE, stateWith())).toBe(null);
  });
  it("苏婉的剧本动作放行：建议送鉴定", () => {
    expect(detectLeak("苏婉", "我建议把那尊鼎送去鉴定一下来历。", WUYE, stateWith())).toBe(null);
  });
  it("常识侦探话术放行：查脚印/指纹", () => {
    expect(detectLeak("林雅", "窗外泥地说不定留有脚印，再查查鼎上的指纹。", WUYE, stateWith())).toBe(null);
  });
});

describe("detectLeak 新增秘密 aliases 正向命中", () => {
  it("别人提遗嘱副本 → 命中林雅秘密", () => {
    expect(detectLeak("苏婉", "遗嘱副本是不是被人拿走了？", WUYE, stateWith())).toBe("secret_林雅");
  });
  it("别人提 00:40 → 命中林雅秘密", () => {
    expect(detectLeak("陈博", "林雅 00:40 是不是进过书房？", WUYE, stateWith())).toBe("secret_林雅");
  });
  it("别人提 00:20 → 命中陈博秘密", () => {
    expect(detectLeak("林雅", "00:20 你在哪里？", WUYE, stateWith())).toBe("secret_陈博");
  });
});
