# LLM 接入 + 全自动对局 — 设计（Phase 1 子项目1）

> Phase 1 剩余（接 LLM 跑通自动对局）拆成 3 个子项目,本文档是**子项目1**:把 stub 玩家换成真 LLM 玩家,用现成的 `GameGraph` 跑通一局全自动对局。
>
> **分解全景**(顺序即依赖):
> 1. **本文档 — LLM 接入 + 全自动对局**:`LLMRouter` + `AIParticipant` + CLI runner。
> 2. eval 台:跑 K 局 + 不变量断言 + 指标表(依赖子1)。
> 3. 质量增强:`LeakDetector` + `DMSpeaker` + `MemoryManager`(eval 度量驱动)。
>
> 上位设计见 [2026-06-05-whodunit-design.md](2026-06-05-whodunit-design.md) §4(LLMRouter/Player 职责)、§6(player prompt 结构)、§7(永不崩盘)、§8(测试策略)、§11(授权欺骗)。承接 [2026-06-08-gamegraph-skeleton-design.md](2026-06-08-gamegraph-skeleton-design.md)(GameGraph 已就位)。

## 1. 范围

**做**:`LLMRouter`(调 SiliconFlow)、`AIParticipant`(实现现有 `Participant` 接口)、CLI runner(用现成 `GameGraph` 跑一局、打印 transcript)。把 stub 换成真 LLM,主链路即可全自动跑完一局。

**不做**(子2/子3):DMSpeaker 自然语言话术(DM 维持 `GameGraph` 的确定性公告)、LeakDetector、MemoryManager、eval 台。玩家 ctx 用现成的 `visibleContext`(已含公开发言历史)。

> 边界理由:先用真 LLM 把主链路跑通、把 `LLMRouter` 接口钉稳;真实对局质量(泄密率等)靠子2 eval 度量,子3 再上兜底。这是 design §8/§9 的车道划分。

## 2. LLMRouter — `src/engine/llm.ts`

模型无关的调用层,按角色路由模型,统一重试/超时。

```ts
type Role = "player" | "dm";
interface LLMRouter {
  complete(role: Role, system: string, user: string): Promise<string>;
}
```

- **传输**:`fetch` 直连 `https://api.siliconflow.cn/v1/chat/completions`(OpenAI 兼容),**零运行期依赖**。payload `{ model, messages:[{role:"system"},{role:"user"}], temperature }`,解析 `choices[0].message.content`。
- **角色路由**:`player → DeepSeek-V4-Flash`、`dm → DeepSeek-V4-Pro`;环境变量 `PLAYER_MODEL` / `DM_MODEL` 可覆盖。**子1 只实际调 `player`**(`dm` 槽位待子3)。
- **鉴权**:`SILICONFLOW_API_KEY` 环境变量;缺失时明确报错(不静默)。
- **降级**(design §7):`AbortController` 超时 → 指数退避重试 N 次 → 仍失败抛错(交给上层兜底)。**不做"换备用模型"**(YAGNI;真遇某模型不稳再加,只是此层小改)。
- **temperature**:跟角色走,`player` ≈0.8(发言要有个性,沿用 spike);不暴露 per-call 调节,接口保持 `complete(role, system, user)` 三参。`vote` 靠文本匹配候选求稳,不靠调温。

## 3. AIParticipant — `src/engine/ai-participant.ts`

实现现有 `Participant.speak/vote`,工厂函数 `aiParticipant(pid, router)`(与 `stubParticipant` 对称)。

- **关键复用**:现成的 `visibleContext(pid)` 已把该玩家的秘密/线索/公开发言渲染成文本——直接当 user message,无需 MemoryManager。
- **system prompt**:角色框架 + **显式授权欺骗**(design §11 风险1 对策:不授权 AI 就不肯撒谎/会自爆)。要点:你是剧本杀玩家 `<pid>`;只依据下列信息发言,严禁编造线索;为达成角色目标,允许隐瞒与误导。
- `speak(ctx, instruction)`:`router.complete("player", system, ctx + instruction)` → 返回文本。
- `vote(ctx, candidates)`:提示"只回一个名字" → 在 `candidates` 里做**文本匹配**(包含匹配) → 命中唯一则投,0 或多则弃权(null)。**不强求结构化 JSON**。
- **不重复兜底**:`router` 抛错直接冒泡——现成的 `GameGraph.doSpeak/doVote` 的 try/catch 已兜成 `SAFE_LINE` / 弃权。AIParticipant 保持薄。

## 4. 降级分层(职责不重复)

| 层 | 负责 |
|---|---|
| LLMRouter | 超时 + 指数退避重试(网络抖动) |
| GameGraph(现成) | router 抛错冒泡上来 → 安全发言 `SAFE_LINE` / 投票弃权 |

任何单个玩家 LLM 失败只降级、不崩整局(design §7、NFR1)。

## 5. CLI runner — `src/play.ts`

构造 `WUYE` + 3 个 `aiParticipant(pid, router)` + `LLMRouter` → `new GameGraph(WUYE, players)` → `runToEnd()` → 把 `state.publicEvents` 按类型友好打印(阶段标题 / `发言人:文本` / `[线索]` / 投票结果 / 真相)。

- 加 `npm run play`。跑 TS 需要 `tsx`(**新增 devDependency,非运行期**)。
- 需要 `SILICONFLOW_API_KEY`;无 key 时报错退出。

## 6. 测试策略

- **LLMRouter**:mock 全局 `fetch`,断言 payload 构造、role→model 路由、重试次数、超时、`choices[0].message.content` 解析、缺 key 报错。
- **AIParticipant**:mock `LLMRouter`,断言 prompt 组装(含授权欺骗 + ctx)、`vote` 候选匹配与失败弃权。
- **CLI**:**不单测**(真实网络 / 烧 token);手动 `npm run play` 验证一局能跑完。
- **不做 golden-text 断言**(design 铁律):LLM 部分只断言结构/不变量,不比文本。真实对局质量留子2 eval。

## 7. 已确认决策点

| | 决策 | 选择 |
|---|---|---|
| A | 角色路由 | `player=DeepSeek-V4-Flash`(默认) / `dm=DeepSeek-V4-Pro`(占位,子3 定);env 可覆盖;子1 只调 player |
| B | 降级 | LLMRouter 只重试+超时,不做换备用模型;安全发言/弃权由现成 GameGraph 兜底 |
| C | vote 解析 | 提示"只回名字" + 文本匹配候选,失败弃权(不强求 JSON) |
| D | 工程 | CLI 用 `tsx`(devDep);文件 `src/engine/llm.ts` + `ai-participant.ts` + `src/play.ts` |
| E | prompt | system 显式授权欺骗(游戏框架) |

> 模型 id / 定价以 [SiliconFlow 官方模型页](https://www.siliconflow.cn/models) 为准;V4-Flash 标 "preview",稳定性首跑实测,不稳再考虑 B 的换备用模型。

## 8. 文件落点

- `src/engine/llm.ts` — `LLMRouter` 接口 + SiliconFlow 实现。
- `src/engine/ai-participant.ts` — `aiParticipant()`。
- `src/play.ts` — CLI runner。
- `src/engine/llm.test.ts` · `src/engine/ai-participant.test.ts` — 确定性部分测试(mock)。
- `package.json` — 加 `play` script + `tsx` devDependency。
