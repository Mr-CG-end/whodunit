# -*- coding: utf-8 -*-
"""VisibilityGate —— 设计文档 §4 标星核心组件之一。

事前隔绝：算出某参与者此刻【能合法看到】的 InfoItem 集合。物理上不把不该看的装进来，
就没有"无从说起"。这是整个项目"用架构约束全知模型"的第一道闸。
"""
from __future__ import annotations

from engine.models import DIRECTED, PRIVATE, PUBLIC, GameState, InfoItem
from engine.scenario import Scenario


def visible_info_for(pid: str, scenario: Scenario, state: GameState) -> list[InfoItem]:
    """参与者 pid 此刻能合法看到的信息。

    铁律：
    - private（秘密）：仅 owner 可见；reveal_phase=None，对 owner 恒可见。
    - directed（定向线索）：仅 owner 可见，且须已发布（item.id ∈ revealed_info，受 reveal_phase 约束）——
      早于 reveal_phase 即视为提前泄露，故不能像 private 那样无条件返回。
    - public：仅当该 info_id 已进入 state.revealed_info（已公布）才可见。
    - omniscient（真相）：玩家永不可见 —— 不在任何分支里返回。
    """
    out: list[InfoItem] = []
    for item in scenario.info_items:
        if item.scope == PRIVATE:
            if pid in item.owners:
                out.append(item)
        elif item.scope == DIRECTED:
            if pid in item.owners and item.id in state.revealed_info:
                out.append(item)
        elif item.scope == PUBLIC:
            if item.id in state.revealed_info:
                out.append(item)
        # OMNISCIENT：故意不处理 —— 玩家无论如何拿不到
    return out
