// 输出校验闸 —— design §4 双保险的第二道闸（事后检测）。
// 第一道闸 VisibilityGate 保证"没拿到的无从说起"；这里兜"拿到的/幻觉编造的不该说出口"。
// 设计：docs/specs/2026-06-11-leak-detector-design.md

import type { GameState } from "./models";
import type { Scenario } from "./scenario";
import { visibleInfoFor } from "./visibility";

/** 旁白/动作清洗：剥（…）(…)【…】[…]*…*，保留「」与引号（整句引起来是合法发言）。 */
const STAGE_RE = /[（(【[][^）)】\]]*[）)】\]]|[*＊][^*＊]+[*＊]/g;

export function stripStageDirections(text: string): string {
  return text.replace(STAGE_RE, "").trim();
}

/** 凶手自爆/认罪短语（沿用 spike 验证过的词表）。只对 scenario.killer 生效，无误伤面。 */
const SELF_BURY = [
  "我是凶手",
  "是我杀",
  "人是我杀",
  "我杀了",
  "我杀害",
  "凶手就是我",
  "我承认是我",
  "是我下的手",
  "我动手杀",
  "确实是我干的",
  "人是我害",
];

/**
 * 公开发言 text 是否泄露了 pid 不该说出口的信息。命中返回泄露的 info_id（自爆返回 "self_bury"），干净返回 null。
 * 规则1：禁止集合 = pid 此刻不可见的 info（真相/别人的秘密/未发布线索），发言含其任一 alias 即泄密。
 * 规则2：凶手说出自爆短语（自己的秘密对自己可见，规则1 盖不住这条，故单列）。
 */
export function detectLeak(pid: string, text: string, scenario: Scenario, state: GameState): string | null {
  const visible = new Set(visibleInfoFor(pid, scenario, state).map((i) => i.id));
  for (const item of scenario.infoItems) {
    if (visible.has(item.id)) continue;
    if (item.aliases.some((a) => a !== "" && text.includes(a))) return item.id;
  }
  if (pid === scenario.killer && SELF_BURY.some((kw) => text.includes(kw))) return "self_bury";
  return null;
}
