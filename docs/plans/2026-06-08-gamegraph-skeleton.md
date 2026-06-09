# GameGraph 确定性编排骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手写一个确定性控制器 `GameGraph`，把已有纯函数（visibility / release / context / tally）串成完整一局——开场到复盘，期间确定性地发线索、组织发言轮、计票、揭真相；玩家用确定性 stub 注入，全程不接 LLM。

**Architecture:** `GameGraph` 构造时把整局展开成一个确定性的 `GraphStep[]` 队列；`step()` 弹出并执行一个最小步（进入阶段 / 一次发言 / 一次投票 / 计票 / 揭真相），原地 mutate 并返回同一 `GameState`；`runToEnd()` 循环调 `step()` 到结束。玩家由 `Participant` 接口注入，本切片只实现确定性 `StubParticipant`。

**Tech Stack:** TypeScript (strict) · Vitest · Biome。命令：`npm test`（全部）· `npx vitest run <file>`（单文件）· `npm run typecheck` · `npm run check` / `npm run check:fix`。

**设计依据:** [docs/specs/2026-06-08-gamegraph-skeleton-design.md](../specs/2026-06-08-gamegraph-skeleton-design.md)。已确认决策：step+runToEnd 双原语 / 原地 mutate / 复盘确定性搬运 truth.text / 每人发言一圈 / 不预留 LeakDetector·Memory 钩子。

---

## File Structure

- **Create** `src/engine/participant.ts` — `Participant` 接口 + `stubParticipant()` 工厂（确定性假玩家）。一个职责：定义"参与者"的统一契约并给确定性实现。
- **Create** `src/engine/participant.test.ts` — stub 行为测试。
- **Create** `src/engine/graph.ts` — `GameGraph` 类（`step` / `runToEnd` / `done`）+ 内部 `GraphStep` 队列。一个职责：确定性编排。
- **Create** `src/engine/graph.test.ts` — 编排不变量测试（阶段顺序 / 发线索时机 / 隔离 / 计票 / 真相 / 降级）。

`graph.ts` 在 Task 2→6 间逐步长出方法；每个任务给出当前完整的相关代码块，照抄替换即可。

---

## Task 1: Participant 抽象 + StubParticipant

**Files:**
- Create: `src/engine/participant.ts`
- Test: `src/engine/participant.test.ts`

- [ ] **Step 1: 写失败测试**

`src/engine/participant.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stubParticipant } from "./participant";

describe("stubParticipant", () => {
  it("speak 默认返回带 id 的占位发言", async () => {
    const p = stubParticipant("林雅");
    expect(await p.speak("ctx", "请发言")).toBe("林雅：（发言）");
  });

  it("speak 可指定固定台词", async () => {
    const p = stubParticipant("林雅", { line: "我没去过书房。" });
    expect(await p.speak("ctx", "请发言")).toBe("我没去过书房。");
  });

  it("vote 默认投候选列表第一个", async () => {
    const p = stubParticipant("林雅");
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe("陈博");
  });

  it("vote 可指定对象，传 null 则弃权", async () => {
    expect(await stubParticipant("林雅", { voteFor: "苏婉" }).vote("ctx", ["陈博", "苏婉"])).toBe("苏婉");
    expect(await stubParticipant("林雅", { voteFor: null }).vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });

  it("fail=true 时 speak / vote 都抛错（供降级测试用）", async () => {
    const p = stubParticipant("林雅", { fail: true });
    await expect(p.speak("ctx", "请发言")).rejects.toThrow();
    await expect(p.vote("ctx", ["陈博"])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/participant.test.ts`
Expected: FAIL —— `Failed to resolve import "./participant"` / `stubParticipant is not a function`。

- [ ] **Step 3: 写实现**

`src/engine/participant.ts`:

