import { describe, expect, it, beforeEach } from "vitest";
import { ShiftRepository } from "../src/storage/repository";
import { MemoryBackend } from "../src/storage/backend";
import { buildSeedData } from "../src/storage/seed";
import { RuleViolationError } from "../src/storage/errors";
import type { EntryDraft, StoreData } from "../src/domain/types";

function repoWith(data: StoreData): ShiftRepository {
  const backend = new MemoryBackend(data);
  return new ShiftRepository(backend);
}

function freshRepo(): ShiftRepository {
  return repoWith(buildSeedData());
}

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

function overLimitDraft(): EntryDraft {
  // 账面 10000，实存 9000 -> 损溢 -1000 -> 10% 超限
  return draft({ closingStock: 9000 });
}

describe("同油品同班不得重复", () => {
  let repo: ShiftRepository;
  let shiftId: string;
  beforeEach(() => {
    repo = freshRepo();
    shiftId = repo.createShift({ date: "2026-09-24", period: "晚班" }).id;
  });

  it("待复核阶段同一油品重复保存覆盖 v1，不产生重复版本", () => {
    repo.saveEntry(shiftId, draft());
    repo.saveEntry(shiftId, draft({ closingStock: 5990 }));
    const chain = repo.versionChain(shiftId, "92#");
    expect(chain).toHaveLength(1);
    expect(chain[0].closingStock).toBe(5990);
    expect(chain[0].version).toBe(1);
    expect(repo.conflicts(shiftId).filter((c) => c.code === "DUPLICATE_PRODUCT")).toHaveLength(0);
  });

  it("不同油品可并存", () => {
    repo.saveEntry(shiftId, draft({ productCode: "92#" }));
    repo.saveEntry(shiftId, draft({ productCode: "95#" }));
    expect(repo.versionChain(shiftId, "92#")).toHaveLength(1);
    expect(repo.versionChain(shiftId, "95#")).toHaveLength(1);
  });
});

describe("超千分之三归因与复核阻断", () => {
  it("超阈值未归因不得保存（阻断在保存环节）", () => {
    const repo = freshRepo();
    const shiftId = repo.createShift({ date: "2026-09-24", period: "晚班" }).id;
    expect(() => repo.saveEntry(shiftId, overLimitDraft())).toThrowError(/千分之三/);
  });

  it("超阈值选了原因并写依据可保存并复核", () => {
    const repo = freshRepo();
    const shiftId = repo.createShift({ date: "2026-09-24", period: "晚班" }).id;
    repo.saveEntry(
      shiftId,
      draft({
        closingStock: 9000,
        attributionKind: "操作原因",
        attributionBasis: "发油后未及时关阀导致串罐，调取监控确认。"
      })
    );
    const shift = repo.review(shiftId);
    expect(shift.locked).toBe(true);
    const head = repo.versionChain(shiftId, "92#")[0];
    expect(head.frozen).toBe(true);
    expect(head.reviewedAt).not.toBeNull();
  });

  it("种子数据：未归因的 0# 班次复核被阻断，并列出油品/原值/规则", () => {
    const repo = freshRepo();
    try {
      repo.review("s-seed-2");
      throw new Error("应当抛出规则冲突");
    } catch (error) {
      expect(error).toBeInstanceOf(RuleViolationError);
      const conflicts = (error as RuleViolationError).conflicts;
      const unattributed = conflicts.find((c) => c.code === "UNATTRIBUTED_VARIANCE");
      expect(unattributed).toBeDefined();
      expect(unattributed!.productCode).toBe("0#");
      expect(unattributed!.oldValue).toContain("损溢率");
      expect(unattributed!.rule).toContain("千分之三");
    }
  });

  it("字段非法（负数/非数字）拒绝保存", () => {
    const repo = freshRepo();
    const shiftId = repo.createShift({ date: "2026-09-24", period: "晚班" }).id;
    expect(() => repo.saveEntry(shiftId, draft({ temperature: -100 }))).toThrow();
    expect(() =>
      repo.saveEntry(shiftId, draft({ delivered: Number.NaN }))
    ).toThrow();
  });
});

