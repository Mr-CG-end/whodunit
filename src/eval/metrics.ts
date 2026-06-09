// eval 指标 —— 纯函数,从一局 GameState 算确定性指标（设计 §3）。不调 LLM。
import type { RouterStats } from "../engine/llm";
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

export interface GameRecord {
  metrics: GameMetrics;
  durationMs: number;
  stats: RouterStats;
}

export interface EvalSummary {
  games: number;
  completionRate: number;
  accuracyRate: number;
  sanityViolations: number;
  avgDurationMs: number;
  stats: RouterStats;
}

export function aggregate(records: GameRecord[]): EvalSummary {
  const games = records.length;
  const completed = records.filter((r) => r.metrics.completed);
  const correct = completed.filter((r) => r.metrics.accusedCorrect).length;
  const sanityViolations = records.filter((r) => !r.metrics.phaseSequenceValid || !r.metrics.voteFormatValid).length;
  const stats = records.reduce<RouterStats>(
    (acc, r) => ({
      callCount: acc.callCount + r.stats.callCount,
      promptTokens: acc.promptTokens + r.stats.promptTokens,
      completionTokens: acc.completionTokens + r.stats.completionTokens,
      cachePromptTokens: acc.cachePromptTokens + r.stats.cachePromptTokens,
      totalLatencyMs: acc.totalLatencyMs + r.stats.totalLatencyMs,
    }),
    { callCount: 0, promptTokens: 0, completionTokens: 0, cachePromptTokens: 0, totalLatencyMs: 0 },
  );
  return {
    games,
    completionRate: games ? completed.length / games : 0,
    accuracyRate: completed.length ? correct / completed.length : 0,
    sanityViolations,
    avgDurationMs: games ? records.reduce((s, r) => s + r.durationMs, 0) / games : 0,
    stats,
  };
}
