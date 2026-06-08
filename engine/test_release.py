# -*- coding: utf-8 -*-
"""按 reveal_phase 发牌的确定性测试。"""
from engine.models import GameState
from engine.release import reveal_clues_for_phase
from engine.scenario import WUYE
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


def test_reveal_fupan_never_leaks_truth():
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
