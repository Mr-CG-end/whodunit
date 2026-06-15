// CLI runner —— 用真 LLM 玩家跑一局《雨夜书房》并打印 transcript。
// 需要 SILICONFLOW_API_KEY（可写进 .env，见 .env.example）。运行：npm run play
import { existsSync } from "node:fs";
import { aiParticipant } from "./engine/ai-participant";
import { aiDMSpeaker } from "./engine/dm";
import { GameGraph } from "./engine/graph";
import { createLLMRouter } from "./engine/llm";
import { selectScenario } from "./engine/scenarios";
import { formatEvent } from "./transcript";

// 本地开发：若存在 .env 就加载（key 不入库）。
if (existsSync(".env")) process.loadEnvFile(".env");

async function main(): Promise<void> {
  const scenario = selectScenario(process.argv);
  const router = createLLMRouter();
  const players = scenario.participants.map((id) => aiParticipant(id, router));
  const graph = new GameGraph(scenario, players, aiDMSpeaker(router));

  console.log(`《${scenario.title}》开局\n${scenario.caseIntro}\n`);
  await graph.runToEnd();

  for (const e of graph.state.publicEvents) {
    const line = formatEvent(e);
    if (line !== null) console.log(line);
  }
  console.log(`\n真凶：${scenario.killer}　本局指认：${graph.result?.accused ?? "（无）"}`);
}

main().catch((err) => {
  console.error("对局失败：", err);
  process.exit(1);
});
