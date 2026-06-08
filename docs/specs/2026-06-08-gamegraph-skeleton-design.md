# GameGraph 确定性编排骨架 — 设计

> Phase 1 第二块。承接已完成的 T1–T7（数据模型 / 剧本 / VisibilityGate / 发牌 / 上下文 / 计票），把这些纯函数串成**完整一局**。范围已与作者确认：**只做确定性编排骨架，不接 LLM**。
>
> 上位设计见 [2026-06-05-whodunit-design.md](2026-06-05-whodunit-design.md) §4（GameGraph 职责）、§5（对局流程）、§7（永不崩盘）、§8（测试策略）。本文只记该上位设计在「骨架切片」里的具体落地与边界。

## 1. 范围

**做**：手写确定性控制器 `GameGraph`，按 `scenario.phases` 线性推进一局（开场→…→复盘），期间确定性地发线索、组织发言轮、计票、揭真相。玩家用确定性 stub 注入。**全程不接 LLM、不新增运行期依赖。**

**不做**（各自留后续切片，且**不预留钩子**）：DMSpeaker 自然语言话术、LLMRouter、Player/Human Participant 的真实实现、LeakDetector、MemoryManager、eval 台、前端 / 传输。

> 边界理由：DM 话术与玩家发言的「内容质量」都是 LLM 活；本切片只锁死确定性编排、把接口钉稳，让 LLM 切片往上接。

## 2. Participant 抽象（未来 AI / 真人共用的缝）

```ts
interface Participant {
  id: string;
  speak(ctx: string, instruction: string): Promise<string>;        // 轮到发言
  vote(ctx: string, candidates: string[]): Promise<string | null>; // 投票，null = 弃权
}
```

- **接口从第一天就是 `Promise`**：将来接 LLM（异步）和真人（等输入）都不改接口。
- 本切片只实现 `StubParticipant`（确定性假玩家：发可配置文本、按规则投票）。`AIParticipant` / `HumanParticipant` 是后续切片。
- `ctx` 由 GameGraph 调 [`visibleContext(pid, …)`](../../src/engine/context.ts) 产出 —— 玩家只可能拿到闸门产物，信息隔离铁律在编排层再钉一遍。

## 3. 状态机推进

按 `scenario.phases`（`["开场","自我介绍","搜证1","讨论1","搜证2","讨论2","投票","复盘"]`）线性推进。每阶段进入时的确定性动作：

| 阶段 | GameGraph 动作 |
|------|----------------|
| 开场 | 写 `phase_change` 公开事件 |
| 自我介绍 | 每个玩家 `speak` 一圈 |
| 搜证N | 调 [`revealCluesForPhase()`](../../src/engine/release.ts) 发该阶段线索 |
| 讨论N | 每个玩家 `speak` 一圈 |
| 投票 | 每人 `vote` → 写 `vote` 事件 → [`majority()`](../../src/engine/tally.ts) 得指认结果 |
| 复盘 | 确定性地把 `truth.text` 搬进一条公开公告事件 |

**核心原语 `step()` + driver `runToEnd()`**：`step` 推进一个最小步（一次发言 / 一次发牌 / 一次阶段转移），**原地修改并返回同一 `state` 引用**（与 `revealCluesForPhase` 的 mutate 风格一致；返回引用只为方便断言 / 链式）；`runToEnd` 循环调 `step` 到结束。`step` 为底层，是为了支持未来人在环「轮到真人就暂停等输入」。

## 4. 永不崩盘（骨架层可测的降级）

participant 的 `speak`/`vote` 抛错或超时 → GameGraph 捕获 → `speak` 用安全模板（"我再想想"）、`vote` 弃权（null）→ **轮转继续，不卡、不崩**。重试 / 换模型属 LLMRouter 层，不在本切片。

## 5. 已确认的决策点

| | 决策 | 选择 |
|---|---|---|
| A | 推进原语与状态写法 | `step` + `runToEnd` 双原语；state 原地 mutate（与现有代码一致） |
| B | 复盘揭真相 | 确定性搬运 `truth.text` 入公开公告，不经 LLM |
| C | 发言轮次 | 自我介绍 / 讨论默认「每人一圈」；轮上限参数先不做，等真有 AI 扯不停再加 |
| D | 后续模块钩子 | 不预留 LeakDetector / Memory 钩子，等各自切片再插（YAGNI） |

## 6. 文件落点

- `src/engine/participant.ts` — `Participant` 接口 + `StubParticipant`
- `src/engine/graph.ts` — `GameGraph`（`step` / `runToEnd`）
- `src/engine/participant.test.ts` · `src/engine/graph.test.ts`

## 7. TDD 不变量清单（测什么，不比文本）

1. 跑完后走过的 phase 序列 == `scenario.phases`，不跳阶、不回退。
2. 每个搜证阶段后，对应 `revealPhase` 的线索已进 `revealedInfo`；更早不出现、不遗漏。
3. 投票产出合法 `vote` 事件，计票 / 指认走 `tallyVotes` / `majority`。
4. 喂给每个玩家的 `ctx` 全程 == `visibleContext(pid)` —— 不含他人秘密 / 真相 / 未公开线索（信息隔离在编排层成立）。
5. 注入会失败的 stub，整局仍完整跑完，失败回合产出安全发言 / 弃权。
