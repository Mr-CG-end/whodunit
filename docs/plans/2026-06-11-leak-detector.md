# 输出校验闸 Implementation Plan（Phase 1 子项目3a）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给公开发言加事后校验闸：旁白清洗 `stripStageDirections` + 泄密检测 `detectLeak`，接进 `GameGraph.doSpeak` 的"清洗→检测→重说→安全发言"降级链，并给 WUYE 剧本的秘密补 `aliases`。

**Architecture:** `detectLeak` 复用 `visibleInfoFor` 取补集当禁止集合（pid 不可见的信息命中 alias 即泄密），外加凶手专属自爆短语规则——是 VisibilityGate 的事后镜像（design §4 双保险）。全部纯确定性，TDD。

**Tech Stack:** TypeScript(strict) · Vitest · Biome。命令：`npm test` · `npx vitest run <file>` · `npm run typecheck` · `npm run check:fix`。

**设计依据:** [docs/specs/2026-06-11-leak-detector-design.md](../specs/2026-06-11-leak-detector-design.md)。

---

## File Structure

- **Create** `src/engine/leak.ts` — `stripStageDirections` + `detectLeak`（一个文件：都是"输出校验闸"这一个职责）。
- **Create** `src/engine/leak.test.ts` — 纯函数 TDD。
- **Modify** `src/engine/scenario.ts` — 3 条秘密补 `aliases`。
- **Modify** `src/engine/graph.ts` — `doSpeak` 接入降级链。
- **Modify** `src/engine/graph.test.ts` — 增补降级链测试。

**aliases 调参结论**（实现 design §5 时的两条落地决定，执行者不要"补全"它们）：

1. **真相（truth）不加 aliases**：真相的每个片段，要么已被某条秘密的 alias 盖住（非 owner 说出即命中），要么是玩家看公开线索就能合法推出的结论（加了必误伤）；凶手自爆由规则 2 专管。
2. **C4/C7 不加 aliases**：它们的内容是 owner 自己秘密的子集。alias 要挂在"知情者恒可见"的那条（秘密）上——若挂在 C4 上，林雅在搜证1 之前提"遗嘱副本"会被误判（她明明从自己秘密里合法知道，但 C4 对她还不可见）。

---

## Task 1: stripStageDirections（旁白清洗）

迁移 spike `strip_stage_directions`（`spike/game.py:97-102`）：剥 `（…）(…)【…】[…]*…*＊…＊`，保留 `「」` 与引号。

**Files:**
- Create: `src/engine/leak.ts`
- Create: `src/engine/leak.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/engine/leak.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { stripStageDirections } from "./leak";

describe("stripStageDirections 旁白清洗", () => {
  it("剥掉（旁白）与*动作*", () => {
    expect(stripStageDirections("（擦汗）我没杀人*紧张*")).toBe("我没杀人");
  });
  it("半角括号同样剥掉", () => {
    expect(stripStageDirections("(整理领带)你好")).toBe("你好");
  });
  it("【方括号】内心戏也剥掉", () => {
    expect(stripStageDirections("【内心】我很慌")).toBe("我很慌");
  });
  it("「」引号是合法发言，不剥", () => {
    expect(stripStageDirections("「我是苏婉」")).toBe("「我是苏婉」");
  });
  it("整句都是旁白 → 剥成空串", () => {
    expect(stripStageDirections("（沉默不语）")).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/leak.test.ts`
Expected: FAIL —— `Failed to load .../leak.ts`（文件不存在）。

- [ ] **Step 3: 最小实现**

新建 `src/engine/leak.ts`：

```ts
// 输出校验闸 —— design §4 双保险的第二道闸（事后检测）。
// 第一道闸 VisibilityGate 保证"没拿到的无从说起"；这里兜"拿到的/幻觉编造的不该说出口"。
// 设计：docs/specs/2026-06-11-leak-detector-design.md

/** 旁白/动作清洗：剥（…）(…)【…】[…]*…*，保留「」与引号（整句引起来是合法发言）。 */
const STAGE_RE = /[（(【[][^）)】\]]*[）)】\]]|[*＊][^*＊]+[*＊]/g;

export function stripStageDirections(text: string): string {
  return text.replace(STAGE_RE, "").trim();
}
```

