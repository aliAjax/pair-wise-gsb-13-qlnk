<script setup lang="ts">
/** 冲突清单：列出油品、原值、违反规则 */
import type { Conflict } from "../domain/types";

defineProps<{ conflicts: Conflict[]; title?: string }>();

const RULE_LABELS: Record<string, string> = {
  DUPLICATE_FUEL: "同油品同班重复",
  DUPLICATE_SHIFT: "同班次重复",
  INVALID_NUMBER: "数值非法",
  FUEL_EMPTY: "油品未选择",
  NO_ENTRIES: "缺少油品录入",
  BOOK_NEGATIVE: "账面量为负",
  REASON_REQUIRED: "超阈值未归因",
  BASIS_REQUIRED: "归因依据缺失",
  CORRECTION_REASON_REQUIRED: "更正原因缺失",
  FROZEN: "已复核冻结",
  REVIEWED_GATE: "复核规则不成立",
  CHAIN_PARENT_MISSING: "版本链父版本缺失",
  CHAIN_VERSION_GAP: "版本号不连续",
  CHAIN_ROOT_MISMATCH: "版本链根不一致"
};
</script>

<template>
  <el-alert v-if="conflicts.length" :title="title ?? `检测到 ${conflicts.length} 项冲突，未归因/冻结类操作已被拦截`" type="error"
    :closable="false" show-icon class="conflict-box">
    <el-table :data="conflicts" size="small" border class="conflict-table">
      <el-table-column label="油品" width="90">
        <template #default="{ row }">{{ row.fuel || "—" }}</template>
      </el-table-column>
      <el-table-column label="原值" width="220" show-overflow-tooltip>
        <template #default="{ row }"><code>{{ row.original || "—" }}</code></template>
      </el-table-column>
      <el-table-column label="规则" width="150">
        <template #default="{ row }">
          <el-tag size="small" type="danger">{{ RULE_LABELS[row.rule] ?? row.rule }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="说明" prop="message" min-width="260" />
    </el-table>
  </el-alert>
  <el-alert v-else :title="title ? '无冲突' : '规则校验通过：班次、损溢、归因与版本链一致'" type="success"
    :closable="false" show-icon />
</template>

<style scoped>
.conflict-box { margin: 10px 0; }
.conflict-table { margin-top: 8px; background: #fff; }
code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #b3402a;
  word-break: break-all;
}
</style>
