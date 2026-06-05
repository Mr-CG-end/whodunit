# -*- coding: utf-8 -*-
"""可见性闸门的信息隔离自检——spike 里唯一"必须确定性正确"的东西。

对应文档 §1 验收 #2 第一层：装配进任何玩家上下文里的信息，绝不含未授权内容。
不调 LLM、零依赖，直接 `python test_visibility.py`。
"""

import sys
if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 GBK，切成 UTF-8 才能打中文/emoji
    sys.stdout.reconfigure(encoding="utf-8")

from scenario import CHARACTERS, PLAYERS, TRUTH
from visibility import visible_context_for


def test_isolation():
    # 造一份典型对局状态：公开发言 + 给林雅的定向线索 + 每人各自的私有盘算
    public_log = ["DM：案情已公布。", "林雅：我什么都不知道。", "【线索C1】凶器是青铜鼎。"]
    directed_log = {p: [] for p in PLAYERS}
    directed_log["林雅"] = ["【线索C4·只给你】遗嘱是你拿的。"]
    memory = {p: [f"[{p}的私有盘算-勿外泄]"] for p in PLAYERS}

    for pid in PLAYERS:
        ctx = visible_context_for(pid, public_log, directed_log, memory[pid])

        # 1) 看得到自己的秘密、自己的私有盘算
        assert CHARACTERS[pid]["secret"] in ctx, f"{pid} 看不到自己的秘密"
        assert f"[{pid}的私有盘算-勿外泄]" in ctx, f"{pid} 看不到自己的记忆"

        # 2) 绝不含上帝视角真相
        assert TRUTH not in ctx, f"{pid} 的上下文里漏了真相！"

        # 3) 绝不含别人的秘密、别人的私有盘算
        for other in PLAYERS:
            if other != pid:
                assert CHARACTERS[other]["secret"] not in ctx, f"{pid} 看到了 {other} 的秘密！"
                assert f"[{other}的私有盘算-勿外泄]" not in ctx, f"{pid} 看到了 {other} 的私有盘算！"

        # 4) 绝不含发给别人的定向线索
        if pid != "林雅":
            assert "遗嘱是你拿的" not in ctx, f"{pid} 看到了发给林雅的定向线索！"

    print("✅ 可见性隔离自检通过：每人只看到自己的秘密/盘算 + 公开信息 + 发给自己的线索。")


if __name__ == "__main__":
    test_isolation()
