# DMSpeaker 主持话术 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给全自动对局加上 DM 主持话术（阶段开场白 / 线索宣布 / 复盘词），且 DMSpeaker 无权看真相——拆角色安全边界端到端落地。

**Architecture:** 独立组件 `dm.ts`（只拿 public-safe context + 上层递来的 instruction）+ GameGraph 可选注入（结构事件照旧先 push，DM 话术是其后的增量）+ DM 专用泄密检测 `detectDMLeak`（禁止集合 = 所有未公开 info，复盘免检）。降级 = 放弃话术不重试（结构公告兜底）。设计：`docs/specs/2026-06-12-dm-speaker-design.md`。

**Tech Stack:** TypeScript strict / Vitest / Biome，运行期零依赖。Node 20+。

**约定（每个任务都适用）：**
- TDD：先写失败测试 → `npm test` 看红 → 最小实现 → 看绿 → 提交。
- 提交信息：中文 conventional 风格，用多个 `-m` 参数（**别用 here-string**），末行 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 本机 `git status` 里有一批 CRLF/LF 幽灵改动（空 diff），**忽略它们**，只 add 本任务文件。

---

### Task 1: `publicContext` — DM 的 public-safe 上下文

**Files:**
- Modify: `src/engine/context.ts`
- Test: `src/engine/context.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/engine/context.test.ts` 末尾追加（文件已有 `visibleContext` 的测试与 import；按需补 import）：

```ts
describe("publicContext DM 视角", () => {
  it("含案情简介与已公开线索，不含未发布线索", () => {
    const s = createGameState(WUYE.participants);
    s.revealedInfo.add("C1");
    const ctx = publicContext(WUYE, s);
    expect(ctx).toContain("雨夜，收藏家周明远"); // caseIntro
    expect(ctx).toContain("法医报告"); // C1 已发布
    expect(ctx).not.toContain("42 码男鞋"); // C3 未发布
  });

  it("含公开发言", () => {
    const s = createGameState(WUYE.participants);
    s.publicEvents.push({
      id: "u1",
      type: "utterance",
      actor: "林雅",
      visibility: "public",
      payload: { text: "我整晚都在房间。" },
    });
    expect(publicContext(WUYE, s)).toContain("林雅：我整晚都在房间。");
  });

  it("永不含秘密、真相与定向线索——即使已投递（隔离铁律）", () => {
    const s = createGameState(WUYE.participants);
    for (const id of ["C1", "C2", "C5", "C4", "C3", "C6", "C8", "C9", "C7"]) s.revealedInfo.add(id);
    const ctx = publicContext(WUYE, s);
    expect(ctx).not.toContain("你就是凶手"); // 陈博的秘密
    expect(ctx).not.toContain("安眠药"); // 苏婉的秘密
    expect(ctx).not.toContain("凶手是陈博"); // 真相
    expect(ctx).not.toContain("遗嘱副本是你拿走的"); // C4 定向（已投递也不进 DM 视野）
  });
});
```

注意 import 需要的符号：`publicContext`（与现有 `visibleContext` 同模块）、`createGameState`、`WUYE`——前两个测试文件可能已 import，缺啥补啥。

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/engine/context.test.ts`
Expected: FAIL —— `publicContext` 未导出。

- [ ] **Step 3: 最小实现**

在 `src/engine/context.ts` 末尾追加：

```ts
/** DM 视角的 public-safe 上下文：caseIntro + 公开事件流（design 3b §3）。
 *  与 visibleContext 的本质区别：没有私密 info 通道——DM 的 prompt 里架构上不存在秘密与真相。 */
