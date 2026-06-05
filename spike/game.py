# -*- coding: utf-8 -*-
"""spike 主循环：3 个 AI 玩家 + 1 个 AI DM，纯命令行跑完一局《雨夜书房》。

这是文档 §9 说的"一次性 spike"——无前端、无 WebSocket、无漂亮架构，
目的就一个：亲眼看 AI 演得有没有意思、会不会自爆、卡不卡。

刻意保留了两处和正式设计同源的做法，方便长大：
- 玩家上下文一律走 visibility.visible_context_for（信息隔离）。
- DM 在【复盘】前拿不到 TRUTH 和任何人的 secret（DM 安全边界 = 拆角色，不靠自律）。
"""

import json
import os
import re
import sys
import time

if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 GBK，切成 UTF-8 才能打中文/emoji
    sys.stdout.reconfigure(encoding="utf-8")

from scenario import (
    CASE_INTRO, CLUE_BATCHES, KILLER, PLAYERS, TRUTH,
)
from visibility import visible_context_for
from llm import chat

PLAYER_MODEL = os.environ.get("PLAYER_MODEL", "deepseek-ai/DeepSeek-V3")
DM_MODEL = os.environ.get("DM_MODEL", "deepseek-ai/DeepSeek-V3")

# ── 系统提示 ──────────────────────────────────────────────────────────

def player_system(pid):
    return (
        "你正在玩一场【剧本杀】推理游戏，这是虚构演绎、不是真实事件，请尽情入戏。\n"
        f"你扮演「{pid}」。规则：\n"
        "1. 你【只】知道下面提供给你的信息，严禁编造不存在的线索、证物或人物。\n"
        "2. 为达成目标，你可以隐瞒、回避、避重就轻、甚至说谎来保护自己的秘密——"
        "游戏允许且鼓励，别跳戏、别说『作为AI』之类的话。\n"
        "3. 你不知道别人的秘密，也不知道真凶是谁（除非你自己就是）。不要假装知道你无从得知的事。\n\n"
        "【输出格式】严格只输出一个 JSON 对象，四个字段：\n"
        '  {"think": "私下盘算", "action": "speak/silent/question/push_vote", "target": "对象名或null", "say": "你公开说出口的话"}\n'
        "- think 是【只有你自己看得到】的内心活动，别人永远看不到。请按这几步想："
        "①刚出现的线索说明了什么 ②我现在最怀疑谁、为什么 ③别人会怎么看我、我有没有露馅 ④这一轮我决定做什么动作、针对谁。\n"
        "- action：speak=正常发言；silent=这轮不开口、观察；question=当众质问 target；push_vote=提议大家投 target。"
        "自我介绍和投票阶段一律用 speak；只有圆桌讨论才考虑 silent/question/push_vote。该出手就出手，该藏就藏。\n"
        "- target：action 为 question/push_vote 时填被针对者的名字，其它情况填 null。\n"
        "- say 是你真正说出口的话：像牌桌上的真人那样，口语、简短（1~2 句），有态度（silent 时可留空）。\n"
        "- 【严禁】在 say 里出现任何括号、星号、动作、表情、心理描写或旁白——那些别人根本听不到，只能放进 think。\n"
        "只输出这个 JSON，前后不要任何多余文字。"
    )


def parse_turn(raw):
    """从模型输出抠出 (think, action, target, say, ok)。
    ok=False 表示没能解析出 JSON —— 调用方必须重生成或用安全发言兜底，
    【绝不能把 raw 原文广播出去】（否则半坏 JSON / 混入的 think 会泄露给全场，见 §7）。"""
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            obj = json.loads(raw[start:end + 1])
            think = (obj.get("think") or "").strip()
            say = (obj.get("say") or "").strip()
            action = (obj.get("action") or "speak").strip().lower()
            tgt = obj.get("target")
            target = tgt.strip() if isinstance(tgt, str) else None
            if action not in ("speak", "silent", "question", "push_vote"):
                action = "speak"
            return think, action, target, say, True
        except (json.JSONDecodeError, AttributeError):
            pass
    return "", "speak", None, raw.strip(), False

