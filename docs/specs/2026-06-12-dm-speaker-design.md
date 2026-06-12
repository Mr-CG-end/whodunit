# DMSpeaker：DM 主持话术 — 设计（Phase 1 子项目3b）

> 子项目3（质量增强）拆为 3a 输出校验闸（已完成，[设计](2026-06-11-leak-detector-design.md)）/ **3b DMSpeaker（本文档）** / 3c MemoryManager（可能 YAGNI，eval 未暴露记忆漂移）。
>
> 上位设计见 [2026-06-05-whodunit-design.md](2026-06-05-whodunit-design.md) §4（DMSpeaker 职责）、决策表「DM 安全边界 = 拆角色」：GameGraph（确定性、看真相、只出动作）+ DMSpeaker（只拿 public-safe context、无权看全量真相），揭真相阶段才显式放开 truth。

## 1. 范围

**做**（最小三件）：

1. **阶段开场白**——每次进阶段 DM 生成主持话术（**复盘阶段除外**，由复盘词覆盖）；开场阶段念 `caseIntro`，搜证阶段打包宣布本阶段 public 线索。
2. **线索宣布词**——并入阶段开场白（一次调用宣布"进入搜证+这两条线索"），不单独成调用。
3. **复盘词**——GameGraph 把 truth 文本显式递入，DM 生成复盘解说。

**不做**：

- **点名提问 / 讨论轮间串场承接**——主持感增强，但每局多 2-3 次调用（延迟已是痛点），留 Phase 2 人在环（真人需要被点名时）再加。
- **NPC 扮演 / 临场圆场**——Phase 1 无人在环，圆场无对象；WUYE 无 NPC 角色。YAGNI。
- **DM 话术质量的文本断言**——铁律：不做 golden-text；质量靠人工看 transcript + 离线 eval 扩展。

> 边界理由：3b 的作品集核心价值是把「DM 开天眼」从架构上消除——**不让同一个 LLM 既握全量真相又做自然语言主持**。最小三件足够让这条边界端到端落地并可测试；话术丰富度是内容活，后续加不动架构。

## 2. DMSpeaker — `src/engine/dm.ts`

```ts
export interface DMSpeaker {
  speak(publicCtx: string, instruction: string): Promise<string>;
}
/** 走 LLMRouter 的 "dm" 角色（默认 DeepSeek-V4-Pro，DM_MODEL 可覆盖）——design「按角色路由」既有约定。 */
export function aiDMSpeaker(router: LLMRouter): DMSpeaker;
```

- system prompt：剧本杀主持人人设——氛围渲染、简短（≤3 句）、**只基于给定文本说话，不编造线索内容、不猜测或暗示凶手**。
- 与 `AIParticipant` 同构（接口 + 工厂），测试用 fake/stub 注入。

## 3. public-safe context — `src/engine/context.ts`

新增：

```ts
/** DM 视角的上下文：caseIntro + 公开事件流。不挂任何人的私密 info，永不含 truth。 */
export function publicContext(scenario: Scenario, state: GameState): string;
```

- 与 `visibleContext(pid, …)` 的本质区别：后者拼"pid 可见的 info + 公开事件"，前者**没有 info 通道**——DM 的 prompt 里架构上不存在秘密与真相。这是拆角色边界的代码落点。
- 复盘的 truth 不走 ctx：由 GameGraph 作为 instruction 文本递入（见 §4）。「放开 truth」的方式是**上层递文本**，不是改 DM 的可见集——可见集规则保持单一不变量，不引入"阶段例外"。

## 4. GameGraph 接入 — `src/engine/graph.ts`

- 构造器加**可选**第三参 `dm?: DMSpeaker`。不传 = 现状裸公告：全部现有测试、stub 对局、`play.ts` 默认行为零改动。
- 接入点（结构事件**照旧先 push**——eval/测试的阶段顺序断言依赖它们；DM 话术是其后的增量）：
  1. **enterPhase**（复盘阶段跳过，见 revealTruth）：push `phase_change`、发线索（照旧）→ 若有 dm：拼 instruction（阶段名；开场阶段指向 publicCtx 首段的 `caseIntro` 做开场陈词（不重复递入，省 token）；搜证阶段附**本阶段 public 线索的文本**，directed 线索只附"〔某人〕收到一条私下线索"的事实、**不附内容**）→ `dm.speak(publicContext(...), instruction)`。
  2. **revealTruth**：push `clue_release(truth)`（照旧）→ 若有 dm：instruction 附 truth 文本 → 生成复盘词。
  3. 话术入流：`{ type: "utterance", actor: "dm", visibility: "public" }`，CLI transcript 自然带出。
- 数据流一句话：**GameGraph（看真相，只出动作和"要宣布的文本"）→ DMSpeaker（只见 publicCtx + 递来的文本）→ 校验闸 → 公开事件流。**
- 备忘：DM 话术嵌在 enterPhase/revealTruth 内、不在 `plan()` 的 steps 里——代价是这两类 step 不再是"确定性瞬时"（含一次 LLM 调用）。Phase 2 人在环若要在"结构公告之后、DM 话术之前"插交互断点，需把 dmSay 拆成独立 GraphStep。
- 成本上界：每局 +8 次 LLM 调用（7 个阶段开场白 + 1 复盘词；投票/计票不另加话术，`phase_change(投票)` 的开场白已覆盖）。

