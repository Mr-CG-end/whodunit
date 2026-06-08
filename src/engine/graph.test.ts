import { describe, expect, it } from "vitest";
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
