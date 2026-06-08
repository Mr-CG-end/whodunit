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
