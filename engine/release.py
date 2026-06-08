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

from engine.models import DIRECTED, PUBLIC, Event, GameState
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
