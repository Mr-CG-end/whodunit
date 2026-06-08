// 最小数据模型 —— 设计文档 §4。所有组件（VisibilityGate / release / context / eval）都围绕这三个结构。

/** 可见范围（设计文档 §6）。 */
export type Scope = "private" | "public" | "directed" | "omniscient";

/** 一条可见性受控的信息（私密剧本/秘密/目标/线索/真相都是它）。`id` 是 prompt 组装与泄密检测的锚点。 */
export interface InfoItem {
  id: string;
  scope: Scope;
  text: string;
  /** scope=private/directed 时，能看到它的参与者 id。 */
  owners: string[];
  /** 最早可公开的阶段；早于此阶段出现即视为泄密。private（秘密）为 null。 */
  revealPhase: string | null;
  /** 别名/同义表达，供 LeakDetector 规则层比对。 */
  aliases: string[];
  tags: string[];
}

export type EventType = "utterance" | "clue_release" | "vote" | "phase_change";
export type Visibility = "public" | "directed" | "private";

/** 对局中发生的一件事。命名为 GameEvent 以避开 DOM 全局 Event。 */
export interface GameEvent {
  id: string;
  type: EventType;
  /** 参与者 id，或 "DM" / "engine"。 */
  actor: string;
  visibility: Visibility;
  payload: Record<string, unknown>;
}

/** 引擎单一事实源。 */
export interface GameState {
  phase: string;
  participants: string[];
  publicEvents: GameEvent[];
  /** pid -> 该玩家的私有事件（定向线索等）。 */
  privateEvents: Record<string, GameEvent[]>;
  /** 已公开/已投递的 info_id 集合 —— VisibilityGate 判断 public/directed 可见性的依据。 */
  revealedInfo: Set<string>;
}

export function createGameState(participants: string[]): GameState {
  return {
    phase: "开场",
    participants: [...participants],
    publicEvents: [],
    privateEvents: {},
    revealedInfo: new Set<string>(),
  };
}
