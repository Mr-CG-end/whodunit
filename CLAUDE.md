# CLAUDE.md — whodunit 项目指南

> 给 Claude Code 的常驻指南：每次会话加载。这里写**不看代码就看不出来**的约定与决策；细节见 `docs/`。

## 这是什么

`whodunit` —— **AI 多智能体剧本杀引擎**：1 真人 + 一桌 AI 玩家 + 1 AI DM，跑完整一局（开场→搜证→讨论→投票→复盘）。

**核心命题（也是作品集卖点）：用架构、而非提示词，把"本来能看到全部游戏状态的 LLM"约束成只知道自己那份信息的角色。** 双目标：① agent 工程能力证明（作品集）；② 能给剧本杀同好试玩、按反馈迭代的真实产品。

## 工具链 / 常用命令

- Python 3.12，**uv** 管理依赖与环境，**pytest** 测试，**Ruff** 查错+格式化。
- `uv sync` 建环境装依赖；`uv run pytest -q` 跑测试；`uv run ruff check .` 查错（`uv run ruff check --fix .` 自动修）。
- **运行期零依赖**（仅标准库）。新增运行期依赖要慎重、要说明理由。`.venv/` 不入库。

## 仓库结构

- `engine/` — **正式领域核心**，主战场。`models.py`(InfoItem/Event/GameState) · `scenario.py`(Scenario+WUYE+PHASES) · `visibility.py`(VisibilityGate) · `test_*.py`。
- `spike/` — 一次性探针，**已完成、已验证假设，不是主线代码**。别在它上面盖正式功能；要的逻辑迁进 `engine/`。
- `docs/specs/` — 设计文档 + PRD。`docs/plans/` — 分阶段实现计划（TDD 任务清单）。

## 架构铁律（改动前必读）

1. **信息隔离由代码强制，绝不靠提示词/框架。** 玩家 prompt 只装 `visible_info_for(pid, scenario, state)` 的产物——没拿到的就无从说起。
2. **`reveal_phase` 是不变量**：线索发早了＝泄密。`PRIVATE`(秘密) 对 owner 恒可见；`DIRECTED`(定向线索) 须 owner **且已发布**(`id ∈ revealed_info`)；`OMNISCIENT`(真相) 玩家永不可见。
3. **编排主链路手写。** `GameGraph` = **手写的确定性控制器，不是 LangGraph**。LangGraph 只作不进主链路的独立 spike（见 design §10）。别在主链路引入 LangGraph。
4. **DM 安全边界 = 拆角色**：`GameGraph`（确定性、看真相、只出动作）+ `DMSpeaker`（只拿 public-safe context、无权看全量真相）。真相只在复盘阶段才放开给 DMSpeaker。
5. **永不崩盘**：任何单个 AI/LLM 失败只降级、不崩整局（重试→换模型→安全发言）。

## 开发约定

- **TDD**（确定性核心）：先写失败测试→`uv run pytest` 看红→最小实现→看绿→提交。
- **分支**：在 `main` 外的特性分支做。提交用**中文 conventional 风格**，消息末行加：
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **垂直切片分期**：每个里程碑端到端可用、不糊弄（design §9）。Phase 1＝引擎+eval（CLI）；Phase 2＝人在环+真实前端；Phase 3＝打磨分享。
- **差异化内核保持小**：作者会亲手重写核心来内化（路线 A）——别把 VisibilityGate / GameGraph / eval 写臃肿。
- **eval 不做 golden-text 断言**：LLM 部分断言不变量/结构（阶段顺序、可见性、不自爆、投票合法），不比文本。

## 关键文档

- 设计文档：`docs/specs/2026-06-05-whodunit-design.md`
- 产品需求（PRD）：`docs/specs/2026-06-08-whodunit-prd.md`
- 当前计划：`docs/plans/2026-06-08-engine-isolation-core.md`
