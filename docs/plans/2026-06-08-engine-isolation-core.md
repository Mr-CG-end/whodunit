# 引擎确定性域核心（信息隔离 + 发牌 + 计票）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 spike 里"信息隔离 + 按阶段发线索 + 计票"这三块确定性逻辑，迁成跑在 `GameState` 上、可被单测确定性证明的 `engine/` 域核心——其中 `VisibilityGate` 补上 `reveal_phase` 不变量（修掉定向线索提前可见的缺陷）。

**Architecture:** 纯 Python 域逻辑，**不引入 LangGraph、不调用 LLM**。所有函数都吃 `Scenario` + `GameState`（设计文档 §4 的最小数据模型），输出可断言的确定性结果。这是设计文档 §3 中"④剧本杀核心（自研）"与"③编排（LangGraph，下一个 plan）"解耦的下半截：核心先独立成立、独立测试，编排层之后再套上来。

**Tech Stack:** Python 3.12（标准库 + dataclasses）；测试用 **pytest**（本 plan 首次引入）。运行期保持零第三方依赖。

**约定：**
- 在 `main` 之外的特性分支上做（Task 1 第一步建分支）。
- 所有命令走 **uv**：`uv run pytest`（跑测试）、`uv run ruff check .`（查错），等价于激活 `.venv` 后直接运行。
- 每个 task 末尾 `git commit`；提交信息用中文 conventional 风格（与首个提交一致），并在消息末行追加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 现有文件状态：`engine/models.py`（`InfoItem`/`Event`/`GameState`/scope 常量）、`engine/scenario.py`（`Scenario` + `WUYE` + `PHASES`）、`engine/visibility.py`（`visible_info_for`）、`engine/test_visibility.py`（3 个裸 assert 测试）均已存在。

---

## File Structure

| 文件 | 责任 | 本 plan 动作 |
|---|---|---|
| `pyproject.toml` | 项目清单：依赖 + pytest/Ruff 配置（uv 管理） | 新建 |
| `engine/visibility.py` | VisibilityGate：算某人合法可见的 `InfoItem` 集合 | 改：DIRECTED 也受 `reveal_phase` 约束 |
| `engine/release.py` | 按 `reveal_phase` 把线索发进 `GameState`（确定性发牌） | 新建 |
| `engine/context.py` | 把可见信息渲染成可塞 prompt 的文本 | 新建 |
| `engine/tally.py` | 计票：统计票数 / 取多数 | 新建 |
| `engine/test_visibility.py` | VisibilityGate 不变量（含 reveal_phase） | 改：更新+新增用例 |
| `engine/test_release.py` | 发牌时机正确、不泄真相 | 新建 |
| `engine/test_context.py` | 可见上下文不含他人秘密/真相/未公开线索 | 新建 |
| `engine/test_tally.py` | 计票/多数/并列/弃权 | 新建 |

---

### Task 1: 工程脚手架（特性分支 + uv + pyproject + Ruff + pytest）

**Files:**
- Create: `pyproject.toml`

- [ ] **Step 1: 建特性分支**

Run:
```bash
git checkout -b feat/engine-isolation-core
```
Expected: `Switched to a new branch 'feat/engine-isolation-core'`

- [ ] **Step 2: 确认 uv 可用（没有就装）**

Run:
```bash
uv --version
```
若找不到命令，先装：`pip install uv`（或见 https://docs.astral.sh/uv/ 的独立安装脚本），再重试。

- [ ] **Step 3: 写项目清单 `pyproject.toml`**

Create `pyproject.toml`（运行期零依赖；dev 依赖 pytest+ruff；pytest/ruff 配置内联同文件）:
```toml
[project]
name = "whodunit"
version = "0.1.0"
description = "AI 剧本杀（多智能体）—— 用架构约束全知模型、演好信息受限的角色"
requires-python = ">=3.12"
dependencies = []

[dependency-groups]
dev = ["pytest>=8", "ruff>=0.6"]

[tool.uv]
package = false

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["engine"]
python_files = ["test_*.py"]

[tool.ruff]
line-length = 100
target-version = "py312"
exclude = ["spike", ".venv"]

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
```

- [ ] **Step 4: 建环境 + 装依赖**

