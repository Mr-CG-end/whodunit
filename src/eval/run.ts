// eval runner —— 跑 K 局真实 LLM 对局,产指标表 + 存档（设计 §5）。
// 需要 SILICONFLOW_API_KEY（可写进 .env）。运行：npm run eval（局数 env EVAL_GAMES，默认 5）
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { aiParticipant } from "../engine/ai-participant";
import { aiDMSpeaker } from "../engine/dm";
import { GameGraph } from "../engine/graph";
import { createLLMRouter } from "../engine/llm";
import { selectScenario } from "../engine/scenarios";
import { aggregate, evalGame, type GameRecord } from "./metrics";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main(): Promise<void> {
  const scenario = selectScenario(process.argv);
  const k = Number(process.env.EVAL_GAMES ?? 5);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("eval-runs", { recursive: true });
  const records: GameRecord[] = [];
  console.log(`剧本：《${scenario.title}》 | 局数：${k}\n`);

  for (let i = 0; i < k; i++) {
    const router = createLLMRouter();
    const players = scenario.participants.map((id) => aiParticipant(id, router));
    const graph = new GameGraph(scenario, players, aiDMSpeaker(router));
    const t0 = Date.now();
    let crashed = false;
    try {
      await graph.runToEnd();
    } catch (err) {
      crashed = true;
      console.error(`局 ${i + 1} 崩溃：`, err);
    }
    const durationMs = Date.now() - t0;
    const metrics = crashed
      ? { completed: false, accused: null, accusedCorrect: false, phaseSequenceValid: false, voteFormatValid: false }
      : evalGame(graph.state, scenario);
    records.push({ metrics, durationMs, stats: router.stats() });
    writeFileSync(`eval-runs/${runId}-game${i + 1}.json`, JSON.stringify(graph.state.publicEvents, null, 2));
    console.log(
      `局 ${i + 1}/${k}: 指认 ${metrics.accused ?? "—"} ${metrics.accusedCorrect ? "✓" : "✗"} | ${(durationMs / 1000).toFixed(1)}s`,
    );
  }

  const summary = aggregate(records);
  writeFileSync(`eval-runs/${runId}-summary.json`, JSON.stringify(summary, null, 2));
  console.log("\n=== eval 汇总 ===");
  console.log(`完成率: ${(summary.completionRate * 100).toFixed(0)}%`);
  console.log(`指认正确率: ${(summary.accuracyRate * 100).toFixed(0)}%（完成局中）`);
  console.log(`sanity 违反: ${summary.sanityViolations} 局`);
  console.log(`平均时长: ${(summary.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(
    `LLM 调用 ${summary.stats.callCount} 次 | prompt ${summary.stats.promptTokens} / completion ${summary.stats.completionTokens} token | 缓存命中 ${summary.stats.cachePromptTokens} token`,
  );
}

main().catch((err) => {
  console.error("eval 失败：", err);
  process.exit(1);
});
