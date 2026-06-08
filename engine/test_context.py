# -*- coding: utf-8 -*-
"""可见上下文不得含他人秘密 / 真相 / 未公开线索。"""
from engine.context import visible_context
from engine.models import Event, GameState
from engine.release import reveal_clues_for_phase
from engine.scenario import WUYE


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
    assert "你就是凶手" not in ctx        # 陈博秘密里的句子
    assert "凶手是陈博" not in ctx        # 真相文本
    assert "42 码" not in ctx and "42码" not in ctx   # C3 属搜证2，尚未公开


def test_context_directed_only_for_owner():
    state = _state_after_search1()       # C4 定向给林雅
    assert "遗嘱副本是你拿走的" in visible_context("林雅", WUYE, state)
    assert "遗嘱副本是你拿走的" not in visible_context("陈博", WUYE, state)
