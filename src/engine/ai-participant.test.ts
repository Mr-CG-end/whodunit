import { describe, expect, it, vi } from "vitest";
import { aiParticipant } from "./ai-participant";
import type { LLMRouter, RouterStats } from "./llm";

const noStats = (): RouterStats => ({
  callCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachePromptTokens: 0,
  totalLatencyMs: 0,
});

const routerWith = (reply: string): LLMRouter => ({
  complete: vi.fn<LLMRouter["complete"]>(async () => reply),
  stats: noStats,
});

describe("aiParticipant", () => {
  it("speak 用 player 角色 + 含授权欺骗的 system + 现成 ctx", async () => {
    const complete = vi.fn<LLMRouter["complete"]>(async () => "我是无辜的。");
    const router: LLMRouter = { complete, stats: noStats };
    const p = aiParticipant("林雅", router);
    const out = await p.speak("我的秘密…", "请发言");
    expect(out).toBe("我是无辜的。");
    const [role, system, user] = complete.mock.calls[0];
    expect(role).toBe("player");
    expect(system).toContain("林雅");
    expect(system).toMatch(/隐瞒|误导|欺骗/); // 授权欺骗
    expect(user).toContain("我的秘密…");
    expect(user).toContain("请发言");
  });

  it("vote 从候选里文本匹配唯一名字", async () => {
    const p = aiParticipant("林雅", routerWith("我认为凶手是陈博。"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe("陈博");
  });

  it("vote 匹配不到名字则弃权", async () => {
    const p = aiParticipant("林雅", routerWith("我不确定。"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });

  it("vote 命中多个候选也弃权", async () => {
    const p = aiParticipant("林雅", routerWith("可能是陈博，也可能是苏婉。"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });

  it("vote 取末行「最终指认」的名字，忽略前文提到的其他候选", async () => {
    const p = aiParticipant("林雅", routerWith("苏婉有不在场证明，应排除。\n最终指认：陈博"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe("陈博");
  });

  it("vote 末行「最终指认：弃权」→ null", async () => {
    const p = aiParticipant("林雅", routerWith("证据不足，难以断定。\n最终指认：弃权"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });

  it("vote 末行 marker 含多个名字 → 弃权（安全）", async () => {
    const p = aiParticipant("林雅", routerWith("最终指认：陈博 或 苏婉"));
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });

  it("vote prompt 要求末行用「最终指认」格式输出", async () => {
    const complete = vi.fn<LLMRouter["complete"]>(async () => "最终指认：陈博");
    const p = aiParticipant("林雅", { complete, stats: noStats });
    await p.vote("ctx", ["陈博", "苏婉"]);
    const user = complete.mock.calls[0][2];
    expect(user).toContain("最终指认");
  });
});
