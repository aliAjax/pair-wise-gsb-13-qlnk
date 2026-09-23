/** 计算层：温度修正、账面量、损溢率（纯函数，无副作用） */
import type { EntryCalc, FuelEntry } from "./types";

/** 标准温度（GB/T 1885 计量标准温度） */
export const STANDARD_TEMP = 20;
/** 石油产品体积温度修正系数（1/℃） */
export const TEMP_COEFFICIENT = 0.0008;
/** 损溢率阈值：千分之三 */
export const THRESHOLD = 0.003;

/**
 * 温度修正：将计量温度下的实测体积折算到 20℃ 标准体积。
 * V20 = Vt × [1 + β × (20 - t)]，温度高于 20℃ 时体积受热膨胀需折减。
 */
export function correctToStandard(volume: number, temperature: number): number {
  return volume * (1 + TEMP_COEFFICIENT * (STANDARD_TEMP - temperature));
}

/** 账面量 = 开始罐存 - 付油量 + 回罐量 */
export function bookStockOf(entry: Pick<FuelEntry, "startStock" | "delivered" | "returned">): number {
  return entry.startStock - entry.delivered + entry.returned;
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 计算单条油品的温度修正实存量、账面量、损溢量与损溢率 */
export function calcEntry(entry: FuelEntry): EntryCalc {
  const actualStock = correctToStandard(entry.endStock, entry.temperature);
  const bookStock = bookStockOf(entry);
  const gainLoss = actualStock - bookStock;
  const ratio = bookStock !== 0 ? gainLoss / Math.abs(bookStock) : gainLoss === 0 ? 0 : Infinity;
  return {
    actualStock: round3(actualStock),
    bookStock: round3(bookStock),
    gainLoss: round3(gainLoss),
    ratio,
    overThreshold: Math.abs(ratio) > THRESHOLD
  };
}

/** 整班损溢汇总 */
export function calcShift(entries: FuelEntry[]): { gainLoss: number; bookStock: number; ratio: number } {
  const calcs = entries.map(calcEntry);
  const gainLoss = round3(calcs.reduce((sum, c) => sum + c.gainLoss, 0));
  const bookStock = round3(calcs.reduce((sum, c) => sum + c.bookStock, 0));
  const ratio = bookStock !== 0 ? gainLoss / Math.abs(bookStock) : 0;
  return { gainLoss, bookStock, ratio };
}

/** 格式化损溢率为千分比，如 3.2‰ */
export function formatPermille(ratio: number): string {
  return `${(ratio * 1000).toFixed(2)}‰`;
}

/** 格式化带符号的升数 */
export function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} L`;
}
