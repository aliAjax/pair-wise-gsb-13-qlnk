/** 存储层：localStorage 仓库（仅负责序列化/读取，不含业务规则） */
import type { ShiftVersion } from "../domain/types";

const STORAGE_KEY = "dfwlfront-7-fuel-loss-shifts";
const SCHEMA_VERSION = 1;

interface PersistShape {
  schema: number;
  versions: ShiftVersion[];
}

/** 读取全部班次版本；损坏数据返回空数组而不是抛错 */
export function loadVersions(): ShiftVersion[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedVersions();
  try {
    const parsed = JSON.parse(raw) as PersistShape;
    if (!parsed || parsed.schema !== SCHEMA_VERSION || !Array.isArray(parsed.versions)) {
      return [];
    }
    return parsed.versions as ShiftVersion[];
  } catch {
    return [];
  }
}

export function saveVersions(versions: ShiftVersion[]): void {
  const payload: PersistShape = { schema: SCHEMA_VERSION, versions };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function resetStorage(): ShiftVersion[] {
  localStorage.removeItem(STORAGE_KEY);
  const seed = seedVersions();
  saveVersions(seed);
  return seed;
}

/** 演示数据：一个已复核冻结班次、一个待复核班次（含超阈值未归因条目，便于演示闸门） */
function seedVersions(): ShiftVersion[] {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      id: "seed-v1-1",
      shiftDate: today,
      shiftType: "早班",
      status: "已复核",
      version: 1,
      parentId: null,
      rootId: "seed-v1-1",
      correctionReason: "",
      createdAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      reviewedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      reviewer: "值班站长",
      entries: [
        {
          id: "seed-e-1",
          fuel: "92#",
          startStock: 12000,
          endStock: 7708,
          temperature: 20,
          delivered: 4280,
          returned: 0,
          reason: "",
          basis: ""
        },
        {
          id: "seed-e-2",
          fuel: "95#",
          startStock: 8000,
          endStock: 5088,
          temperature: 20,
          delivered: 3000,
          returned: 100,
          reason: "",
          basis: ""
        }
      ]
    },
    {
      id: "seed-v2-1",
      shiftDate: today,
      shiftType: "中班",
      status: "待复核",
      version: 1,
      parentId: null,
      rootId: "seed-v2-1",
      correctionReason: "",
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      reviewedAt: null,
      reviewer: "",
      entries: [
        {
          id: "seed-e-3",
          fuel: "0#",
          startStock: 10000,
          endStock: 7520,
          temperature: 24.1,
          delivered: 2600,
          returned: 0,
          reason: "",
          basis: ""
        }
      ]
    }
  ];
}