Run:
```bash
uv sync
```
Expected: 生成 `.venv/` 与 `uv.lock`，装上 pytest、ruff。

- [ ] **Step 5: 跑现有测试，确认基线绿**

Run:
```bash
uv run pytest -q
```
Expected: 现有 `engine/test_visibility.py` 的 3 个用例 PASS（`3 passed`）。

- [ ] **Step 6: 跑 Ruff，确认 engine 代码干净**

Run:
```bash
uv run ruff check .
```
Expected: `All checks passed!`（如有可自动修的 import 顺序等：`uv run ruff check --fix .`）。

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: 工程脚手架——uv + pyproject + Ruff + pytest"
```
（`.venv/` 已被 `.gitignore` 忽略，不入库。）

---

### Task 2: VisibilityGate 让 DIRECTED 线索也守 `reveal_phase`

**背景缺陷：** 现版 `visible_info_for` 把 `PRIVATE` 和 `DIRECTED` 一并按"仅 owner 可见"处理，**忽略了 `reveal_phase`**。后果：定向线索 `C7`（给苏婉，`reveal_phase=搜证2`）从开局就对苏婉可见 = 提前泄露。修法：把两者拆开——`PRIVATE`（秘密，`reveal_phase=None`）对 owner 恒可见；`DIRECTED`（定向线索）须 owner 且**已发布**（`id in revealed_info`）才可见。

**Files:**
- Modify: `engine/visibility.py`
- Test: `engine/test_visibility.py`

- [ ] **Step 1: 写失败测试（定向线索须发布后才可见）**

在 `engine/test_visibility.py` 末尾（`if __name__` 之前）追加：
```python
def test_directed_clue_respects_reveal_phase():
    # 未发布：C4（定向给林雅，reveal_phase=搜证1）对谁都不可见
    empty = _state(revealed=set())
    for pid in WUYE.participants:
        assert "C4" not in {i.id for i in visible_info_for(pid, WUYE, empty)}, \
            f"C4 未发布却对 {pid} 可见 —— 定向线索提前泄露！"
    # 已发布：只有收件人林雅可见
    after = _state(revealed={"C4"})
    assert "C4" in {i.id for i in visible_info_for("林雅", WUYE, after)}
    for other in ("陈博", "苏婉"):
        assert "C4" not in {i.id for i in visible_info_for(other, WUYE, after)}
```

- [ ] **Step 2: 跑测试，确认失败**

Run:
```bash
uv run pytest engine/test_visibility.py::test_directed_clue_respects_reveal_phase -q
```
Expected: FAIL —— 断言 "C4 未发布却对 林雅 可见" 触发（现实现对 owner 无条件返回 DIRECTED）。

- [ ] **Step 3: 修 VisibilityGate**

把 `engine/visibility.py` 里的循环体替换为（把 PRIVATE 与 DIRECTED 拆开）：
```python
    out: list[InfoItem] = []
    for item in scenario.info_items:
        if item.scope == PRIVATE:
            # 秘密：reveal_phase=None，对 owner 恒可见
            if pid in item.owners:
                out.append(item)
        elif item.scope == DIRECTED:
            # 定向线索：owner 且已发布（受 reveal_phase 约束）才可见
            if pid in item.owners and item.id in state.revealed_info:
                out.append(item)
        elif item.scope == PUBLIC:
            if item.id in state.revealed_info:
                out.append(item)
        # OMNISCIENT：故意不处理 —— 玩家无论如何拿不到
    return out
```
（`PRIVATE / PUBLIC / DIRECTED` 已在文件顶部 import，无需改 import。）

- [ ] **Step 4: 更新原有用例以匹配新语义**

`engine/test_visibility.py` 里 `test_directed_only_to_owner` 原本用 `revealed=set()` 断言 C4 可见——新语义下 C4 须先发布。把该函数体改为：
```python
def test_directed_only_to_owner():
    state = _state(revealed={"C4"})                      # C4 已发布
    assert "C4" in {i.id for i in visible_info_for("林雅", WUYE, state)}  # 定向给林雅
    for other in WUYE.participants:
        if other != "林雅":
            assert "C4" not in {i.id for i in visible_info_for(other, WUYE, state)}
