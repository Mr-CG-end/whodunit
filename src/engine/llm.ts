// LLMRouter —— 模型无关的调用层（设计 §4 / docs/specs/2026-06-09-llm-integration-design.md）。
// fetch 直连 SiliconFlow（OpenAI 兼容），按角色路由模型。零运行期依赖。重试/超时在 Task 3 加。
export type Role = "player" | "dm";

export interface LLMRouter {
  complete(role: Role, system: string, user: string): Promise<string>;
}

export interface RouterOptions {
  apiKey?: string;
  playerModel?: string;
  dmModel?: string;
  endpoint?: string;
  maxRetries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  temperature?: number;
  fetchFn?: typeof fetch;
}

const ENDPOINT = "https://api.siliconflow.cn/v1/chat/completions";

export function createLLMRouter(opts: RouterOptions = {}): LLMRouter {
  const apiKey = opts.apiKey ?? process.env.SILICONFLOW_API_KEY ?? "";
  const playerModel = opts.playerModel ?? process.env.PLAYER_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash";
  const dmModel = opts.dmModel ?? process.env.DM_MODEL ?? "deepseek-ai/DeepSeek-V4-Pro";
  const endpoint = opts.endpoint ?? ENDPOINT;
  const temperature = opts.temperature ?? 0.8;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  async function once(body: string): Promise<string> {
    const resp = await fetchFn(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0].message.content.trim();
  }

  async function complete(role: Role, system: string, user: string): Promise<string> {
    if (!apiKey) throw new Error("缺少 SILICONFLOW_API_KEY 环境变量");
    const model = role === "player" ? playerModel : dmModel;
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
    });
    return once(body);
  }

  return { complete };
}
