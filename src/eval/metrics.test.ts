import { describe, expect, it } from "vitest";
import { GameGraph } from "../engine/graph";
import { stubParticipant } from "../engine/participant";
import { WUYE } from "../engine/scenario";
import { evalGame } from "./metrics";

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