```ts
// 参与者抽象 —— 设计 §3/§4。未来 AIParticipant / HumanParticipant 都实现这个接口；
// 本切片只实现确定性 StubParticipant，用来在不接 LLM 的情况下驱动 GameGraph。

export interface Participant {
  id: string;
  /** 轮到发言：拿可见上下文文本 + 指令，返回发言。 */
  speak(ctx: string, instruction: string): Promise<string>;
  /** 投票：拿可见上下文 + 候选人列表，返回被投者 id 或 null（弃权）。 */
  vote(ctx: string, candidates: string[]): Promise<string | null>;
}

export interface StubOptions {
  /** 发言固定文本；省略则用 `${id}：（发言）`。 */
  line?: string;
  /** 投给谁；省略则投候选列表第一个，传 null 则弃权。 */
  voteFor?: string | null;
  /** true 时 speak / vote 都抛错，用于测试 GameGraph 的降级。 */
  fail?: boolean;
}

/** 确定性假玩家。 */
export function stubParticipant(id: string, opts: StubOptions = {}): Participant {
  return {
    id,
    async speak(_ctx, _instruction) {
      if (opts.fail) throw new Error(`stub ${id} speak failed`);
      return opts.line ?? `${id}：（发言）`;
    },
    async vote(_ctx, candidates) {
      if (opts.fail) throw new Error(`stub ${id} vote failed`);
      if (opts.voteFor !== undefined) return opts.voteFor;
      return candidates[0] ?? null;
    },
  };
}
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/participant.test.ts`
Expected: check 无 error、typecheck 无输出、测试 5 个 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/engine/participant.ts src/engine/participant.test.ts
git commit -m "feat: Participant 抽象 + StubParticipant" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: GameGraph 阶段推进 + 发言轮 + 信息隔离

把整局展开成 `GraphStep[]`，实现 `step`/`runToEnd`/`done`、`enterPhase`（写 `phase_change`）、`doSpeak`（每人发言、喂的是 `visibleContext` 产物）。**本任务 `doSpeak` 不含 try/catch**——降级留到 Task 6。

**Files:**
- Create: `src/engine/graph.ts`
- Test: `src/engine/graph.test.ts`

- [ ] **Step 1: 写失败测试**

`src/engine/graph.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/graph.test.ts`
Expected: FAIL —— `Failed to resolve import "./graph"`。

- [ ] **Step 3: 写实现**

`src/engine/graph.ts`:

```ts
// GameGraph —— 手写确定性编排控制器（设计 §4 / docs/specs/2026-06-08-gamegraph-skeleton-design.md）。
// 把已有纯函数（visibility / release / context / tally）串成一局；玩家由 Participant 注入。
import { visibleContext } from "./context";
import { createGameState, type GameEvent, type GameState } from "./models";
import type { Participant } from "./participant";
import type { Scenario } from "./scenario";

type GraphStep = { kind: "enterPhase"; phase: string } | { kind: "speak"; pid: string; instruction: string };

export class GameGraph {
  readonly state: GameState;
  private readonly scenario: Scenario;
  private readonly players: Map<string, Participant>;
  private readonly steps: GraphStep[];
  private cursor = 0;

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
    }
  }

  private enterPhase(phase: string): void {
    this.state.phase = phase;
    this.push({ id: `phase_${phase}`, type: "phase_change", actor: "engine", visibility: "public", payload: { phase } });
  }

  private async doSpeak(pid: string, instruction: string): Promise<void> {
    const ctx = visibleContext(pid, this.scenario, this.state);
    const player = this.players.get(pid);
    if (!player) return;
    const line = await player.speak(ctx, instruction);
    this.push({ id: `utt_${pid}_${this.cursor}`, type: "utterance", actor: pid, visibility: "public", payload: { text: line } });
  }

  private push(ev: GameEvent): void {
    this.state.publicEvents.push(ev);
  }
}
```