- [ ] **Step 4: 运行测试看绿**

Run: `npx vitest run src/engine/leak.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 静态检查 + 提交**

```bash
npm run typecheck && npm run check:fix
git add src/engine/leak.ts src/engine/leak.test.ts
git commit -m "feat: 旁白清洗 stripStageDirections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: detectLeak + WUYE 秘密 aliases

泄密检测两条规则：① 禁止集合（`visibleInfoFor` 补集）alias 命中；② 凶手自爆短语。测试直接打真实 WUYE 剧本——所以同任务先给 3 条秘密补 aliases。

**Files:**
- Modify: `src/engine/scenario.ts`（3 条秘密的 `opts`）
- Modify: `src/engine/leak.ts`
- Modify: `src/engine/leak.test.ts`

- [ ] **Step 1: 补 WUYE 秘密 aliases**

`src/engine/scenario.ts` 中三处 `item("secret_…")` 的 `opts` 参数，按下面替换（只动 `opts`，text 不动）：

`secret_林雅`（原 `{ owners: ["林雅"], tags: ["secret"] }`）：

```ts
    { owners: ["林雅"], aliases: ["遗嘱副本", "负债累累", "00:40"], tags: ["secret"] },
```

`secret_陈博`（原 `{ owners: ["陈博"], tags: ["secret", "killer"] }`）：

```ts
    { owners: ["陈博"], aliases: ["00:20"], tags: ["secret", "killer"] },
```

`secret_苏婉`（原 `{ owners: ["苏婉"], tags: ["secret"] }`）：

```ts
    { owners: ["苏婉"], aliases: ["安眠药"], tags: ["secret"] },
```

> 选词依据（design §5"保守独有特征词，宁漏不误伤"）：`遗嘱副本/负债累累/安眠药/00:40/00:20` 都是公开线索与案情简介里**完全没出现**的私密细节，无辜者推理不会自然说出；像"失手""旧情""整夜没出"这类别人能合理猜出的词**故意不收**。真相与 C4/C7 不加 aliases（理由见 File Structure 节）。

- [ ] **Step 2: 写失败测试**

在 `src/engine/leak.test.ts` 顶部 import 改为：

```ts
import { describe, expect, it } from "vitest";
import { detectLeak, stripStageDirections } from "./leak";
import { createGameState } from "./models";
import { WUYE } from "./scenario";
```

文件末尾追加：

```ts
/** 造一个已发布指定线索的对局状态。 */
const stateWith = (...revealed: string[]) => {
  const s = createGameState(WUYE.participants);
  for (const id of revealed) s.revealedInfo.add(id);
  return s;
};

describe("detectLeak 不可见信息规则", () => {
  it("说出别人的秘密 → 命中该秘密", () => {
    expect(detectLeak("陈博", "我怀疑苏婉给他下了安眠药。", WUYE, stateWith())).toBe("secret_苏婉");
  });
  it("自己的秘密对自己可见 → 不触发", () => {
    expect(detectLeak("苏婉", "我给过他安眠药，常规剂量吃不死人。", WUYE, stateWith())).toBe(null);
  });
  it("提前说出未发布的线索 → 命中该线索", () => {
    expect(detectLeak("林雅", "那尊鼎是仿品。", WUYE, stateWith())).toBe("C6");
  });
  it("线索发布后同样的话放行（禁止集合随 revealedInfo 动态收缩）", () => {
    expect(detectLeak("林雅", "那尊鼎是仿品。", WUYE, stateWith("C6"))).toBe(null);
  });
  it("基于公开线索的合法指认不误伤", () => {
    expect(
      detectLeak("林雅", "我认为凶手是陈博，湿皮鞋说明他出过房间。", WUYE, stateWith("C3", "C6", "C8", "C9")),
    ).toBe(null);
  });
});

describe("detectLeak 凶手自爆规则", () => {
  it("凶手说出认罪短语 → self_bury", () => {
    expect(detectLeak("陈博", "对不起，人是我杀的。", WUYE, stateWith())).toBe("self_bury");
  });
  it("非凶手说同样的话不触发", () => {
    expect(detectLeak("林雅", "对不起，人是我杀的。", WUYE, stateWith())).toBe(null);
  });
  it("凶手正常否认放行", () => {
    expect(detectLeak("陈博", "我没杀人，我整夜都在房间里。", WUYE, stateWith())).toBe(null);
  });
});
```

