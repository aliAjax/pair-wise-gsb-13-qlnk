/**
 * 计算层：温度修正、账面量、实存量、损溢与归因判定。
 * 全部为纯函数，不读写存储、不依赖页面；Node 与浏览器均可直接单测。
 *
 * 计算口径（页面与复核判定共用，单一事实来源）：
 * - 体积温度修正：V20 = Vt × [1 + β × (20 − t)]
 *   罐存量按实测罐温折算到 20℃ 标准体积；付油量按加油机发油（标准体积结算），
 *   回罐量为当班实测回罐，二者不做温度折算。
 * - 账面量 = 修正后开始罐存 + 回罐量 − 付油量
 * - 实存量 = 修正后结束罐存
 * - 损溢量 = 实存量 − 账面量（正为溢余，负为损耗）
 * - 损溢率 = |损溢量| / 账面量，严格大于 0.003（千分之三）即必须归因。
 */

import { STANDARD_TEMPERATURE, VARIANCE_LIMIT } from "./rules";
import type { EntryInput, Product } from "./types";

/** 体积温度修正系数（VCF） */
export function volumeCorrectionFactor(temperatureC: number, beta: number): number {
  return 1 + beta * (STANDARD_TEMPERATURE - temperatureC);
}

/** 实测体积折算为 20℃ 标准体积 */
export function correctToStandard(measuredVolume: number, temperatureC: number, beta: number): number {
  return round3(measuredVolume * volumeCorrectionFactor(temperatureC, beta));
}

export interface VarianceResult {
  vcf: number;
  openingStandard: number;
  closingStandard: number;
  bookQuantity: number;
  actualQuantity: number;
  variance: number;
  varianceRate: number;
  overLimit: boolean;
}

/** 计算一条录入的温度修正结果与损溢 */
export function computeVariance(input: EntryInput, product: Product | undefined): VarianceResult {
  const beta = product?.beta ?? 0;
  const vcf = round6(volumeCorrectionFactor(input.temperature, beta));
  const openingStandard = correctToStandard(input.openingStock, input.temperature, beta);
  const closingStandard = correctToStandard(input.closingStock, input.temperature, beta);
  const bookQuantity = round3(openingStandard + input.returned - input.delivered);
  const actualQuantity = closingStandard;
  const variance = round3(actualQuantity - bookQuantity);
  const varianceRate = bookQuantity === 0 ? (variance === 0 ? 0 : 1) : Math.abs(variance) / Math.abs(bookQuantity);
  return {
    vcf,
    openingStandard,
    closingStandard,
    bookQuantity,
    actualQuantity,
    variance,
    varianceRate,
    overLimit: varianceRate > VARIANCE_LIMIT
  };
}

/**
 * 判定一条（已带归因的）录入是否满足复核要求。
 * 超阈值却未选原因或未写依据 -> 不满足。
 */
export function isAttributionSatisfied(
  result: Pick<VarianceResult, "overLimit">,
  attributionKind: string | null,
  attributionBasis: string
): boolean {
  if (!result.overLimit) return true;
  return attributionKind !== null && attributionBasis.trim().length > 0;
}

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/** 页面展示：保留两位小数 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 千分比展示，如 4.20‰ */
export function formatPermyriad(rate: number): string {
  return `${(rate * 1000).toFixed(2)}‰`;
}
