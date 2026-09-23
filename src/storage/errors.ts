/**
 * 存储层：规则冲突错误。写操作违反规则时抛出，页面据此列出油品/原值/规则。
 */

import type { Conflict } from "../domain/types";

export class RuleViolationError extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super(conflicts.map((conflict) => conflict.message).join("；"));
    this.name = "RuleViolationError";
  }
}
