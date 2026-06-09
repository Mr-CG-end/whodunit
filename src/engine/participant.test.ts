import { describe, expect, it } from "vitest";
import { stubParticipant } from "./participant";

describe("stubParticipant", () => {
  it("speak 默认返回带 id 的占位发言", async () => {
    const p = stubParticipant("林雅");
    expect(await p.speak("ctx", "请发言")).toBe("林雅：（发言）");
  });

  it("speak 可指定固定台词", async () => {
    const p = stubParticipant("林雅", { line: "我没去过书房。" });
    expect(await p.speak("ctx", "请发言")).toBe("我没去过书房。");
  });

  it("vote 默认投候选列表第一个", async () => {
    const p = stubParticipant("林雅");
    expect(await p.vote("ctx", ["陈博", "苏婉"])).toBe("陈博");
  });

  it("vote 可指定对象，传 null 则弃权", async () => {
    expect(await stubParticipant("林雅", { voteFor: "苏婉" }).vote("ctx", ["陈博", "苏婉"])).toBe("苏婉");
    expect(await stubParticipant("林雅", { voteFor: null }).vote("ctx", ["陈博", "苏婉"])).toBe(null);
  });

  it("fail=true 时 speak / vote 都抛错（供降级测试用）", async () => {
    const p = stubParticipant("林雅", { fail: true });
    await expect(p.speak("ctx", "请发言")).rejects.toThrow();
    await expect(p.vote("ctx", ["陈博"])).rejects.toThrow();
  });
});
