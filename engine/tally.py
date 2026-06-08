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
