import { describe, expect, it } from "vitest";
import {
  computeVariance,
  correctToStandard,
  formatPermyriad,
  isAttributionSatisfied,
  volumeCorrectionFactor
} from "../src/domain/calculations";
import { VARIANCE_LIMIT } from "../src/domain/rules";
import type { EntryInput, Product } from "../src/domain/types";

const gasoline: Product = { code: "92#", name: "92号汽油", beta: 0.0012 };
const diesel: Product = { code: "0#", name: "0号柴油", beta: 0.0008 };

function input(partial: Partial<EntryInput> = {}): EntryInput {
  return {
    productCode: "92#",
    openingStock: 10000,
    closingStock: 6000,
    temperature: 20,
    delivered: 4000,
    returned: 0,
    ...partial
  };
}

describe("温度修正", () => {
  it("20℃ 时 VCF=1，修正后体积不变", () => {
    expect(volumeCorrectionFactor(20, 0.0012)).toBe(1);
    expect(correctToStandard(10000, 20, 0.0012)).toBe(10000);
  });

  it("高于 20℃ 时体积折算减小，低于时增大", () => {
    expect(correctToStandard(10000, 25, 0.0012)).toBe(9940);
    expect(correctToStandard(10000, 15, 0.0012)).toBe(10060);
    expect(correctToStandard(10000, 26, diesel.beta)).toBe(9952);
  });
});

describe("账面量 / 实存量 / 损溢", () => {
  it("账实相等时损溢为 0", () => {
    const result = computeVariance(input(), gasoline);
    expect(result.bookQuantity).toBe(6000);
    expect(result.actualQuantity).toBe(6000);
    expect(result.variance).toBe(0);
    expect(result.varianceRate).toBe(0);
    expect(result.overLimit).toBe(false);
  });

  it("账面量 = 修正后开始罐存 + 回罐 - 付油；损溢=实存-账面", () => {
    const result = computeVariance(
      input({ openingStock: 10000, temperature: 25, delivered: 4200, returned: 20, closingStock: 5800 }),
      gasoline
    );
    // 修正后开始 9940，账面 9940 + 20 - 4200 = 5760，实存 9940*0.58 = 5765.2
    expect(result.openingStandard).toBe(9940);
    expect(result.bookQuantity).toBe(5760);
    expect(result.closingStandard).toBe(5765.2);
    expect(result.variance).toBe(5.2);
  });

  it("损溢率以账面量绝对值为分母，严格大于千分之三才超限", () => {
    const book = 10000;
    // 恰好 3‰：不超限
    const atLimit = computeVariance(
      input({ openingStock: book, closingStock: book, temperature: 20, delivered: 0 }),
      gasoline
    );
    expect(atLimit.varianceRate).toBe(0);
    // 构造 |损溢|/账面 恰好 0.003：开始 10000、付油 0、回罐 0 -> 账面 10000；结束 9970 -> 损溢 -30
    const exactly = computeVariance(
      input({
        openingStock: 10000,
        temperature: 20,
        delivered: 0,
        returned: 0,
        closingStock: 9970
      }),
      gasoline
    );
    expect(exactly.bookQuantity).toBe(10000);
    expect(exactly.varianceRate).toBeCloseTo(VARIANCE_LIMIT, 10);
    expect(exactly.overLimit).toBe(false);

    const beyond = computeVariance(
      input({ openingStock: 10000, temperature: 20, delivered: 0, closingStock: 9969 }),
      gasoline
    );
    expect(beyond.varianceRate).toBeGreaterThan(VARIANCE_LIMIT);
    expect(beyond.overLimit).toBe(true);
  });

  it("千分比格式化", () => {
    expect(formatPermyriad(0.0042)).toBe("4.20‰");
  });
});

describe("归因判定", () => {
  it("未超阈值无需归因", () => {
    expect(isAttributionSatisfied({ overLimit: false }, null, "")).toBe(true);
  });

  it("超阈值必须选原因且写依据，空白依据不算", () => {
    expect(isAttributionSatisfied({ overLimit: true }, null, "")).toBe(false);
    expect(isAttributionSatisfied({ overLimit: true }, "计量原因", "")).toBe(false);
    expect(isAttributionSatisfied({ overLimit: true }, "计量原因", "   ")).toBe(false);
    expect(isAttributionSatisfied({ overLimit: true }, "漏损原因", "复尺记录 #12")).toBe(true);
  });
});
