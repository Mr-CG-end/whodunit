// eval runner —— 跑 K 局真实 LLM 对局,产指标表 + 存档（设计 §5）。
// 需要 SILICONFLOW_API_KEY（可写进 .env）。运行：npm run eval（局数 env EVAL_GAMES，默认 5）
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { aiParticipant } from "../engine/ai-participant";
import { aiDMSpeaker } from "../engine/dm";
import { GameGraph } from "../engine/graph";
import type { RouterStats } from "../engine/llm";
import { createLLMRouter } from "../engine/llm";
import { selectScenario } from "../engine/scenarios";
import { formatEvent } from "../transcript";
import { aggregate, evalGame, type GameRecord } from "./metrics";

if (existsSync(".env")) process.loadEnvFile(".env");

/** 两个 router 的 stats 逐字段相加（凶手/好人各一个 router 时合一局计数）。 */
function sumStats(a: RouterStats, b: RouterStats): RouterStats {
  return {
    callCount: a.callCount + b.callCount,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cachePromptTokens: a.cachePromptTokens + b.cachePromptTokens,
    totalLatencyMs: a.totalLatencyMs + b.totalLatencyMs,
  };
}

/** 边跑边打印 transcript（EVAL_TRACE=1）；发言/投票标注本回合耗时。默认走 runToEnd 不打印。 */
async function runGame(graph: GameGraph, trace: boolean, gameNo: number): Promise<void> {
  if (!trace) {
    await graph.runToEnd();
    return;
  }
  console.log(`\n──────── 局 ${gameNo} 实时过程 ────────`);
  let printed = 0;
  while (!graph.done()) {
    const t = Date.now();
    await graph.step();
    const dt = Date.now() - t;
    const evs = graph.state.publicEvents;
    for (; printed < evs.length; printed++) {
      const line = formatEvent(evs[printed]);
      if (line === null) continue;
      const isTurn = evs[printed].type === "utterance" || evs[printed].type === "vote";
      console.log(isTurn && dt > 1000 ? `${line}  (${(dt / 1000).toFixed(1)}s)` : line);
    }
  }
}

async function main(): Promise<void> {
  const scenario = selectScenario(process.argv);
  const k = Number(process.env.EVAL_GAMES ?? 5);
  const noDm = process.argv.includes("--no-dm");
  const concurrency = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 1));
  // 设了就给凶手(scenario.killer)单独配模型,其余玩家走 PLAYER_MODEL——跑「凶手 vs 好人不同模型」对照
  const killerModel = process.env.KILLER_MODEL;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync("eval-runs", { recursive: true });
  // 并行时 transcript 会交错成乱码,只在串行时开 trace
  const trace = process.env.EVAL_TRACE === "1" && concurrency === 1;
  console.log(
    `剧本：《${scenario.title}》 | 局数：${k} | DM：${noDm ? "关" : "开"} | 并发：${concurrency}` +
      `${killerModel ? ` | 凶手(${scenario.killer})模型：${killerModel}` : ""}\n`,
  );

  const records: GameRecord[] = new Array(k);
  const playGame = async (i: number): Promise<void> => {
    const router = createLLMRouter();
    const killerRouter = killerModel ? createLLMRouter({ playerModel: killerModel }) : router;
    const players = scenario.participants.map((id) =>
      aiParticipant(id, killerModel && id === scenario.killer ? killerRouter : router),
    );
    const graph = new GameGraph(scenario, players, noDm ? undefined : aiDMSpeaker(router));
    const t0 = Date.now();
    let crashed = false;
    try {
      await runGame(graph, trace, i + 1);
    } catch (err) {
      crashed = true;
      console.error(`局 ${i + 1} 崩溃：`, err);
    }
    const durationMs = Date.now() - t0;
    const metrics = crashed
      ? { completed: false, accused: null, accusedCorrect: false, phaseSequenceValid: false, voteFormatValid: false }
      : evalGame(graph.state, scenario);
    const stats = killerModel ? sumStats(router.stats(), killerRouter.stats()) : router.stats();
    records[i] = { metrics, durationMs, stats };
    writeFileSync(`eval-runs/${runId}-game${i + 1}.json`, JSON.stringify(graph.state.publicEvents, null, 2));
    console.log(
      `局 ${i + 1}/${k}: 指认 ${metrics.accused ?? "—"} ${metrics.accusedCorrect ? "✓" : "✗"} | ${(durationMs / 1000).toFixed(1)}s`,
    );
  };

  // 固定大小的工作池：next 自增领号,跑满 k 局
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < k) await playGame(next++);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, k) }, worker));

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
