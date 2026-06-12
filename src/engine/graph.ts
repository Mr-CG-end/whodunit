// GameGraph —— 手写确定性编排控制器（设计 §4 / docs/specs/2026-06-08-gamegraph-skeleton-design.md）。
// 把已有纯函数（visibility / release / context / tally）串成一局；玩家由 Participant 注入。
import { publicContext, visibleContext } from "./context";
import type { DMSpeaker } from "./dm";
import { detectDMLeak, detectLeak, stripStageDirections } from "./leak";
import { createGameState, type GameEvent, type GameState } from "./models";
import type { Participant } from "./participant";
import { revealCluesForPhase } from "./release";
import type { Scenario } from "./scenario";
import { majority, tallyVotes } from "./tally";

const SAFE_LINE = "我再想想。";

/** 每次发言最多生成 3 次：1 次原说 + 2 次重说（design §4，成本上界明确）。 */
const MAX_SPEAK_ATTEMPTS = 3;

type GraphStep =
  | { kind: "enterPhase"; phase: string }
  | { kind: "speak"; pid: string; instruction: string }
  | { kind: "vote"; pid: string }
  | { kind: "tally" }
  | { kind: "revealTruth" };

export interface VoteResult {
  counts: Record<string, number>;
  accused: string | null;
}

export class GameGraph {
  readonly state: GameState;
  private readonly scenario: Scenario;
  private readonly players: Map<string, Participant>;
  private readonly dm?: DMSpeaker;
  private readonly steps: GraphStep[];
  private cursor = 0;
  private votes: Record<string, string | null> = {};
  result: VoteResult | null = null;

  constructor(scenario: Scenario, participants: Participant[], dm?: DMSpeaker) {
    this.scenario = scenario;
    this.players = new Map(participants.map((p): [string, Participant] => [p.id, p]));
    this.dm = dm;
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
      } else if (phase === "复盘") {
        steps.push({ kind: "revealTruth" });
      }
    }
    return steps;
  }

  private async exec(s: GraphStep): Promise<void> {
    switch (s.kind) {
      case "enterPhase":
        await this.enterPhase(s.phase);
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
      case "revealTruth":
        await this.revealTruth();
        break;
    }
  }

  private async enterPhase(phase: string): Promise<void> {
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
    if (phase !== "复盘") await this.dmSay(this.dmInstruction(phase), /* checkLeak */ true);
  }

  /** 拼 DM 的主持指令：阶段名 + 要宣布的文本（开场=caseIntro；搜证=本阶段线索；directed 只给事实不给内容）。 */
  private dmInstruction(phase: string): string {
    const parts = [`现在进入「${phase}」阶段，请向玩家宣布。`];
    if (phase === "开场") parts.push(`请介绍案情：${this.scenario.caseIntro}`);
    if (phase.startsWith("搜证")) {
      for (const item of this.scenario.infoItems) {
        if (item.revealPhase !== phase) continue;
        if (item.scope === "public") parts.push(`请宣布新线索：${item.text}`);
        else if (item.scope === "directed")
          parts.push(`请宣布：${item.owners.join("、")}收到一条私下线索（内容保密，不要编造）。`);
      }
    }
    return parts.join("\n");
  }

  /** DM 话术：清洗→（可选）泄密检测→入流。任何一步不过=放弃，不重试——结构公告兜底（design 3b §5）。 */
  private async dmSay(instruction: string, checkLeak: boolean): Promise<void> {
    if (!this.dm) return;
    let raw: string;
    try {
      raw = await this.dm.speak(publicContext(this.scenario, this.state), instruction);
    } catch {
      return;
    }
    const cleaned = stripStageDirections(raw);
    if (cleaned === "") return;
    if (checkLeak && detectDMLeak(cleaned, this.scenario, this.state) !== null) return;
    this.push({
      id: `dm_${this.cursor}`,
      type: "utterance",
      actor: "dm",
      visibility: "public",
      payload: { text: cleaned },
    });
  }

  private async doSpeak(pid: string, instruction: string): Promise<void> {
    const ctx = visibleContext(pid, this.scenario, this.state);
    const player = this.players.get(pid);
    let line = SAFE_LINE;
    if (player) {
      for (let attempt = 0; attempt < MAX_SPEAK_ATTEMPTS; attempt++) {
        let raw: string;
        try {
          raw = await player.speak(ctx, instruction);
        } catch {
          break; // 抛错不在这层重试（网络重试在 LLMRouter），直接落安全发言
        }
        const cleaned = stripStageDirections(raw);
        // 重说不带"你泄密了"反馈：把泄密原因喂回去本身就是泄露面（design §4）
        if (cleaned !== "" && detectLeak(pid, cleaned, this.scenario, this.state) === null) {
          line = cleaned;
          break;
        }
      }
    }
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
      try {
        target = await player.vote(ctx, candidates);
      } catch {
        target = null;
      }
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

  private async revealTruth(): Promise<void> {
    const truths: string[] = [];
    for (const item of this.scenario.infoItems) {
      if (item.scope !== "omniscient") continue;
      truths.push(item.text);
      this.push({
        id: `reveal_${item.id}`,
        type: "clue_release",
        actor: "engine",
        visibility: "public",
        payload: { infoId: item.id, text: item.text },
      });
    }
    await this.dmSay(`真相已揭晓如下：\n${truths.join("\n")}\n请向各位玩家做复盘解说。`, /* checkLeak */ false);
  }

  private push(ev: GameEvent): void {
    this.state.publicEvents.push(ev);
  }
}