> 注：`SAFE_LINE` 常量到 Task 6 引入降级时才加（提前声明会被 Biome 判未用变量、`npm run check` 报错）。本任务 `doSpeak` 走 `if (!player) return` 的裸路径，故意不兜底——降级的红→绿留给 Task 6。

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/graph.test.ts`
Expected: 全部通过（3 个测试 PASS）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/graph.ts src/engine/graph.test.ts
git commit -m "feat: GameGraph 阶段推进 + 发言轮 + 信息隔离" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 搜证阶段确定性发线索

进入"搜证N"阶段时调 `revealCluesForPhase`，按 `revealPhase` 发线索、不提前。

**Files:**
- Modify: `src/engine/graph.ts`（`enterPhase` 加发线索 + import）
- Test: `src/engine/graph.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `src/engine/graph.test.ts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/graph.test.ts -t "搜证发线索"`
Expected: FAIL —— `revealedInfo.has("C1")` 为 `false`（线索还没被发）。

- [ ] **Step 3: 写实现**

在 `src/engine/graph.ts` 顶部 import 区加入：

```ts
import { revealCluesForPhase } from "./release";
```

把 `enterPhase` 整个替换为：

```ts
  private enterPhase(phase: string): void {
    this.state.phase = phase;
    this.push({ id: `phase_${phase}`, type: "phase_change", actor: "engine", visibility: "public", payload: { phase } });
    if (phase.startsWith("搜证")) {
      revealCluesForPhase(this.scenario, this.state, phase);
    }
  }
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/graph.test.ts`
Expected: 全部 PASS（含先前 3 个 + 新增 2 个）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/graph.ts src/engine/graph.test.ts
git commit -m "feat: GameGraph 搜证阶段确定性发线索" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 投票与计票

投票阶段每人投一票、写公开 `vote` 事件，之后 `tally` 用 `tallyVotes`/`majority` 结算到 `result`。引入 `votes` / `result` 字段。**`doVote` 本任务不含 try/catch**（降级留 Task 6）。

**Files:**
- Modify: `src/engine/graph.ts`
- Test: `src/engine/graph.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `src/engine/graph.test.ts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/graph.test.ts -t "投票计票"`
Expected: FAIL —— `g.result` 为 `undefined`（投票阶段还没做事）。

- [ ] **Step 3: 写实现**

在 `src/engine/graph.ts` import 区加入：

```ts
import { majority, tallyVotes } from "./tally";
```

在文件顶部（`GraphStep` 定义附近）加入结果类型：

```ts
export interface VoteResult {
  counts: Record<string, number>;
  accused: string | null;
}
```

把 `GraphStep` 整个替换为（新增 `vote` / `tally`）：

```ts
type GraphStep =
  | { kind: "enterPhase"; phase: string }
  | { kind: "speak"; pid: string; instruction: string }
  | { kind: "vote"; pid: string }
  | { kind: "tally" };
```

在 class 字段区（`private cursor = 0;` 下面）新增：

```ts
  private votes: Record<string, string | null> = {};
  result: VoteResult | null = null;
```

把 `plan()` 整个替换为（投票阶段展开成逐人 `vote` + 末尾 `tally`）：

```ts
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
```

把 `exec()` 整个替换为（新增 `vote` / `tally` 分支）：

```ts
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
```

在 `doSpeak` 后新增 `doVote` / `doTally`：

```ts
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
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/graph.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/engine/graph.ts src/engine/graph.test.ts
git commit -m "feat: GameGraph 投票与计票" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 复盘揭真相

复盘阶段确定性地把 `omniscient` 信息（真相）的文本搬进一条公开公告事件。不经 LLM。

