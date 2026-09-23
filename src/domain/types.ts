/** 领域模型：油品损溢核销台（纯类型，不含计算与存储） */

/** 班次类型 */
export type ShiftType = "早班" | "中班" | "晚班";

/** 损溢归因 */
export type LossReason = "计量原因" | "漏损原因" | "操作原因";

/** 班次复核状态 */
export type ReviewStatus = "待复核" | "已复核";

/** 单条油品的罐存/付油/回罐录入 */
export interface FuelEntry {
  id: string;
  /** 油品名称，如 92#、95#、0# */
  fuel: string;
  /** 开始罐存（升） */
  startStock: number;
  /** 结束罐存（升，计量温度下的实测体积） */
  endStock: number;
  /** 计量温度（℃） */
  temperature: number;
  /** 付油量（升，发油机发出） */
  delivered: number;
  /** 回罐量（升，发油检定/校机回罐） */
  returned: number;
  /** 归因（损溢率超过千分之三时必填） */
  reason: LossReason | "";
  /** 归因依据（必填） */
  basis: string;
}

/** 班次的一个版本：初录或一次更正 */
export interface ShiftVersion {
  id: string;
  /** 业务班次键：日期 + 班次 */
  shiftDate: string;
  shiftType: ShiftType;
  entries: FuelEntry[];
  status: ReviewStatus;
  version: number;
  /** 初录版本为 null，更正版本指向被更正的已复核版本 */
  parentId: string | null;
  rootId: string;
  /** 更正原因（更正版本必填） */
  correctionReason: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewer: string;
}

/** 计算结果（温度修正后的损溢） */
export interface EntryCalc {
  /** 结束罐存折算到标准温度后的实存量（升） */
  actualStock: number;
  /** 账面量 = 开始罐存 - 付油量 + 回罐量（升） */
  bookStock: number;
  /** 损溢量 = 实存量 - 账面量（正为溢、负为损） */
  gainLoss: number;
  /** 损溢率 = 损溢量 / 账面量 */
  ratio: number;
  /** |损溢率| 是否超过 0.003 */
  overThreshold: boolean;
}

/** 校验/复核冲突的规则编码 */
export type RuleCode =
  | "DUPLICATE_FUEL"
  | "DUPLICATE_SHIFT"
  | "INVALID_NUMBER"
  | "FUEL_EMPTY"
  | "NO_ENTRIES"
  | "BOOK_NEGATIVE"
  | "REASON_REQUIRED"
  | "BASIS_REQUIRED"
  | "CORRECTION_REASON_REQUIRED"
  | "FROZEN"
  | "REVIEWED_GATE"
  | "CHAIN_PARENT_MISSING"
  | "CHAIN_VERSION_GAP"
  | "CHAIN_ROOT_MISMATCH";

export interface Conflict {
  rule: RuleCode;
  /** 冲突条目油品（班次级冲突为空） */
  fuel: string;
  /** 字段名 */
  field: string;
  /** 原值（便于核对） */
  original: string;
  message: string;
}
