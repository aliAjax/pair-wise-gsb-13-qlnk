/**
 * 存储层：班次/录入仓储。
 * 业务写操作全部经过这里的规则校验；只持久化原始数据，
 * 损溢、账面量等派生量不入库，由计算层在读取时重算。
 */

import { computeVariance, isAttributionSatisfied } from "../domain/calculations";
import { RULES } from "../domain/rules";
import type {
  AttributionKind,
  Conflict,
  EntryDraft,
  EntryVersion,
  Product,
  Shift,
  ShiftPeriod,
  StoreData
} from "../domain/types";
import { activeEntries, detectConflicts, reviewBlockers, validateDraft } from "../domain/validation";
import type { StorageBackend } from "./backend";
import { RuleViolationError } from "./errors";
import { buildSeedData } from "./seed";

export function createId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export class ShiftRepository {
  private data: StoreData;

  constructor(
    private readonly backend: StorageBackend,
    seed: () => StoreData = buildSeedData
  ) {
    const loaded = backend.load();
    this.data = loaded ?? seed();
    if (!loaded) this.persist();
  }

  // ---------- 读取 ----------

  snapshot(): StoreData {
    return structuredClone(this.data);
  }

  getShift(shiftId: string): Shift {
    const shift = this.data.shifts.find((item) => item.id === shiftId);
    if (!shift) throw new Error(`班次不存在: ${shiftId}`);
    return structuredClone(shift);
  }

  listProducts(): Product[] {
    return this.data.products.map((product) => ({ ...product }));
  }

  /** 班次内某油品的版本链，按版本号升序 */
  versionChain(shiftId: string, productCode: string): EntryVersion[] {
    return this.data.entries
      .filter((entry) => entry.shiftId === shiftId && entry.productCode === productCode)
      .sort((a, b) => a.version - b.version)
      .map((entry) => structuredClone(entry));
  }

  /** 全量冲突（刷新后据此展示，保证班次/损溢/归因/版本链一致） */
  conflicts(shiftId?: string): Conflict[] {
    return detectConflicts(this.data, shiftId);
  }

  // ---------- 班次 ----------

  createShift(input: { date: string; period: ShiftPeriod; station?: string }): Shift {
    if (!input.date) throw new RuleViolationError([invalidInput("请选择交接日期")]);
    const shift: Shift = {
      id: createId("s"),
      date: input.date,
      period: input.period,
      station: input.station?.trim() || undefined,
      locked: false,
      reviewedAt: null,
      createdAt: new Date().toISOString()
    };
    this.data.shifts.push(shift);
    this.persist();
    return structuredClone(shift);
  }

  /** 表头仅在首次复核（冻结）前可改 */
  updateShift(shiftId: string, patch: { date?: string; period?: ShiftPeriod; station?: string }): Shift {
    const shift = this.mustShift(shiftId);
    if (shift.locked) {
      throw new RuleViolationError([
        {
          code: "SHIFT_LOCKED",
          shiftId,
          oldValue: `${shift.date} ${shift.period}`,
          rule: RULES.shiftLocked,
          message: "班次已复核冻结，表头不可修改；如数据有误请对具体油品发起更正"
        }
      ]);
    }
    if (patch.date) shift.date = patch.date;
    if (patch.period) shift.period = patch.period;
    if (patch.station !== undefined) shift.station = patch.station.trim() || undefined;
    this.persist();
    return structuredClone(shift);
  }

  /** 复核：前置规则不通过则抛出；通过后冻结班次、当前生效版本与其原始罐温 */
  review(shiftId: string): Shift {
    const shift = this.mustShift(shiftId);
    const blockers = reviewBlockers(this.data, shiftId);
    if (blockers.length > 0) throw new RuleViolationError(blockers);
    if (activeEntries(this.data.entries, shiftId).length === 0) {
      throw new RuleViolationError([invalidInput("空班次无法复核，请至少录入一条油品数据", shiftId)]);
    }
    const now = new Date().toISOString();
    shift.locked = true;
    shift.reviewedAt = shift.reviewedAt ?? now;
    for (const entry of activeEntries(this.data.entries, shiftId)) {
      entry.frozen = true;
      entry.reviewedAt = entry.reviewedAt ?? now;
    }
    this.persist();
    return structuredClone(shift);
  }

  // ---------- 油品录入 / 更正 ----------

  /**
   * 保存录入。
   * - 待复核班次、油品首次录入：建立 v1，可继续在 v1 上修订；
   * - 已复核冻结班次上对已有油品再次保存：原版本冻结并置 supersededAt，
   *   新增 v(n+1)，必须填写更正原因；
   * - 同油品同班重复的原始录入：直接拒绝（走更正流程）。
   */
  saveEntry(shiftId: string, draft: EntryDraft): EntryVersion {
    const shift = this.mustShift(shiftId);
    const product = this.data.products.find((item) => item.code === draft.productCode);
    const chain = this.data.entries
      .filter((entry) => entry.shiftId === shiftId && entry.productCode === draft.productCode)
      .sort((a, b) => a.version - b.version);
    const head = chain[chain.length - 1];
    const isCorrection = shift.locked && chain.length > 0;

    if (shift.locked && chain.length === 0) {
      throw new RuleViolationError([
        {
          code: "SHIFT_LOCKED",
          shiftId,
          productCode: draft.productCode,
          oldValue: "该油品在本班次无原始录入",
          rule: RULES.shiftLocked,
          message: "已复核班次不能新增油品原始录入，只能更正班内已有的油品记录"
        }
      ]);
    }
    if (isCorrection && !head.frozen) {
      throw new RuleViolationError([
        {
          code: "FROZEN_ENTRY",
          shiftId,
          productCode: draft.productCode,
          oldValue: `v${head.version} 待重新复核`,
          rule: RULES.frozenEntry,
          message: "该油品已有待重新复核的更正版本，请先完成重新复核再发起新的更正"
        }
      ]);
    }

    const fieldConflicts = validateDraft(draft, isCorrection, product).map((conflict) => ({
      ...conflict,
      shiftId
    }));
    if (fieldConflicts.length > 0) throw new RuleViolationError(fieldConflicts);

    const now = new Date().toISOString();

    if (!isCorrection) {
      if (head) {
        // 待复核阶段在 v1 上直接修订（原始数据尚未冻结）
        Object.assign(head, stripDraft(draft), {
          attributionKind: draft.attributionKind,
          attributionBasis: draft.attributionBasis.trim()
        });
        this.persist();
        return structuredClone(head);
      }
      const version: EntryVersion = {
        ...stripDraft(draft),
        id: createId("e"),
        shiftId,
        version: 1,
        supersededAt: null,
        correctedFrom: null,
        frozen: false,
        attributionKind: draft.attributionKind,
        attributionBasis: draft.attributionBasis.trim(),
        correctionReason: "",
        createdAt: now,
        reviewedAt: null
      };
      this.data.entries.push(version);
      this.persist();
      return structuredClone(version);
    }

    // 更正：冻结旧版本（含原始罐温），追加带原因的新版本
    const result = computeVariance(draft, product);
    if (
      result.overLimit &&
      !isAttributionSatisfied(result, draft.attributionKind, draft.attributionBasis)
    ) {
      throw new RuleViolationError([
        {
          code: "UNATTRIBUTED_VARIANCE",
          shiftId,
          productCode: draft.productCode,
          oldValue: `损溢率 ${(result.varianceRate * 1000).toFixed(2)}‰`,
          rule: RULES.unattributedVariance,
          message: "更正后损溢率仍超过千分之三，必须选择原因并填写依据"
        }
      ]);
    }
    head.frozen = true;
    head.supersededAt = now;
    if (!head.reviewedAt) head.reviewedAt = now;
    const next: EntryVersion = {
      ...stripDraft(draft),
      id: createId("e"),
      shiftId,
      version: head.version + 1,
      supersededAt: null,
      correctedFrom: head.id,
      frozen: false,
      attributionKind: result.overLimit ? draft.attributionKind : null,
      attributionBasis: result.overLimit ? draft.attributionBasis.trim() : "",
      correctionReason: draft.correctionReason.trim(),
      createdAt: now,
      reviewedAt: null
    };
    this.data.entries.push(next);
    this.persist();
    return structuredClone(next);
  }

  /** 仅允许删除待复核班次中、未冻结的当前版本（含整链） */
  deleteEntry(shiftId: string, productCode: string): void {
    const shift = this.mustShift(shiftId);
    if (shift.locked) {
      throw new RuleViolationError([
        {
          code: "SHIFT_LOCKED",
          shiftId,
          productCode,
          oldValue: "已复核",
          rule: RULES.shiftLocked,
          message: "已复核班次的录入不可删除，需要修改请发起更正"
        }
      ]);
    }
    this.data.entries = this.data.entries.filter(
      (entry) => !(entry.shiftId === shiftId && entry.productCode === productCode)
    );
    this.persist();
  }

  // ---------- 测试/运维 ----------

  resetToSeed(): StoreData {
    this.data = buildSeedData();
    this.persist();
    return this.snapshot();
  }

  clearAll(): void {
    this.data = { version: 1, shifts: [], entries: [], products: this.data.products };
    this.persist();
  }

  // ---------- 内部 ----------

  private persist(): void {
    this.backend.save(this.data);
  }

  private mustShift(shiftId: string): Shift {
    const shift = this.data.shifts.find((item) => item.id === shiftId);
    if (!shift) throw new Error(`班次不存在: ${shiftId}`);
    return shift;
  }
}

function stripDraft(draft: EntryDraft): Omit<
  EntryVersion,
  | "id" | "shiftId" | "version" | "supersededAt" | "correctedFrom" | "frozen"
  | "attributionKind" | "attributionBasis" | "correctionReason" | "createdAt" | "reviewedAt"
> {
  return {
    productCode: draft.productCode,
    openingStock: draft.openingStock,
    closingStock: draft.closingStock,
    temperature: draft.temperature,
    delivered: draft.delivered,
    returned: draft.returned
  };
}

function invalidInput(message: string, shiftId = ""): Conflict {
  return { code: "INVALID_INPUT", shiftId, rule: RULES.invalidInput, message };
}

export type { AttributionKind };
