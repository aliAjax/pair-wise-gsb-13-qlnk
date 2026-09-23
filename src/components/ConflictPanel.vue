<script setup lang="ts">
import { computed } from "vue";
import type { ConflictCode } from "../domain/types";
import { useShiftStore } from "../store/shiftStore";

const store = useShiftStore();

const codeLabel: Record<ConflictCode, string> = {
  DUPLICATE_PRODUCT: "同油品同班重复",
  UNATTRIBUTED_VARIANCE: "超阈值未归因",
  FROZEN_ENTRY: "冻结数据冲突",
  SHIFT_LOCKED: "班次已冻结",
  INVALID_INPUT: "录入不合法",
  INTEGRITY: "版本链/数据完整性"
};

const shift = computed(() => store.selectedShift);
const rows = computed(() =>
  store.shiftConflicts.map((conflict) => {
    const shiftItem = store.data.shifts.find((item) => item.id === conflict.shiftId);
    return {
      ...conflict,
      shiftLabel: shiftItem ? `${shiftItem.date} ${shiftItem.period}` : conflict.shiftId
    };
  })
);
</script>

<template>
  <el-alert
    v-if="rows.length === 0 && shift"
    type="success"
    :closable="false"
    show-icon
    :title="shift.locked ? '班次已复核冻结；无规则冲突' : '数据一致，无阻断复核的规则冲突'"
  />
  <el-card v-else shadow="never" class="conflict-card">
    <template #header>
      <span>规则冲突（{{ rows.length }}）— 复核已被阻断</span>
    </template>
    <el-table :data="rows" size="small" style="width: 100%">
      <el-table-column label="类型" width="130">
        <template #default="{ row }">
          <el-tag type="danger" size="small">{{ codeLabel[row.code as ConflictCode] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="班次" width="150">
        <template #default="{ row }">{{ row.shiftLabel }}</template>
      </el-table-column>
      <el-table-column label="油品" width="80">
        <template #default="{ row }">{{ row.productCode ?? "—" }}</template>
      </el-table-column>
      <el-table-column label="原值 / 现状" min-width="200">
        <template #default="{ row }">
          <code class="old-value">{{ row.oldValue ?? "—" }}</code>
        </template>
      </el-table-column>
      <el-table-column label="说明" min-width="220">
        <template #default="{ row }">{{ row.message }}</template>
      </el-table-column>
      <el-table-column label="违反规则" min-width="260">
        <template #default="{ row }">
          <span class="rule">{{ row.rule }}</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.conflict-card {
  border-color: #f5c6c0;
}
.old-value {
  font-size: 12px;
  background: #f7f8fa;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: pre-wrap;
}
.rule {
  font-size: 12px;
  color: #69758c;
}
</style>
