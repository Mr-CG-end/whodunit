# LLM 接入 + 全自动对局 Implementation Plan（Phase 1 子项目1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 stub 玩家换成真 LLM 玩家——新增 `LLMRouter`(fetch 直连 SiliconFlow)、`AIParticipant`(实现现有 `Participant`)、CLI runner,用现成的 `GameGraph` 跑通一局全自动对局。

**Architecture:** `LLMRouter` 是模型无关的薄调用层(角色路由 + 重试/超时,零运行期依赖);`aiParticipant(pid, router)` 把现成的 `visibleContext` 当输入、配一个授权欺骗的 system prompt,调 router 产出发言/投票;CLI 用现成 `GameGraph` 串起来跑一局。降级分层:router 只重试,安全发言/弃权由现成 `GameGraph` 的 try/catch 兜底。

**Tech Stack:** TypeScript(strict) · Vitest · Biome · `fetch`(Node 原生) · `tsx`(跑 CLI)。命令:`npm test` · `npx vitest run <file>` · `npm run typecheck` · `npm run check:fix`。

**设计依据:** [docs/specs/2026-06-09-llm-integration-design.md](../specs/2026-06-09-llm-integration-design.md)。

> **prompt caching 注记**:子1 不做(收益小+过早优化)。它是 `LLMRouter` 内部的未来可选优化,跟 `complete(role, system, user)` 接口解耦——将来要做只在 router 内部加,不影响 `AIParticipant`/`GameGraph`/本计划。

---

## File Structure

- **Create** `src/engine/llm.ts` — `Role` / `LLMRouter` 接口 + `createLLMRouter()`(SiliconFlow 实现)。职责:模型无关调用层。
- **Create** `src/engine/llm.test.ts` — mock `fetchFn` 测确定性部分。
- **Create** `src/engine/ai-participant.ts` — `aiParticipant(pid, router)`。职责:把可见上下文 + 授权欺骗 prompt 变成发言/投票。
- **Create** `src/engine/ai-participant.test.ts` — mock `LLMRouter` 测 prompt 组装 + vote 解析。
- **Create** `src/play.ts` — CLI runner(手动验证,不单测)。
- **Modify** `tsconfig.json` — `types: ["node"]`。
- **Modify** `package.json` — 加 `play` script + `@types/node`、`tsx` devDependency。

---

## Task 1: 工程前置（Node 类型 + tsx）

`LLMRouter`/CLI 要用 `process`、`fetch`、`AbortController` 等 Node 全局,先装类型、开 `types: ["node"]`,并确认现有代码不受影响。

**Files:**
- Modify: `tsconfig.json`
- Modify: `package.json`(经 npm 命令)

- [ ] **Step 1: 装开发依赖**

Run: `npm install -D @types/node tsx`
Expected: `package.json` 的 devDependencies 多出 `@types/node` 与 `tsx`,无报错。

- [ ] **Step 2: 开启 node 类型**

修改 `tsconfig.json`,把 `"types": []` 改为:

```json
    "types": ["node"]
```

- [ ] **Step 3: 确认现有代码不受影响**

Run: `npm run typecheck && npm test`
Expected: typecheck 无输出;**现有 26 测试仍全绿**(加 node 类型不应破坏任何纯函数)。

- [ ] **Step 4: 提交**

```bash
git add tsconfig.json package.json package-lock.json
git commit -m "chore: 接入 LLM 前置——@types/node + tsx + tsconfig types" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: LLMRouter 基本调用

`createLLMRouter` 发一次 SiliconFlow 请求:构造 OpenAI 兼容 payload、按角色路由模型、解析 `choices[0].message.content`、缺 key 报错。测试注入 `fetchFn` mock,不碰真实网络。

**Files:**
- Create: `src/engine/llm.ts`
- Test: `src/engine/llm.test.ts`

- [ ] **Step 1: 写失败测试**

`src/engine/llm.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createLLMRouter } from "./llm";

const okResp = (content: string) =>
  ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }) as Response;

