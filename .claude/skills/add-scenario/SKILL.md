---
name: add-scenario
description: Use when adding a new murder-mystery scenario to the whodunit engine (e.g. 难本二号), or when editing scenario data / clue visibility / aliases for an existing one.
---

# 加新剧本（Scenario）

## 核心原则
剧本是**纯数据，引擎零改动**。新本只新增 `src/engine/scenario-<name>.ts`（一个 `export const <NAME>: Scenario`），复用 `scenario.ts` 的 `Scenario` / `PHASES` / `item()`。确定性核心走 **TDD**：先写不变量测试看红，再填数据看绿。

## 铁律（动手前必读）
- 信息隔离靠代码：每条信息标 `scope` / `owners` / `revealPhase`，VisibilityGate 据此装配。
- `private`（秘密）`revealPhase: null`、对 owner 恒可见；`directed` 须 owner **且已发布**；`omniscient`（truth）玩家永不可见、复盘才揭、**无 aliases**。
- 凶手秘密 `tags: ["secret","killer"]`（leak.ts 的 SELF_BURY 检测依赖它）。
- **防误伤（宁漏不误伤）**：秘密的 alias 不得是任何其他 InfoItem 文本的子串；关键词若横跨多条线索（如沈园的「乌头碱/汇票」），就**不要**设成 alias——公开/定向线索可整体留空 alias，泄密质量交给 eval，而不是用会误伤合法讨论的 alias。

## 步骤
1. **设计文档** `docs/specs/<date>-scenario-<name>-design.md`：角色/秘密表、线索发放表（逐条标 scope/owner/revealPhase）、难度机关、测试清单（§6）、决策点。
2. **写不变量测试（先红）** `src/engine/scenario-<name>.test.ts`，覆盖四组：① 结构（killer∈participants、private/directed 有合法 owner、revealPhase∈phases、omniscient 仅 truth 一条且复盘且无 alias、条目计数）；② 可解性（链碎片 owner 互不相同、不落在凶手/红鲱鱼手里）；③ 防误伤（秘密 alias 非他文本子串）；④ VisibilityGate 对新本参数化。`npx vitest run <test>` 看红。
3. **填数据（后绿）** `src/engine/scenario-<name>.ts`：用 `item()` 建条目，`export const`。看绿。
4. **注册** `src/engine/scenarios.ts`：加进 `SCENARIOS` 记录（`--scenario=<name>` 即可选）。
5. **验证**：`npm test` + `npm run typecheck` + `npx biome check <你改/建的文件>` 全绿。
6. **eval 区分度（需真实 API）**：`npm run eval -- --scenario=<name>` 对照 WUYE 基线；难本的 accuracyRate 应**显著低于** WUYE。不够毒就回炉调**剧本文本**，绝不调引擎。

## 常见错误
- 改了引擎 / `PHASES` → 与 WUYE 的 eval 数据不再同构可比。**别动**，剧本是唯一变量。
- 把横跨多条线索的词设成秘密 alias → 误伤合法讨论（防误伤测试会红）。
- truth 加了 aliases → 误伤合法指认。
- 注册表写回 `scenario.ts` → 与 `scenario-<name>.ts` 循环依赖；注册表必须留在独立的 `scenarios.ts`。

## 参照实现
《沈园夜宴》：`src/engine/scenario-shenyuan.ts` + `scenario-shenyuan.test.ts`（commit 330a85f）。
