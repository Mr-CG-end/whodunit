import { describe, expect, it } from "vitest";
import type { DMSpeaker } from "./dm";
import { GameGraph } from "./graph";
import type { Participant } from "./participant";
import { stubParticipant } from "./participant";
import { WUYE } from "./scenario";

const stubs = () => WUYE.participants.map((id) => stubParticipant(id));

describe("GameGraph 阶段推进", () => {
  it("按 scenario.phases 顺序走完，不跳阶、不回退", async () => {
    const g = new GameGraph(WUYE, stubs());
    await g.runToEnd();
    const seq = g.state.publicEvents.filter((e) => e.type === "phase_change").map((e) => String(e.payload.phase));
    expect(seq).toEqual(WUYE.phases);
    expect(g.done()).toBe(true);
    expect(g.state.phase).toBe("复盘");
  });

  it("自我介绍 + 讨论 各阶段每个玩家发言一次（3 轮 × 3 人 = 9 条）", async () => {
    const g = new GameGraph(WUYE, stubs());
    await g.runToEnd();
    const utts = g.state.publicEvents.filter((e) => e.type === "utterance");
    expect(utts).toHaveLength(9);
  });

  it("喂给玩家的上下文不含他人秘密与真相（隔离在编排层成立）", async () => {
    const seen: Record<string, string[]> = { 林雅: [], 陈博: [], 苏婉: [] };
    const recorder = (id: string): Participant => ({
      id,
      async speak(ctx) {
        seen[id].push(ctx);
        return `${id}：（发言）`;
      },
      async vote(_ctx, candidates) {
        return candidates[0] ?? null;
      },
    });
    const g = new GameGraph(WUYE, [recorder("林雅"), recorder("陈博"), recorder("苏婉")]);
    await g.runToEnd();
    for (const ctx of seen.林雅) {
      expect(ctx).not.toContain("你就是凶手"); // 陈博的秘密
      expect(ctx).not.toContain("凶手是陈博"); // 真相
    }
    expect(seen.陈博.some((c) => c.includes("你就是凶手"))).toBe(true); // 自己的秘密对自己可见
  });
});

describe("GameGraph 搜证发线索", () => {
  it("线索按阶段发布，不提前", async () => {
    const g = new GameGraph(WUYE, stubs());
    while (!g.done() && g.state.phase !== "搜证1") await g.step();
    expect(g.state.revealedInfo.has("C1")).toBe(true); // 搜证1 线索已发
    expect(g.state.revealedInfo.has("C3")).toBe(false); // 搜证2 线索尚未发
  });

  it("跑完后各搜证阶段线索都已发布", async () => {
    const g = new GameGraph(WUYE, stubs());
    await g.runToEnd();
    for (const id of ["C1", "C2", "C5", "C4", "C3", "C6", "C8", "C9", "C7"]) {
      expect(g.state.revealedInfo.has(id)).toBe(true);
    }
  });
});

describe("GameGraph 投票计票", () => {
  it("收集投票、计票、产出唯一指认", async () => {
    const g = new GameGraph(WUYE, [
      stubParticipant("林雅", { voteFor: "陈博" }),
      stubParticipant("陈博", { voteFor: "苏婉" }),
      stubParticipant("苏婉", { voteFor: "陈博" }),
    ]);
    await g.runToEnd();
    expect(g.result).toEqual({ counts: { 陈博: 2, 苏婉: 1 }, accused: "陈博" });
    const ballots = g.state.publicEvents.filter((e) => e.type === "vote" && e.actor !== "engine");
    expect(ballots).toHaveLength(3);
  });

  it("平票时不强行裁决（accused = null）", async () => {
    const g = new GameGraph(WUYE, [
      stubParticipant("林雅", { voteFor: "陈博" }),
      stubParticipant("陈博", { voteFor: "林雅" }),
      stubParticipant("苏婉", { voteFor: null }),
    ]);
    await g.runToEnd();
    expect(g.result?.accused).toBe(null);
  });
});

