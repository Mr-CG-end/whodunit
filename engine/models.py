# -*- coding: utf-8 -*-
"""最小数据模型 —— 设计文档 §4「最小数据模型」的正式落地。

所有组件（VisibilityGate / LeakDetector / eval）都围绕这三个结构展开：
- InfoItem：一条可见性受控的信息（私密剧本/秘密/目标/线索/真相都是它）。
- Event：对局中发生的一件事（发言/发线索/投票/阶段切换）。
- GameState：引擎单一事实源。
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ── 可见范围（设计文档 §6）─────────────────────────────────────────────
PRIVATE = "private"        # 私密：仅 owners（角色私密剧本、秘密、目标）
PUBLIC = "public"          # 公开：所有人（公开发言、已公布线索、DM 公告）
DIRECTED = "directed"      # 定向：仅 owners（DM 私发给某人的线索）
OMNISCIENT = "omniscient"  # 全知：仅引擎/DM（真相、凶手）—— 玩家永不可见

SCOPES = (PRIVATE, PUBLIC, DIRECTED, OMNISCIENT)


@dataclass(frozen=True)
class InfoItem:
    """一条可见性受控的信息。`id` 是 prompt 组装与泄密检测的锚点。"""
    id: str
    scope: str                        # PRIVATE / PUBLIC / DIRECTED / OMNISCIENT
    text: str
    owners: tuple[str, ...] = ()      # scope=private/directed 时，能看到它的参与者
    reveal_phase: str | None = None   # 最早可公开的阶段；早于此阶段出现即视为泄密
    aliases: tuple[str, ...] = ()     # 别名/同义表达，供 LeakDetector 规则层比对
    tags: tuple[str, ...] = ()

    def __post_init__(self):
        if self.scope not in SCOPES:
            raise ValueError(f"未知 scope: {self.scope!r}，应为 {SCOPES}")


@dataclass
class Event:
    """对局中发生的一件事。"""
    id: str
    type: str          # utterance / clue_release / vote / phase_change
    actor: str         # 参与者 id，或 "DM" / "engine"
    visibility: str    # public / directed / private
    payload: dict = field(default_factory=dict)


@dataclass
class GameState:
    """引擎单一事实源。"""
    phase: str = "开场"
    participants: list[str] = field(default_factory=list)
    public_events: list[Event] = field(default_factory=list)
    private_events: dict[str, list[Event]] = field(default_factory=dict)  # pid -> events
    revealed_info: set[str] = field(default_factory=set)                  # 已公开的 info_id
