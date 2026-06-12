import { describe, expect, it } from "vitest";
import { aiDMSpeaker } from "./dm";
import type { LLMRouter } from "./llm";

const fakeRouter = (reply = "雨夜的山庄，故事开始了。") => {
  const calls: { role: string; system: string; user: string }[] = [];
  const router: LLMRouter = {
    async complete(role, system, user) {
      calls.push({ role, system, user });
      return reply;
    },
    stats: () => ({ callCount: 0, promptTokens: 0, completionTokens: 0, cachePromptTokens: 0, totalLatencyMs: 0 }),
  };
  return { router, calls };
};

describe("aiDMSpeaker", () => {
  it("走 dm 角色路由，publicCtx 与 instruction 进 user prompt", async () => {
    const { router, calls } = fakeRouter();
    const dm = aiDMSpeaker(router);
    await dm.speak("【案情】雨夜……", "现在进入「搜证1」阶段，请宣布。");
    expect(calls).toHaveLength(1);
    expect(calls[0].role).toBe("dm");
    expect(calls[0].user).toContain("【案情】雨夜……");
    expect(calls[0].user).toContain("搜证1");
  });

  it("system prompt 是主持人设，禁止编造与暗示凶手", async () => {
    const { router, calls } = fakeRouter();
    await aiDMSpeaker(router).speak("ctx", "instr");
    expect(calls[0].system).toContain("主持人");
    expect(calls[0].system).toContain("严禁编造");
  });

  it("返回文本原样上交（清洗在 graph 层）", async () => {
    const { router } = fakeRouter("（环视全场）请开始。");
    await expect(aiDMSpeaker(router).speak("ctx", "instr")).resolves.toBe("（环视全场）请开始。");
  });
});
