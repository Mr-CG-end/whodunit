import { describe, expect, it, vi } from "vitest";
import { createLLMRouter } from "./llm";

const okResp = (content: string): Response =>
  ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }) as unknown as Response;

describe("createLLMRouter 基本调用", () => {
  it("发出正确 payload 并解析（trim）content", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(okResp("  你好  "));
    const router = createLLMRouter({ apiKey: "k", playerModel: "M-player", fetchFn });
    const out = await router.complete("player", "sys", "usr");
    expect(out).toBe("你好");
    expect(fetchFn).toHaveBeenCalledOnce();
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { model: string; messages: unknown };
    expect(body.model).toBe("M-player");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("按角色路由：dm 用 dmModel", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(okResp("x"));
    const router = createLLMRouter({ apiKey: "k", dmModel: "M-dm", fetchFn });
    await router.complete("dm", "s", "u");
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("M-dm");
  });

  it("缺 API key 时报错", async () => {
    const router = createLLMRouter({ apiKey: "", fetchFn: vi.fn<typeof fetch>() });
    await expect(router.complete("player", "s", "u")).rejects.toThrow(/SILICONFLOW_API_KEY/);
  });
});

const errFetch = (calls: { n: number }) =>
  vi.fn<typeof fetch>(async () => {
    calls.n++;
    throw new Error("network down");
  });

describe("createLLMRouter 重试", () => {
  it("前几次失败、之后成功则返回", async () => {
    let n = 0;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      n++;
      if (n < 3) throw new Error("network");
      return okResp("ok");
    });
    const router = createLLMRouter({ apiKey: "k", fetchFn, maxRetries: 3, backoffMs: 0 });
    expect(await router.complete("player", "s", "u")).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("重试耗尽后抛错（1 + maxRetries 次尝试）", async () => {
    const calls = { n: 0 };
    const fetchFn = errFetch(calls);
    const router = createLLMRouter({ apiKey: "k", fetchFn, maxRetries: 2, backoffMs: 0 });
    await expect(router.complete("player", "s", "u")).rejects.toThrow(/重试 2 次/);
    expect(calls.n).toBe(3);
  });

  it("非 2xx 触发重试", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const router = createLLMRouter({ apiKey: "k", fetchFn, maxRetries: 1, backoffMs: 0 });
    await expect(router.complete("player", "s", "u")).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
