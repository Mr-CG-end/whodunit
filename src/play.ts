// CLI runner —— 用真 LLM 玩家跑一局《雨夜书房》并打印 transcript。
// 需要 SILICONFLOW_API_KEY（可写进 .env，见 .env.example）。运行：npm run play
import { existsSync } from "node:fs";
import { aiParticipant } from "./engine/ai-participant";
import { GameGraph } from "./engine/graph";
import { createLLMRouter } from "./engine/llm";
import { WUYE } from "./engine/scenario";

// 本地开发：若存在 .env 就加载（key 不入库）。
if (existsSync(".env")) process.loadEnvFile(".env");

async function main(): Promise<void> {
  const router = createLLMRouter();
  const players = WUYE.participants.map((id) => aiParticipant(id, router));
  const graph = new GameGraph(WUYE, players);

  console.log(`《${WUYE.title}》开局\n${WUYE.caseIntro}\n`);
  await graph.runToEnd();

  for (const e of graph.state.publicEvents) {
    if (e.type === "phase_change") console.log(`\n=== ${String(e.payload.phase)} ===`);
    else if (e.type === "utterance") console.log(`${e.actor}：${String(e.payload.text)}`);
    else if (e.type === "clue_release") console.log(`[线索] ${String(e.payload.text)}`);
    else if (e.type === "vote" && e.actor === "engine")
      console.log(`[计票] ${JSON.stringify(e.payload.counts)} → 指认 ${String(e.payload.accused)}`);
    else if (e.type === "vote") console.log(`[投票] ${e.actor} → ${String(e.payload.target)}`);
  }
  console.log(`\n真凶：${WUYE.killer}　本局指认：${graph.result?.accused ?? "（无）"}`);
}

main().catch((err) => {
  console.error("对局失败：", err);
  process.exit(1);
});
