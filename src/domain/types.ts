/**
 * 数据层：班次交接 / 油品损溢核销的领域模型。
 * 这里只放类型与常量，不做计算、不碰存储、不依赖 DOM。
 */

/** 班次时段 */
export type ShiftPeriod = "早班" | "中班" | "晚班";
export const SHIFT_PERIODS: readonly ShiftPeriod[] = ["早班", "中班", "晚班"];

/** 损溢归因类别（超过千分之三时必选其一） */
export type AttributionKind = "计量原因" | "漏损原因" | "操作原因";
export const ATTRIBUTION_KINDS: readonly AttributionKind[] = [
  "计量原因",
  "漏损原因",
  "操作原因"
];

/** 班次状态：locked=false 待复核；locked=true 已复核（更正不解除冻结） */
export type ShiftStatus = "待复核" | "已复核";

/** 油品档案。beta 为体积温度修正系数（1/℃），用于把实测体积折算到 20℃ 标准体积 */
export interface Product {
  /** 油品编码，如 92# */
  code: string;
  /** 品名，如 92号车用汽油 */
  name: string;
  /** 体积温度修正系数 β，V20 = Vt × [1 + β(20 − t)] */
  beta: number;
}

/** 班次表头 */
export interface Shift {
  id: string;
  /** 交接日期 YYYY-MM-DD */
  date: string;
  period: ShiftPeriod;
  station?: string;
  /** 复核冻结标记，复核后置 true，更正不回退 */
  locked: boolean;
  reviewedAt: string | null;
  createdAt: string;
}

/** 一次录入的原始量（手填部分） */
export interface EntryInput {
  productCode: string;
  /** 开始罐存 L（实测体积） */
  openingStock: number;
  /** 结束罐存 L（实测体积） */
  closingStock: number;
  /** 量测罐温 ℃（结束罐温） */
  temperature: number;
  /** 当班付油量 L（加油机发油，按标准体积结算） */
  delivered: number;
  /** 回罐量 L */
  returned: number;
}

/**
 * 同油品同班的一个版本。
 * v1 为原始录入；复核冻结后更正会新增 v2、v3……旧版本 supersededAt 置时间戳，
 * 原始罐温随旧版本永久保留、不可改写。
 */
export interface EntryVersion extends EntryInput {
  id: string;
  shiftId: string;
  /** 版本号，从 1 开始 */
  version: number;
  /** 被新版本替代的时间；当前生效版本为 null */
  supersededAt: string | null;
  /** 上一版本 id，v1 为 null */
  correctedFrom: string | null;
  /** 复核冻结标记 */
  frozen: boolean;
  /** 超 3‰ 时的归因；未超阈值为 null */
  attributionKind: AttributionKind | null;
  /** 归因依据（现场记录、检尺数据等） */
  attributionBasis: string;
  /** 更正原因，version >= 2 必填 */
  correctionReason: string;
  createdAt: string;
  reviewedAt: string | null;
}

/** 表单草稿（含归因与更正原因） */
export interface EntryDraft extends EntryInput {
  attributionKind: AttributionKind | null;
  attributionBasis: string;
  correctionReason: string;
}

/** 存储根对象（只持久化原始数据，损溢等派生量每次重算） */
export interface StoreData {
  version: 1;
  shifts: Shift[];
  entries: EntryVersion[];
  products: Product[];
}

/** 冲突/违规编码 */
export type ConflictCode =
  | "DUPLICATE_PRODUCT"
  | "UNATTRIBUTED_VARIANCE"
  | "FROZEN_ENTRY"
  | "SHIFT_LOCKED"
  | "INVALID_INPUT"
  | "INTEGRITY";

/** 冲突明细：列出油品、原值与所违反规则 */
export interface Conflict {
  code: ConflictCode;
  shiftId: string;
  productCode?: string;
  /** 原值/现状描述 */
  oldValue?: string;
  /** 违反的规则条文 */
  rule: string;
  message: string;
}
