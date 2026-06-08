// 《雨夜书房》—— 结构化剧本（VisibilityGate 直接吃它）。每条信息都带 scope / owners / revealPhase。
import type { InfoItem, Scope } from "./models";

export interface Scenario {
  id: string;
  title: string;
  /** AI 玩家（不含 NPC 死者）。 */
  participants: string[];
  caseIntro: string;
  phases: string[];
  infoItems: InfoItem[];
  killer: string;
}

export const PHASES = ["开场", "自我介绍", "搜证1", "讨论1", "搜证2", "讨论2", "投票", "复盘"];

/** 建 InfoItem 的小工具：填默认值，让下面的剧本数据保持可读。 */
function item(
  id: string,
  scope: Scope,
  text: string,
  opts: { owners?: string[]; revealPhase?: string | null; aliases?: string[]; tags?: string[] } = {},
): InfoItem {
  return {
    id,
    scope,
    text,
    owners: opts.owners ?? [],
    revealPhase: opts.revealPhase ?? null,
    aliases: opts.aliases ?? [],
    tags: opts.tags ?? [],
  };
}

const caseIntro =
  "雨夜，收藏家周明远邀三位客人到山庄做客。今晨，周明远被发现死在书房：头部遭钝器重击，" +
  "书桌上一尊青铜鼎沾有血迹。书房门从内反锁，三位客人昨夜都宿在山庄客房。" +
  "法医推定死亡时间在昨夜 00:00 至 01:00 之间。";

const infoItems: InfoItem[] = [
  // ── 私密：各人的秘密（仅本人可见，永不公开）──
  item(
    "secret_林雅",
    "private",
    "你负债累累，急需这笔遗产。昨夜 00:40 你偷偷溜进书房想偷一份遗嘱副本——进门时周明远已经" +
      "倒在地上没了气息，你慌乱中扶过桌上那尊青铜鼎，然后只拿走遗嘱就跑了。你没有杀人。你必须死死" +
      "隐瞒『昨夜进过书房』这件事，因为一旦承认，凶器上你的指纹会让你百口莫辩。",
    { owners: ["林雅"], tags: ["secret"] },
  ),
  item(
    "secret_陈博",
    "private",
    "三个月前你卖给周明远的那尊『商周青铜鼎』其实是现代仿品。周明远已经起疑、请人鉴定，扬言要" +
      "公开揭穿你、毁掉你的招牌。昨夜约 00:20 你溜进书房与他争执，失手用那尊鼎将他打死。你对外一口" +
      "咬定『整夜没离开过房间』。你就是凶手，但绝不能露馅、绝不能自爆。",
    { owners: ["陈博"], tags: ["secret", "killer"] },
  ),
  item(
    "secret_苏婉",
    "private",
    "你与周明远有过一段旧情。昨夜你和他在书房激烈争吵过——但争吵是因为你提醒他『那尊鼎来路可疑，" +
      "赶紧找人鉴定，别被人骗了』。你还给失眠的他送过安眠药（常规剂量，吃不死人）。你没有杀人。你想" +
      "隐瞒那段旧情、也怕被卷进来，但你心里清楚：周生前在提防一个『卖假货给他的人』。",
    { owners: ["苏婉"], tags: ["secret"] },
  ),

  // ── 搜证第一轮：公开 + 一条定向给林雅 ──
  item("C1", "public", "法医报告：死因为头部钝器重击；死亡时间窗 00:00–01:00；凶器为书桌上的青铜鼎，鼎身有死者血迹。", {
    revealPhase: "搜证1",
  }),
  item("C2", "public", "青铜鼎上检出两组指纹：死者周明远的，以及——林雅的。", {
    revealPhase: "搜证1",
    aliases: ["林雅的指纹", "指纹"],
  }),
  item("C5", "public", "管家证词：昨晚饭后，曾听到苏婉与周明远在书房里激烈争吵。", {
    revealPhase: "搜证1",
    aliases: ["争吵", "苏婉争吵"],
  }),
  item("C4", "directed", "（只有你知道）遗嘱副本是你拿走的；你进书房时，周明远已经倒地不动。", {
    owners: ["林雅"],
    revealPhase: "搜证1",
  }),

  // ── 搜证第二轮：公开 + 一条定向给苏婉 ──
  item("C3", "public", "现场勘查：书房门从内反锁，但窗户没有闩死；窗外泥地上有一行脚印，约 42 码男鞋。", {
    revealPhase: "搜证2",
    aliases: ["42码", "脚印", "男鞋"],
  }),
  item("C6", "public", "书桌上发现一份第三方鉴定草稿：周明远送检的那尊『商周青铜鼎』，被判定为现代仿制品。", {
    revealPhase: "搜证2",
    aliases: ["仿品", "赝品", "鉴定"],
  }),
  item("C8", "public", "今晨发现：陈博房中的外套下摆沾着泥、皮鞋是湿的；但陈博坚称自己『整夜没出过房间』。", {
    revealPhase: "搜证2",
    aliases: ["湿皮鞋", "沾泥", "整夜没出"],
  }),
  item("C9", "public", "旧账目显示：那尊青铜鼎是三个月前由陈博经手卖给周明远的。", {
    revealPhase: "搜证2",
    aliases: ["陈博卖", "经手"],
  }),
  item("C7", "directed", "（只有你知道）你和周明远的争吵其实是你在提醒他『那鼎来路可疑、快去鉴定』。", {
    owners: ["苏婉"],
    revealPhase: "搜证2",
  }),

  // ── 全知：真相（仅引擎/DM，复盘阶段才揭）──
  item(
    "truth",
    "omniscient",
    "凶手是陈博。他卖给周明远的青铜鼎是仿品，周明远识破后扬言要曝光他，他凌晨在书房争执中失手用" +
      "那尊鼎打死了周明远。林雅的指纹只是她偷遗嘱、发现尸体时碰到鼎留下的；苏婉与周的争吵是在提醒他" +
      "提防被骗，安眠药也非致死。破案链——动机：鼎是仿品、且正是陈博卖的，周要曝光他；" +
      "机会：42 码脚印 + 陈博湿鞋沾泥外套戳穿『整夜没出房』。",
    { revealPhase: "复盘", tags: ["truth"] },
  ),
];

export const WUYE: Scenario = {
  id: "wuye-shufang",
  title: "雨夜书房",
  participants: ["林雅", "陈博", "苏婉"],
  caseIntro,
  phases: PHASES,
  infoItems,
  killer: "陈博",
};