```

- [ ] **Step 5: 新增穷尽不变量——未来阶段的线索绝不可见**

在 `engine/test_visibility.py` 追加（只发布"搜证1"那批，断言"搜证2"那批一律不可见）：
```python
def test_no_future_phase_clue_visible():
    # 只发布搜证1的线索（C1/C2/C5 公开 + C4 定向给林雅）
    state = _state(revealed={"C1", "C2", "C5", "C4"})
    future = {"C3", "C6", "C8", "C9", "C7"}   # 搜证2 那批（含定向 C7 给苏婉）
    for pid in WUYE.participants:
        ids = {i.id for i in visible_info_for(pid, WUYE, state)}
        assert not (ids & future), f"{pid} 看到了未来阶段线索：{ids & future}"
        assert "truth" not in ids
```

- [ ] **Step 6: 跑全部可见性测试，确认全绿**

Run:
```bash
uv run pytest engine/test_visibility.py -q
```
Expected: PASS（5 个用例：原 3 个 + 新 2 个，`test_directed_only_to_owner` 已更新）。

- [ ] **Step 7: Commit**

```bash
git add engine/visibility.py engine/test_visibility.py
git commit -m "fix: 定向线索纳入 reveal_phase 约束，堵住提前泄露；补穷尽不变量"
```

---

### Task 3: 按 `reveal_phase` 确定性发牌

`reveal_clues_for_phase` 把"`reveal_phase` 等于该阶段"的线索发出去：`PUBLIC` 进 `revealed_info` + `public_events`；`DIRECTED` 进 `revealed_info` + 收件人的 `private_events`。`OMNISCIENT`（真相）与 `PRIVATE`（秘密）**不经此发布**——真相绝不会因为"进入复盘阶段"而被写进任何人可见的地方。

**Files:**
- Create: `engine/release.py`
- Test: `engine/test_release.py`

- [ ] **Step 1: 写失败测试**

Create `engine/test_release.py`:
```python
# -*- coding: utf-8 -*-
"""按 reveal_phase 发牌的确定性测试。"""
from engine.models import GameState
from engine.scenario import WUYE
from engine.release import reveal_clues_for_phase
from engine.visibility import visible_info_for


def _fresh():
    return GameState(participants=list(WUYE.participants))


def test_search1_releases_exactly_its_clues():
    state = _fresh()
    reveal_clues_for_phase(WUYE, state, "搜证1")
    assert state.revealed_info == {"C1", "C2", "C5", "C4"}
    public_ids = {e.payload["info_id"] for e in state.public_events if e.type == "clue_release"}
    assert public_ids == {"C1", "C2", "C5"}                 # C4 是定向，不进公开
    lin_ids = {e.payload["info_id"] for e in state.private_events.get("林雅", [])}
    assert lin_ids == {"C4"}
    assert "苏婉" not in state.private_events or not state.private_events["苏婉"]


def test_reveal_complan_phase_never_leaks_truth():
    state = _fresh()
    reveal_clues_for_phase(WUYE, state, "复盘")
    assert "truth" not in state.revealed_info
    assert all(e.payload.get("info_id") != "truth" for e in state.public_events)


def test_release_then_gate_sees_search2_directed_only_after_search2():
    state = _fresh()
    reveal_clues_for_phase(WUYE, state, "搜证1")
    assert "C7" not in {i.id for i in visible_info_for("苏婉", WUYE, state)}   # C7 是搜证2
    reveal_clues_for_phase(WUYE, state, "搜证2")
    assert "C7" in {i.id for i in visible_info_for("苏婉", WUYE, state)}
    for other in ("林雅", "陈博"):
        assert "C7" not in {i.id for i in visible_info_for(other, WUYE, state)}
```

- [ ] **Step 2: 跑测试，确认失败**

Run:
```bash
uv run pytest engine/test_release.py -q
```
Expected: FAIL —— `ModuleNotFoundError: No module named 'engine.release'`。

- [ ] **Step 3: 实现发牌**

Create `engine/release.py`:
```python
# -*- coding: utf-8 -*-
"""按 reveal_phase 确定性发牌 —— 设计文档 §4「GameGraph 确定性发线索」的核心动作。

把 reveal_phase==phase 的线索写进 GameState：
- PUBLIC：加入 revealed_info，并广播一条 clue_release 公开事件；
- DIRECTED：加入 revealed_info，并把 clue_release 投进每个 owner 的私有事件；
- PRIVATE（秘密）/ OMNISCIENT（真相）：不经此发布 —— 真相绝不因进入复盘就变得可见。

revealed_info 正是 VisibilityGate 判断 PUBLIC/DIRECTED 可见性的依据，故"发早了"
即"泄露"被收敛成一个可断言的不变量。
"""
from __future__ import annotations

