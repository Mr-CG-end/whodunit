# 输出校验闸：LeakDetector + 旁白清洗 — 设计（Phase 1 子项目3a）

> 子项目3（质量增强）拆为 **3a 输出校验闸（本文档）** / 3b DMSpeaker / 3c MemoryManager（可能 YAGNI，eval 未暴露记忆漂移）。
>
> 上位设计见 [2026-06-05-whodunit-design.md](2026-06-05-whodunit-design.md) §4（双保险：事前 VisibilityGate + 事后 LeakDetector）、§7（永不崩盘）、§8（测试策略）。承接 [2026-06-09-eval-harness-design.md](2026-06-09-eval-harness-design.md)（eval 台已就位，可度量改动前后差异）。

## 1. 范围

**做**：`detectLeak`（规则层泄密检测）+ `stripStageDirections`（旁白清洗）+ 接进 `GameGraph.doSpeak`（重说→安全发言降级链）+ 补 `WUYE` 剧本秘密/真相的 `aliases`。全部纯确定性，TDD。

**不做**：
- **暗示型/语义级泄露检测**——规则层管不了"话里有话"，留给离线 LLM judge（design §8，未来 eval 扩展）。
- **泄密拦截计数进 eval 指标**——本期先拦住；要量化拦截率等后续 eval 需要时再加。
- **投票环节检测**——投票输出只是一个名字，无泄密面。

> 边界理由：LeakDetector 是 VisibilityGate 的**事后镜像**（design §4 双保险的第二道闸）：第一道闸保证"没拿到的无从说起"，第二道闸兜"拿到的（自己的秘密）/幻觉编造的不该说出口"。规则层只兜确定性可判的最致命类别，宁漏不误伤。

## 2. detectLeak — `src/engine/leak.ts`

```ts
/** 公开发言 text 是否泄露了 pid 不该说出口的信息。命中返回泄露的 info_id，干净返回 null。 */
export function detectLeak(pid: string, text: string, scenario: Scenario, state: GameState): string | null;
```

两条规则，按序检查：

1. **不可见信息规则（核心，复用 `visibleInfoFor`）**：禁止集合 = `scenario.infoItems` 减去 `visibleInfoFor(pid, scenario, state)` ——即 pid **此刻不可见**的信息（真相 / 别人的秘密 / 未发布的线索）。发言文本包含其中任一条的任一 `alias`（子串匹配）→ 返回该 `info_id`。
   - 这是"知识违规"检测：说出了架构上不可能知道的事 = 幻觉或串场，必拦。
   - 随 `state.revealedInfo` 动态变化：线索发布前提它算泄密，发布后自然出禁。
2. **凶手自爆规则（待确认，推荐加）**：`pid === scenario.killer` 时，发言命中自爆短语表（"我是凶手"、"是我杀"、"我杀了"……沿用 spike `SELF_BURY`）→ 返回 `"self_bury"`。
   - 为何规则 1 盖不住：凶手自己的秘密对他**可见**，不在他的禁止集合里；而把自爆短语挂在真相 `aliases` 上会误伤其他玩家的合法假设句（"假如我是凶手……"）。只对凶手生效就无误伤面。
   - spike 已验证这是最致命、也最高频的一类泄露；eval 的"不自爆"不变量依赖它。

不匹配 `text` 与 `InfoItem.text` 本身——原文太长、表述多变，规则层只认人工挑过的 `aliases`。

## 3. stripStageDirections — `src/engine/leak.ts`

迁移 spike `strip_stage_directions`：剥掉 `（…）` `(…)` `【…】` `[…]` `*…*` 等旁白/动作描写，**保留 `「」` 与 `“”` 引号**（整句引起来是合法发言）。治"（林雅微微蹙眉）"式 AI 腔，也防模型把内心戏藏在括号里广播出去。

```ts
export function stripStageDirections(text: string): string;
```

## 4. GameGraph.doSpeak 接入 — `src/engine/graph.ts`

现流程 `speak → push` 改为：

```
speak → strip → detectLeak
  ├─ 干净且非空 → push（清洗后的文本）
  └─ 泄密 / 清洗后为空 → 重说（简单重试，不带"你泄密了"反馈，重试上限 N=2）
       └─ 仍不过 → push 安全发言 SAFE_LINE
```

