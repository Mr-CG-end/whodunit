# -*- coding: utf-8 -*-
"""《雨夜书房》—— 迁进正式 schema 的剧本（spike 内容的结构化版本）。

和 spike/scenario.py 的区别：那边是裸字典 + 字符串，这边每条信息都是带
scope / owners / reveal_phase 的 InfoItem —— VisibilityGate 直接吃它。
"""
from __future__ import annotations

from dataclasses import dataclass

from engine.models import InfoItem, PRIVATE, PUBLIC, DIRECTED, OMNISCIENT


@dataclass
class Scenario:
    id: str
    title: str
    participants: list[str]          # AI 玩家（不含 NPC 死者）
    case_intro: str
    phases: list[str]
    info_items: list[InfoItem]
    killer: str

    def info_by_id(self, info_id: str) -> InfoItem | None:
        return next((i for i in self.info_items if i.id == info_id), None)


PHASES = ["开场", "自我介绍", "搜证1", "讨论1", "搜证2", "讨论2", "投票", "复盘"]

_CASE_INTRO = (
    "雨夜，收藏家周明远邀三位客人到山庄做客。今晨，周明远被发现死在书房：头部遭钝器重击，"
    "书桌上一尊青铜鼎沾有血迹。书房门从内反锁，三位客人昨夜都宿在山庄客房。"
    "法医推定死亡时间在昨夜 00:00 至 01:00 之间。"
)

_INFO = [
    # ── 私密：各人的秘密（仅本人可见，永不公开）──
    InfoItem("secret_林雅", PRIVATE, owners=("林雅",), reveal_phase=None, tags=("secret",), text=(
        "你负债累累，急需这笔遗产。昨夜 00:40 你偷偷溜进书房想偷一份遗嘱副本——进门时周明远已经"
        "倒在地上没了气息，你慌乱中扶过桌上那尊青铜鼎，然后只拿走遗嘱就跑了。你没有杀人。你必须死死"
        "隐瞒『昨夜进过书房』这件事，因为一旦承认，凶器上你的指纹会让你百口莫辩。")),
    InfoItem("secret_陈博", PRIVATE, owners=("陈博",), reveal_phase=None, tags=("secret", "killer"), text=(
        "三个月前你卖给周明远的那尊『商周青铜鼎』其实是现代仿品。周明远已经起疑、请人鉴定，扬言要"
        "公开揭穿你、毁掉你的招牌。昨夜约 00:20 你溜进书房与他争执，失手用那尊鼎将他打死。你对外一口"
        "咬定『整夜没离开过房间』。你就是凶手，但绝不能露馅、绝不能自爆。")),
    InfoItem("secret_苏婉", PRIVATE, owners=("苏婉",), reveal_phase=None, tags=("secret",), text=(
        "你与周明远有过一段旧情。昨夜你和他在书房激烈争吵过——但争吵是因为你提醒他『那尊鼎来路可疑，"
        "赶紧找人鉴定，别被人骗了』。你还给失眠的他送过安眠药（常规剂量，吃不死人）。你没有杀人。你想"
        "隐瞒那段旧情、也怕被卷进来，但你心里清楚：周生前在提防一个『卖假货给他的人』。")),

    # ── 搜证第一轮：公开 + 一条定向给林雅 ──
    InfoItem("C1", PUBLIC, reveal_phase="搜证1", text=(
        "法医报告：死因为头部钝器重击；死亡时间窗 00:00–01:00；凶器为书桌上的青铜鼎，鼎身有死者血迹。")),
    InfoItem("C2", PUBLIC, reveal_phase="搜证1", aliases=("林雅的指纹", "指纹"), text=(
        "青铜鼎上检出两组指纹：死者周明远的，以及——林雅的。")),
    InfoItem("C5", PUBLIC, reveal_phase="搜证1", aliases=("争吵", "苏婉争吵"), text=(
        "管家证词：昨晚饭后，曾听到苏婉与周明远在书房里激烈争吵。")),
    InfoItem("C4", DIRECTED, owners=("林雅",), reveal_phase="搜证1", text=(
        "（只有你知道）遗嘱副本是你拿走的；你进书房时，周明远已经倒地不动。")),

    # ── 搜证第二轮：公开 + 一条定向给苏婉 ──
    InfoItem("C3", PUBLIC, reveal_phase="搜证2", aliases=("42码", "脚印", "男鞋"), text=(
        "现场勘查：书房门从内反锁，但窗户没有闩死；窗外泥地上有一行脚印，约 42 码男鞋。")),
    InfoItem("C6", PUBLIC, reveal_phase="搜证2", aliases=("仿品", "赝品", "鉴定"), text=(
        "书桌上发现一份第三方鉴定草稿：周明远送检的那尊『商周青铜鼎』，被判定为现代仿制品。")),
    InfoItem("C8", PUBLIC, reveal_phase="搜证2", aliases=("湿皮鞋", "沾泥", "整夜没出"), text=(
        "今晨发现：陈博房中的外套下摆沾着泥、皮鞋是湿的；但陈博坚称自己『整夜没出过房间』。")),
    InfoItem("C9", PUBLIC, reveal_phase="搜证2", aliases=("陈博卖", "经手"), text=(
        "旧账目显示：那尊青铜鼎是三个月前由陈博经手卖给周明远的。")),
    InfoItem("C7", DIRECTED, owners=("苏婉",), reveal_phase="搜证2", text=(
        "（只有你知道）你和周明远的争吵其实是你在提醒他『那鼎来路可疑、快去鉴定』。")),

    # ── 全知：真相（仅引擎/DM，复盘阶段才揭）──
    InfoItem("truth", OMNISCIENT, reveal_phase="复盘", tags=("truth",), text=(
        "凶手是陈博。他卖给周明远的青铜鼎是仿品，周明远识破后扬言要曝光他，他凌晨在书房争执中失手用"
        "那尊鼎打死了周明远。林雅的指纹只是她偷遗嘱、发现尸体时碰到鼎留下的；苏婉与周的争吵是在提醒他"
        "提防被骗，安眠药也非致死。破案链——动机：鼎是仿品、且正是陈博卖的，周要曝光他；"
        "机会：42 码脚印 + 陈博湿鞋沾泥外套戳穿『整夜没出房』。")),
]

WUYE = Scenario(
    id="wuye-shufang",
    title="雨夜书房",
    participants=["林雅", "陈博", "苏婉"],
    case_intro=_CASE_INTRO,
    phases=PHASES,
    info_items=_INFO,
    killer="陈博",
)