export function publicContext(scenario: Scenario, state: GameState): string {
  const parts: string[] = [`【案情】${scenario.caseIntro}`];
  const revealed = scenario.infoItems.filter((i) => i.scope === "public" && state.revealedInfo.has(i.id));
  if (revealed.length > 0) {
    parts.push(`【已公开的线索】\n${revealed.map((i) => `[${i.id}] ${i.text}`).join("\n")}`);
  }
  const utterances = state.publicEvents.filter((e) => e.type === "utterance");
  if (utterances.length > 0) {
    const lines = utterances.map((e) => `${e.actor}：${String(e.payload.text ?? "")}`).join("\n");
    parts.push(`【目前公开发言】\n${lines}`);
  }
  return parts.join("\n\n");
}
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/engine/context.test.ts`
Expected: PASS（含原有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/context.ts src/engine/context.test.ts
git commit -m "feat: publicContext——DM 的 public-safe 上下文" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `detectDMLeak` — DM 专用泄密检测

**Files:**
- Modify: `src/engine/leak.ts`
- Test: `src/engine/leak.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/engine/leak.test.ts` 末尾追加（文件已有 `stateWith` 助手和 `detectLeak` import；把 `detectDMLeak` 加进同一行 import）：

```ts
describe("detectDMLeak DM 话术泄密检测", () => {
  it("未发布线索 alias 命中", () => {
    expect(detectDMLeak("据说那尊鼎是仿品。", WUYE, stateWith())).toBe("C6");
  });
  it("线索发布后放行（随 revealedInfo 收缩）", () => {
    expect(detectDMLeak("据说那尊鼎是仿品。", WUYE, stateWith("C6"))).toBe(null);
  });
  it("秘密 alias 恒命中——DM 没有任何豁免", () => {
    expect(detectDMLeak("有人给死者下过安眠药吗？", WUYE, stateWith("C1", "C2"))).toBe("secret_苏婉");
  });
  it("真相 alias 恒命中（omniscient 永在禁止集合）", () => {
    const truthAliased = {
      ...WUYE,
      infoItems: WUYE.infoItems.map((i) => (i.id === "truth" ? { ...i, aliases: ["失手用那尊鼎"] } : i)),
    };
    expect(detectDMLeak("听说他是失手用那尊鼎打死的。", truthAliased, stateWith())).toBe("truth");
  });
  it("干净的主持话术放行", () => {
    expect(detectDMLeak("夜色渐深，请各位开始搜证。", WUYE, stateWith("C1"))).toBe(null);
  });
});
```

（WUYE 的 truth 故意无 aliases——3a 决策；omniscient 分支用展开改造的剧本数据测。）

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/engine/leak.test.ts`
Expected: FAIL —— `detectDMLeak` 未导出。

- [ ] **Step 3: 最小实现**

在 `src/engine/leak.ts` 末尾追加：

```ts
/** DM 话术泄密检测（design 3b §5）：DM 没有"自己可见"豁免——
 *  禁止集合 = 全部 private + 全部 omniscient + 未发布的 directed/public。复用 aliases 子串匹配，无 self_bury。 */
export function detectDMLeak(text: string, scenario: Scenario, state: GameState): string | null {
  for (const item of scenario.infoItems) {
    if ((item.scope === "public" || item.scope === "directed") && state.revealedInfo.has(item.id)) continue;
    if (item.aliases.some((a) => a !== "" && text.includes(a))) return item.id;
  }
  return null;
}
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/engine/leak.test.ts`
Expected: PASS（含原有 32 例）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/leak.ts src/engine/leak.test.ts
git commit -m "feat: detectDMLeak——DM 话术泄密检测（无豁免禁止集合）" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `aiDMSpeaker` — DMSpeaker 组件