## 5. DM 输出校验闸 — `src/engine/leak.ts`

DM 输出同样过闸：`stripStageDirections` + 泄密检测。

```ts
/** DM 话术泄密检测：禁止集合 = 所有未公开 info（全部 private + 未发布 directed/public + omniscient）。 */
export function detectDMLeak(text: string, scenario: Scenario, state: GameState): string | null;
```

- 比玩家更严：玩家的禁止集合随"自己可见"豁免，DM 没有豁免——它本来就不该知道任何私密。复用规则 1 的 aliases 子串匹配；无 self_bury（DM 不是凶手）。
- 已知边界：WUYE 的 truth 故意无 aliases（3a 决策，加了会误伤玩家合法指认），因此 `detectDMLeak` 对真相实际零检测力——真相防泄完全靠第一道闸（`publicContext` 架构上不含 truth）。第二道闸对真相的意义在未来"DM 专用 aliases"需要时再议（现在不做）。
- 已知边界（同类取舍）：directed 线索**已发布即出禁**——但发布只意味着 owner 收到，内容对其他人仍是秘密，DM 公开说出仍属泄密。现实风险极低（第一道闸保证 DM 拿不到 directed 内容，只剩幻觉撞 alias，且 WUYE 的 C4/C7 无 aliases），故接受；未来动 leak.ts 时可考虑只豁免 `public && revealed`。
- **复盘阶段免检**：真相已公开宣布，无密可泄；强检反而会被秘密 aliases（"00:20"等）误伤复盘解说。实现上 revealTruth 的 DM 话术不过 `detectDMLeak`（清洗仍做）。
- **降级 = 放弃，不重试**：DM 话术泄密 / 清洗后为空 / `speak` 抛错 → 直接不产话术事件，整局照跑（结构公告兜底在场）。与玩家发言（必需品，重说 2 次）定位不同：话术是锦上添花，重试只增延迟。永不崩盘成本为零。

## 6. 测试策略

- **`dm.test.ts`**（fake router，无 LLM）：`aiDMSpeaker` 把 publicCtx/instruction 注入 prompt、走 "dm" 角色；返回文本原样上交（清洗在 graph 层）。
- **`context.test.ts` 增补**：`publicContext` 含 caseIntro 与公开事件；**不含任何秘密文本、不含 truth 文本**（隔离断言，核心卖点）。
- **`graph.test.ts` 增补**（fake DMSpeaker）：
  - 每阶段产生 `actor:"dm"` 话术事件；复盘 instruction 含 truth 文本。
  - 搜证 instruction 含本阶段 public 线索文本、**不含 directed 线索文本**；递给 dm 的 publicCtx 不含秘密/真相。
  - dm 抛错 / 话术泄密 → 无 dm 事件、整局照跑、其余事件流不变。
  - **不传 dm → 公开事件流与现状完全一致**（回归保护）。
- **`leak.test.ts` 增补**：`detectDMLeak` 命中未公开线索/秘密 alias；已发布线索放行；动态随 `revealedInfo` 收缩。
- 改动后跑 `npm run eval`（K=3）对照 3a 基线：完成率/指认率/sanity 不退化；记录调用数（预期 ≈12+8/局）与时长涨幅。

## 7. 决策点

| | 决策 | 选择 | 状态 |
|---|---|---|---|
| A | 范围 | 最小三件（阶段开场白+线索宣布并入+复盘词），串场/NPC 不做 | 已确认 |
| B | 实现方案 | 独立组件 `dm.ts` + GameGraph 可选注入；不伪装 Participant、不做纯模板 | 已确认 |
| C | truth 放开方式 | 上层递文本进 instruction，不改 DM 可见集 | 已确认 |
| D | directed 线索 | DM 只宣布"谁收到私下线索"，内容不递给 DM | 已确认 |
| E | DM 校验闸 | `detectDMLeak` 禁止集合=所有未公开 info；复盘免检；降级=放弃不重试 | 已确认 |
| F | 模型路由 | 复用 LLMRouter 既有 "dm" 角色（V4-Pro / env 覆盖），不新增配置 | 已确认 |

## 8. 文件落点

- `src/engine/dm.ts` — `DMSpeaker` 接口 + `aiDMSpeaker`（新建）。
- `src/engine/dm.test.ts` — DMSpeaker 工厂测试（新建）。
- `src/engine/context.ts` — 新增 `publicContext`。
- `src/engine/leak.ts` — 新增 `detectDMLeak`。
- `src/engine/graph.ts` — 构造器可选 `dm` 参数 + enterPhase/revealTruth 接入。
- `src/engine/graph.test.ts` / `context.test.ts` / `leak.test.ts` — 增补测试。
- `src/play.ts` — 创建 `aiDMSpeaker` 注入 GameGraph（CLI 全自动局带 DM 话术）。
