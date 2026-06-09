# eval 台 Implementation Plan（Phase 1 子项目2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 跑 K 局全自动对局,对每局算确定性指标(完成率/指认正确率/结构 sanity)、聚合成数字表、存档 transcript;给 `LLMRouter` 加 `stats()` 统计性能/成本/缓存。

**Architecture:** `metrics.ts` 纯函数从一局 `GameState` 算单局指标 + 聚合(确定性,TDD);`LLMRouter` 内部累积 usage/计时、暴露 `stats()`(`complete` 签名不变);`run.ts` 跑 K 局真实 LLM、调 metrics、聚合、打印表、存 `eval-runs/`(手动,不单测)。

**Tech Stack:** TypeScript(strict) · Vitest · Biome · 真实 LLM(SiliconFlow,沿用子1) · `tsx`。命令:`npm test` · `npx vitest run <file>` · `npm run typecheck` · `npm run check:fix`。

**设计依据:** [docs/specs/2026-06-09-eval-harness-design.md](../specs/2026-06-09-eval-harness-design.md)。

---

## File Structure

- **Modify** `src/engine/llm.ts` — 加 `RouterStats` + `LLMRouter.stats()` + 内部累积。
- **Modify** `src/engine/llm.test.ts` — 加 `stats()` 累积测试。
- **Modify** `src/engine/ai-participant.test.ts` — 现有 mock router 补 `stats`(接口加方法后的编译修复)。
- **Create** `src/eval/metrics.ts` — `evalGame`(单局) + `aggregate`(K 局) + 相关类型。
- **Create** `src/eval/metrics.test.ts` — 纯函数 TDD。
- **Create** `src/eval/run.ts` — runner(手动,不单测)。
- **Modify** `.gitignore` — 加 `eval-runs/`。
- **Modify** `package.json` — 加 `eval` script。

---

## Task 1: LLMRouter 加 stats()

给 `LLMRouter` 加内部统计(调用数/token/缓存/计时),`complete` 签名不变。接口加 `stats()` 会破坏现有 mock,**同任务补 ai-participant.test.ts**。

**Files:**
- Modify: `src/engine/llm.ts`
- Modify: `src/engine/llm.test.ts`
- Modify: `src/engine/ai-participant.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `src/engine/llm.test.ts` 末尾追加:

```ts
const usageResp = (content: string, usage: unknown): Response =>
  ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage }) }) as unknown as Response;

