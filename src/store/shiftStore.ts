/**
 * 状态胶水层：页面只与 store 交互；store 负责调用仓储并在每次写后
 * 重新载入快照并重算派生量，保证刷新后班次、损溢、归因、版本链一致。
 */

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { computeVariance, type VarianceResult } from "../domain/calculations";
import type {
  Conflict,
  EntryDraft,
  EntryVersion,
  Product,
  Shift,
  ShiftPeriod,
  StoreData
} from "../domain/types";
import { activeEntries } from "../domain/validation";
import { LocalStorageBackend, type StorageBackend } from "../storage/backend";
import { RuleViolationError } from "../storage/errors";
import { ShiftRepository } from "../storage/repository";

export interface EntryView {
  entry: EntryVersion;
  product: Product | undefined;
  result: VarianceResult;
  /** 该油品版本链长度（>1 说明发生过更正） */
  chainLength: number;
  /** 已复核班次上的待复核更正 */
  pendingCorrection: boolean;
}

function emptyDraft(products: Product[]): EntryDraft {
  return {
    productCode: products[0]?.code ?? "",
    openingStock: 0,
    closingStock: 0,
    temperature: 20,
    delivered: 0,
    returned: 0,
    attributionKind: null,
    attributionBasis: "",
    correctionReason: ""
  };
}

/** 允许测试注入内存后端；默认走 localStorage */
let backendOverride: StorageBackend | null = null;
export function setStoreBackend(backend: StorageBackend | null): void {
  backendOverride = backend;
}

export const useShiftStore = defineStore("shift", () => {
  const repository = new ShiftRepository(backendOverride ?? new LocalStorageBackend());

  const data = ref<StoreData>(repository.snapshot());
  const selectedShiftId = ref<string | null>(data.value.shifts[0]?.id ?? null);
  /** 正在查看版本链的油品 */
  const chainKey = ref<{ shiftId: string; productCode: string } | null>(null);
  /** 表单是否处于“更正”模式（已复核班次上的新版本） */
  const correctingProduct = ref<string | null>(null);

  function reload(): void {
    data.value = repository.snapshot();
  }

  const shifts = computed<Shift[]>(() =>
    [...data.value.shifts].sort((a, b) =>
      (b.date + b.period).localeCompare(a.date + a.period)
    )
  );
  const products = computed<Product[]>(() => data.value.products);
  const selectedShift = computed<Shift | undefined>(() =>
    data.value.shifts.find((shift) => shift.id === selectedShiftId.value)
  );
  const conflicts = computed<Conflict[]>(() => {
    void data.value;
    return repository.conflicts();
  });
  const shiftConflicts = computed<Conflict[]>(() => {
    void data.value;
    return selectedShiftId.value ? repository.conflicts(selectedShiftId.value) : [];
  });

  const activeEntryViews = computed<EntryView[]>(() => {
    if (!selectedShiftId.value) return [];
    const shiftId = selectedShiftId.value;
    return activeEntries(data.value.entries, shiftId).map((entry) => {
      const product = data.value.products.find((item) => item.code === entry.productCode);
      return {
        entry,
        product,
        result: computeVariance(entry, product),
        chainLength: repository.versionChain(shiftId, entry.productCode).length,
        pendingCorrection: selectedShift.value?.locked === true && !entry.frozen
      };
    });
  });

  const versionChain = computed<EntryVersion[]>(() => {
    void data.value; // 依赖快照，写操作 reload 后版本链同步刷新
    return chainKey.value
      ? repository.versionChain(chainKey.value.shiftId, chainKey.value.productCode)
      : [];
  });

  /** 班次概要指标 */
  const shiftSummary = computed(() => {
    const views = activeEntryViews.value;
    return {
      count: views.length,
      totalVariance: views.reduce((sum, view) => sum + view.result.variance, 0),
      overLimit: views.filter((view) => view.result.overLimit).length,
      pendingCorrections: views.filter((view) => view.pendingCorrection).length
    };
  });

  // ---------- 操作（捕获规则冲突，返回给页面展示） ----------

  function run(action: () => unknown): Conflict[] | null {
    try {
      action();
      reload();
      return null;
    } catch (error) {
      if (error instanceof RuleViolationError) return error.conflicts;
      throw error;
    }
  }

  function createShift(input: { date: string; period: ShiftPeriod; station?: string }): Conflict[] | null {
    return run(() => {
      const shift = repository.createShift(input);
      selectedShiftId.value = shift.id;
      correctingProduct.value = null;
    });
  }

  function updateShift(shiftId: string, patch: { date?: string; period?: ShiftPeriod; station?: string }) {
    return run(() => repository.updateShift(shiftId, patch));
  }

  function review(shiftId: string) {
    return run(() => repository.review(shiftId));
  }

  function saveEntry(shiftId: string, draft: EntryDraft) {
    return run(() => {
      repository.saveEntry(shiftId, draft);
      correctingProduct.value = null;
    });
  }

  function deleteEntry(shiftId: string, productCode: string) {
    return run(() => repository.deleteEntry(shiftId, productCode));
  }

  function selectShift(shiftId: string): void {
    selectedShiftId.value = shiftId;
    chainKey.value = null;
    correctingProduct.value = null;
  }

  function openChain(shiftId: string, productCode: string): void {
    chainKey.value = { shiftId, productCode };
  }

  function closeChain(): void {
    chainKey.value = null;
  }

  /** 以当前生效版本预填表单，发起更正 */
  function draftFromHead(shiftId: string, productCode: string): EntryDraft | null {
    const chain = repository.versionChain(shiftId, productCode);
    const head = chain[chain.length - 1];
    if (!head) return null;
    correctingProduct.value = productCode;
    return {
      productCode: head.productCode,
      openingStock: head.openingStock,
      closingStock: head.closingStock,
      temperature: head.temperature,
      delivered: head.delivered,
      returned: head.returned,
      attributionKind: head.attributionKind,
      attributionBasis: head.attributionBasis,
      correctionReason: ""
    };
  }

  function blankDraft(): EntryDraft {
    return emptyDraft(data.value.products);
  }

  function isProductUsedInShift(shiftId: string, productCode: string): boolean {
    return activeEntries(data.value.entries, shiftId).some((entry) => entry.productCode === productCode);
  }

  function resetDemo(): void {
    repository.resetToSeed();
    reload();
    selectedShiftId.value = data.value.shifts[0]?.id ?? null;
    chainKey.value = null;
    correctingProduct.value = null;
  }

  return {
    // state
    data,
    selectedShiftId,
    chainKey,
    correctingProduct,
    // getters
    shifts,
    products,
    selectedShift,
    conflicts,
    shiftConflicts,
    activeEntryViews,
    versionChain,
    shiftSummary,
    // actions
    selectShift,
    createShift,
    updateShift,
    review,
    saveEntry,
    deleteEntry,
    openChain,
    closeChain,
    draftFromHead,
    blankDraft,
    isProductUsedInShift,
    resetDemo
  };
});
