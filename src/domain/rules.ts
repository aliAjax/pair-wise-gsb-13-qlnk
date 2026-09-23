/**
 * 数据层：业务规则常量与条文。
 * 规则单点定义，冲突提示直接引用这里，避免页面与存储各说各话。
 */

/** 损溢率阈值：千分之三（|损溢量| / 账面量 > 0.003 即必须归因） */
export const VARIANCE_LIMIT = 0.003;

/** 标准温度 ℃ */
export const STANDARD_TEMPERATURE = 20;

/** 规则条文（用于冲突列表） */
export const RULES = {
  duplicateProduct:
    "同油品同班次不得重复录入；已复核冻结的记录只能通过“更正”新增带原因版本。",
  unattributedVariance:
    "温度修正后的账面量与实存量相差超过千分之三时，必须选择计量/漏损/操作原因并填写依据，未归因不得复核。",
  frozenEntry: "已复核冻结的原始罐存、罐温与付油/回罐数据不可改写，更正须另建带原因版本。",
  shiftLocked: "班次已复核冻结，表头与原始数据锁定；更正以新版本追加，不改写原值。",
  invalidInput: "录入字段须为非负数值（罐温允许 0℃ 以上合理范围），归因依据与更正原因不得为空。",
  integrity: "版本链或数据引用不完整（断链/悬挂/重复生效版本）。"
} as const;

/** 默认油品档案；β 为体积温度修正系数近似值 */
export const DEFAULT_PRODUCTS = [
  { code: "92#", name: "92号车用汽油", beta: 0.0012 },
  { code: "95#", name: "95号车用汽油", beta: 0.0012 },
  { code: "0#", name: "0号车用柴油", beta: 0.0008 },
  { code: "-10#", name: "-10号车用柴油", beta: 0.0008 }
] as const;
