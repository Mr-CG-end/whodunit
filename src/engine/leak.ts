// 输出校验闸 —— design §4 双保险的第二道闸（事后检测）。
// 第一道闸 VisibilityGate 保证"没拿到的无从说起"；这里兜"拿到的/幻觉编造的不该说出口"。
// 设计：docs/specs/2026-06-11-leak-detector-design.md

/** 旁白/动作清洗：剥（…）(…)【…】[…]*…*，保留「」与引号（整句引起来是合法发言）。 */
const STAGE_RE = /[（(【[][^）)】\]]*[）)】\]]|[*＊][^*＊]+[*＊]/g;

export function stripStageDirections(text: string): string {
  return text.replace(STAGE_RE, "").trim();
}