describe("createLLMRouter 基本调用", () => {
  it("发出正确 payload 并解析（trim）content", async () => {
    const fetchFn = vi.fn(async () => okResp("  你好  "));
    const router = createLLMRouter({ apiKey: "k", playerModel: "M-player", fetchFn });
    const out = await router.complete("player", "sys", "usr");
    expect(out).toBe("你好");
    expect(fetchFn).toHaveBeenCalledOnce();
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("M-player");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("按角色路由：dm 用 dmModel", async () => {
    const fetchFn = vi.fn(async () => okResp("x"));
    const router = createLLMRouter({ apiKey: "k", dmModel: "M-dm", fetchFn });
    await router.complete("dm", "s", "u");
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).model).toBe("M-dm");
  });

  it("缺 API key 时报错", async () => {
    const router = createLLMRouter({ apiKey: "", fetchFn: vi.fn() });
    await expect(router.complete("player", "s", "u")).rejects.toThrow(/SILICONFLOW_API_KEY/);
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/llm.test.ts`
Expected: FAIL —— `Failed to resolve import "./llm"`。

- [ ] **Step 3: 写实现**

`src/engine/llm.ts`:

```ts
// LLMRouter —— 模型无关的调用层（设计 §4 / docs/specs/2026-06-09-llm-integration-design.md）。
// fetch 直连 SiliconFlow（OpenAI 兼容），按角色路由模型。零运行期依赖。重试/超时在 Task 3 加。
export type Role = "player" | "dm";

export interface LLMRouter {
  complete(role: Role, system: string, user: string): Promise<string>;
}

export interface RouterOptions {
  apiKey?: string;
  playerModel?: string;
  dmModel?: string;
  endpoint?: string;
  maxRetries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  temperature?: number;
  fetchFn?: typeof fetch;
}

const ENDPOINT = "https://api.siliconflow.cn/v1/chat/completions";

export function createLLMRouter(opts: RouterOptions = {}): LLMRouter {
  const apiKey = opts.apiKey ?? process.env.SILICONFLOW_API_KEY ?? "";
  const playerModel = opts.playerModel ?? process.env.PLAYER_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash";
  const dmModel = opts.dmModel ?? process.env.DM_MODEL ?? "deepseek-ai/DeepSeek-V4-Pro";
  const endpoint = opts.endpoint ?? ENDPOINT;
  const temperature = opts.temperature ?? 0.8;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  async function once(body: string): Promise<string> {
    const resp = await fetchFn(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content.trim();
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
    return once(body);
  }

  return { complete };
}
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/llm.test.ts`
Expected: 全部通过（3 个 PASS）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/llm.ts src/engine/llm.test.ts
git commit -m "feat: LLMRouter——SiliconFlow 调用 + 角色路由" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: LLMRouter 重试与超时

给 `complete` 加指数退避重试 + `AbortController` 超时:fetch 失败 / 非 2xx / 超时都重试到上限,仍失败才抛错。超时与网络错走同一重试路径。

**Files:**
- Modify: `src/engine/llm.ts`
- Test: `src/engine/llm.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

在 `src/engine/llm.test.ts` 末尾追加:

```ts
const errFetch = (calls: { n: number }) =>
  vi.fn(async () => {
    calls.n++;
    throw new Error("network down");
  });

describe("createLLMRouter 重试", () => {
  it("前几次失败、之后成功则返回", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n++;
      if (n < 3) throw new Error("network");
      return okResp("ok");
    });
    const router = createLLMRouter({ apiKey: "k", fetchFn, maxRetries: 3, backoffMs: 0 });
    expect(await router.complete("player", "s", "u")).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("重试耗尽后抛错（1 + maxRetries 次尝试）", async () => {
    const calls = { n: 0 };
    const fetchFn = errFetch(calls);
    const router = createLLMRouter({ apiKey: "k", fetchFn, maxRetries: 2, backoffMs: 0 });
    await expect(router.complete("player", "s", "u")).rejects.toThrow(/重试 2 次/);
    expect(calls.n).toBe(3);
  });

  it("非 2xx 触发重试", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    const router = createLLMRouter({ apiKey: "k", fetchFn, maxRetries: 1, backoffMs: 0 });
    await expect(router.complete("player", "s", "u")).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/llm.test.ts -t "重试"`
Expected: FAIL —— "前几次失败、之后成功则返回" 抛错(Task 2 的 `complete` 没有重试,首次失败即抛)。

- [ ] **Step 3: 写实现**

把 `src/engine/llm.ts` 里的 `createLLMRouter` **整个函数替换为**(加 maxRetries/backoffMs/timeoutMs 解构、`once` 加 `AbortController` 超时、`complete` 加重试循环):

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

  async function once(body: string): Promise<string> {
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
      const data = (await resp.json()) as { choices: { message: { content: string } }[] };
      return data.choices[0].message.content.trim();
    } finally {
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

  return { complete };
}
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/llm.test.ts`
Expected: 全部 PASS（Task 2 的 3 个 + 新增 3 个）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/llm.ts src/engine/llm.test.ts
git commit -m "feat: LLMRouter 重试与超时" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: AIParticipant

`aiParticipant(pid, router)` 实现现有 `Participant`:`speak` 用授权欺骗 system + 现成 ctx 调 player 模型;`vote` 提示"只回名字"再文本匹配候选,失败弃权。不重复兜底(router 抛错由 GameGraph 接住)。

**Files:**
- Create: `src/engine/ai-participant.ts`
- Test: `src/engine/ai-participant.test.ts`

- [ ] **Step 1: 写失败测试**

`src/engine/ai-participant.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { aiParticipant } from "./ai-participant";
import type { LLMRouter } from "./llm";

const routerWith = (reply: string): LLMRouter => ({ complete: vi.fn(async () => reply) });

describe("aiParticipant", () => {
  it("speak 用 player 角色 + 含授权欺骗的 system + 现成 ctx", async () => {
    const complete = vi.fn(async () => "我是无辜的。");
    const router: LLMRouter = { complete };
    const p = aiParticipant("林雅", router);
    const out = await p.speak("我的秘密…", "请发言");
    expect(out).toBe("我是无辜的。");
    const [role, system, user] = complete.mock.calls[0];
    expect(role).toBe("player");
    expect(system).toContain("林雅");
    expect(system).toMatch(/隐瞒|误导|欺骗/); // 授权欺骗
    expect(user).toContain("我的秘密…");
    expect(user).toContain("请发言");
  });

  it("vote 从候选里文本匹配唯一名字", async () => {
    const p = aiParticipant("林雅", routerWith("我认为凶手是陈博。"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe("陈博");
  });

  it("vote 匹配不到名字则弃权", async () => {
    const p = aiParticipant("林雅", routerWith("我不确定。"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });

  it("vote 命中多个候选也弃权", async () => {
    const p = aiParticipant("林雅", routerWith("可能是陈博，也可能是苏婉。"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/ai-participant.test.ts`
Expected: FAIL —— `Failed to resolve import "./ai-participant"`。

- [ ] **Step 3: 写实现**

`src/engine/ai-participant.ts`:

```ts
// AIParticipant —— 用真 LLM 实现 Participant（设计 §3 / §6 / §11）。
// 复用现成的 visibleContext 产物作输入；system prompt 显式授权欺骗，否则 AI 不肯演坏人。
import type { LLMRouter } from "./llm";
import type { Participant } from "./participant";

function systemPrompt(pid: string): string {
  return (
    `你正在参加一场剧本杀，扮演玩家「${pid}」。这是虚构推理游戏：为达成你的角色目标，` +
    `你可以隐瞒信息、避重就轻、误导他人——这是游戏的正常部分。\n` +
    `铁律：只能依据下面提供给你的信息发言，严禁编造不存在的线索或他人信息。` +
    `保持角色，发言简洁自然，像真人玩家一样。`
  );
}

export function aiParticipant(pid: string, router: LLMRouter): Participant {
  return {
    id: pid,
    async speak(ctx, instruction) {
      return router.complete("player", systemPrompt(pid), `${ctx}\n\n${instruction}`);
    },
    async vote(ctx, candidates) {
      const reply = await router.complete(
        "player",
        systemPrompt(pid),
        `${ctx}\n\n请从这些人里指认一名凶手：${candidates.join("、")}。只回复一个名字。`,
      );
      const hit = candidates.filter((c) => reply.includes(c));
      return hit.length === 1 ? hit[0] : null;
    },
  };
}
```

- [ ] **Step 4: 格式化 + 类型 + 测试一把过**

Run: `npm run check:fix && npm run typecheck && npx vitest run src/engine/ai-participant.test.ts`
Expected: 全部通过（4 个 PASS）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/ai-participant.ts src/engine/ai-participant.test.ts
git commit -m "feat: AIParticipant——真 LLM 玩家（授权欺骗 + vote 解析）" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: CLI runner（端到端跑一局）

`src/play.ts` 用现成 `GameGraph` + 真 LLM 玩家跑一局、友好打印 transcript。这是端到端验证(真实网络),不进单测;加 `npm run play`。

**Files:**
- Create: `src/play.ts`
- Modify: `package.json`(经 npm 命令)

- [ ] **Step 1: 写 CLI**

`src/play.ts`:

```ts
// CLI runner —— 用真 LLM 玩家跑一局《雨夜书房》并打印 transcript。
// 需要环境变量 SILICONFLOW_API_KEY。运行：npm run play
import { aiParticipant } from "./engine/ai-participant";
import { GameGraph } from "./engine/graph";
import { createLLMRouter } from "./engine/llm";
import { WUYE } from "./engine/scenario";

async function main(): Promise<void> {
  const router = createLLMRouter();
  const players = WUYE.participants.map((id) => aiParticipant(id, router));
  const graph = new GameGraph(WUYE, players);

  console.log(`《${WUYE.title}》开局\n${WUYE.caseIntro}\n`);
  await graph.runToEnd();

  for (const e of graph.state.publicEvents) {
    if (e.type === "phase_change") console.log(`\n=== ${String(e.payload.phase)} ===`);
    else if (e.type === "utterance") console.log(`${e.actor}：${String(e.payload.text)}`);
    else if (e.type === "clue_release") console.log(`[线索] ${String(e.payload.text)}`);
    else if (e.type === "vote" && e.actor === "engine")
      console.log(`[计票] ${JSON.stringify(e.payload.counts)} → 指认 ${String(e.payload.accused)}`);
    else if (e.type === "vote") console.log(`[投票] ${e.actor} → ${String(e.payload.target)}`);
  }
  console.log(`\n真凶：${WUYE.killer}　本局指认：${graph.result?.accused ?? "（无）"}`);
}

main().catch((err) => {
  console.error("对局失败：", err);
  process.exit(1);
});
```

- [ ] **Step 2: 加 play script**

Run: `npm pkg set scripts.play="tsx src/play.ts"`
Expected: `package.json` 的 scripts 多出 `"play": "tsx src/play.ts"`。

- [ ] **Step 3: 类型 + 格式检查**

Run: `npm run check:fix && npm run typecheck`
Expected: 无 error、无类型报错（`play.ts` 在 `src/` 下,被 typecheck 覆盖）。

- [ ] **Step 4: 手动端到端验证（需要 API key）**

```bash
# PowerShell:  $env:SILICONFLOW_API_KEY = "你的key"
npm run play
```
Expected: 打印开局 → 各阶段发言/线索 → 投票计票 → 真凶对照。**人工确认**:一局从开场到复盘不崩地跑完;AI 发言像在演角色;凶手没在发言里直接自爆。(这是手动检查,不是自动断言——LLM 部分不做 golden-text 断言,系统化度量留子2 eval。)

- [ ] **Step 5: 提交**

```bash
git add src/play.ts package.json
git commit -m "feat: CLI runner——真 LLM 跑通一局自动对局" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完成定义

- `npm test` 全绿(现有 26 + LLMRouter 6 + AIParticipant 4)、`npm run typecheck` 干净、`npm run check` 无 error。
- `npm run play`(配好 key)能从开场到复盘**不崩**地跑完一局,打印完整 transcript。
- 对照设计:角色路由(A)✅ · 重试+超时、GameGraph 兜底(B)✅ · vote 文本匹配弃权(C)✅ · tsx CLI(D)✅ · 授权欺骗 prompt(E)✅。
- **不在本切片**:DMSpeaker 话术、LeakDetector、Memory、eval 台、泄密率度量(子2/子3)。
