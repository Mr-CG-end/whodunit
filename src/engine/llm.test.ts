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