- [ ] **Step 3: 运行测试看红**

Run: `npx vitest run src/engine/leak.test.ts`
Expected: FAIL —— `detectLeak` 未导出。

- [ ] **Step 4: 最小实现**

在 `src/engine/leak.ts` 顶部注释后加 import 与实现：

```ts
import type { GameState } from "./models";
import type { Scenario } from "./scenario";
import { visibleInfoFor } from "./visibility";

/** 凶手自爆/认罪短语（沿用 spike 验证过的词表）。只对 scenario.killer 生效，无误伤面。 */
const SELF_BURY = [
  "我是凶手",
  "是我杀",
  "人是我杀",
  "我杀了",
  "我杀害",
  "凶手就是我",
  "我承认是我",
  "是我下的手",
  "我动手杀",
  "确实是我干的",
  "人是我害",
];

/**
 * 公开发言 text 是否泄露了 pid 不该说出口的信息。命中返回泄露的 info_id（自爆返回 "self_bury"），干净返回 null。
 * 规则1：禁止集合 = pid 此刻不可见的 info（真相/别人的秘密/未发布线索），发言含其任一 alias 即泄密。
 * 规则2：凶手说出自爆短语（自己的秘密对自己可见，规则1 盖不住这条，故单列）。
 */
export function detectLeak(pid: string, text: string, scenario: Scenario, state: GameState): string | null {
  const visible = new Set(visibleInfoFor(pid, scenario, state).map((i) => i.id));
  for (const item of scenario.infoItems) {
    if (visible.has(item.id)) continue;
    if (item.aliases.some((a) => a !== "" && text.includes(a))) return item.id;
  }
  if (pid === scenario.killer && SELF_BURY.some((kw) => text.includes(kw))) return "self_bury";
  return null;
}
```

- [ ] **Step 5: 运行测试看绿**

Run: `npx vitest run src/engine/leak.test.ts`
Expected: PASS（13 个用例）。

- [ ] **Step 6: 全量回归（scenario 动过，确认没碰坏别的）**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 7: 静态检查 + 提交**

