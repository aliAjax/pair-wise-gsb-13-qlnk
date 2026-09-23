<script setup lang="ts">
/** 油品录入表格：开始/结束罐存、温度、付油量、回罐量，实时温度修正损溢与归因 */
import { computed } from "vue";
import { calcEntry, formatPermille, formatSigned } from "../domain/calculations";
import type { FuelEntry, LossReason } from "../domain/types";

const props = defineProps<{ modelValue: FuelEntry[] }>();
const emit = defineEmits<{ "update:modelValue": [FuelEntry[]] }>();

const FUEL_OPTIONS = ["92#", "95#", "98#", "0#"];
const REASON_OPTIONS: LossReason[] = ["计量原因", "漏损原因", "操作原因"];

const rows = computed(() => props.modelValue);

function patch(id: string, field: keyof FuelEntry, value: string | number) {
  const next = rows.value.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry));
  emit("update:modelValue", next);
}

function addRow() {
  emit("update:modelValue", [
    ...rows.value,
    {
      id: crypto.randomUUID(),
      fuel: "",
      startStock: 0,
      endStock: 0,
      temperature: 20,
      delivered: 0,
      returned: 0,
      reason: "",
      basis: ""
    }
  ]);
}

function removeRow(id: string) {
  emit("update:modelValue", rows.value.filter((entry) => entry.id !== id));
}
</script>

<template>
  <div class="entry-editor">
    <el-table :data="rows" border size="small" empty-text="尚未添加油品，点击下方按钮录入">
      <el-table-column label="油品" width="100">
        <template #default="{ row }">
          <el-select :model-value="row.fuel" placeholder="油品" filterable allow-create default-first-option
            @update:model-value="(v: string) => patch(row.id, 'fuel', v)">
            <el-option v-for="f in FUEL_OPTIONS" :key="f" :label="f" :value="f" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="开始罐存 L" width="120">
        <template #default="{ row }">
          <el-input-number :model-value="row.startStock" :min="0" :controls="false" style="width: 100%"
            @update:model-value="(v: number) => patch(row.id, 'startStock', Number(v))" />
        </template>
      </el-table-column>
      <el-table-column label="结束罐存 L" width="120">
        <template #default="{ row }">
          <el-input-number :model-value="row.endStock" :min="0" :controls="false" style="width: 100%"
            @update:model-value="(v: number) => patch(row.id, 'endStock', Number(v))" />
        </template>
      </el-table-column>
      <el-table-column label="温度 ℃" width="105">
        <template #default="{ row }">
          <el-input-number :model-value="row.temperature" :precision="1" :step="0.5" :controls="false" style="width: 100%"
            @update:model-value="(v: number) => patch(row.id, 'temperature', Number(v))" />
        </template>
      </el-table-column>
      <el-table-column label="付油量 L" width="115">
        <template #default="{ row }">
          <el-input-number :model-value="row.delivered" :min="0" :controls="false" style="width: 100%"
            @update:model-value="(v: number) => patch(row.id, 'delivered', Number(v))" />
        </template>
      </el-table-column>
      <el-table-column label="回罐量 L" width="115">
        <template #default="{ row }">
          <el-input-number :model-value="row.returned" :min="0" :controls="false" style="width: 100%"
            @update:model-value="(v: number) => patch(row.id, 'returned', Number(v))" />
        </template>
      </el-table-column>
      <el-table-column label="账面/实存·损溢" min-width="190">
        <template #default="{ row }">
          <template v-if="Number.isFinite(row.temperature)">
            <div class="calc-line">账面 {{ calcEntry(row).bookStock.toFixed(1) }} / 实存 {{ calcEntry(row).actualStock.toFixed(1) }}</div>
            <el-tag size="small" :type="calcEntry(row).overThreshold ? 'danger' : calcEntry(row).gainLoss === 0 ? 'info' : 'warning'">
              {{ formatSigned(calcEntry(row).gainLoss) }}（{{ formatPermille(calcEntry(row).ratio) }}）
            </el-tag>
            <span v-if="calcEntry(row).overThreshold" class="threshold-hint">超 3‰ 必须归因</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="归因原因" width="128">
        <template #default="{ row }">
          <el-select :model-value="row.reason" placeholder="请选择" clearable
            :class="{ 'reason-required': calcEntry(row).overThreshold && !row.reason }"
            @update:model-value="(v: LossReason | '') => patch(row.id, 'reason', v ?? '')">
            <el-option v-for="r in REASON_OPTIONS" :key="r" :label="r" :value="r" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="归因依据" min-width="170">
        <template #default="{ row }">
          <el-input :model-value="row.basis" placeholder="写明依据，如校罐记录/检漏单号"
            :class="{ 'reason-required': calcEntry(row).overThreshold && !row.basis.trim() }"
            @update:model-value="(v: string) => patch(row.id, 'basis', v)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="70" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="removeRow(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-button class="add-entry" plain type="primary" @click="addRow">添加油品行</el-button>
  </div>
</template>

<style scoped>
.entry-editor :deep(.el-input-number) { width: 100%; }
.calc-line { font-size: 12px; color: #5b667a; margin-bottom: 3px; white-space: nowrap; }
.threshold-hint { display: block; color: #c84b31; font-size: 12px; margin-top: 2px; }
.reason-required :deep(.el-input__wrapper),
.reason-required:deep(.el-input__wrapper) { box-shadow: 0 0 0 1px #c84b31 inset; }
.add-entry { margin-top: 10px; width: 100%; }
</style>
