/** 领域规则与 store 冒烟测试（node 执行，构建时不参与） */
import assert from "node:assert";
// Node 环境的 localStorage 垫片（浏览器下由宿主提供）
const mem = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear()
  }
});

import { setActivePinia, createPinia } from "pinia";
import { correctToStandard, calcEntry, bookStockOf } from "../src/domain/calculations";
import { canReview, prepareEntries, validateEntries } from "../src/domain/validation";
import type { FuelEntry, ShiftVersion } from "../src/domain/types";
import { useShiftStore } from "../src/stores/shifts";

let pass = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  pass++;
  console.log(`✓ ${name}`);
}

function entry(partial: Partial<FuelEntry> = {}): FuelEntry {
  return {
    id: Math.random().toString(36),
    fuel: "92#",
    startStock: 10000,
    endStock: 9000,
    temperature: 20,
    delivered: 1000,
    returned: 0,
    reason: "",
    basis: "",
    ...partial
  };
}

// 1. 温度修正
{
  // 20℃ 不修正
  assert.ok(Math.abs(correctToStandard(1000, 20) - 1000) < 1e-9);
  // 30℃ 膨胀，标准体积变小
  ok("30℃ 修正后体积折减", correctToStandard(1000, 30) < 1000);
  // 10℃ 收缩，标准体积变大
  ok("10℃ 修正后体积增大", correctToStandard(1000, 10) > 1000);
  // 账面量 = 开始 - 付油 + 回罐
  ok("账面量含回罐", bookStockOf(entry({ startStock: 100, delivered: 30, returned: 5 })) === 75);
}

// 2. 账实一致（阈值内）无需归因，可复核
{
  const e = entry(); // 账面 9000 = 实存 9000
  const c = calcEntry(e);
  ok("账实相等损溢率0", c.ratio === 0 && !c.overThreshold);
  ok("阈值内可复核", canReview([e]).ok);
}

// 3. 超千分之三：必须归因+依据，否则不得复核
{
  // 账面 9000，20℃实存 = 9000*1.005=9045，损溢率 0.5% > 0.3%
  const over = entry({ endStock: 9000, temperature: 13.75 });
  // 精确构造：让 V20 = 9030（损 30/9000=3.33‰）→ 用 endStock 调整
  const target = entry({ endStock: 9030, temperature: 20 });
  const c = calcEntry(target);
  ok("构造用例超阈值", c.overThreshold === true && Math.abs(c.ratio - 30 / 9000) < 1e-9);
  const blocked = canReview([target]);
  ok("未归因不得复核", !blocked.ok);
  ok("冲突含 REASON_REQUIRED 与 BASIS_REQUIRED",
    blocked.conflicts.some((x) => x.rule === "REASON_REQUIRED") &&
    blocked.conflicts.some((x) => x.rule === "BASIS_REQUIRED"));
  ok("冲突列出油品与原值", blocked.conflicts.every((x) => x.fuel === "92#" && x.original.length > 0));

  const attributed = { ...target, reason: "计量原因" as const, basis: "2号流量计校表单 J2026-09" };
  ok("归因+依据后可复核", canReview([attributed]).ok);

  const reasonOnly = { ...target, reason: "计量原因" as const, basis: "   " };
  ok("只选原因没写依据仍阻断", !canReview([reasonOnly]).ok);
  void over;
}

// 4. 同油品同班不得重复
{
  const conflicts = validateEntries([entry({ id: "a", fuel: "95#" }), entry({ id: "b", fuel: "95#" })]);
  const dup = conflicts.find((c) => c.rule === "DUPLICATE_FUEL");
  ok("同油品重复被检出", !!dup);
  ok("重复冲突含油品名", dup?.fuel === "95#");
  ok("不同油品不重复", !validateEntries([entry({ fuel: "95#" }), entry({ fuel: "0#" })]).some((c) => c.rule === "DUPLICATE_FUEL"));
}

// 5. 非法数值 / 账面为负
{
  ok("付油大于开始+回罐→账面为负", validateEntries([entry({ delivered: 99999 })]).some((c) => c.rule === "BOOK_NEGATIVE"));
  ok("负罐存非法", validateEntries([entry({ startStock: -5 })]).some((c) => c.rule === "INVALID_NUMBER"));
}

// 5b. 空行剔除 / 至少一条油品 / 有数据但未选油品
{
  const blank: FuelEntry = { id: "z", fuel: "", startStock: 0, endStock: 0, temperature: 20, delivered: 0, returned: 0, reason: "", basis: "" };
  const real = entry({ id: "r", fuel: "92#" });
  const prepared = prepareEntries([blank, real]);
  ok("完全空行被剔除", prepared.entries.length === 1 && prepared.entries[0].id === "r");
  ok("全空时报 NO_ENTRIES", prepareEntries([blank]).conflicts[0]?.rule === "NO_ENTRIES");
  const noFuel = { ...blank, fuel: "", delivered: 100 };
  ok("有数据未选油品报 FUEL_EMPTY", validateEntries([noFuel]).some((c) => c.rule === "FUEL_EMPTY"));
}

// 6. 阈值边界：恰 3‰ 不阻断（规则为"超过"）
{
  // 账面 10000，实存 10030 → 3‰ 整
  const edge = entry({ startStock: 10000, delivered: 0, returned: 0, endStock: 10030, temperature: 20 });
  ok("恰 3‰ 不触发", calcEntry(edge).overThreshold === false && canReview([edge]).ok);
  const beyond = { ...edge, endStock: 10031 };
  ok("3.1‰ 触发", calcEntry(beyond).overThreshold === true && !canReview([beyond]).ok);
}