**Files:**
- Create: `src/engine/dm.ts`
- Test: `src/engine/dm.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/engine/dm.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { aiDMSpeaker } from "./dm";
import type { LLMRouter } from "./llm";

const fakeRouter = (reply = "雨夜的山庄，故事开始了。") => {
  const calls: { role: string; system: string; user: string }[] = [];
  const router: LLMRouter = {
    async complete(role, system, user) {
      calls.push({ role, system, user });
      return reply;
    },
    stats: () => ({ callCount: 0, promptTokens: 0, completionTokens: 0, cachePromptTokens: 0, totalLatencyMs: 0 }),
  };
  return { router, calls };
};

describe("aiDMSpeaker", () => {
  it("走 dm 角色路由，publicCtx 与 instruction 进 user prompt", async () => {
    const { router, calls } = fakeRouter();
    const dm = aiDMSpeaker(router);
    await dm.speak("【案情】雨夜……", "现在进入「搜证1」阶段，请宣布。");
    expect(calls).toHaveLength(1);
    expect(calls[0].role).toBe("dm");
    expect(calls[0].user).toContain("【案情】雨夜……");
    expect(calls[0].user).toContain("搜证1");
  });

  it("system prompt 是主持人设，禁止编造与暗示凶手", async () => {
    const { router, calls } = fakeRouter();
    await aiDMSpeaker(router).speak("ctx", "instr");
    expect(calls[0].system).toContain("主持人");
    expect(calls[0].system).toContain("严禁编造");
  });

  it("返回文本原样上交（清洗在 graph 层）", async () => {
    const { router } = fakeRouter("（环视全场）请开始。");
    await expect(aiDMSpeaker(router).speak("ctx", "instr")).resolves.toBe("（环视全场）请开始。");
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/engine/dm.test.ts`
Expected: FAIL —— 模块 `./dm` 不存在。

- [ ] **Step 3: 最小实现**

新建 `src/engine/dm.ts`：

```ts
// DMSpeaker —— DM 主持话术（design 3b §2，docs/specs/2026-06-12-dm-speaker-design.md）。
// 拆角色边界：只拿 public-safe context + 上层递来的 instruction，无权看全量真相。
import type { LLMRouter } from "./llm";

export interface DMSpeaker {
  /** 生成主持话术。publicCtx 来自 publicContext()；要宣布的文本由上层装进 instruction。 */
  speak(publicCtx: string, instruction: string): Promise<string>;
}

const SYSTEM =
  "你是一场剧本杀的主持人（DM），负责渲染气氛、推进流程。\n" +
  "铁律：只能基于下面提供的案情、公开信息与主持指令说话，严禁编造线索内容，严禁猜测或暗示谁是凶手。\n" +
  "话术简短而有氛围感，不超过 3 句。";

export function aiDMSpeaker(router: LLMRouter): DMSpeaker {
  return {
    async speak(publicCtx, instruction) {
      return router.complete("dm", SYSTEM, `${publicCtx}\n\n【主持指令】${instruction}`);
    },
  };
}
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/engine/dm.test.ts`
Expected: PASS（3 例）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/dm.ts src/engine/dm.test.ts
git commit -m "feat: aiDMSpeaker——DM 主持话术组件（dm 角色路由）" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: GameGraph 接入 + CLI

**Files:**
- Modify: `src/engine/graph.ts`
- Modify: `src/play.ts`
- Test: `src/engine/graph.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/engine/graph.test.ts` 末尾追加一个 describe（顶部补 `import type { DMSpeaker } from "./dm";`）：

