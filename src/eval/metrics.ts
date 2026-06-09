// eval 指标 —— 纯函数,从一局 GameState 算确定性指标（设计 §3）。不调 LLM。
import type { GameState } from "../engine/models";
import type { Scenario } from "../engine/scenario";

export interface GameMetrics {
  completed: boolean;
  accused: string | null;
  accusedCorrect: boolean;
  phaseSequenceValid: boolean;
  voteFormatValid: boolean;
}

export function evalGame(state: GameState, scenario: Scenario): GameMetrics {
  const phaseSeq = state.publicEvents.filter((e) => e.type === "phase_change").map((e) => String(e.payload.phase));
  const phaseSequenceValid =
    phaseSeq.length === scenario.phases.length && phaseSeq.every((p, i) => p === scenario.phases[i]);

  const resultEvent = state.publicEvents.find((e) => e.type === "vote" && e.actor === "engine");
  const accused = resultEvent ? ((resultEvent.payload.accused as string | null) ?? null) : null;

  const ballots = state.publicEvents.filter((e) => e.type === "vote" && e.actor !== "engine");
  const voteFormatValid =
    ballots.length === scenario.participants.length &&
    ballots.every((e) => {
      const t = e.payload.target as string | null;
      return t === null || scenario.participants.includes(t);
    });

  const lastPhase = scenario.phases[scenario.phases.length - 1];
  const completed = state.phase === lastPhase && resultEvent !== undefined;
  const accusedCorrect = accused === scenario.killer;

  return { completed, accused, accusedCorrect, phaseSequenceValid, voteFormatValid };
}
