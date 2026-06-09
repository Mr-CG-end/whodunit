# eval 台 — 设计（Phase 1 子项目2）

> Phase 1 剩余拆出的**子项目2**:跑 K 局全自动对局,对每局算确定性指标、聚合成一张数字表、存档 transcript。这是 design §8 第 2 层、§9 的"核心学习产出"——把非确定性行为从"看一眼感觉还行"变成可复现的数字。
>
> 承接[子项目1](2026-06-09-llm-integration-design.md)(LLMRouter + AIParticipant + GameGraph 已就位)。上位设计见 [2026-06-05-whodunit-design.md](2026-06-05-whodunit-design.md) §8(测试策略)、PRD §8(验收:完成率/等待时长等数字)。

## 1. 范围

**做**:`metrics`(纯函数,从一局 `GameState` 算确定性指标)+ `run`(runner,跑 K 局真实 LLM、聚合、打印表、存档)+ 给 `LLMRouter` 加 `stats()`(性能/成本/缓存统计)。

**不做**(留后续):
- 泄密/自爆检测 —— 留**子3**,与 LeakDetector 规则层复用(避免重复造)。
- 语义/embedding/LLM-judge 度量 —— 留 **Phase 3**。
- **不做 golden-text 断言** —— LLM 部分只断言结构/不变量,绝不比对文本。

> 范围理由:先用最便宜的"确定性指标"回答"能不能跑、推理准不准、性能成本几何";泄密那一层逻辑属 LeakDetector,放子3 一处实现。

## 2. 代码结构(跟子1 对称:确定性库 + 真实 runner)

- **`src/eval/metrics.ts`** — 纯函数:吃一局的 `GameState`(+ killer)→ 单局指标。确定性,**TDD with fixture**(手工造一局假 `GameState`,不调 LLM)。
- **`src/eval/run.ts`** — runner:跑 K 局真实 LLM、调 metrics、聚合、打印表、存档。**手动触发、烧 token、不单测**。

## 3. 指标清单

**单局(`metrics.ts` 算)**
- `completed`:跑到复盘且有投票结果(不崩)。**永不崩盘设计下应恒 true;一旦 <100% 就暴露了未兜底的崩溃路径** —— 这正是它作为回归哨兵的价值
- `accused` / `accusedCorrect`:`result.accused === scenario.killer`(推理质量)
- `phaseSequenceValid`:phase_change 序列 == `scenario.phases`
- `voteFormatValid`:每个玩家恰一票、被投者是合法参与者

**K 局聚合**
- 完成率 = 完成局数 / K
- 指认正确率 = `accusedCorrect` 局数 / 完成局数
- sanity 违反局数(应为 0)
- 平均墙钟时长、平均 LLM 调用数 / token / 缓存命中

## 4. 性能/成本 —— 给 `LLMRouter` 加 `stats()`

当前 `complete(role,system,user)` 只返回 string、丢弃 usage。改法:**LLMRouter 内部累积**,新增只读 `stats()`:

```ts
interface RouterStats {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  cachePromptTokens: number; // 缓存命中的 prompt token —— SiliconFlow 缓存的实测口径
  totalLatencyMs: number;
}
```

- `complete` 签名**不变**,`AIParticipant` 一行不动。
- `once` 解析响应里的 `usage`(`prompt_tokens` / `completion_tokens` / 缓存字段),累积;包一层 `Date.now()` 计时。
- **缓存字段名以实际响应为准**(DeepSeek 用 `prompt_cache_hit_tokens`,OpenAI 系用 `prompt_tokens_details.cached_tokens`);读不到就记 0——**记到 0 本身就是"SiliconFlow 没透传缓存"的实测结论**。
- runner 每局用**独立 router**,跑完读该局 `stats()`,聚合所有局。

## 5. 输出

- 控制台:打印聚合表 + 每局明细(完成/指认对错/时长/token)。
- 文件:原始结果 JSON + 各局 transcript 写到 `eval-runs/`(**加进 `.gitignore`**,非确定性产物不入库)。聚合数字想留作 writeup 素材就手动摘录。

## 6. 测试策略

- `metrics.ts`:fixture(手工造一局 `GameState`)断言各指标 —— 红绿 TDD。
- `LLMRouter.stats()`:mock fetch 返回带 `usage` 的响应,断言累积正确(含缓存字段缺失记 0)。
- `run.ts`:不单测(真实网络),手动 `npm run eval` 验证产出一张表。

## 7. 已确认决策点

| | 决策 | 选择 |
|---|---|---|
| A | 范围 | 确定性指标;泄密/自爆留子3 |
| B | 性能统计 | `LLMRouter` 加内部 `stats()`(`complete` 签名不变);顺带实测 SiliconFlow 缓存 |
| C | runner | 跑 K 局,K 是 CLI 参数默认 5;输出控制台表 + `eval-runs/`(gitignore)存 JSON+transcript |
| D | 测试 | `metrics.ts` 纯函数 TDD;`run.ts` 真实 LLM 手动、不单测 |
| E | 落点 | `src/eval/metrics.ts` + `src/eval/run.ts` + `npm run eval` |

## 8. 后续增强(不在子2,触发条件明确)

**凶手/好人异质模型对照矩阵(消融实验)**:给凶手与好人分配不同能力的模型,跑 2×2(好人强弱 × 凶手强弱),分离"凶手隐瞒能力 vs 好人推理能力"哪个主导指认正确率。

- **触发条件**:基础 eval 跑出的`指认正确率`有悬念(不是 100% 太直白)时才做;若一上来就 100%,先改剧本(线索更隐晦/加红鲱鱼/负面线索摊匀),省下成倍 token。
- **实现成本**:纯 runner 配置——`createLLMRouter({ playerModel })` 已可配模型、`aiParticipant(pid, router)` 接受任意 router,按 `scenario.killer` 给凶手/好人不同 router 即可,**不改 LLMRouter/AIParticipant 接口**。
- 这条同时服务于将来(二期)**AI 出本**:`指认正确率` + 引擎能否跑通,就是 AI 生成剧本的客观验收器。

## 9. 文件落点

- `src/engine/llm.ts` — 加 `RouterStats` + `stats()`(改子1 代码)。
- `src/engine/llm.test.ts` — 加 `stats()` 累积测试。
- `src/eval/metrics.ts` + `src/eval/metrics.test.ts` — 单局指标纯函数 + TDD。
- `src/eval/run.ts` — runner(手动)。
- `.gitignore` — 加 `eval-runs/`。
- `package.json` — 加 `eval` script。