**Files:**
- Modify: `src/engine/graph.ts`
- Test: `src/engine/graph.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `src/engine/graph.test.ts` 末尾追加：

```ts
describe("GameGraph 复盘揭真相", () => {
  it("复盘阶段把真相文本搬进公开公告", async () => {
    const g = new GameGraph(WUYE, stubs());
    await g.runToEnd();
    const reveal = g.state.publicEvents.find((e) => e.type === "clue_release" && e.payload.infoId === "truth");
    expect(reveal).toBeDefined();
    expect(String(reveal?.payload.text)).toContain("凶手是陈博");
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/graph.test.ts -t "复盘揭真相"`
Expected: FAIL —— `reveal` 为 `undefined`（真相还没被揭）。

- [ ] **Step 3: 写实现**

把 `GraphStep` 整个替换为（新增 `revealTruth`）：

```ts
type GraphStep =
  | { kind: "enterPhase"; phase: string }
  | { kind: "speak"; pid: string; instruction: string }
  | { kind: "vote"; pid: string }
  | { kind: "tally" }
  | { kind: "revealTruth" };
```

在 `plan()` 的 `else if (phase === "投票")` 块之后、`}` 之前，加入复盘分支：

```ts
      } else if (phase === "复盘") {
        steps.push({ kind: "revealTruth" });
      }
```

在 `exec()` 的 switch 内、`case "tally"` 之后加入：

```ts
      case "revealTruth":
        this.revealTruth();
        break;
```

在 `doTally` 后新增 `revealTruth`：

```ts
  private revealTruth(): void {
    for (const item of this.scenario.infoItems) {
      if (item.scope !== "omniscient") continue;
      this.push({
        id: `reveal_${item.id}`,
        type: "clue_release",
        actor: "engine",
        visibility: "public",
        payload: { infoId: item.id, text: item.text },
      });
    }
  }
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/graph.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/engine/graph.ts src/engine/graph.test.ts
git commit -m "feat: GameGraph 复盘揭真相" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 永不崩盘降级

参与者 `speak`/`vote` 抛错时不让整局崩：`speak` 失败 → 安全模板；`vote` 失败 → 弃权。给 `doSpeak`/`doVote` 包 try/catch，引入 `SAFE_LINE`。

**Files:**
- Modify: `src/engine/graph.ts`
- Test: `src/engine/graph.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `src/engine/graph.test.ts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/graph.test.ts -t "永不崩盘"`
Expected: FAIL —— `runToEnd` 抛出 `stub 林雅 speak failed`（裸 await 未兜底）。

- [ ] **Step 3: 写实现**

在 `src/engine/graph.ts` 顶部加入常量（import 区下方）：

```ts
const SAFE_LINE = "我再想想。";
```

把 `doSpeak` 整个替换为：

```ts
  private async doSpeak(pid: string, instruction: string): Promise<void> {
    const ctx = visibleContext(pid, this.scenario, this.state);
    const player = this.players.get(pid);
    let line = SAFE_LINE;
    if (player) {
      try {
        line = await player.speak(ctx, instruction);
      } catch {
        line = SAFE_LINE;
      }
    }
    this.push({ id: `utt_${pid}_${this.cursor}`, type: "utterance", actor: pid, visibility: "public", payload: { text: line } });
  }
```

把 `doVote` 整个替换为：

```ts
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
```

- [ ] **Step 4: 全量验证**

Run: `npm run check:fix && npm run typecheck && npm test`
Expected: Biome 无 error、typecheck 无输出、**全部测试 PASS**（含 T1–T7 旧测试 + 本切片新测试）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/graph.ts src/engine/graph.test.ts
git commit -m "feat: GameGraph 永不崩盘降级" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完成定义（对照设计 §7 TDD 不变量清单）

切片完成需同时满足：

1. ✅ 阶段序列 == `scenario.phases`，不跳阶、不回退（Task 2）。
2. ✅ 各搜证阶段线索按 `revealPhase` 发布、不提前、不遗漏（Task 3）。
3. ✅ 投票产出合法 `vote` 事件，计票 / 指认走 `tallyVotes` / `majority`（Task 4）。
4. ✅ 喂给每个玩家的 `ctx` 不含他人秘密 / 真相 / 未公开线索（Task 2）。
5. ✅ 注入失败 stub，整局仍完整跑完，失败回合产出安全发言 / 弃权（Task 6）。
6. ✅ 复盘确定性搬运 `truth.text`（Task 5）。

最终：`npm test` 全绿 + `npm run typecheck` 干净 + `npm run check` 无 error。
