/** 一致性层：刷新后版本链 / 归因 / 冻结状态体检（纯函数） */
import { calcEntry } from "./calculations";
import type { Conflict, ShiftVersion } from "./types";

/**
 * 刷新后体检：校验所有版本的版本链完整性，以及已复核版本当初的复核规则是否仍成立。
 * 冲突列出油品、原值与规则编码，供页面"数据体检"面板展示。
 */
export function auditVersions(versions: ShiftVersion[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const byId = new Map(versions.map((v) => [v.id, v]));

  // 按 root 分组并按版本号排序
  const chains = new Map<string, ShiftVersion[]>();
  for (const v of versions) {
    const list = chains.get(v.rootId) ?? [];
    list.push(v);
    chains.set(v.rootId, list);
  }

  for (const [rootId, chain] of chains) {
    chain.sort((a, b) => a.version - b.version);
    chain.forEach((v, index) => {
      // 链条必须从 v1 起步且版本号连续
      if (index === 0) {
        if (v.version !== 1 || v.parentId !== null) {
          conflicts.push({
            rule: "CHAIN_VERSION_GAP",
            fuel: "",
            field: "version",
            original: `${v.shiftDate} ${v.shiftType} v${v.version}`,
            message: `版本链 ${rootId} 起点不是 v1/无父版本，原值：${v.shiftDate} ${v.shiftType} v${v.version}`
          });
        }
      } else {
        const expectedParent = chain[index - 1];
        if (v.version !== expectedParent.version + 1) {
          conflicts.push({
            rule: "CHAIN_VERSION_GAP",
            fuel: "",
            field: "version",
            original: `v${v.version}`,
            message: `版本链 ${rootId} 版本号不连续：v${expectedParent.version} → v${v.version}`
          });
        }
        if (!v.parentId || !byId.has(v.parentId)) {
          conflicts.push({
            rule: "CHAIN_PARENT_MISSING",
            fuel: "",
            field: "parentId",
            original: String(v.parentId),
            message: `版本链 ${rootId} 的 v${v.version} 父版本原值「${v.parentId}」不存在`
          });
        } else if (v.parentId !== expectedParent.id) {
          conflicts.push({
            rule: "CHAIN_PARENT_MISSING",
            fuel: "",
            field: "parentId",
            original: String(v.parentId),
            message: `版本链 ${rootId} 的 v${v.version} 未链接到紧邻的上一版本`
          });
        }
      }

      if (v.rootId !== rootId) {
        conflicts.push({
          rule: "CHAIN_ROOT_MISMATCH",
          fuel: "",
          field: "rootId",
          original: v.rootId,
          message: `${v.shiftDate} ${v.shiftType} v${v.version} 的 rootId 原值「${v.rootId}」与版本链不符`
        });
      }

      // 已复核版本：冻结的原始罐温/罐存对应的归因规则必须仍然成立
      if (v.status === "已复核") {
        for (const entry of v.entries) {
          const calc = calcEntry(entry);
          if (calc.overThreshold && (!entry.reason || !entry.basis.trim())) {
            conflicts.push({
              rule: "REVIEWED_GATE",
              fuel: entry.fuel,
              field: entry.reason ? "basis" : "reason",
              original: `损溢率 ${(calc.ratio * 1000).toFixed(2)}‰ / 原因「${entry.reason || "空"}」 / 依据「${entry.basis || "空"}」`,
              message: `已复核班次 ${v.shiftDate} ${v.shiftType} v${v.version} 的油品「${entry.fuel}」损溢率 ${(calc.ratio * 1000).toFixed(2)}‰ 超阈值却未完整归因（原值：${entry.reason || "空"}/${entry.basis || "空"}）`
            });
          }
        }
        if (!v.reviewedAt || !v.reviewer) {
          conflicts.push({
            rule: "REVIEWED_GATE",
            fuel: "",
            field: "reviewedAt",
            original: `${v.reviewedAt ?? "空"} / ${v.reviewer || "空"}`,
            message: `${v.shiftDate} ${v.shiftType} v${v.version} 已复核但冻结时间/复核人原值缺失`
          });
        }
      }
    });
  }

  return conflicts;
}
