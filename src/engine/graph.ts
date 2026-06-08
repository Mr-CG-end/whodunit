// GameGraph —— 手写确定性编排控制器（设计 §4 / docs/specs/2026-06-08-gamegraph-skeleton-design.md）。
// 把已有纯函数（visibility / release / context / tally）串成一局；玩家由 Participant 注入。
import { visibleContext } from "./context";
import { createGameState, type GameEvent, type GameState } from "./models";
import type { Participant } from "./participant";
import { revealCluesForPhase } from "./release";
import type { Scenario } from "./scenario";
import { majority, tallyVotes } from "./tally";

type GraphStep =
  | { kind: "enterPhase"; phase: string }
  | { kind: "speak"; pid: string; instruction: string }
  | { kind: "vote"; pid: string }
  | { kind: "tally" };

export interface VoteResult {
  counts: Record<string, number>;
  accused: string | null;
}

export class GameGraph {
  readonly state: GameState;
  private readonly scenario: Scenario;
  private readonly players: Map<string, Participant>;
  private readonly steps: GraphStep[];
  private cursor = 0;
  private votes: Record<string, string | null> = {};
  result: VoteResult | null = null;

  constructor(scenario: Scenario, participants: Participant[]) {
    this.scenario = scenario;
    this.players = new Map(participants.map((p): [string, Participant] => [p.id, p]));
    this.state = createGameState(scenario.participants);
    this.steps = this.plan();
  }

  done(): boolean {
    return this.cursor >= this.steps.length;
  }

  async step(): Promise<GameState> {
    if (this.done()) return this.state;
    const current = this.steps[this.cursor++];
    await this.exec(current);
    return this.state;
  }

  async runToEnd(): Promise<GameState> {
    while (!this.done()) await this.step();
    return this.state;
  }

  private plan(): GraphStep[] {
    const steps: GraphStep[] = [];
    for (const phase of this.scenario.phases) {
      steps.push({ kind: "enterPhase", phase });
      if (phase === "自我介绍") {
        for (const pid of this.scenario.participants) {
          steps.push({ kind: "speak", pid, instruction: "请做自我介绍。" });
        }
      } else if (phase.startsWith("讨论")) {
        for (const pid of this.scenario.participants) {
          steps.push({ kind: "speak", pid, instruction: "请就目前线索发言。" });
        }
      } else if (phase === "投票") {
        for (const pid of this.scenario.participants) {
          steps.push({ kind: "vote", pid });
        }
        steps.push({ kind: "tally" });
      }
    }
    return steps;
  }

  private async exec(s: GraphStep): Promise<void> {
    switch (s.kind) {
      case "enterPhase":
        this.enterPhase(s.phase);
        break;
      case "speak":
        await this.doSpeak(s.pid, s.instruction);
        break;
      case "vote":
        await this.doVote(s.pid);
        break;
      case "tally":
        this.doTally();
        break;
    }
  }

  private enterPhase(phase: string): void {
    this.state.phase = phase;
    this.push({
      id: `phase_${phase}`,
      type: "phase_change",
      actor: "engine",
      visibility: "public",
      payload: { phase },
    });
    if (phase.startsWith("搜证")) {
      revealCluesForPhase(this.scenario, this.state, phase);
    }
  }

  private async doSpeak(pid: string, instruction: string): Promise<void> {
    const ctx = visibleContext(pid, this.scenario, this.state);
    const player = this.players.get(pid);
    if (!player) return;
    const line = await player.speak(ctx, instruction);
    this.push({
      id: `utt_${pid}_${this.cursor}`,
      type: "utterance",
      actor: pid,
      visibility: "public",
      payload: { text: line },
    });
  }

  private async doVote(pid: string): Promise<void> {
    const ctx = visibleContext(pid, this.scenario, this.state);
    const candidates = this.scenario.participants.filter((p) => p !== pid);
    const player = this.players.get(pid);
    let target: string | null = null;
    if (player) {
      target = await player.vote(ctx, candidates);
    }
    if (target !== null && !candidates.includes(target)) target = null;
    this.votes[pid] = target;
    this.push({ id: `vote_${pid}`, type: "vote", actor: pid, visibility: "public", payload: { target } });
  }

  private doTally(): void {
    const counts = tallyVotes(this.votes);
    const accused = majority(this.votes);
    this.result = { counts, accused };
    this.push({ id: "vote_result", type: "vote", actor: "engine", visibility: "public", payload: { counts, accused } });
  }

  private push(ev: GameEvent): void {
    this.state.publicEvents.push(ev);
  }
}