DM_SYSTEM = (
    "你是这场剧本杀的主持人（DM）。职责：用生动简洁的语言主持流程、宣布阶段、公布线索、"
    "引导三位嫌疑人（林雅、陈博、苏婉）讨论。\n"
    "铁律：在【复盘揭真相】之前，你并不知道谁是凶手，也绝不能暗示或泄露真相——"
    "你只负责把交给你的内容主持出来。\n"
    "严禁编造剧本里没有的证据、物件、监控录像或新细节——只能转述已经公布/交给你的线索。"
    "说话简洁、带点悬疑气氛，每次 2~4 句，别替玩家下结论。"
)

DM_SYSTEM_REVEAL = (
    "你是这场剧本杀的主持人（DM），现在进入最后的【复盘揭真相】环节。"
    "请郑重揭晓凶手、把破案推理讲清楚，让大家恍然大悟。语气可有仪式感，4~8 句。\n"
    "【硬性约束】只能依据下面交给你的真相文本来复盘，严禁编造剧本里没有的证据、"
    "物件编号、监控录像等任何新细节。"
)

# ── 工具 ─────────────────────────────────────────────────────────────

# 凶手自爆/认罪关键短语：既用于【在线】拦截重生成，也用于赛后不变量断言
SELF_BURY = ["我是凶手", "是我杀", "人是我杀", "我杀了", "我杀害", "凶手就是我",
             "我承认是我", "是我下的手", "我动手杀", "确实是我干的", "人是我害"]

# 旁白/动作清洗：剧本杀里 say 中的（括号）和*星号*几乎都是舞台说明，公开发言一律剥掉。
# 注意不碰「」/“”引号（苏婉那种把整句话引起来的用法是合法发言）。
_STAGE_RE = re.compile(r"[（(【\[][^）)】\]]*[）)】\]]|[*＊][^*＊]+[*＊]")


def strip_stage_directions(say):
    """剥掉 say 里的（旁白）、*动作* 等，只留真正说出口的话（codex #5：输出校验而非只靠 prompt）。"""
    return _STAGE_RE.sub("", say).strip()


def leaks(pid, say):
    """在线泄密拦截（规则层 stub，不是完整 LeakDetector）。命中返回原因，否则 None。
    spike 只兜最致命的一类：凶手在公开发言里认罪/自曝。
    其余玩家因 VisibilityGate 根本看不到别人的秘密，无从在 say 里说出来 —— 语义级泄露留给主线的离线 judge。"""
    if pid == KILLER:
        for kw in SELF_BURY:
            if kw in say:
                return f"凶手自曝「{kw}」"
    return None


def chat_safe(model, system, user, temperature=0.8):
    """任何单次调用失败都只降级、不崩盘（文档 §7 铁律）。"""
    try:
        return chat(model, system, user, temperature=temperature)
    except Exception as e:  # noqa: BLE001  spike 阶段粗兜底
        print(f"   ⚠ LLM 调用失败，降级为安全发言：{e}")
        return ("……我再想想，先听听各位怎么说。", 0.0)


def parse_vote(pid, text):
    candidates = [p for p in PLAYERS if p != pid]
    # 严格格式优先："我投：某某"
    m = re.search(r"我投[:：]\s*([一-龥]{2,4})", text)
    if m:
        name = m.group(1)
        for c in candidates:
            if c in name or name in c:
                return c
    # 兜底前先抹掉"不投X/没投X/不是X/别投X"这类否定，避免"我不投陈博，我投苏婉"被误判（codex #6）
    cleaned = re.sub(r"(不投|没投|不是|别投|不可能是|没杀)\s*[一-龥]{2,4}", "", text)
    hits = {c: cleaned.find(c) for c in candidates if c in cleaned}
    return min(hits, key=hits.get) if hits else None


# ── 主循环 ───────────────────────────────────────────────────────────

