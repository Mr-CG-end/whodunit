import { describe, expect, it } from "vitest";
import { GameGraph } from "../engine/graph";
import { stubParticipant } from "../engine/participant";
import { WUYE } from "../engine/scenario";
import { aggregate, evalGame, type GameRecord } from "./metrics";

describe("evalGame", () => {
  it("完整一局：completed + 指认正确判定（真凶 陈博）", async () => {
    const g = new GameGraph(
      WUYE,
      WUYE.participants.map((id) => stubParticipant(id, { voteFor: "陈博" })),
    );
    await g.runToEnd();
    const m = evalGame(g.state, WUYE);
    expect(m.completed).toBe(true);
    expect(m.accused).toBe("陈博");
    expect(m.accusedCorrect).toBe(true);
    expect(m.phaseSequenceValid).toBe(true);
    expect(m.voteFormatValid).toBe(true);
  });

  it("多数指认错误时 accusedCorrect=false", async () => {
    const g = new GameGraph(WUYE, [
      stubParticipant("林雅", { voteFor: "苏婉" }),
      stubParticipant("陈博", { voteFor: "苏婉" }),
      stubParticipant("苏婉", { voteFor: "林雅" }),
    ]);
    await g.runToEnd();
    const m = evalGame(g.state, WUYE);
    expect(m.accused).toBe("苏婉");
    expect(m.accusedCorrect).toBe(false);
  });

  it("阶段序列不全时 phaseSequenceValid=false", async () => {
    const g = new GameGraph(
      WUYE,
      WUYE.participants.map((id) => stubParticipant(id)),
    );
    await g.runToEnd();
    g.state.publicEvents = g.state.publicEvents.filter(
      (e) => !(e.type === "phase_change" && e.payload.phase === "投票"),
    );
    expect(evalGame(g.state, WUYE).phaseSequenceValid).toBe(false);
  });
});

const rec = (over: Partial<GameRecord["metrics"]>, durationMs: number, callCount: number): GameRecord => ({
  metrics: {
    completed: true,
    accused: "陈博",
    accusedCorrect: true,
    phaseSequenceValid: true,
    voteFormatValid: true,
    ...over,
  },
  durationMs,
  stats: { callCount, promptTokens: 10, completionTokens: 5, cachePromptTokens: 2, totalLatencyMs: durationMs },
});

describe("aggregate", () => {
  it("聚合完成率/正确率/性能", () => {
    const s = aggregate([
      rec({}, 1000, 12),
      rec({ accusedCorrect: false }, 2000, 12),
      rec({ completed: false, accusedCorrect: false }, 500, 3),
    ]);
    expect(s.games).toBe(3);
    expect(s.completionRate).toBeCloseTo(2 / 3);
    expect(s.accuracyRate).toBeCloseTo(1 / 2); // 完成 2 局里 1 局对
    expect(s.avgDurationMs).toBeCloseTo((1000 + 2000 + 500) / 3);
    expect(s.stats.callCount).toBe(27);
    expect(s.stats.promptTokens).toBe(30);
  });

  it("sanity 违反计数", () => {
    const s = aggregate([rec({ voteFormatValid: false }, 1000, 12), rec({}, 1000, 12)]);
    expect(s.sanityViolations).toBe(1);
  });
});
