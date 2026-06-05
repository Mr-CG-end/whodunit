# -*- coding: utf-8 -*-
"""确定性单测：输出校验闸的几个纯函数（parse_turn / 旁白清洗 / 在线泄密 / 投票解析）。
对应文档 §8「确定性部分 → TDD，必须稳过」。不调 LLM、不花钱。"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from game import parse_turn, strip_stage_directions, leaks, parse_vote
from scenario import KILLER


def test_parse_turn():
    t = parse_turn('{"think":"x","action":"question","target":"陈博","say":"你好"}')
    assert t[4] is True and t[1] == "question" and t[3] == "你好", t      # 正常 JSON
    t = parse_turn('```json\n{"action":"speak","say":"嗨"}\n```')
    assert t[4] is True and t[3] == "嗨", t                               # 带代码围栏也能抠出
    t = parse_turn('{"action":"hack","say":"嗨"}')
    assert t[1] == "speak", t                                            # 非法 action 归一化
    t = parse_turn("我内心觉得陈博可疑（这其实是泄露的 think）")
    assert t[4] is False, t                                              # 抠不出 → ok=False，调用方不广播原文


def test_strip_stage_directions():
    assert strip_stage_directions("（擦汗）我没杀人*紧张*") == "我没杀人"
    assert strip_stage_directions("(整理领带)你好") == "你好"
    assert strip_stage_directions("「我是苏婉」") == "「我是苏婉」"        # 引号是合法发言，不剥


def test_leaks():
    assert leaks(KILLER, "其实我是凶手") is not None                      # 凶手自曝 → 拦截
    assert leaks(KILLER, "我没动过他") is None                           # 凶手正常否认 → 放行
    assert leaks("林雅", "我是凶手") is None                              # 非凶手不触发


def test_parse_vote():
    assert parse_vote("林雅", "我投：陈博。理由是…") == "陈博"
    assert parse_vote("林雅", "我不投陈博，我投苏婉") == "苏婉"            # 否定不再误判（#6）
    assert parse_vote("林雅", "我也说不好") is None


if __name__ == "__main__":
    for _name, _fn in list(globals().items()):
        if _name.startswith("test_"):
            _fn()
            print(f"✅ {_name}")
    print("✅ 输出校验闸 全部通过")
