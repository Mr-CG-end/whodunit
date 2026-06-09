// LLMRouter —— 模型无关的调用层（设计 §4 / docs/specs/2026-06-09-llm-integration-design.md）。
// fetch 直连 SiliconFlow（OpenAI 兼容），按角色路由模型。零运行期依赖。重试/超时在 Task 3 加。
export type Role = "player" | "dm";

export interface LLMRouter {
  complete(role: Role, system: string, user: string): Promise<string>;
  stats(): RouterStats;
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

export interface RouterStats {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  cachePromptTokens: number;
  totalLatencyMs: number;
}

interface ChatResponse {
  choices: { message: { content: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

const ENDPOINT = "https://api.siliconflow.cn/v1/chat/completions";

export function createLLMRouter(opts: RouterOptions = {}): LLMRouter {
  const apiKey = opts.apiKey ?? process.env.SILICONFLOW_API_KEY ?? "";
  const playerModel = opts.playerModel ?? process.env.PLAYER_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash";
  const dmModel = opts.dmModel ?? process.env.DM_MODEL ?? "deepseek-ai/DeepSeek-V4-Pro";
  const endpoint = opts.endpoint ?? ENDPOINT;
  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 200;
  const timeoutMs = opts.timeoutMs ?? 90000;
  const temperature = opts.temperature ?? 0.8;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  const tally: RouterStats = {
    callCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachePromptTokens: 0,
    totalLatencyMs: 0,
  };

  async function once(body: string): Promise<string> {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchFn(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as ChatResponse;
      const u = data.usage;
      tally.callCount += 1;
      tally.promptTokens += u?.prompt_tokens ?? 0;
      tally.completionTokens += u?.completion_tokens ?? 0;
      tally.cachePromptTokens += u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0;
      return data.choices[0].message.content.trim();
    } finally {
      tally.totalLatencyMs += Date.now() - t0;
      clearTimeout(timer);
    }
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
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await once(body);
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
      }
    }
    throw new Error(`LLM 调用失败（重试 ${maxRetries} 次）：${String(lastErr)}`);
  }

  return { complete, stats: () => ({ ...tally }) };
}
