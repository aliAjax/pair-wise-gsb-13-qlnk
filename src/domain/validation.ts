/** 校验层：录入规则与复核闸门（纯函数，返回冲突清单） */
import { calcEntry } from "./calculations";
import type { Conflict, FuelEntry, ShiftVersion } from "./types";

/** 判断数值字段是否为有效、非负的有限数（温度允许为负） */
function badNumber(value: number): boolean {
  return value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value) || value < 0;
}

/** 完全未填写的空行（无油品名且其余字段为默认零值）直接忽略，不当作有效录入 */
export function stripBlankEntries(entries: FuelEntry[]): FuelEntry[] {
  return entries.filter(
    (e) =>
      e.fuel.trim() !== "" ||
      e.startStock !== 0 ||
      e.endStock !== 0 ||
      e.temperature !== 20 ||
      e.delivered !== 0 ||
      e.returned !== 0 ||
      e.reason !== "" ||
      e.basis.trim() !== ""
  );
}

/** 提交前整理：剔除空行，保证至少一条有效油品 */
export function prepareEntries(raw: FuelEntry[]): { entries: FuelEntry[]; conflicts: Conflict[] } {
  const entries = stripBlankEntries(raw);
  if (entries.length === 0) {
    return {
      entries,
      conflicts: [
        {
          rule: "NO_ENTRIES",
          fuel: "",
          field: "entries",
          original: "0 条有效油品",
          message: "至少录入一种油品（开始/结束罐存、温度、付油量、回罐量）"
        }
      ]
    };
  }
  return { entries, conflicts: [] };
}

/** 校验一份油品录入草稿，返回所有冲突（含油品、原值、规则） */
export function validateEntries(entries: FuelEntry[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const seen = new Map<string, number>();

  entries.forEach((entry, rowIndex) => {
    // 油品名缺失（有数据但未选油品）
    if (!entry.fuel.trim()) {
      conflicts.push({
        rule: "FUEL_EMPTY",
        fuel: "（未选择）",
        field: "fuel",
        original: entry.fuel,
        message: `第 ${rowIndex + 1} 行录入了数据但未选择油品`
      });
    }

    // 同油品同班不得重复
    if (entry.fuel.trim() && seen.has(entry.fuel)) {
      conflicts.push({
        rule: "DUPLICATE_FUEL",
        fuel: entry.fuel,
        field: "fuel",
        original: entry.fuel,
        message: `油品「${entry.fuel}」在本班重复录入（第 ${seen.get(entry.fuel)! + 1} 行与第 ${rowIndex + 1} 行）`
      });
    } else if (entry.fuel.trim()) {
      seen.set(entry.fuel, rowIndex);
    }

    // 数值合法性
    const numberFields: Array<{ field: keyof FuelEntry; label: string }> = [
      { field: "startStock", label: "开始罐存" },
      { field: "endStock", label: "结束罐存" },
      { field: "temperature", label: "温度" },
      { field: "delivered", label: "付油量" },
      { field: "returned", label: "回罐量" }
    ];
    for (const { field, label } of numberFields) {
      const value = Number(entry[field]);
      if (field === "temperature" ? !Number.isFinite(value) : badNumber(value)) {
        conflicts.push({
          rule: "INVALID_NUMBER",
          fuel: entry.fuel,
          field,
          original: String(entry[field]),
          message: `油品「${entry.fuel}」${label}原值「${entry[field]}」不是合法数值`
        });
      }
    }

    const calc = calcEntry(entry);
    if (calc.bookStock < 0) {
      conflicts.push({
        rule: "BOOK_NEGATIVE",
        fuel: entry.fuel,
        field: "delivered",
        original: `账面量 ${calc.bookStock}`,
        message: `油品「${entry.fuel}」账面量为负（${calc.bookStock} L），付油量与回罐量原值有误`
      });
    }

    // 损溢率超过千分之三：必须选原因并写依据
    if (calc.overThreshold) {
      if (!entry.reason) {
        conflicts.push({
          rule: "REASON_REQUIRED",
          fuel: entry.fuel,
          field: "reason",
          original: `损溢率 ${(calc.ratio * 1000).toFixed(2)}‰`,
          message: `油品「${entry.fuel}」温度修正后损溢率 ${(calc.ratio * 1000).toFixed(2)}‰ 超过 3‰，原值未归因，必须选择计量/漏损/操作原因`
        });
      }
      if (!entry.basis.trim()) {
        conflicts.push({
          rule: "BASIS_REQUIRED",
          fuel: entry.fuel,
          field: "basis",
          original: entry.basis ? entry.basis : "（空）",
          message: `油品「${entry.fuel}」已归因为「${entry.reason}」，但依据原值为空，必须写明依据`
        });
      }
    } else if (entry.basis.trim() && !entry.reason) {
      // 写了依据但没选原因：保持归因完整
      conflicts.push({
        rule: "REASON_REQUIRED",
        fuel: entry.fuel,
        field: "reason",
        original: entry.basis,
        message: `油品「${entry.fuel}」填写了依据却未选择归因原因`
      });
    }
  });

  return conflicts;
}

/** 复核闸门：存在任何冲突（含未归因）一律不得复核 */
export function canReview(entries: FuelEntry[]): { ok: boolean; conflicts: Conflict[] } {
  const conflicts = validateEntries(entries);
  return { ok: conflicts.length === 0, conflicts };
}

/** 更正建版时必须填写更正原因 */
export function validateCorrection(version: Pick<ShiftVersion, "version" | "correctionReason">): Conflict[] {
  if (version.version > 1 && !version.correctionReason.trim()) {
    return [
      {
        rule: "CORRECTION_REASON_REQUIRED",
        fuel: "",
        field: "correctionReason",
        original: version.correctionReason || "（空）",
        message: "更正另建版本必须填写更正原因"
      }
    ];
  }
  return [];
}
