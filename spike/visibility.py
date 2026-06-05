# -*- coding: utf-8 -*-
"""VisibilityGate 的雏形：算出某个玩家此刻"被允许看到"的信息。

这是整个项目的核心学习点——信息隔离。spike 版很糙，但有一条铁律：
它【只】读取该玩家自己的 secret、公开日志、以及私发给该玩家的线索；
绝不触碰别人的 secret、别人的定向线索、或 TRUTH。

正因为它结构上只读这三样，"装配进 prompt 的信息里不含未授权内容"就是
可以被单测确定性证明的（见 test_visibility.py）——对应文档 §1 验收 #2 的第一层。
"""

from scenario import CHARACTERS


def visible_context_for(pid, public_log, directed_log, own_memory=None):
    """拼出玩家 pid 能看到的上下文文本。

    参数:
        pid:          玩家名，如 "林雅"
        public_log:   list[str]，全场公开发生的事（DM 公告、公开线索、所有人发言）
        directed_log: dict[str, list[str]]，每人私有的定向线索
        own_memory:   list[str] | None，【该玩家自己】的私有盘算（私有 think 回流）。
                      调用方只能传入 pid 本人的记忆——别人的记忆从不经过这里，
                      所以"不泄露"这条铁律仍然成立。
    返回:
        str，可直接塞进该玩家 prompt 的可见信息。
    """
    own = CHARACTERS[pid]
    parts = [
        f"【你的身份】{own['public']}",
        f"【你的秘密 · 只有你知道】{own['secret']}",
    ]
    if own_memory:
        parts.append("【你之前的私下盘算 · 只有你知道，注意与它保持一致】\n" + "\n".join(own_memory))
    if public_log:
        parts.append("【目前公开发生的事】\n" + "\n".join(public_log))
    mine = directed_log.get(pid, [])
    if mine:
        parts.append("【只发给你的线索】\n" + "\n".join(mine))
    return "\n\n".join(parts)
