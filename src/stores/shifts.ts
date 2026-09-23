/** 应用状态层：编排领域规则与存储（Pinia），页面只通过本仓库读写 */
import { defineStore } from "pinia";
import { auditVersions } from "../domain/consistency";
import { calcEntry } from "../domain/calculations";
import { canReview, prepareEntries, validateCorrection, validateEntries } from "../domain/validation";
import { loadVersions, resetStorage, saveVersions } from "../data/storage";
import type { Conflict, FuelEntry, LossReason, ReviewStatus, ShiftType, ShiftVersion } from "../domain/types";
import { deepClone } from "../domain/utils";

/** 保存草稿时必须立即拦截的硬冲突；归因类仅在复核闸门拦截 */
const HARD_RULES = new Set([
  "DUPLICATE_FUEL",
  "INVALID_NUMBER",
  "FUEL_EMPTY",
  "NO_ENTRIES",
  "BOOK_NEGATIVE"
]);

export interface ShiftGroup {
  rootId: string;
  shiftDate: string;
  shiftType: ShiftType;
  current: ShiftVersion;
  chain: ShiftVersion[];
}

function uuid(): string {
  return crypto.randomUUID();
}


export interface ActionResult {
  ok: boolean;
  conflicts: Conflict[];
}

const OK: ActionResult = { ok: true, conflicts: [] };

