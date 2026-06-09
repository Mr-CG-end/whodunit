import { describe, expect, it, vi } from "vitest";
import { aiParticipant } from "./ai-participant";
import type { LLMRouter } from "./llm";

const routerWith = (reply: string): LLMRouter => ({
  complete: vi.fn<LLMRouter["complete"]>(async () => reply),
});

describe("aiParticipant", () => {
  it("speak 用 player 角色 + 含授权欺骗的 system + 现成 ctx", async () => {
    const complete = vi.fn<LLMRouter["complete"]>(async () => "我是无辜的。");
    const router: LLMRouter = { complete };
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
});
