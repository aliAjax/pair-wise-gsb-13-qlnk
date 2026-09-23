import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { MemoryBackend } from "../src/storage/backend";
import { buildSeedData } from "../src/storage/seed";
import { setStoreBackend, useShiftStore } from "../src/store/shiftStore";
import type { EntryDraft } from "../src/domain/types";

function draft(partial: Partial<EntryDraft> = {}): EntryDraft {
  return {
    productCode: "92#",
    openingStock: 10000,
    closingStock: 6000,
    temperature: 20,
    delivered: 4000,
    returned: 0,
    attributionKind: null,
    attributionBasis: "",
    correctionReason: "",
    ...partial
  };
}

describe("状态层（store）冒烟", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setStoreBackend(new MemoryBackend(buildSeedData()));
  });

  it("载入种子数据并默认选中第一个班次，派生视图可算损溢", () => {
    const store = useShiftStore();
    expect(store.shifts.length).toBeGreaterThan(0);
    expect(store.selectedShift).toBeDefined();
    expect(store.activeEntryViews.length).toBeGreaterThan(0);
    const view = store.activeEntryViews.find((item) => item.entry.productCode === "92#");
    expect(view?.result).toBeDefined();
    expect(typeof view?.result.variance).toBe("number");
  });

  it("完整闭环：新建班次 → 录入 → 复核冻结 → 更正 → 重新复核 → 版本链一致", () => {
    const store = useShiftStore();
    expect(store.createShift({ date: "2026-09-24", period: "晚班" })).toBeNull();
    const id = store.selectedShiftId!;
    expect(store.activeEntryViews).toHaveLength(0);

    // 超阈值未归因：保存返回冲突
    const blocked = store.saveEntry(id, draft({ closingStock: 9000 }));
    expect(blocked?.[0].code).toBe("UNATTRIBUTED_VARIANCE");
    expect(store.activeEntryViews).toHaveLength(0);

    // 归因后保存 + 复核
    expect(
      store.saveEntry(id, {
        ...draft({
          closingStock: 9000,
          attributionKind: "计量原因",
          attributionBasis: "复尺记录：温度计偏差，附校验证 YD-2026-09。"
        })
      })
    ).toBeNull();
    expect(store.activeEntryViews).toHaveLength(1);
    expect(store.review(id)).toBeNull();
    expect(store.selectedShift?.locked).toBe(true);
    expect(store.activeEntryViews[0].entry.frozen).toBe(true);

    // 更正（新版本，罐温改回，数据做到 3‰ 内）
    const correction = store.draftFromHead(id, "92#");
    expect(correction).not.toBeNull();
    const conflicts = store.saveEntry(id, {
      ...correction!,
      temperature: 20,
      closingStock: 6000,
      attributionKind: null,
      attributionBasis: "",
      correctionReason: "换用校验合格温度计复测，罐温20℃、结束罐存6000L。"
    });
    expect(conflicts).toBeNull();
    store.openChain(id, "92#");
    expect(store.versionChain).toHaveLength(2);
    expect(store.versionChain[0].frozen).toBe(true);
    expect(store.versionChain[0].temperature).toBe(20); // 原始版本原值
    expect(store.versionChain[1].frozen).toBe(false);
    expect(store.shiftSummary.pendingCorrections).toBe(1);

    // 重新复核
    expect(store.review(id)).toBeNull();
    expect(store.versionChain[1].frozen).toBe(true);
    expect(store.conflicts.filter((c) => c.shiftId === id)).toHaveLength(0);
  });

  it("切换班次互不串数据", () => {
    const store = useShiftStore();
    store.selectShift("s-seed-1");
    const before = store.activeEntryViews.length;
    expect(before).toBe(2);
    store.selectShift("s-seed-2");
    expect(store.activeEntryViews.map((v) => v.entry.productCode).sort()).toEqual(["-10#", "0#"]);
    expect(store.activeEntryViews.some((v) => v.entry.productCode === "0#")).toBe(true);
    // 该班次复核被阻断（0# 未归因）
    expect(store.shiftConflicts.some((c) => c.code === "UNATTRIBUTED_VARIANCE")).toBe(true);
  });
});