from engine.models import Event, GameState, PUBLIC, DIRECTED
from engine.scenario import Scenario


def reveal_clues_for_phase(scenario: Scenario, state: GameState, phase: str) -> None:
    for item in scenario.info_items:
        if item.reveal_phase != phase:
            continue
        if item.scope == PUBLIC:
            state.revealed_info.add(item.id)
            state.public_events.append(Event(
                id=f"rel_{item.id}", type="clue_release", actor="engine",
                visibility="public", payload={"info_id": item.id, "text": item.text}))
        elif item.scope == DIRECTED:
            state.revealed_info.add(item.id)
            for owner in item.owners:
                state.private_events.setdefault(owner, []).append(Event(
                    id=f"rel_{item.id}_{owner}", type="clue_release", actor="engine",
                    visibility="directed", payload={"info_id": item.id, "text": item.text}))
        # PRIVATE / OMNISCIENT：不发布
```

- [ ] **Step 4: 跑测试，确认通过**

Run:
```bash
uv run pytest engine/test_release.py -q
```
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add engine/release.py engine/test_release.py
git commit -m "feat: 按 reveal_phase 确定性发牌（public 广播 / directed 投递 / 真相不外泄）"
```

---

### Task 4: 可见上下文渲染

`visible_context` 把"某人此刻能合法看到的一切"渲染成一段可直接塞进 prompt 的文本。它**只**消费 `VisibilityGate` 的产物 + 公开发言事件——结构上就装不进别人的秘密、真相、未公开线索。这给 §1 验收 #2 第一层"prompt 组装层硬验收"提供了断言点。

**Files:**
- Create: `engine/context.py`
- Test: `engine/test_context.py`

- [ ] **Step 1: 写失败测试**

Create `engine/test_context.py`:
```python
# -*- coding: utf-8 -*-
"""可见上下文不得含他人秘密 / 真相 / 未公开线索。"""
from engine.models import Event, GameState
from engine.scenario import WUYE
from engine.release import reveal_clues_for_phase
from engine.context import visible_context


def _state_after_search1():
    state = GameState(participants=list(WUYE.participants))
    reveal_clues_for_phase(WUYE, state, "搜证1")
    state.public_events.append(Event(
        id="u1", type="utterance", actor="陈博", visibility="public",
        payload={"text": "我和周明远是多年老友。"}))
    return state


def test_context_includes_own_and_public_excludes_secrets_truth_future():
    state = _state_after_search1()
    ctx = visible_context("林雅", WUYE, state)
    assert "遗嘱" in ctx                 # 林雅自己的秘密（应在）
    assert "我和周明远是多年老友" in ctx   # 公开发言（应在）
    assert "C1" in ctx                   # 已公开线索（应在）
    # 不该出现的：
    assert "你就是凶手" not in ctx        # 陈博秘密里的句子
    assert "凶手是陈博" not in ctx        # 真相文本
    assert "42 码" not in ctx and "42码" not in ctx   # C3 属搜证2，尚未公开


def test_context_directed_only_for_owner():
    state = _state_after_search1()       # C4 定向给林雅
    assert "遗嘱副本是你拿走的" in visible_context("林雅", WUYE, state)
    assert "遗嘱副本是你拿走的" not in visible_context("陈博", WUYE, state)
```

- [ ] **Step 2: 跑测试，确认失败**

Run:
```bash
uv run pytest engine/test_context.py -q
```
Expected: FAIL —— `ModuleNotFoundError: No module named 'engine.context'`。

- [ ] **Step 3: 实现渲染**