describe("createLLMRouter stats()", () => {
  it("累积 usage 与计时", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(usageResp("x", { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80 }));
    const router = createLLMRouter({ apiKey: "k", fetchFn });
    await router.complete("player", "s", "u");
    await router.complete("player", "s", "u");
    const s = router.stats();
    expect(s.callCount).toBe(2);
    expect(s.promptTokens).toBe(200);
    expect(s.completionTokens).toBe(40);
    expect(s.cachePromptTokens).toBe(160);
    expect(s.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("usage 缺失时累积记 0、不报错", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(usageResp("x", undefined));
    const router = createLLMRouter({ apiKey: "k", fetchFn });
    await router.complete("player", "s", "u");
    const s = router.stats();
    expect(s.callCount).toBe(1);
    expect(s.promptTokens).toBe(0);
    expect(s.cachePromptTokens).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/llm.test.ts -t "stats"`
Expected: FAIL —— `router.stats is not a function`。

- [ ] **Step 3: 改实现**

在 `src/engine/llm.ts` 顶部 `RouterOptions` 之后加类型:

```ts
export interface RouterStats {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  cachePromptTokens: number;
  totalLatencyMs: number;
}

interface ChatResponse {
  choices: { message: { content: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}
```

把 `LLMRouter` 接口替换为(加 `stats`):

```ts
export interface LLMRouter {
  complete(role: Role, system: string, user: string): Promise<string>;
  stats(): RouterStats;
}
```

把 `createLLMRouter` 整个函数替换为(加 stats 累积、once 解析 usage、计时):

```ts
export function createLLMRouter(opts: RouterOptions = {}): LLMRouter {
  const apiKey = opts.apiKey ?? process.env.SILICONFLOW_API_KEY ?? "";
  const playerModel = opts.playerModel ?? process.env.PLAYER_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash";
  const dmModel = opts.dmModel ?? process.env.DM_MODEL ?? "deepseek-ai/DeepSeek-V4-Pro";
  const endpoint = opts.endpoint ?? ENDPOINT;
  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 200;
  const timeoutMs = opts.timeoutMs ?? 90000;
  const temperature = opts.temperature ?? 0.8;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  const tally: RouterStats = {
    callCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachePromptTokens: 0,
    totalLatencyMs: 0,
  };

  async function once(body: string): Promise<string> {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchFn(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as ChatResponse;
      const u = data.usage;
      tally.callCount += 1;
      tally.promptTokens += u?.prompt_tokens ?? 0;
      tally.completionTokens += u?.completion_tokens ?? 0;
      tally.cachePromptTokens += u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0;
      return data.choices[0].message.content.trim();
    } finally {
      tally.totalLatencyMs += Date.now() - t0;
      clearTimeout(timer);
    }
  }

  async function complete(role: Role, system: string, user: string): Promise<string> {
    if (!apiKey) throw new Error("缺少 SILICONFLOW_API_KEY 环境变量");
    const model = role === "player" ? playerModel : dmModel;
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    });
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await once(body);
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
      }
    }
    throw new Error(`LLM 调用失败（重试 ${maxRetries} 次）：${String(lastErr)}`);
  }

  return { complete, stats: () => ({ ...tally }) };
}
```

- [ ] **Step 4: 修 ai-participant.test.ts 的 mock(接口加了方法)**

在 `src/engine/ai-participant.test.ts` 把 `routerWith` 替换为:

```ts
const noStats = (): RouterStats => ({
  callCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachePromptTokens: 0,
  totalLatencyMs: 0,
});

const routerWith = (reply: string): LLMRouter => ({
  complete: vi.fn<LLMRouter["complete"]>(async () => reply),
  stats: noStats,
});
```

并把第一个测试里的 `const router: LLMRouter = { complete };` 替换为:

```ts
    const router: LLMRouter = { complete, stats: noStats };
```

同时把该文件顶部的 import 改为(加 `RouterStats`):

```ts
import type { LLMRouter, RouterStats } from "./llm";
```

- [ ] **Step 5: 格式化 + 类型 + 全量测试一把过**

Run: `npm run check:fix && npm run typecheck && npm test`
Expected: 全部 PASS（现有 36 + 新增 2 = 38）。

- [ ] **Step 6: 提交**

```bash
git add src/engine/llm.ts src/engine/llm.test.ts src/engine/ai-participant.test.ts
git commit -m "feat: LLMRouter stats()——usage/缓存/计时统计" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 单局指标 evalGame

纯函数:从一局 `GameState` 算单局指标。fixture 用真实 GameGraph + stub 跑出(确定性,不调 LLM)。

**Files:**
- Create: `src/eval/metrics.ts`
- Test: `src/eval/metrics.test.ts`

- [ ] **Step 1: 写失败测试**

`src/eval/metrics.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/eval/metrics.test.ts`
Expected: FAIL —— `Failed to resolve import "./metrics"`。

- [ ] **Step 3: 写实现**

`src/eval/metrics.ts`:

```ts
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
  const phaseSeq = state.publicEvents
    .filter((e) => e.type === "phase_change")
    .map((e) => String(e.payload.phase));
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
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/eval/metrics.test.ts`
Expected: 3 个 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/eval/metrics.ts src/eval/metrics.test.ts
git commit -m "feat: eval 单局指标 evalGame" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: K 局聚合 aggregate

纯函数:把每局 `GameRecord`(指标 + 时长 + router stats)聚合成 `EvalSummary`。

**Files:**
- Modify: `src/eval/metrics.ts`
- Test: `src/eval/metrics.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

先把 `src/eval/metrics.test.ts` 顶部的 `import { evalGame } from "./metrics";` 改为 `import { aggregate, evalGame, type GameRecord } from "./metrics";`,再在文件末尾追加(注意:不要再写 import,它必须在顶部):

```ts
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
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/eval/metrics.test.ts -t "aggregate"`
Expected: FAIL —— `aggregate is not exported` / `GameRecord` 未定义。

- [ ] **Step 3: 写实现**

在 `src/eval/metrics.ts` 顶部 import 区加:

```ts
import type { RouterStats } from "../engine/llm";
```

在文件末尾追加:

```ts
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
  const sanityViolations = records.filter(
    (r) => !r.metrics.phaseSequenceValid || !r.metrics.voteFormatValid,
  ).length;
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
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/eval/metrics.test.ts`
Expected: 全部 PASS（evalGame 3 + aggregate 2）。

- [ ] **Step 5: 提交**

```bash
git add src/eval/metrics.ts src/eval/metrics.test.ts
git commit -m "feat: eval K 局聚合 aggregate" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: runner（跑 K 局产指标表）

`src/eval/run.ts`:跑 K 局真实 LLM、调 metrics、聚合、打印表、存 `eval-runs/`。**真实网络、不单测**,手动 `npm run eval`。

**Files:**
- Create: `src/eval/run.ts`
- Modify: `.gitignore`
- Modify: `package.json`（经 npm 命令）

- [ ] **Step 1: 写 runner**

`src/eval/run.ts`:

```ts
// eval runner —— 跑 K 局真实 LLM 对局,产指标表 + 存档（设计 §5）。
// 需要 SILICONFLOW_API_KEY（可写进 .env）。运行：npm run eval（局数 env EVAL_GAMES，默认 5）
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { aiParticipant } from "../engine/ai-participant";
import { GameGraph } from "../engine/graph";
import { createLLMRouter } from "../engine/llm";
import { WUYE } from "../engine/scenario";
import { aggregate, evalGame, type GameRecord } from "./metrics";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main(): Promise<void> {
  const k = Number(process.env.EVAL_GAMES ?? 5);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("eval-runs", { recursive: true });
  const records: GameRecord[] = [];

  for (let i = 0; i < k; i++) {
    const router = createLLMRouter();
    const players = WUYE.participants.map((id) => aiParticipant(id, router));
    const graph = new GameGraph(WUYE, players);
    const t0 = Date.now();
    let crashed = false;
    try {
      await graph.runToEnd();
    } catch (err) {
      crashed = true;
      console.error(`局 ${i + 1} 崩溃：`, err);
    }
    const durationMs = Date.now() - t0;
    const metrics = crashed
      ? { completed: false, accused: null, accusedCorrect: false, phaseSequenceValid: false, voteFormatValid: false }
      : evalGame(graph.state, WUYE);
    records.push({ metrics, durationMs, stats: router.stats() });
    writeFileSync(`eval-runs/${runId}-game${i + 1}.json`, JSON.stringify(graph.state.publicEvents, null, 2));
    console.log(
      `局 ${i + 1}/${k}: 指认 ${metrics.accused ?? "—"} ${metrics.accusedCorrect ? "✓" : "✗"} | ${(durationMs / 1000).toFixed(1)}s`,
    );
  }

  const summary = aggregate(records);
  writeFileSync(`eval-runs/${runId}-summary.json`, JSON.stringify(summary, null, 2));
  console.log("\n=== eval 汇总 ===");
  console.log(`完成率: ${(summary.completionRate * 100).toFixed(0)}%`);
  console.log(`指认正确率: ${(summary.accuracyRate * 100).toFixed(0)}%（完成局中）`);
  console.log(`sanity 违反: ${summary.sanityViolations} 局`);
  console.log(`平均时长: ${(summary.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(
    `LLM 调用 ${summary.stats.callCount} 次 | prompt ${summary.stats.promptTokens} / completion ${summary.stats.completionTokens} token | 缓存命中 ${summary.stats.cachePromptTokens} token`,
  );
}

main().catch((err) => {
  console.error("eval 失败：", err);
  process.exit(1);
});
```

- [ ] **Step 2: 加 .gitignore 与 eval script**

在 `.gitignore` 的 "本地环境 / 密钥" 段下面加一行(用编辑器,把下面这行加到 `.gitignore`):

```
eval-runs/
```

Run: `npm pkg set scripts.eval="tsx src/eval/run.ts"`
Expected: `package.json` scripts 多出 `"eval": "tsx src/eval/run.ts"`。

- [ ] **Step 3: 类型 + 格式检查**

Run: `npm run check:fix && npm run typecheck`
Expected: 无 error、无类型报错。

- [ ] **Step 4: 手动端到端验证（需要 API key）**

```bash
# PowerShell:  $env:EVAL_GAMES = "3"   # 先跑 3 局省 token
npm run eval
```
Expected: 逐局打印指认对错 + 汇总表(完成率/指认正确率/时长/token/缓存);`eval-runs/` 下生成 transcript + summary JSON。**人工看**:完成率应 100%(永不崩盘);记下指认正确率(回答"是不是太容易")与缓存命中 token(回答"SiliconFlow 透不透传缓存")。

- [ ] **Step 5: 提交**

```bash
git add src/eval/run.ts .gitignore package.json
git commit -m "feat: eval runner——跑 K 局产指标表" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完成定义

- `npm test` 全绿(现有 36 + stats 2 + evalGame 3 + aggregate 2 = 43)、`typecheck` 干净、`check` 无 error。
- `npm run eval`(配好 key)跑完 K 局、打印一张指标表、`eval-runs/` 有存档。
- 对照设计:确定性指标(A)✅ · `stats()` 实测缓存(B)✅ · K 可配 + eval-runs gitignore(C)✅ · metrics TDD/runner 手动(D)✅ · 落点(E)✅。
- **不在本切片**:泄密/自爆检测、语义度量、异质模型对照矩阵(§8 后续增强)。
