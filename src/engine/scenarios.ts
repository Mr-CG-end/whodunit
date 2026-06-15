// 剧本注册表 + --scenario 选择（设计 §5）。内置剧本就两个，用 Record 即可，不做文件解析（YAGNI）。
import { type Scenario, WUYE } from "./scenario";
import { SHENYUAN } from "./scenario-shenyuan";

export const SCENARIOS: Record<string, Scenario> = {
  wuye: WUYE,
  shenyuan: SHENYUAN,
};

const PREFIX = "--scenario=";

/** 从 argv 解析 --scenario=<id>，缺省 wuye；未知名抛错。 */
export function selectScenario(argv: string[]): Scenario {
  const id = argv.find((a) => a.startsWith(PREFIX))?.slice(PREFIX.length) ?? "wuye";
  const scenario = SCENARIOS[id];
  if (!scenario) {
    throw new Error(`未知剧本：${id}（可选：${Object.keys(SCENARIOS).join(" | ")}）`);
  }
  return scenario;
}