Create `engine/context.py`:
```python
# -*- coding: utf-8 -*-
"""把 pid 此刻能合法看到的一切渲染成可塞进 prompt 的文本。

只读 VisibilityGate 的产物（secret / 已公开 public / 已投递 directed）+ 公开发言事件。
结构上不触碰别人的秘密、真相、未公开线索 —— 故"prompt 里不含未授权信息"可被单测证明。
"""
from __future__ import annotations

from engine.models import GameState, PRIVATE, PUBLIC, DIRECTED
from engine.scenario import Scenario
from engine.visibility import visible_info_for


def visible_context(pid: str, scenario: Scenario, state: GameState) -> str:
    items = visible_info_for(pid, scenario, state)
    secrets = [i for i in items if i.scope == PRIVATE]
    public_clues = [i for i in items if i.scope == PUBLIC]
    directed = [i for i in items if i.scope == DIRECTED]

    parts: list[str] = []
    for s in secrets:
        parts.append(f"【你的秘密 · 只有你知道】{s.text}")
    if public_clues:
        parts.append("【已公开的线索】\n" + "\n".join(f"[{i.id}] {i.text}" for i in public_clues))
    if directed:
        parts.append("【只发给你的线索】\n" + "\n".join(f"[{i.id}] {i.text}" for i in directed))
    utterances = [e for e in state.public_events if e.type == "utterance"]
    if utterances:
        parts.append("【目前公开发言】\n" + "\n".join(
            f"{e.actor}：{e.payload.get('text', '')}" for e in utterances))
    return "\n\n".join(parts)
```

- [ ] **Step 4: 跑测试，确认通过**

Run:
```bash
uv run pytest engine/test_context.py -q
```
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add engine/context.py engine/test_context.py
git commit -m "feat: 可见上下文渲染（只装授权信息，可单测证明无泄露）"
```

---

### Task 5: 计票

`tally_votes` 统计每人得票；`majority` 取唯一多数（并列第一或空票返回 `None`，不强行裁决）。纯函数，与对局状态无耦合。

**Files:**
- Create: `engine/tally.py`
- Test: `engine/test_tally.py`

- [ ] **Step 1: 写失败测试**

Create `engine/test_tally.py`:
```python
# -*- coding: utf-8 -*-
"""计票纯函数测试。"""
from engine.tally import tally_votes, majority


def test_tally_counts_and_ignores_abstain():
    votes = {"林雅": "陈博", "陈博": "林雅", "苏婉": "陈博", "弃权者": None}
    assert tally_votes(votes) == {"陈博": 2, "林雅": 1}


def test_majority_picks_unique_top():
    assert majority({"林雅": "陈博", "陈博": "林雅", "苏婉": "陈博"}) == "陈博"


def test_majority_none_on_tie_or_empty():
    assert majority({"a": "X", "b": "Y"}) is None     # 1:1 并列
    assert majority({}) is None                        # 空票
    assert majority({"a": None}) is None               # 全弃权
```

- [ ] **Step 2: 跑测试，确认失败**

Run:
```bash
uv run pytest engine/test_tally.py -q
```
Expected: FAIL —— `ModuleNotFoundError: No module named 'engine.tally'`。

- [ ] **Step 3: 实现计票**

Create `engine/tally.py`:
```python
# -*- coding: utf-8 -*-
"""计票：统计票数 / 取唯一多数。纯函数。"""
from __future__ import annotations


def tally_votes(votes: dict[str, str | None]) -> dict[str, int]:
    """votes: {投票人: 被投者 | None} → {被投者: 票数}，忽略弃权(None)。"""
    counts: dict[str, int] = {}
    for target in votes.values():
        if target:
            counts[target] = counts.get(target, 0) + 1
    return counts


def majority(votes: dict[str, str | None]) -> str | None:
    """得票唯一最高者；并列第一或无有效票时返回 None（不强行裁决）。"""
    counts = tally_votes(votes)
    if not counts:
        return None
    top = max(counts.values())
    leaders = [name for name, c in counts.items() if c == top]
    return leaders[0] if len(leaders) == 1 else None
