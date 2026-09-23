/**
 * 数据层：录入合法性校验与整库一致性/规则冲突检测。
 * 纯函数，输入数据输出 Conflict[]，页面渲染与复核前置检查共用。
 */

import { computeVariance, isAttributionSatisfied } from "./calculations";
import { RULES } from "./rules";
import type { Conflict, EntryDraft, EntryVersion, Product, Shift, StoreData } from "./types";

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 单条录入草稿的字段校验（保存前） */
export function validateDraft(
  draft: EntryDraft,
  isCorrection: boolean,
  product: Product | undefined
): Conflict[] {
  const conflicts: Conflict[] = [];
  const push = (message: string, oldValue?: string) =>
    conflicts.push({
      code: "INVALID_INPUT",
      shiftId: "",
      productCode: draft.productCode,
      oldValue,
      rule: RULES.invalidInput,
      message
    });

  if (!draft.productCode || !product) push("请选择油品档案中存在的油品", draft.productCode);
  for (const [label, key] of [
    ["开始罐存", "openingStock"],
    ["结束罐存", "closingStock"],
    ["温度", "temperature"],
    ["付油量", "delivered"],
    ["回罐量", "returned"]
  ] as const) {
    if (!isFiniteNonNegative(draft[key])) push(`${label}必须为非负数值`, String(draft[key]));
  }
  if (isFiniteNonNegative(draft.temperature) && (draft.temperature < -40 || draft.temperature > 60)) {
    push("罐温超出合理量测范围（-40℃ ~ 60℃）", `${draft.temperature}℃`);
  }

  if (product) {
    const result = computeVariance(draft, product);
    if (result.overLimit && !isAttributionSatisfied(result, draft.attributionKind, draft.attributionBasis)) {
      conflicts.push({
        code: "UNATTRIBUTED_VARIANCE",
        shiftId: "",
        productCode: draft.productCode,
        oldValue: `损溢率 ${(result.varianceRate * 1000).toFixed(2)}‰`,
        rule: RULES.unattributedVariance,
        message: "损溢率超过千分之三，必须选择计量/漏损/操作原因并填写依据"
      });
    }
  }
  if (isCorrection && draft.correctionReason.trim().length === 0) {
    push("更正必须填写更正原因");
  }
  return conflicts;
}

/** 某班次当前生效（未被替代）的版本 */
export function activeEntries(entries: EntryVersion[], shiftId: string): EntryVersion[] {
  const heads = new Map<string, EntryVersion>();
  for (const entry of entries) {
    if (entry.shiftId !== shiftId) continue;
    const prev = heads.get(entry.productCode);
    if (!prev || entry.version > prev.version) heads.set(entry.productCode, entry);
  }
  return [...heads.values()].filter((entry) => entry.supersededAt === null);
}

export interface DataContext {
  shifts: Shift[];
  entries: EntryVersion[];
  products: Product[];
}

/**
 * 全量一致性与规则检测（刷新后重跑）：
 * - 重复生效油品、未归因超阈值（复核阻断项）
 * - 冻结版本被改动（数据不变量，理论上不出现）
 * - 版本链断裂 / 悬挂引用
 */
export function detectConflicts(data: StoreData | DataContext, shiftId?: string): Conflict[] {
  const conflicts: Conflict[] = [];
  const shifts = shiftId ? data.shifts.filter((shift) => shift.id === shiftId) : data.shifts;
  const productByCode = new Map(data.products.map((product) => [product.code, product]));

  for (const shift of shifts) {
    const shiftEntries = data.entries.filter((entry) => entry.shiftId === shift.id);

    // 同一油品只能有一个生效版本
    const headsByProduct = new Map<string, EntryVersion[]>();
    for (const entry of shiftEntries) {
      if (entry.supersededAt !== null) continue;
      const list = headsByProduct.get(entry.productCode) ?? [];
      list.push(entry);
      headsByProduct.set(entry.productCode, list);
    }
    for (const [productCode, heads] of headsByProduct) {
      if (heads.length > 1) {
        conflicts.push({
          code: "DUPLICATE_PRODUCT",
          shiftId: shift.id,
          productCode,
          oldValue: `生效版本 v${heads.map((head) => head.version).join("、v")}`,
          rule: RULES.duplicateProduct,
          message: `班次内油品 ${productCode} 存在多个生效版本`
        });
      }
    }

    // 版本链完整性
    const byId = new Map(shiftEntries.map((entry) => [entry.id, entry]));
    for (const entry of shiftEntries) {
      if (entry.version === 1) {
        if (entry.correctedFrom !== null) {
          conflicts.push(integrity(shift.id, entry.productCode, `v${entry.version} 首版本不应有上游版本`));
        }
      } else if (!entry.correctedFrom || !byId.has(entry.correctedFrom)) {
        conflicts.push(integrity(shift.id, entry.productCode, `v${entry.version} 找不到上游版本`));
      } else {
        const prev = byId.get(entry.correctedFrom)!;
        if (prev.version !== entry.version - 1 || prev.productCode !== entry.productCode) {
          conflicts.push(integrity(shift.id, entry.productCode, `v${entry.version} 与上游版本不连续`));
        }
        if (shift.locked && !prev.frozen) {
          conflicts.push({
            code: "FROZEN_ENTRY",
            shiftId: shift.id,
            productCode: entry.productCode,
            oldValue: `v${prev.version} 未冻结`,
            rule: RULES.frozenEntry,
            message: "更正链的原始版本未处于冻结状态"
          });
        }
      }
    }

    // 当前生效版本的归因规则（复核阻断项）
    for (const entry of activeEntries(shiftEntries, shift.id)) {
      const product = productByCode.get(entry.productCode);
      const result = computeVariance(entry, product);
      if (!isAttributionSatisfied(result, entry.attributionKind, entry.attributionBasis)) {
        conflicts.push({
          code: "UNATTRIBUTED_VARIANCE",
          shiftId: shift.id,
          productCode: entry.productCode,
          oldValue: `损溢率 ${(result.varianceRate * 1000).toFixed(2)}‰，归因=${entry.attributionKind ?? "无"}`,
          rule: RULES.unattributedVariance,
          message: `${entry.productCode} 损溢率超过千分之三且未完成归因，不得复核`
        });
      }
    }
  }

  // 悬挂录入：引用了不存在的班次或油品
  const shiftIds = new Set(data.shifts.map((shift) => shift.id));
  for (const entry of data.entries) {
    if (!shiftIds.has(entry.shiftId)) {
      conflicts.push(integrity(entry.shiftId, entry.productCode, "录入引用了不存在的班次"));
    }
    if (!productByCode.has(entry.productCode)) {
      conflicts.push(integrity(entry.shiftId, entry.productCode, `油品 ${entry.productCode} 档案缺失`));
    }
  }
  return conflicts;
}

/** 复核前置检查：返回会阻断复核的冲突 */
export function reviewBlockers(data: StoreData, shiftId: string): Conflict[] {
  return detectConflicts(data, shiftId).filter(
    (conflict) => conflict.code === "UNATTRIBUTED_VARIANCE" || conflict.code === "DUPLICATE_PRODUCT"
  );
}

function integrity(shiftId: string, productCode: string | undefined, message: string): Conflict {
  return { code: "INTEGRITY", shiftId, productCode, rule: RULES.integrity, message };
}
