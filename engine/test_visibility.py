# -*- coding: utf-8 -*-
"""VisibilityGate 的 TDD 规格 —— 设计文档 §8 第 1 层「最重要、必须稳过」的确定性测试。

断言四条铁律：
1. 每人看得到自己的私密信息；
2. 永远看不到别人的私密信息；
3. 永远看不到全知真相（omniscient）；
4. 公开线索只有在「已公布」后才可见；定向线索只有收件人可见。

跑法（仓库根目录）：python -m engine.test_visibility
"""
import sys

if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 GBK，切 UTF-8 才能打中文/emoji
    sys.stdout.reconfigure(encoding="utf-8")

from engine.models import GameState, OMNISCIENT, PUBLIC
from engine.scenario import WUYE
from engine.visibility import visible_info_for


def _state(revealed=()):
    s = GameState(participants=list(WUYE.participants))
    s.revealed_info = set(revealed)
    return s


def test_own_secret_visible_others_and_truth_not():
    state = _state(revealed={"C1", "C2", "C5"})
    for pid in WUYE.participants:
        ids = {i.id for i in visible_info_for(pid, WUYE, state)}
        assert f"secret_{pid}" in ids, f"{pid} 看不到自己的秘密"
        for other in WUYE.participants:
            if other != pid:
                assert f"secret_{other}" not in ids, f"{pid} 看到了 {other} 的秘密！"
        assert "truth" not in ids, f"{pid} 看到了全知真相！"
        assert not any(i.scope == OMNISCIENT for i in visible_info_for(pid, WUYE, state))


def test_public_only_after_revealed():
    # 还没公布任何线索 → 看不到任何公开 InfoItem
    empty = _state(revealed=set())
    for pid in WUYE.participants:
        vis = visible_info_for(pid, WUYE, empty)
        assert not any(i.scope == PUBLIC for i in vis), "未公布的公开线索竟然可见！"
    # 公布 C1 后才可见，C3（第二轮）仍不可见
    after = _state(revealed={"C1"})
    ids = {i.id for i in visible_info_for("林雅", WUYE, after)}
    assert "C1" in ids and "C3" not in ids


def test_directed_only_to_owner():
    state = _state(revealed=set())
    assert "C4" in {i.id for i in visible_info_for("林雅", WUYE, state)}      # C4 定向给林雅
    for other in WUYE.participants:
        if other != "林雅":
            assert "C4" not in {i.id for i in visible_info_for(other, WUYE, state)}


if __name__ == "__main__":
    test_own_secret_visible_others_and_truth_not()
    test_public_only_after_revealed()
    test_directed_only_to_owner()
    print("✅ engine VisibilityGate TDD 全过：无他人私密 / 无真相 / 公开需已公布 / 定向仅限收件人")