```

- [ ] **Step 4: 跑测试，确认通过**

Run:
```bash
uv run pytest engine/test_tally.py -q
```
Expected: PASS（3 个用例）。

- [ ] **Step 5: 跑全套测试 + Commit**

Run:
```bash
uv run pytest -q
```
Expected: 全绿（visibility 5 + release 3 + context 2 + tally 3 = 13 passed）。

```bash
git add engine/tally.py engine/test_tally.py
git commit -m "feat: 计票（统计/多数/并列与弃权处理）"
```

---

## Self-Review

**1. Spec coverage（对照设计文档 §4/§6/§8 确定性部分）：**
- VisibilityGate「无他人秘密 / 无真相 / public 须已公布」→ Task 2 全覆盖；新增「定向受 reveal_phase 约束」「无未来阶段线索」两条不变量。✅
- 「线索发早了＝泄密，由 reveal_phase 收敛成不变量」→ Task 3（发牌）+ Task 2/Task 3 的 gate 联测。✅
- 「prompt 组装层硬验收：不含未授权 info」→ Task 4（context 不含他人秘密/真相/未公开线索）。✅
- GameGraph 阶段推进 / 投票组织 / LeakDetector / LLM → **不在本 plan**，属 Plan 2（LangGraph 编排 + agents）与 Plan 3（eval）。本 plan 只交付"④核心"里与框架无关、可独立证明的确定性域逻辑。✅（范围有意收窄）

**2. Placeholder scan：** 无 TODO / "略" / "类似上文"；每个 code step 均含完整代码。✅

**3. Type consistency：** `visible_info_for(pid, scenario, state)`、`reveal_clues_for_phase(scenario, state, phase)`、`visible_context(pid, scenario, state)`、`tally_votes(votes)`/`majority(votes)` 全程签名一致；`Event` 字段（id/type/actor/visibility/payload）与 `engine/models.py` 现有定义一致；`clue_release` 的 `payload["info_id"]`/`["text"]` 在 Task 3 写入、Task 3/4 读取，键名一致。✅

---

## 后续 plan（本 plan 完成后再各自展开）

> **编排决策（2026-06-08，据 codex review 收敛）：** 主链路**手写极简显式状态机**（领域规则与编排运行时分离）；LangGraph **不进主链路**，作独立 spike + 对比 ADR。理由：当前复杂度下显式状态机更透明、可单测、易内化；框架价值在运行时能力（checkpoint/恢复/并发/中断），当人在环/恢复收益超过依赖成本时再替换编排层。**绝不为"证明能力"手写一套劣化版 LangGraph**——手写的只是项目独有的领域状态机。

- **Plan 2 — 手写编排 + agents（主链路）：** 用一个**极简、显式的领域状态机**（纯函数 + 明确转移，几十~百行；不是图引擎）把本 plan 的核心串成一局：开场/自我介绍/搜证·讨论×N/投票/复盘。新增 `PlayerAgent`/`DMAgent` 接口 + `MockPlayer`/`MockDM`（控制流可单测）+ LLM 实现（复用 `spike/llm.py`）。迁入 `parse_turn`/`strip_stage_directions` 与 LeakDetector 在线规则层（凶手自曝）。**编排与领域解耦**：领域逻辑不依赖任何编排实现，为可替换编排层留缝。交付：`python -m engine.run` 跑通真实自动对局。
- **Plan 3 — eval 台：** 跑 K 局自动对局，聚合不变量（阶段顺序、可见性、凶手不自爆、投票合法）+ 指标（完成率、延迟、拦截次数），产出数字表 + 录制 transcript。
- **Plan 4（独立、不进主链路）— LangGraph adapter spike + 对比 ADR：** 用 `from langgraph.graph import StateGraph, START, END` 把**同一套领域逻辑**接进 LangGraph，做一个小而真的实验，**实际用到** checkpoint（`InMemorySaver`）、state reducer（`Annotated[list, add]` / 自定义并集）、`add_conditional_edges`（搜证↔讨论可配置轮数）、`interrupt`（对应 Phase 2 人在环真人轮次的暂停/恢复）——这才足以支撑简历上的"会 LangGraph"。配一条 ADR：手写 vs LangGraph 取舍，结论＝当前复杂度显式状态机更透明，当恢复/并发/人工中断收益超过依赖成本时替换编排层而不动领域逻辑。

---

## Execution Handoff

Plan 完成并保存于 `docs/plans/2026-06-08-engine-isolation-core.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 task 派一个全新 subagent 实现，task 间我来审，迭代快。
2. **Inline Execution** — 在当前会话用 executing-plans 按批次执行，带检查点供你审阅。

选哪种？