```ts
describe("GameGraph DM 话术", () => {
  const recordingDM = (line = "各位请就座。") => {
    const calls: { ctx: string; instruction: string }[] = [];
    const dm: DMSpeaker = {
      async speak(ctx, instruction) {
        calls.push({ ctx, instruction });
        return line;
      },
    };
    return { dm, calls };
  };

  it("7 个非复盘阶段各一条开场白 + 1 条复盘词，actor 为 dm", async () => {
    const { dm } = recordingDM();
    const g = new GameGraph(WUYE, stubs(), dm);
    await g.runToEnd();
    const dmUtts = g.state.publicEvents.filter((e) => e.type === "utterance" && e.actor === "dm");
    expect(dmUtts).toHaveLength(8);
    expect(dmUtts.every((e) => e.payload.text === "各位请就座。")).toBe(true);
  });

  it("隔离铁律：ctx 永不含秘密/真相；只有复盘 instruction 含真相", async () => {
    const { dm, calls } = recordingDM();
    await new GameGraph(WUYE, stubs(), dm).runToEnd();
    for (const c of calls) {
      expect(c.ctx).not.toContain("你就是凶手");
      expect(c.ctx).not.toContain("凶手是陈博");
      expect(c.ctx).not.toContain("安眠药");
    }
    const recap = calls[calls.length - 1];
    expect(recap.instruction).toContain("凶手是陈博"); // truth 由上层显式递入
    for (const c of calls.slice(0, -1)) {
      expect(c.instruction).not.toContain("凶手是陈博");
    }
  });

  it("搜证 instruction 含 public 线索文本、不含 directed 内容", async () => {
    const { dm, calls } = recordingDM();
    await new GameGraph(WUYE, stubs(), dm).runToEnd();
    const sou1 = calls.find((c) => c.instruction.includes("搜证1"));
    expect(sou1).toBeDefined();
    expect(sou1?.instruction).toContain("青铜鼎上检出两组指纹"); // C2 public
    expect(sou1?.instruction).toContain("私下线索"); // C4 只宣布事实
    expect(sou1?.instruction).not.toContain("遗嘱副本是你拿走的"); // C4 内容不递给 DM
  });

  it("dm 抛错 → 无 dm 事件，整局照跑（降级=放弃不重试）", async () => {
    const failDM: DMSpeaker = {
      async speak() {
        throw new Error("dm down");
      },
    };
    const g = new GameGraph(WUYE, stubs(), failDM);
    await expect(g.runToEnd()).resolves.toBeDefined();
    expect(g.done()).toBe(true);
    expect(g.state.publicEvents.some((e) => e.actor === "dm")).toBe(false);
  });

  it("dm 话术泄密 → 该条放弃；线索公开后同样的话放行；复盘免检", async () => {
    const leakyDM: DMSpeaker = {
      async speak() {
        return "那尊鼎是赝品。"; // C6 的 alias，搜证2 才发布
      },
    };
    const g = new GameGraph(WUYE, stubs(), leakyDM);
    await g.runToEnd();
    const evs = g.state.publicEvents;
    const dmUtts = evs.filter((e) => e.type === "utterance" && e.actor === "dm");
    // 开场/自我介绍/搜证1/讨论1 被拦（C6 未发布）；搜证2/讨论2/投票放行 + 复盘词免检
    expect(dmUtts).toHaveLength(4);
    const c6Idx = evs.findIndex((e) => e.type === "clue_release" && e.payload.infoId === "C6");
    const firstDmIdx = evs.findIndex((e) => e.type === "utterance" && e.actor === "dm");
    expect(firstDmIdx).toBeGreaterThan(c6Idx);
  });

  it("dm 话术过旁白清洗", async () => {
    const { dm } = recordingDM("（清了清嗓子）天黑请闭眼……不，这是剧本杀。");
    const g = new GameGraph(WUYE, stubs(), dm);
    await g.runToEnd();
    const first = g.state.publicEvents.find((e) => e.type === "utterance" && e.actor === "dm");
    expect(String(first?.payload.text)).toBe("天黑请闭眼……不，这是剧本杀。");
  });
});
```

（"不传 dm 行为不变"由既有用例守护——`自我介绍 + 讨论 各阶段每个玩家发言一次（3 轮 × 3 人 = 9 条）` 等都不传 dm。）

- [ ] **Step 2: 跑测试看红**

Run: `npx vitest run src/engine/graph.test.ts`
Expected: FAIL —— GameGraph 构造器不收第三参 / 无 dm 事件。

- [ ] **Step 3: 实现 GameGraph 接入**

改 `src/engine/graph.ts`：

