// 参与者抽象 —— 设计 §3/§4。未来 AIParticipant / HumanParticipant 都实现这个接口；
// 本切片只实现确定性 StubParticipant，用来在不接 LLM 的情况下驱动 GameGraph。

export interface Participant {
  id: string;
  /** 轮到发言：拿可见上下文文本 + 指令，返回发言。 */
  speak(ctx: string, instruction: string): Promise<string>;
  /** 投票：拿可见上下文 + 候选人列表，返回被投者 id 或 null（弃权）。 */
  vote(ctx: string, candidates: string[]): Promise<string | null>;
}

export interface StubOptions {
  /** 发言固定文本；省略则用 `${id}：（发言）`。 */
  line?: string;
  /** 投给谁；省略则投候选列表第一个，传 null 则弃权。 */
  voteFor?: string | null;
  /** true 时 speak / vote 都抛错，用于测试 GameGraph 的降级。 */
  fail?: boolean;
}

/** 确定性假玩家。 */
export function stubParticipant(id: string, opts: StubOptions = {}): Participant {
  return {
    id,
    async speak(_ctx, _instruction) {
      if (opts.fail) throw new Error(`stub ${id} speak failed`);
      return opts.line ?? `${id}：（发言）`;
    },
    async vote(_ctx, candidates) {
      if (opts.fail) throw new Error(`stub ${id} vote failed`);
      if (opts.voteFor !== undefined) return opts.voteFor;
      return candidates[0] ?? null;
    },
  };
}