- **重试不带反馈**：把泄密原因喂回去 = 在 prompt 里复述泄密内容，本身就是泄露面；且 temperature 0.8 下重抽大概率自然避开。
- **清洗后为空**视同无效输出（整句都是旁白），走同一条重说链。
- `player.speak` 抛错仍走现有 try/catch → SAFE_LINE，行为不变；重试也消耗在 LLM 调用上，最坏 3 次调用/发言（成本上界明确）。
- **被拦截的原文绝不进 `publicEvents`**——任何降级路径下进事件流的只有清洗后的干净文本或 SAFE_LINE。

## 5. 补 aliases — `src/engine/scenario.ts`

现状：公开线索 C2/C3/C5/C6/C8/C9 已有 aliases；3 条秘密、真相、定向线索 C4/C7 没有。本期补齐秘密 + 真相 +（视需要）C4/C7。

**调参原则（关键）**：**保守选独有特征词，宁漏不误伤**。

- ❌ 别用"凶手是陈博"当真相 alias——其他玩家根据公开线索合法推理"我认为凶手是陈博"会被误杀，这恰恰是游戏该有的发言。
- ✅ 用该信息**独有**、玩家从公开线索推不出来的因果细节。如 `secret_林雅` 用"遗嘱副本"（案情简介与公开线索均未提遗嘱）；`secret_陈博` 用"失手"；真相用只有全知视角才有的链路表述。
- 每条 alias 都要过一遍"无辜者会不会自然说出这个词"——会，就不用。
- 漏掉的暗示型泄露不归规则层管（§1 不做）。

具体词表在实现计划里逐条钉，并配测试（每条 alias 一正一反：命中样例 + 合法发言不误伤样例）。

## 6. 测试策略

- **`leak.test.ts`**（纯函数，TDD 主体）：
  - `detectLeak`：不可见信息命中（别人的秘密 alias / 未发布线索 alias / 真相 alias）；已发布线索不再算泄密（`state.revealedInfo` 动态性）；自己可见的秘密不触发规则 1；凶手自爆短语命中 / 非凶手说同样的话不触发；合法推理句不误伤。
  - `stripStageDirections`：移植 spike 既有用例（括号/星号剥除、引号保留）+ 全旁白句剥成空串。
- **`graph.test.ts` 增补**（stub Participant，无 LLM）：注入先泄密后干净的 stub → 断言重说生效、`publicEvents` 里只有干净文本；注入永远泄密的 stub → 断言落到 SAFE_LINE、原文未入事件流。
- **不做 golden-text 断言**（铁律）：只断言"该拦的拦了、不该拦的没拦、事件流里没有脏文本"。
- 改动后跑一次 `npm run eval`（K=3）对照子2 基线，确认完成率/不变量没退化——这是 eval 台存在的意义。

## 7. 决策点

| | 决策 | 选择 | 状态 |
|---|---|---|---|
| A | 禁止集合来源 | 复用 `visibleInfoFor` 取补集，不另维护清单 | 已确认 |
| B | 匹配方式 | 人工 aliases 子串匹配；不匹配 info 原文、不做分词/语义 | 已确认 |
| C | 重说策略 | 简单重试不带反馈，上限 N=2，仍不过用 SAFE_LINE | 已确认 |
| D | aliases 调参 | 保守独有特征词，宁漏不误伤；暗示型留离线 eval | 已确认 |
| E | 文件落点 | `src/engine/leak.ts` 新建 + 改 `graph.ts` / `scenario.ts` | 已确认 |
| F | 凶手自爆规则 | killer 专属短语表（沿用 spike `SELF_BURY`），理由见 §2 | 已确认 |

## 8. 文件落点

- `src/engine/leak.ts` — `detectLeak` + `stripStageDirections`（新建）。
- `src/engine/leak.test.ts` — 上述纯函数测试（新建）。
- `src/engine/graph.ts` — `doSpeak` 接入清洗+检测+重说链。
- `src/engine/graph.test.ts` — 增补降级链测试。
- `src/engine/scenario.ts` — 秘密/真相/定向线索补 `aliases`。
