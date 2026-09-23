<script setup lang="ts">
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { Conflict, ShiftPeriod } from "../domain/types";
import { SHIFT_PERIODS } from "../domain/types";
import { useShiftStore } from "../store/shiftStore";

const store = useShiftStore();

const dialogVisible = ref(false);
const today = new Date().toISOString().slice(0, 10);
const form = reactive({ date: today, period: "早班" as ShiftPeriod, station: "示范加油站" });

function openCreate(): void {
  dialogVisible.value = true;
}

function submit(): void {
  const conflicts = store.createShift({ ...form });
  if (conflicts) {
    report(conflicts);
    return;
  }
  dialogVisible.value = false;
  ElMessage.success("班次已创建");
}

function report(conflicts: Conflict[]): void {
  ElMessage.error(conflicts.map((item) => item.message).join("；"));
}
</script>

<template>
  <div class="shift-bar">
    <el-select
      :model-value="store.selectedShiftId ?? ''"
      placeholder="请选择班次"
      style="width: 260px"
      @update:model-value="store.selectShift"
    >
      <el-option
        v-for="shift in store.shifts"
        :key="shift.id"
        :label="`${shift.date} ${shift.period}${shift.locked ? '（已复核）' : '（待复核）'}`"
        :value="shift.id"
      />
    </el-select>
    <el-button type="primary" @click="openCreate">新建班次</el-button>
    <el-button @click="store.resetDemo()">重置演示数据</el-button>

    <el-dialog v-model="dialogVisible" title="新建班次" width="380px">
      <el-form label-width="82px">
        <el-form-item label="交接日期" required>
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="班次时段" required>
          <el-select v-model="form.period" style="width: 100%">
            <el-option v-for="period in SHIFT_PERIODS" :key="period" :label="period" :value="period" />
          </el-select>
        </el-form-item>
        <el-form-item label="加油站">
          <el-input v-model="form.station" placeholder="站点名称（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.shift-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
</style>