export const useShiftStore = defineStore("fuel-loss", {
  state: () => {
    const versions = loadVersions();
    return {
      versions,
      /** 刷新/变更后的一致性体检结果 */
      auditConflicts: auditVersions(versions),
      reviewer: "值班站长"
    };
  },

  getters: {
    /** 按版本链根分组后的班次（展示当前最新版本） */
    groups(state): ShiftGroup[] {
      const map = new Map<string, ShiftVersion[]>();
      for (const v of state.versions) {
        const list = map.get(v.rootId) ?? [];
        list.push(v);
        map.set(v.rootId, list);
      }
      const groups: ShiftGroup[] = [];
      for (const [rootId, list] of map) {
        const chain = [...list].sort((a, b) => a.version - b.version);
        groups.push({
          rootId,
          shiftDate: chain[0].shiftDate,
          shiftType: chain[0].shiftType,
          current: chain[chain.length - 1],
          chain
        });
      }
      return groups.sort((a, b) =>
        (b.shiftDate + b.shiftType).localeCompare(a.shiftDate + a.shiftType, "zh-Hans-CN")
      );
    },

    /** 已复核冻结的版本数 */
    frozenCount(state): number {
      return state.versions.filter((v) => v.status === "已复核").length;
    },

    pendingCount(): number {
      return this.groups.filter((g: ShiftGroup) => g.current.status === "待复核").length;
    },

    /** 各油品累计损溢（取每条版本链当前版本，避免重复统计历史版本） */
    fuelLossSummary(): { fuel: string; gainLoss: number }[] {
      const map = new Map<string, number>();
      for (const group of this.groups as ShiftGroup[]) {
        for (const entry of group.current.entries) {
          const c = calcEntry(entry);
          map.set(entry.fuel, (map.get(entry.fuel) ?? 0) + c.gainLoss);
        }
      }
      return [...map.entries()].map(([fuel, gainLoss]) => ({ fuel, gainLoss }));
    }
  },

  actions: {
    /** 整理并校验录入：剔除空行，返回硬冲突；归因类冲突不在保存阶段拦截 */
    prepareValid(raw: FuelEntry[]): { entries: FuelEntry[]; conflicts: Conflict[] } {
      const { entries, conflicts } = prepareEntries(raw);
      conflicts.push(...validateEntries(entries).filter((c) => HARD_RULES.has(c.rule)));
      return { entries, conflicts };
    },

    persist() {
      saveVersions(this.versions);
      this.auditConflicts = auditVersions(this.versions);
    },

    /** 重新从存储读取并体检（模拟刷新后校验班次/损溢/归因/版本链一致） */
    refresh(): ActionResult {
      this.versions = loadVersions();
      this.auditConflicts = auditVersions(this.versions);
      return { ok: this.auditConflicts.length === 0, conflicts: this.auditConflicts };
    },

    /** 初录新班次：同日期同班次不得重复 */
    createShift(shiftDate: string, shiftType: ShiftType, rawEntries: FuelEntry[]): ActionResult {
      const conflicts: Conflict[] = [];
      const duplicateShift = this.versions.some((v) => v.shiftDate === shiftDate && v.shiftType === shiftType);
      if (duplicateShift) {
        conflicts.push({
          rule: "DUPLICATE_SHIFT",
          fuel: "",
          field: "shiftType",
          original: `${shiftDate} ${shiftType}`,
          message: `${shiftDate} ${shiftType} 已存在班次，同班次不得重复建立`
        });
      }
      const prepared = this.prepareValid(rawEntries);
      conflicts.push(...prepared.conflicts);
      if (conflicts.length) return { ok: false, conflicts };

      const id = uuid();
      const version: ShiftVersion = {
        id,
        shiftDate,
        shiftType,
        entries: deepClone(prepared.entries),
        status: "待复核",
        version: 1,
        parentId: null,
        rootId: id,
        correctionReason: "",
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewer: ""
      };
      this.versions.push(version);
      this.persist();
      return OK;
    },

    /** 编辑待复核草稿（已复核版本冻结，返回 FROZEN 冲突） */
    updateDraft(versionId: string, rawEntries: FuelEntry[]): ActionResult {
      const target = this.versions.find((v) => v.id === versionId);
      if (!target) return { ok: false, conflicts: [] };
      if (target.status === "已复核") {
        return {
          ok: false,
          conflicts: [
            {
              rule: "FROZEN",
              fuel: "",
              field: "status",
              original: "已复核",
              message: `${target.shiftDate} ${target.shiftType} v${target.version} 已复核冻结，原始罐温与录入不可修改，如需更正请另建版本`
            }
          ]
        };
      }
      const prepared = this.prepareValid(rawEntries);
      if (prepared.conflicts.length) return { ok: false, conflicts: prepared.conflicts };
      target.entries = deepClone(prepared.entries);
      this.persist();
      return OK;
    },

    /** 复核：未归因不得复核；复核后冻结班次和原始罐温 */
    review(versionId: string): ActionResult {
      const target = this.versions.find((v) => v.id === versionId);
      if (!target) return { ok: false, conflicts: [] };
      if (target.status === "已复核") {
        return {
          ok: false,
          conflicts: [
            {
              rule: "FROZEN",
              fuel: "",
              field: "status",
              original: "已复核",
              message: "该班次已复核冻结，不能重复复核"
            }
          ]
        };
      }
      const gate = canReview(target.entries);
      const extra = validateCorrection(target);
      if (!gate.ok || extra.length) {
        return { ok: false, conflicts: [...gate.conflicts, ...extra] };
      }
      target.status = "已复核" as ReviewStatus;
      target.reviewedAt = new Date().toISOString();
      target.reviewer = this.reviewer || "值班站长";
      this.persist();
      return OK;
    },

    /**
     * 更正：基于已复核版本另建带原因的新版本（原版本保留、继续冻结）。
     * 新版本复制原始班次的日期/班次与罐温录入，规则重新校验。
     */
    correct(sourceId: string, rawEntries: FuelEntry[], correctionReason: string): ActionResult {
      const source = this.versions.find((v) => v.id === sourceId);
      if (!source) return { ok: false, conflicts: [] };
      if (source.status !== "已复核") {
        return {
          ok: false,
          conflicts: [
            {
              rule: "REVIEWED_GATE",
              fuel: "",
              field: "status",
              original: source.status,
              message: "只能对已复核冻结的班次发起更正"
            }
          ]
        };
      }
      // 同一班次链上已有待复核更正版本时，先处理该版本
      const pending = this.versions.some(
        (v) => v.rootId === source.rootId && v.status === "待复核"
      );
      if (pending) {
        return {
          ok: false,
          conflicts: [
            {
              rule: "DUPLICATE_SHIFT",
              fuel: "",
              field: "version",
              original: "存在待复核更正版本",
              message: `${source.shiftDate} ${source.shiftType} 已有待复核的更正版本，请先复核或删除后再发起更正`
            }
          ]
        };
      }

      const prepared = this.prepareValid(rawEntries);
      const nextVersionNum = Math.max(...this.versions.filter((v) => v.rootId === source.rootId).map((v) => v.version)) + 1;
      const draft: ShiftVersion = {
        id: uuid(),
        shiftDate: source.shiftDate,
        shiftType: source.shiftType,
        entries: deepClone(prepared.entries),
        status: "待复核",
        version: nextVersionNum,
        parentId: source.id,
        rootId: source.rootId,
        correctionReason: correctionReason.trim(),
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewer: ""
      };

      // 更正版本创建即需通过完整复核闸门（含归因），并带更正原因
      const gate = canReview(draft.entries);
      const extra = validateCorrection(draft);
      const conflicts = [...prepared.conflicts, ...gate.conflicts, ...extra];
      if (conflicts.length) {
        return { ok: false, conflicts };
      }
      this.versions.push(draft);
      this.persist();
      return OK;
    },

    /** 删除待复核草稿（已复核冻结版本不可删） */
    removeDraft(versionId: string): ActionResult {
      const target = this.versions.find((v) => v.id === versionId);
      if (!target) return { ok: false, conflicts: [] };
      if (target.status === "已复核") {
        return {
          ok: false,
          conflicts: [
            {
              rule: "FROZEN",
              fuel: "",
              field: "status",
              original: "已复核",
              message: "已复核冻结版本不可删除，只能通过更正产生新版本"
            }
          ]
        };
      }
      this.versions = this.versions.filter((v) => v.id !== versionId);
      this.persist();
      return OK;
    },

    resetToSeed(): void {
      this.versions = resetStorage();
      this.auditConflicts = auditVersions(this.versions);
    },

    /** 供页面预填归因下拉/单条计算 */
    emptyEntry(): FuelEntry {
      return {
        id: uuid(),
        fuel: "",
        startStock: 0,
        endStock: 0,
        temperature: 20,
        delivered: 0,
        returned: 0,
        reason: "" as LossReason | "",
        basis: ""
      };
    }
  }
});