describe("GameGraph 复盘揭真相", () => {
  it("复盘阶段把真相文本搬进公开公告", async () => {
    const g = new GameGraph(WUYE, stubs());
    await g.runToEnd();
    const reveal = g.state.publicEvents.find((e) => e.type === "clue_release" && e.payload.infoId === "truth");
    expect(reveal).toBeDefined();
    expect(String(reveal?.payload.text)).toContain("凶手是陈博");
  });
});

describe("GameGraph 永不崩盘", () => {
  it("玩家全部失败时整局仍跑完：发言降级、投票弃权", async () => {
    const g = new GameGraph(WUYE, [
      stubParticipant("林雅", { fail: true }),
      stubParticipant("陈博", { fail: true }),
      stubParticipant("苏婉", { fail: true }),
    ]);
    await expect(g.runToEnd()).resolves.toBeDefined(); // 不抛
    expect(g.done()).toBe(true);
    const utts = g.state.publicEvents.filter((e) => e.type === "utterance");
    expect(utts.length).toBeGreaterThan(0);
    expect(utts.every((e) => e.payload.text === "我再想想。")).toBe(true);
    expect(g.result?.accused).toBe(null); // 全弃权 → 无指认
  });
});

describe("GameGraph 输出校验闸", () => {
  it("旁白清洗后才入公开事件流", async () => {
    const g = new GameGraph(WUYE, [
      stubParticipant("林雅", { line: "（推了推眼镜）我没什么好说的。" }),
      stubParticipant("陈博"),
      stubParticipant("苏婉"),
    ]);
    await g.runToEnd();
    const mine = g.state.publicEvents.filter((e) => e.type === "utterance" && e.actor === "林雅");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.payload.text === "我没什么好说的。")).toBe(true);
  });

  it("泄密发言触发重说，原文绝不进事件流", async () => {
    let calls = 0;
    const leaky: Participant = {
      id: "陈博",
      async speak() {
        calls++;
        return calls === 1 ? "我怀疑苏婉昨晚给他下了安眠药。" : "我整夜都在自己房间。";
      },
      async vote() {
        return null;
      },
    };
    const g = new GameGraph(WUYE, [stubParticipant("林雅"), leaky, stubParticipant("苏婉")]);
    await g.runToEnd();
    const texts = g.state.publicEvents.filter((e) => e.type === "utterance").map((e) => String(e.payload.text));
    expect(texts.some((t) => t.includes("安眠药"))).toBe(false);
    expect(texts).toContain("我整夜都在自己房间。");
  });

  it("重说仍泄密 → 安全发言兜底（重试上限 2，共 3 次生成）", async () => {
    let calls = 0;
    const leaky: Participant = {
      id: "陈博",
      async speak() {
        calls++;
        return "人是我杀的。";
      },
      async vote() {
        return null;
      },
    };
    const g = new GameGraph(WUYE, [stubParticipant("林雅"), leaky, stubParticipant("苏婉")]);
    await g.runToEnd();
    const mine = g.state.publicEvents.filter((e) => e.type === "utterance" && e.actor === "陈博");
    expect(mine.every((e) => e.payload.text === "我再想想。")).toBe(true);
    expect(calls).toBe(9); // 3 个发言回合 × 3 次生成
  });

  it("清洗后为空视为无效输出，触发重说", async () => {
    let calls = 0;
    const silent: Participant = {
      id: "林雅",
      async speak() {
        calls++;
        return calls === 1 ? "（沉默不语）" : "我有话直说。";
      },
      async vote() {
        return null;
      },
    };
    const g = new GameGraph(WUYE, [silent, stubParticipant("陈博"), stubParticipant("苏婉")]);
    await g.runToEnd();
    const texts = g.state.publicEvents
      .filter((e) => e.type === "utterance" && e.actor === "林雅")
      .map((e) => String(e.payload.text));
    expect(texts[0]).toBe("我有话直说。");
    expect(calls).toBe(4); // 首回合空输出重说 1 次（2 次生成）+ 后两回合各 1 次
  });
});

