// 《沈园夜宴》结构不变量 —— 设计 §6。确定性，TDD；LLM 部分照铁律不做文本断言。
import { describe, expect, it } from "vitest";
import { createGameState, type GameState } from "./models";
import { SHENYUAN } from "./scenario-shenyuan";
import { visibleInfoFor } from "./visibility";

const RED_HERRING = "顾曼珠";
const CHAIN_IDS = ["D8", "D9", "D10"]; // 毒源 / 机会 / 动机

function byId(id: string) {
  const found = SHENYUAN.infoItems.find((i) => i.id === id);
  if (!found) throw new Error(`无此 InfoItem: ${id}`);
  return found;
}

describe("《沈园夜宴》结构不变量", () => {
  it("killer 在 participants 中", () => {
    expect(SHENYUAN.participants).toContain(SHENYUAN.killer);
  });

  it("所有 private/directed 信息都有 owner，且 owner 是合法参与者", () => {
    for (const i of SHENYUAN.infoItems) {
      if (i.scope === "private" || i.scope === "directed") {
        expect(i.owners.length).toBeGreaterThan(0);
      }
      for (const o of i.owners) expect(SHENYUAN.participants).toContain(o);
    }
  });

  it("所有 revealPhase 都在 phases 内（private 恒为 null 除外）", () => {
    for (const i of SHENYUAN.infoItems) {
      if (i.revealPhase !== null) expect(SHENYUAN.phases).toContain(i.revealPhase);
      if (i.scope === "private") expect(i.revealPhase).toBeNull();
    }
  });

  it("omniscient 仅 truth 一条、复盘才揭、且无 aliases", () => {
    const omni = SHENYUAN.infoItems.filter((i) => i.scope === "omniscient");
    expect(omni).toHaveLength(1);
    expect(omni[0].id).toBe("truth");
    expect(omni[0].revealPhase).toBe("复盘");
    expect(omni[0].aliases).toHaveLength(0);
  });

  it("信息分布：公开 7 + 定向 4 + 秘密 5 + 真相 1 = 17", () => {
    const count = (s: string) => SHENYUAN.infoItems.filter((i) => i.scope === s).length;
    expect(count("public")).toBe(7);
    expect(count("directed")).toBe(4);
    expect(count("private")).toBe(5);
    expect(count("omniscient")).toBe(1);
    expect(SHENYUAN.infoItems).toHaveLength(17);
  });
});

describe("《沈园夜宴》链碎片不变量（可解性保障）", () => {
  it("D8/D9/D10 的 owner 互不相同", () => {
    const owners = CHAIN_IDS.map((id) => byId(id).owners[0]);
    expect(new Set(owners).size).toBe(CHAIN_IDS.length);
  });

  it("链碎片不落在凶手或红鲱鱼手里（否则真凶被永久隐瞒）", () => {
    for (const id of CHAIN_IDS) {
      const owner = byId(id).owners[0];
      expect(owner).not.toBe(SHENYUAN.killer);
      expect(owner).not.toBe(RED_HERRING);
    }
  });
});

describe("《沈园夜宴》防误伤不变量（3a「宁漏不误伤」机器化）", () => {
  it("每条秘密的 alias 都不是任何其他 InfoItem 文本的子串", () => {
    const secrets = SHENYUAN.infoItems.filter((i) => i.scope === "private");
    for (const s of secrets) {
      for (const alias of s.aliases) {
        for (const other of SHENYUAN.infoItems) {
          if (other.id === s.id) continue;
          expect(other.text.includes(alias), `秘密 ${s.id} 的 alias「${alias}」撞进了 ${other.id} 的文本`).toBe(false);
        }
      }
    }
  });
});

describe("VisibilityGate 对《沈园夜宴》同样成立", () => {
  const SEARCH1 = ["D1", "D2", "D3", "D4", "D5"];
  const SEARCH2 = ["D6", "D7", "D11", "D8", "D9", "D10"];

  function stateWith(revealed: string[]): GameState {
    const s = createGameState(SHENYUAN.participants);
    s.revealedInfo = new Set(revealed);
    return s;
  }
  function visibleIds(pid: string, state: GameState): Set<string> {
    return new Set(visibleInfoFor(pid, SHENYUAN, state).map((i) => i.id));
  }

  it("每人看得到自己的秘密；永远看不到别人的秘密或真相", () => {
    const state = stateWith(SEARCH1);
    for (const pid of SHENYUAN.participants) {
      const seen = visibleIds(pid, state);
      expect(seen.has(`secret_${pid}`)).toBe(true);
      for (const other of SHENYUAN.participants) {
        if (other !== pid) expect(seen.has(`secret_${other}`)).toBe(false);
      }
      expect(seen.has("truth")).toBe(false);
    }
  });

  it("公开线索只有已公布后才可见", () => {
    const empty = stateWith([]);
    for (const pid of SHENYUAN.participants) {
      expect(visibleInfoFor(pid, SHENYUAN, empty).some((i) => i.scope === "public")).toBe(false);
    }
    expect(visibleIds("顾曼珠", stateWith(["D1"])).has("D1")).toBe(true);
  });

  it("定向线索须 owner 且已发布", () => {
    for (const pid of SHENYUAN.participants) {
      expect(visibleIds(pid, stateWith([])).has("D5")).toBe(false);
    }
    const after = stateWith(["D5"]);
    expect(visibleIds("顾曼珠", after).has("D5")).toBe(true);
    for (const other of SHENYUAN.participants) {
      if (other !== "顾曼珠") expect(visibleIds(other, after).has("D5")).toBe(false);
    }
  });

  it("仅发布搜证1时，搜证2 的线索与真相绝不可见", () => {
    const state = stateWith(SEARCH1);
    for (const pid of SHENYUAN.participants) {
      const seen = visibleIds(pid, state);
      for (const f of SEARCH2) expect(seen.has(f)).toBe(false);
      expect(seen.has("truth")).toBe(false);
    }
  });
});