3a. import 区改两行、加一行：

```ts
import { publicContext, visibleContext } from "./context";
import type { DMSpeaker } from "./dm";
import { detectDMLeak, detectLeak, stripStageDirections } from "./leak";
```

（Biome 按字母序组织 import，`./dm` 在 `./leak` 之前；测试文件里的新 import 同理，跑 `npm run check:fix` 可自动整理。）

3b. 类成员与构造器（加可选 dm）：

```ts
  private readonly dm?: DMSpeaker;

  constructor(scenario: Scenario, participants: Participant[], dm?: DMSpeaker) {
    this.scenario = scenario;
    this.players = new Map(participants.map((p): [string, Participant] => [p.id, p]));
    this.dm = dm;
    this.state = createGameState(scenario.participants);
    this.steps = this.plan();
  }
```

3c. `exec` 里 enterPhase 改为 await（enterPhase/revealTruth 变 async）：

```ts
      case "enterPhase":
        await this.enterPhase(s.phase);
        break;
      // ...
      case "revealTruth":
        await this.revealTruth();
        break;
```

3d. `enterPhase` 变 async，结构事件照旧先 push，复盘阶段不出开场白（design 3b §1）：

```ts
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
    if (phase !== "复盘") await this.dmSay(this.dmInstruction(phase), true);
  }
```

3e. 新增两个私有方法（放在 `doSpeak` 上方）：

```ts
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
```

3f. `revealTruth` 变 async，truth 文本显式递入复盘词（免检：checkLeak=false）：

```ts
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
    await this.dmSay(`真相已揭晓如下：\n${truths.join("\n")}\n请向各位玩家做复盘解说。`, false);
  }
```

- [ ] **Step 4: 跑测试看绿**

Run: `npx vitest run src/engine/graph.test.ts`
Expected: PASS（原有 13 例 + 新 6 例）。

- [ ] **Step 5: CLI 接入**

改 `src/play.ts`：

5a. import 加一行：

```ts
import { aiDMSpeaker } from "./engine/dm";
```

5b. 构图改一行：

```ts
  const graph = new GameGraph(WUYE, players, aiDMSpeaker(router));
```

5c. transcript 打印里给 DM 单独样式——在 `else if (e.type === "utterance")` **之前**插入：

```ts
    else if (e.type === "utterance" && e.actor === "dm") console.log(`〔DM〕${String(e.payload.text)}`);
```

- [ ] **Step 6: 全量验证**

Run: `npm test && npm run typecheck && npm run check`
Expected: 全绿无错。

- [ ] **Step 7: 提交**

```bash
git add src/engine/graph.ts src/engine/graph.test.ts src/play.ts
git commit -m "feat: GameGraph 接入 DMSpeaker——阶段开场白/线索宣布/复盘词" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 收尾验证 + eval 对照 + 终审

**Files:** 无新改动（验证与审查）。

- [ ] **Step 1: 三件套复核**

Run: `npm test && npm run typecheck && npm run check`
Expected: 全绿（预期 ≈86 tests）。

- [ ] **Step 2: eval 对照基线**

Run（PowerShell）: `$env:EVAL_GAMES = '3'; npm run eval`（需 `.env` 里有 `SILICONFLOW_API_KEY`；run.ts 自动加载）
Expected: 完成率 100%、sanity 0、指认率不低于基线（100%）。LLM 调用数预期 ≈20/局（基线 ≈12 + DM 8）——记录数字与时长涨幅即可，不算退化。另抽查一份 `eval-runs/<runId>-game1.json`：确认有 `actor:"dm"` 的话术事件、其中不含未公开信息。

- [ ] **Step 3: 终审 + 分支收尾**

- 派最终 code reviewer 审整分支（base=本计划提交，head=HEAD），按 requesting-code-review 模板。
- 修完审查项后用 superpowers:finishing-a-development-branch 收尾（push / PR 由用户决定）。
