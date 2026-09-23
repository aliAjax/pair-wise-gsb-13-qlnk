/**
 * 存储层：演示种子数据。首次打开（localStorage 为空）时载入，
 * 覆盖：已复核班次、待复核未归因（阻断复核）、复核后更正版本链三种场景。
 */

import { DEFAULT_PRODUCTS } from "../domain/rules";
import type { EntryVersion, Shift, StoreData } from "../domain/types";

const T0 = "2026-09-22T06:30:00.000Z";
const T1 = "2026-09-22T07:00:00.000Z";
const T2 = "2026-09-23T02:30:00.000Z";
const T3 = "2026-09-23T03:00:00.000Z";

export function buildSeedData(): StoreData {
  const shifts: Shift[] = [
    {
      id: "s-seed-1",
      date: "2026-09-22",
      period: "早班",
      station: "示范加油站",
      locked: true,
      reviewedAt: T1,
      createdAt: T0
    },
    {
      id: "s-seed-2",
      date: "2026-09-23",
      period: "中班",
      station: "示范加油站",
      locked: false,
      reviewedAt: null,
      createdAt: T2
    },
    {
      id: "s-seed-3",
      date: "2026-09-23",
      period: "早班",
      station: "示范加油站",
      locked: true,
      reviewedAt: T3,
      createdAt: T2
    }
  ];

  const entries: EntryVersion[] = [
    // s1：92# 损溢超 3‰，已按漏损原因归因并复核
    {
      id: "e-s1-92-v1",
      shiftId: "s-seed-1",
      version: 1,
      correctedFrom: null,
      supersededAt: null,
      frozen: true,
      productCode: "92#",
      openingStock: 10000,
      closingStock: 5766,
      temperature: 25,
      delivered: 4200,
      returned: 20,
      attributionKind: "漏损原因",
      attributionBasis: "地封检查发现1号油罐人孔密封垫渗油，已拍照报安全设备部（工作联系单 JL-0912）。",
      correctionReason: "",
      createdAt: T0,
      reviewedAt: T1
    },
    // s1：95# 损溢在 3‰ 以内，无需归因
    {
      id: "e-s1-95-v1",
      shiftId: "s-seed-1",
      version: 1,
      correctedFrom: null,
      supersededAt: null,
      frozen: true,
      productCode: "95#",
      openingStock: 8000,
      closingStock: 4880,
      temperature: 25,
      delivered: 3100,
      returned: 0,
      attributionKind: null,
      attributionBasis: "",
      correctionReason: "",
      createdAt: T0,
      reviewedAt: T1
    },
    // s2：0# 损溢超 3‰ 且未归因 —— 复核应被阻断
    {
      id: "e-s2-0-v1",
      shiftId: "s-seed-2",
      version: 1,
      correctedFrom: null,
      supersededAt: null,
      frozen: false,
      productCode: "0#",
      openingStock: 12000,
      closingStock: 6900,
      temperature: 26,
      delivered: 5000,
      returned: 30,
      attributionKind: null,
      attributionBasis: "",
      correctionReason: "",
      createdAt: T2,
      reviewedAt: null
    },
    // s2：-10# 正常
    {
      id: "e-s2-m10-v1",
      shiftId: "s-seed-2",
      version: 1,
      correctedFrom: null,
      supersededAt: null,
      frozen: false,
      productCode: "-10#",
      openingStock: 6000,
      closingStock: 3990,
      temperature: 26,
      delivered: 2000,
      returned: 0,
      attributionKind: null,
      attributionBasis: "",
      correctionReason: "",
      createdAt: T2,
      reviewedAt: null
    },
    // s3：92# 复核后更正链 —— v1 已冻结（计量原因），v2 待重新复核
    {
      id: "e-s3-92-v1",
      shiftId: "s-seed-3",
      version: 1,
      correctedFrom: null,
      supersededAt: T3,
      frozen: true,
      productCode: "92#",
      openingStock: 9000,
      closingStock: 5120,
      temperature: 23,
      delivered: 3800,
      returned: 0,
      attributionKind: "计量原因",
      attributionBasis: "首次检尺按罐温23℃折算，损溢率约12.8‰；复尺怀疑温度计读数偏差。",
      correctionReason: "",
      createdAt: T2,
      reviewedAt: T3
    },
    {
      id: "e-s3-92-v2",
      shiftId: "s-seed-3",
      version: 2,
      correctedFrom: "e-s3-92-v1",
      supersededAt: null,
      frozen: false,
      productCode: "92#",
      openingStock: 9000,
      closingStock: 5195,
      temperature: 20.5,
      delivered: 3800,
      returned: 0,
      attributionKind: null,
      attributionBasis: "",
      correctionReason: "复核后复尺确认原罐温读数错误（23℃），实测罐温20.5℃，结束罐存按复测值5195L更正。",
      createdAt: T3,
      reviewedAt: null
    },
    // s3：95# 正常已复核
    {
      id: "e-s3-95-v1",
      shiftId: "s-seed-3",
      version: 1,
      correctedFrom: null,
      supersededAt: null,
      frozen: true,
      productCode: "95#",
      openingStock: 7000,
      closingStock: 4400,
      temperature: 22,
      delivered: 2600,
      returned: 0,
      attributionKind: null,
      attributionBasis: "",
      correctionReason: "",
      createdAt: T2,
      reviewedAt: T3
    }
  ];

  return {
    version: 1,
    shifts,
    entries,
    products: DEFAULT_PRODUCTS.map((product) => ({ ...product }))
  };
}