def run():
    public_log = []                       # 所有人可见（喂给 visibility）
    directed_log = {p: [] for p in PLAYERS}  # 定向线索，私有
    private_memory = {p: [] for p in PLAYERS}  # 每人私有 think 回流 —— 零成本记忆
    transcript = []                       # 完整记录（含旁白标记），用于录制回放
    timings = []                          # (谁, 耗时) —— 看延迟
    killer_lines = []                     # 凶手的发言，赛后扫自爆
    votes = {}

    def record(line):
        print(line)
        transcript.append(line)

    def dm_say(instruction, *, reveal=False, temperature=0.8):
        system = DM_SYSTEM_REVEAL if reveal else DM_SYSTEM
        if reveal:
            user = instruction
        else:
            ctx = ("【目前公开发生的事】\n" + "\n".join(public_log) + "\n\n") if public_log else ""
            user = ctx + instruction
        text, dt = chat_safe(DM_MODEL, system, user, temperature=temperature)
        timings.append(("DM", dt))
        record(f"\n🎙️ DM（{dt:.1f}s）：{text}")
        public_log.append(f"DM：{text}")
        return text

    def player_turn(pid, instruction, can_act=True):
        """一次回合。can_act=True：agent 自选动作（发言/沉默/质询/归票）；
        can_act=False：强制普通发言（自我介绍、投票、被质问的回应——后者防止质询无限套娃）。
        输出过一道校验闸：解析失败 / 凶手自曝 → 重生成一次；仍不行用安全发言，
        【绝不广播模型原文】（codex #3/#4）。旁白确定性清洗（codex #5）。
        返回 {action, target, say}，沉默时返回 None。"""
        ctx = visible_context_for(pid, public_log, directed_log, private_memory[pid])
        full = ctx + "\n\n【现在轮到你】" + instruction
        think, action, target, say = "", "speak", None, ""
        dt_total, accepted = 0.0, False
        for _ in range(2):  # 最多两次：被拦截就重生成一次（§7：重试 → 降级）
            raw, dt = chat_safe(PLAYER_MODEL, player_system(pid), full)
            dt_total += dt
            think, action, target, say, ok = parse_turn(raw)
            say = strip_stage_directions(say)
            reason = ("JSON 解析失败" if not ok else None) or leaks(pid, say)
            if not reason:
                accepted = True
                break
            record(f"   ♻ {pid} 输出被拦截（{reason}），重生成一次…")
        timings.append((pid, dt_total))
        if not accepted:  # 两次都没过 → 安全公开发言，绝不把模型原文/私有推理广播出去
            think, action, target, say = "", "speak", None, "……我先听听各位怎么说，再表态。"

        if think:  # 私有思维链：打到控制台供你观察，但绝不进 public_log
            record(f"   🧠 {pid}（私有·不广播）：{think}")
            private_memory[pid].append(f"[你上一轮的盘算] {think}")
            private_memory[pid][:] = private_memory[pid][-3:]  # 只留最近3条，防膨胀

        if target not in PLAYERS or target == pid:  # 规整非法/自指对象
            target = None
        if not can_act:                              # 受限回合：只准发言
            action = "speak"
        if action in ("question", "push_vote") and target is None:  # 无合法对象 → 降级
            action = "speak"

        if action == "silent" or not say:
            record(f"\n🤐 {pid}（{dt_total:.1f}s）选择沉默观察。")
            return None
        if action == "question":
            record(f"\n🗣️ {pid}（{dt_total:.1f}s）当众质问 {target}：{say}")
            public_log.append(f"{pid}（质问{target}）：{say}")
        elif action == "push_vote":
            record(f"\n📢 {pid}（{dt_total:.1f}s）提议大家投 {target}：{say}")
            public_log.append(f"{pid}（提议投{target}）：{say}")
        else:
            record(f"\n🗣️ {pid}（{dt_total:.1f}s）：{say}")
            public_log.append(f"{pid}：{say}")
        if pid == KILLER:  # 自曝在线已拦截；这里再记一份供赛后不变量断言
            killer_lines.append(say)
        return {"action": action, "target": target, "say": say}

    record(f"================  《雨夜书房》spike  ================")
    record(f"玩家模型: {PLAYER_MODEL}   DM模型: {DM_MODEL}\n")

    # ① 开场
    record("\n────────  ① 开场  ────────")
    dm_say("请你开场，向在场三位嫌疑人宣布这起案件的案情：\n\n"
           + CASE_INTRO
           + "\n\n宣布完后，请大家准备各自做自我介绍。")

    # ② 自我介绍
    record("\n────────  ② 自我介绍  ────────")
    for pid in PLAYERS:
        player_turn(pid, "请做个简短的自我介绍：你是谁、和死者周明远是什么关系。（你的秘密能藏就藏）",
                    can_act=False)

    # ③/⑤ 搜证两轮，中间夹讨论
    for rnd, batch in enumerate(CLUE_BATCHES, start=1):
        record(f"\n────────  ③ 搜证 · 第{rnd}轮  ────────")
        for clue in batch:
            if clue["scope"] == "public":
                line = f"【线索{clue['id']}】{clue['text']}"
                public_log.append(line)
                record("   " + line)
            else:  # directed
                directed_log[clue["to"]].append(f"【线索{clue['id']}·只给你】{clue['text']}")
                record(f"   （DM 私下把线索{clue['id']}递给了 {clue['to']}）")
        dm_say("请把刚刚出现的这些新线索向大家公布、简短点评气氛即可，但不要替大家下结论。")

        record(f"\n────────  ④ 圆桌讨论 · 第{rnd}轮  ────────")
        for pid in PLAYERS:
            res = player_turn(pid,
                "结合目前所有线索，【你自己决定】这一轮怎么做：陈述看法、点名质问某人(question)、"
                "提议大家投某人(push_vote)、或先沉默观察(silent)。")
            # 被点名质问者立刻回应一次（封顶一次、不再触发新质问，防套娃）
            if res and res["action"] == "question" and res["target"]:
                player_turn(res["target"], f"{pid} 刚当众质问了你，请简短回应或辩解。", can_act=False)

    # ⑥ 投票
    record("\n────────  ⑥ 投票指认  ────────")
    dm_say("线索都摆出来了，现在请三位投票指认你心中的凶手。")
    for pid in PLAYERS:
        others = "、".join(p for p in PLAYERS if p != pid)
        res = player_turn(pid, f"现在投票指认凶手，只能从『{others}』里选一个（不能投自己）。"
                               "请严格用这个格式开头：我投：某某。然后用一句话说明理由。", can_act=False)
        votes[pid] = parse_vote(pid, res["say"]) if res else None

    # ⑦ 复盘揭真相（此处才把 TRUTH 交给 DM）
    # codex #2：事实以确定性 TRUTH 文本为准，先原样打出来；DM 只在其上做低温、受约束的旁白。
    record("\n────────  ⑦ 复盘揭真相  ────────")
    record(f"\n📜 本案真相（标准答案 · 确定性输出，不依赖 LLM）：\n{TRUTH}")
    dm_say("现在请你以 DM 身份，【仅依据下面这段真相】郑重揭晓凶手并复盘，"
           "不得添加任何剧本之外的新证据或细节：\n\n" + TRUTH, reveal=True, temperature=0.2)

    # ── 赛后：极简"不变量断言"（eval 台的雏形）──
    record("\n================  赛后小结  ================")
    record(f"投票结果：{votes}")
    tally = {}
    for v in votes.values():
        if v:
            tally[v] = tally.get(v, 0) + 1
    record(f"票数统计：{tally}")
    if tally:
        top = max(tally, key=tally.get)
        ok = "✅ 抓对了" if top == KILLER else "❌ 抓错了"
        record(f"多数票指向：{top}（真凶：{KILLER}） → {ok}")

    burned = next((kw for u in killer_lines for kw in SELF_BURY if kw in u), None)
    record(f"凶手自爆检测：{'⚠ 疑似自爆，命中「' + burned + '」' if burned else '✅ 未发现明显自爆'}")

    llm_calls = [t for t in timings if t[1] > 0]
    total = sum(dt for _, dt in llm_calls)
    if llm_calls:
        record(f"延迟：{len(llm_calls)} 次有效调用，合计 {total:.1f}s，平均 {total/len(llm_calls):.1f}s/次")

    # 录制 transcript（对应 P0 切片第 5 步）
    os.makedirs(os.path.join(os.path.dirname(__file__), "transcripts"), exist_ok=True)
    path = os.path.join(os.path.dirname(__file__), "transcripts",
                        f"run-{time.strftime('%Y%m%d-%H%M%S')}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(transcript))
    record(f"\n📄 本局 transcript 已存：{path}")


if __name__ == "__main__":
    run()
