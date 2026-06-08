// 计票纯函数测试。
import { expect, it } from "vitest";
import { majority, tallyVotes } from "./tally";

it("统计票数并忽略弃权", () => {
  const votes = { 林雅: "陈博", 陈博: "林雅", 苏婉: "陈博", 弃权者: null };
  expect(tallyVotes(votes)).toEqual({ 陈博: 2, 林雅: 1 });
});

it("取唯一多数", () => {
  expect(majority({ 林雅: "陈博", 陈博: "林雅", 苏婉: "陈博" })).toBe("陈博");
});

it("并列或空票返回 null", () => {
  expect(majority({ a: "X", b: "Y" })).toBeNull(); // 1:1 并列
  expect(majority({})).toBeNull(); // 空票
  expect(majority({ a: null })).toBeNull(); // 全弃权
});