describe("GameGraph DM 话术", () => {
  const recordingDM = (line = "各位请就座。") => {
    const calls: { ctx: string; instruction: string }[] = [];
    const dm: DMSpeaker = {
      async speak(ctx, instruction) {
        calls.push({ ctx, instruction });
        return line;
      },
    };
    return { dm, calls };
  };

  it("7 个非复盘阶段各一条开场白 + 1 条复盘词，actor 为 dm", async () => {
    const { dm } = recordingDM();
    const g = new GameGraph(WUYE, stubs(), dm);
    await g.runToEnd();
    const dmUtts = g.state.publicEvents.filter((e) => e.type === "utterance" && e.actor === "dm");
    expect(dmUtts).toHaveLength(8);
    expect(dmUtts.every((e) => e.payload.text === "各位请就座。")).toBe(true);
  });

  it("隔离铁律：ctx 永不含秘密/真相；只有复盘 instruction 含真相", async () => {
    const { dm, calls } = recordingDM();
    await new GameGraph(WUYE, stubs(), dm).runToEnd();
    for (const c of calls) {
      expect(c.ctx).not.toContain("你就是凶手");
      expect(c.ctx).not.toContain("凶手是陈博");
      expect(c.ctx).not.toContain("安眠药");
    }
    const recap = calls[calls.length - 1];
    expect(recap.instruction).toContain("凶手是陈博"); // truth 由上层显式递入
    for (const c of calls.slice(0, -1)) {
      expect(c.instruction).not.toContain("凶手是陈博");
    }
  });

  it("搜证 instruction 含 public 线索文本、不含 directed 内容", async () => {
    const { dm, calls } = recordingDM();
    await new GameGraph(WUYE, stubs(), dm).runToEnd();
    const sou1 = calls.find((c) => c.instruction.includes("搜证1"));
    expect(sou1).toBeDefined();
    expect(sou1?.instruction).toContain("青铜鼎上检出两组指纹"); // C2 public
    expect(sou1?.instruction).toContain("私下线索"); // C4 只宣布事实
    expect(sou1?.instruction).not.toContain("遗嘱副本是你拿走的"); // C4 内容不递给 DM
  });

  it("dm 抛错 → 无 dm 事件，整局照跑（降级=放弃不重试）", async () => {
    const failDM: DMSpeaker = {
      async speak() {
        throw new Error("dm down");
      },
    };
    const g = new GameGraph(WUYE, stubs(), failDM);
    await expect(g.runToEnd()).resolves.toBeDefined();
    expect(g.done()).toBe(true);
    expect(g.state.publicEvents.some((e) => e.actor === "dm")).toBe(false);
  });

  it("dm 话术泄密 → 该条放弃；线索公开后同样的话放行；复盘免检", async () => {
    const leakyDM: DMSpeaker = {
      async speak() {
        return "那尊鼎是赝品。"; // C6 的 alias，搜证2 才发布
      },
    };
    const g = new GameGraph(WUYE, stubs(), leakyDM);
    await g.runToEnd();
    const evs = g.state.publicEvents;
    const dmUtts = evs.filter((e) => e.type === "utterance" && e.actor === "dm");
    // 开场/自我介绍/搜证1/讨论1 被拦（C6 未发布）；搜证2/讨论2/投票放行 + 复盘词免检
    expect(dmUtts).toHaveLength(4);
    const c6Idx = evs.findIndex((e) => e.type === "clue_release" && e.payload.infoId === "C6");
    const firstDmIdx = evs.findIndex((e) => e.type === "utterance" && e.actor === "dm");
    expect(firstDmIdx).toBeGreaterThan(c6Idx);
  });

  it("dm 话术过旁白清洗", async () => {
    const { dm } = recordingDM("（清了清嗓子）天黑请闭眼……不，这是剧本杀。");
    const g = new GameGraph(WUYE, stubs(), dm);
    await g.runToEnd();
    const first = g.state.publicEvents.find((e) => e.type === "utterance" && e.actor === "dm");
    expect(String(first?.payload.text)).toBe("天黑请闭眼……不，这是剧本杀。");
  });
});