```bash
npm run typecheck && npm run check:fix
git add src/engine/leak.ts src/engine/leak.test.ts src/engine/scenario.ts
git commit -m "feat: detectLeak 泄密检测 + WUYE 秘密 aliases

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: GameGraph.doSpeak 接入降级链

`speak → strip → detectLeak → 干净入流 / 泄密或空重说（上限 2 次）→ 仍不过 SAFE_LINE`。被拦截的原文绝不进 `publicEvents`。

**Files:**
- Modify: `src/engine/graph.ts`
- Modify: `src/engine/graph.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/engine/graph.test.ts` 末尾追加（`Participant` 类型与 `stubParticipant` 已在文件顶部 import）：

```ts
describe("GameGraph 输出校验闸", () => {
  it("旁白清洗后才入公开事件流", async () => {
    const g = new GameGraph(WUYE, [
      stubParticipant("林雅", { line: "（推了推眼镜）我没什么好说的。" }),
      stubParticipant("陈博"),
      stubParticipant("苏婉"),
    ]);
    await g.runToEnd();
    const mine = g.state.publicEvents.filter((e) => e.type === "utterance" && e.actor === "林雅");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.payload.text === "我没什么好说的。")).toBe(true);
  });

  it("泄密发言触发重说，原文绝不进事件流", async () => {
    let calls = 0;
    const leaky: Participant = {
      id: "陈博",
      async speak() {
        calls++;
        return calls === 1 ? "我怀疑苏婉昨晚给他下了安眠药。" : "我整夜都在自己房间。";
      },
      async vote() {
        return null;
      },
    };
    const g = new GameGraph(WUYE, [stubParticipant("林雅"), leaky, stubParticipant("苏婉")]);
    await g.runToEnd();
    const texts = g.state.publicEvents.filter((e) => e.type === "utterance").map((e) => String(e.payload.text));
    expect(texts.some((t) => t.includes("安眠药"))).toBe(false);
    expect(texts).toContain("我整夜都在自己房间。");
  });

  it("重说仍泄密 → 安全发言兜底（重试上限 2，共 3 次生成）", async () => {
    let calls = 0;
    const leaky: Participant = {
      id: "陈博",
      async speak() {
        calls++;
        return "人是我杀的。";
      },
      async vote() {
        return null;
      },
    };
    const g = new GameGraph(WUYE, [stubParticipant("林雅"), leaky, stubParticipant("苏婉")]);
    await g.runToEnd();
    const mine = g.state.publicEvents.filter((e) => e.type === "utterance" && e.actor === "陈博");
    expect(mine.every((e) => e.payload.text === "我再想想。")).toBe(true);
    expect(calls).toBe(9); // 3 个发言回合 × 3 次生成
  });

  it("清洗后为空视为无效输出，触发重说", async () => {
    let calls = 0;
    const silent: Participant = {
      id: "林雅",
      async speak() {
        calls++;
        return calls === 1 ? "（沉默不语）" : "我有话直说。";
      },
      async vote() {
        return null;
      },
    };
    const g = new GameGraph(WUYE, [silent, stubParticipant("陈博"), stubParticipant("苏婉")]);
    await g.runToEnd();
    const texts = g.state.publicEvents
      .filter((e) => e.type === "utterance" && e.actor === "林雅")
      .map((e) => String(e.payload.text));
    expect(texts[0]).toBe("我有话直说。");
  });
});
```

- [ ] **Step 2: 运行测试看红**

Run: `npx vitest run src/engine/graph.test.ts -t "输出校验闸"`
Expected: FAIL —— 4 个新用例（旁白原样入流 / 安眠药文本在流里 / calls=3 而非 9 / 第一条是空串或原文）。

- [ ] **Step 3: 改 doSpeak**

`src/engine/graph.ts` 顶部 import 区加：

```ts
import { detectLeak, stripStageDirections } from "./leak";
```

`SAFE_LINE` 下面加常量：

```ts
/** 每次发言最多生成 3 次：1 次原说 + 2 次重说（design §4，成本上界明确）。 */
const MAX_SPEAK_ATTEMPTS = 3;
```

`doSpeak` 整个方法替换为：

```ts
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
```

> 注意：被拦截/抛错的任何路径下，进 `publicEvents` 的只有清洗后的干净文本或 `SAFE_LINE`——模型原文绝不广播。

- [ ] **Step 4: 运行测试看绿**

Run: `npx vitest run src/engine/graph.test.ts`
Expected: 全 PASS（含既有用例——默认 stub 发言 `林雅：（发言）` 清洗后是 `林雅：`，非空，不触发重说，既有计数断言不受影响）。

- [ ] **Step 5: 全量回归**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 6: 静态检查 + 提交**

```bash
npm run typecheck && npm run check:fix
git add src/engine/graph.ts src/engine/graph.test.ts
git commit -m "feat: doSpeak 接入输出校验闸（清洗→检测→重说→安全发言）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 收尾验证 + eval 对照

**Files:** 无新改动（验证任务）。

- [ ] **Step 1: 全量验证三件套**

```bash
npm test && npm run typecheck && npm run check
```

Expected: 全部通过、无 Biome 报错。

- [ ] **Step 2: eval 对照基线（手动，烧真 token）**

Run: `npm run eval`（需要 `SILICONFLOW_API_KEY`；K=3 约 13 分钟）
Expected: 完成率 100%、sanityViolations 0、指标不比子2 基线（指认率 100%）退化。重说会增加 LLM 调用数——`callCount` 高于基线属预期，记录数字即可。

> 此步是 design §6 的要求：改动后用 eval 台对照。若环境无 key，明确说明跳过、不要谎称跑过。

- [ ] **Step 3: 完成收尾**

用 superpowers:finishing-a-development-branch 技能走分支收尾（push / PR 由用户决定）。
