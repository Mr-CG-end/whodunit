# -*- coding: utf-8 -*-
"""计票纯函数测试。"""
from engine.tally import majority, tally_votes


def test_tally_counts_and_ignores_abstain():
    votes = {"林雅": "陈博", "陈博": "林雅", "苏婉": "陈博", "弃权者": None}
    assert tally_votes(votes) == {"陈博": 2, "林雅": 1}


def test_majority_picks_unique_top():
    assert majority({"林雅": "陈博", "陈博": "林雅", "苏婉": "陈博"}) == "陈博"


def test_majority_none_on_tie_or_empty():
    assert majority({"a": "X", "b": "Y"}) is None     # 1:1 并列
    assert majority({}) is None                        # 空票
    assert majority({"a": None}) is None               # 全弃权