// 7. Store：创建→复核冻结→不可改/不可重复复核→更正另建版本→版本链体检
{
  localStorage.clear();
  setActivePinia(createPinia());
  const store = useShiftStore();

  const make = (over = false) => [
    // 账面量 7720；阈值内用 7708（-1.55‰），超阈值用 7750（+3.89‰）
    entry({ id: "x1", fuel: "92#", startStock: 12000, endStock: over ? 7750 : 7708, temperature: 20, delivered: 4280, returned: 0 }),
    entry({ id: "x2", fuel: "95#", startStock: 8000, endStock: 5088, temperature: 20, delivered: 3000, returned: 100 })
  ];

  // 种子数据：早班已复核、中班待复核
  ok("种子加载2条链", store.groups.length === 2);

  const created = store.createShift("2026-09-24", "晚班", make(false));
  ok("新建班次成功", created.ok);
  const newGroup = store.groups.find((g) => g.shiftType === "晚班")!;
  ok("新班次待复核", newGroup.current.status === "待复核");

  // 同日期同班次重复
  const dup = store.createShift("2026-09-24", "晚班", make(false));
  ok("同班次重复被拦截", !dup.ok && dup.conflicts[0].rule === "DUPLICATE_SHIFT");

  // 未填写的默认空行不能保存
  const blankRow: FuelEntry[] = [{ id: "b", fuel: "", startStock: 0, endStock: 0, temperature: 20, delivered: 0, returned: 0, reason: "", basis: "" }];
  const emptyRes = store.createShift("2026-09-26", "早班", blankRow);
  ok("全空录入报 NO_ENTRIES", !emptyRes.ok && emptyRes.conflicts.some((c) => c.rule === "NO_ENTRIES"));

  // 超阈值未归因复核被拦截
  const blocked = store.createShift("2026-09-25", "早班", make(true));
  ok("超阈值班次可先存草稿", blocked.ok);
  const g2 = store.groups.find((g) => g.shiftDate === "2026-09-25")!;
  const reviewBlocked = store.review(g2.current.id);
  ok("超阈值未归因复核被拦截", !reviewBlocked.ok);

  // 归因后复核通过
  g2.current.entries[0].reason = "漏损原因";
  g2.current.entries[0].basis = "潜油泵机械密封渗漏，检漏单 L-091";
  ok("归因后复核通过", store.review(g2.current.id).ok);
  const frozenId = g2.current.id;

  // 冻结后不可编辑、不可删、不可重复复核
  ok("冻结版本不可编辑", !store.updateDraft(frozenId, g2.current.entries).ok);
  ok("冻结版本不可删除", !store.removeDraft(frozenId).ok);
  ok("重复复核被拦截", !store.review(frozenId).ok);

  // 更正必须带原因
  const noReason = store.correct(frozenId, g2.current.entries, "  ");
  ok("更正缺原因被拦截", !noReason.ok && noReason.conflicts.some((c) => c.rule === "CORRECTION_REASON_REQUIRED"));

  // 正常更正产生 v2，原版本保留
  const correctedEntries = (JSON.parse(JSON.stringify(g2.current.entries)) as FuelEntry[])
    .map((e) => (e.fuel === "92#" ? { ...e, id: e.id + "-v2", endStock: 7700 } : { ...e, id: e.id + "-v2" }));
  const corr = store.correct(frozenId, correctedEntries, "结束罐存单记错登 20L，以复核尺记录为准");
  ok("更正版本创建成功", corr.ok);
  const chain = store.groups.find((g) => g.current.id !== frozenId && g.shiftDate === "2026-09-25")
    ?? store.groups.find((g) => g.shiftDate === "2026-09-25")!;
  ok("版本链长度为2(v1+v2)", chain.chain.length === 2);
  ok("当前为v2待复核", chain.current.version === 2 && chain.current.status === "待复核");
  ok("v1仍存在且已复核冻结", chain.chain[0].version === 1 && chain.chain[0].status === "已复核");
  ok("v2父版本指向v1", chain.current.parentId === chain.chain[0].id);
  ok("v2带更正原因", chain.current.correctionReason.includes("结束罐存单"));

  // 已有待复核更正时不能再次更正
  const again = store.correct(chain.chain[0].id, correctedEntries, "再次更正");
  ok("待复核更正未处理前禁止再更正", !again.ok);

  // 复核 v2 后冻结
  ok("v2复核通过", store.review(chain.current.id).ok);

  // 刷新体检：全部一致
  const refresh = store.refresh();
  ok("刷新体检无冲突", refresh.ok && store.auditConflicts.length === 0);

  // 人为破坏版本链 → 体检列出规则
  store.versions.find((v) => v.version === 2)!.parentId = "missing-id";
  saveAndAudit(store);
  ok("断链体检报 CHAIN_PARENT_MISSING", store.auditConflicts.some((c) => c.rule === "CHAIN_PARENT_MISSING"));

  // 人为抹掉已复核版本的归因 → 体检报 REVIEWED_GATE，含油品原值
  store.versions = JSON.parse(JSON.stringify(store.versions)) as ShiftVersion[];
  const reviewedOver = store.versions.find((v) => v.id === frozenId)!;
  reviewedOver.entries[0].reason = "" as FuelEntry["reason"];
  reviewedOver.entries[0].basis = "";
  saveAndAudit(store);
  const gate = store.auditConflicts.find((c) => c.rule === "REVIEWED_GATE");
  ok("已复核未归因体检报 REVIEWED_GATE", !!gate);
  ok("体检冲突列出油品与原值", !!gate && gate.fuel === "92#" && gate.original.includes("损溢率"));
}

function saveAndAudit(store: ReturnType<typeof useShiftStore>) {
  store.persist();
}

console.log(`\n全部通过：${pass} 项断言`);
