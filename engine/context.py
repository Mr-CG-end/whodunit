# -*- coding: utf-8 -*-
"""把 pid 此刻能合法看到的一切渲染成可塞进 prompt 的文本。

只读 VisibilityGate 的产物（secret / 已公开 public / 已投递 directed）+ 公开发言事件。
结构上不触碰别人的秘密、真相、未公开线索 —— 故"prompt 里不含未授权信息"可被单测证明。
"""
from __future__ import annotations

from engine.models import DIRECTED, PRIVATE, PUBLIC, GameState
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