describe("复核冻结与更正版本链", () => {
  it("复核后不能改表头、不能改原值、不能新增原始油品", () => {
    const repo = freshRepo();
    expect(() => repo.updateShift("s-seed-1", { station: "改名" })).toThrowError(/冻结/);
    // 已复核班次新增一个从未录入过的油品 -> 拒绝
    expect(() =>
      repo.saveEntry("s-seed-1", draft({ productCode: "-10#" }))
    ).toThrowError(/不能新增/);
  });

  it("更正另建带原因版本，旧版本与原始罐温冻结保留", () => {
    const repo = freshRepo();
    // s-seed-3 的 92#：v1 已 superseded+冻结，v2 待复核；改测 95# 走完整流程
    const before = repo.versionChain("s-seed-3", "95#");
    expect(before).toHaveLength(1);
    expect(before[0].frozen).toBe(true);
    const originalTemp = before[0].temperature;

    repo.saveEntry("s-seed-3", {
      productCode: "95#",
      openingStock: 7000,
      closingStock: 4400,
      temperature: 21.8,
      delivered: 2600,
      returned: 0,
      attributionKind: null,
      attributionBasis: "",
      correctionReason: "复尺发现罐温计示值偏差0.2℃，按21.8℃与复测液位更正结束罐存。"
    });

    const chain = repo.versionChain("s-seed-3", "95#");
    expect(chain).toHaveLength(2);
    expect(chain[0].version).toBe(1);
    expect(chain[0].supersededAt).not.toBeNull();
    expect(chain[0].frozen).toBe(true);
    expect(chain[0].temperature).toBe(originalTemp); // 原始罐温不变
    expect(chain[1].version).toBe(2);
    expect(chain[1].correctedFrom).toBe(chain[0].id);
    expect(chain[1].supersededAt).toBeNull();
    expect(chain[1].frozen).toBe(false);
    expect(chain[1].correctionReason).toContain("罐温计");
  });

  it("更正必须填写更正原因", () => {
    const repo = freshRepo();
    expect(() =>
      repo.saveEntry("s-seed-3", draft({ productCode: "95#", correctionReason: "   " }))
    ).toThrowError(/更正原因/);
  });

  it("更正后仍超 3‰ 且未归因，保存被拦截", () => {
    const repo = freshRepo();
    expect(() =>
      repo.saveEntry("s-seed-3", {
        ...draft({ productCode: "95#" }),
        closingStock: 100,
        correctionReason: "测试"
      })
    ).toThrowError(/千分之三/);
  });

  it("待复核更正存在时不得叠加更正", () => {
    const repo = freshRepo();
    // s-seed-3 的 92# v2 正待复核
    expect(() =>
      repo.saveEntry("s-seed-3", {
        ...draft({ productCode: "92#" }),
        correctionReason: "再次更正"
      })
    ).toThrowError(/重新复核/);
  });

  it("重新复核冻结新版本，班次保持已复核状态", () => {
    const repo = freshRepo();
    const shift = repo.review("s-seed-3");
    expect(shift.locked).toBe(true);
    const head = repo.versionChain("s-seed-3", "92#").find((e) => e.supersededAt === null)!;
    expect(head.version).toBe(2);
    expect(head.frozen).toBe(true);
  });

  it("空班次不得复核", () => {
    const repo = freshRepo();
    const id = repo.createShift({ date: "2026-09-25", period: "早班" }).id;
    expect(() => repo.review(id)).toThrowError(/至少录入/);
  });

  it("待复核班次可删除录入，已复核班次不可删除", () => {
    const repo = freshRepo();
    repo.deleteEntry("s-seed-2", "0#");
    expect(repo.versionChain("s-seed-2", "0#")).toHaveLength(0);
    expect(() => repo.deleteEntry("s-seed-1", "92#")).toThrowError(/不可删除/);
  });
});

describe("刷新一致性（重新加载后端）", () => {
  it("写操作持久化后，用同一后端重建仓储，班次/损溢/归因/版本链一致", () => {
    const backend = new MemoryBackend(buildSeedData());
    const repo1 = new ShiftRepository(backend);
    const shiftId = repo1.createShift({ date: "2026-09-24", period: "晚班" }).id;
    repo1.saveEntry(shiftId, draft());

    const repo2 = new ShiftRepository(backend);
    expect(repo2.getShift(shiftId).locked).toBe(false);
    expect(repo2.versionChain(shiftId, "92#")).toHaveLength(1);
    expect(repo2.conflicts(shiftId)).toHaveLength(0);
  });

  it("种子数据无完整性冲突", () => {
    const repo = freshRepo();
    expect(repo.conflicts().filter((c) => c.code === "INTEGRITY")).toHaveLength(0);
  });
});
