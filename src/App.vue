<script setup lang="ts">
/** 油品损溢核销台页面：编排录入、复核冻结、更正版本链与刷新一致性体检 */
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import ConflictList from "./components/ConflictList.vue";
import EntryEditor from "./components/EntryEditor.vue";
import ShiftCard from "./components/ShiftCard.vue";
import { formatSigned } from "./domain/calculations";
import type { Conflict, FuelEntry, ShiftType } from "./domain/types";
import { useShiftStore } from "./stores/shifts";

const store = useShiftStore();

const today = new Date().toISOString().slice(0, 10);
const shiftDate = ref(today);
const shiftType = ref<ShiftType>("早班");
const entries = ref<FuelEntry[]>([store.emptyEntry()]);
const formConflicts = ref<Conflict[]>([]);
const filter = ref<"全部" | "待复核" | "已复核">("全部");
const auditActive = ref<string[]>([]);

const filteredGroups = computed(() => {
  if (filter.value === "全部") return store.groups;
  return store.groups.filter((g) => g.current.status === filter.value);
});

const totalLoss = computed(() =>
  store.fuelLossSummary.reduce((sum, item) => sum + item.gainLoss, 0)
);

function resetEntries() {
  entries.value = [store.emptyEntry()];
}

function submitShift() {
  const result = store.createShift(shiftDate.value, shiftType.value, entries.value);
  formConflicts.value = result.conflicts;
  if (result.ok) {
    ElMessage.success("班次已创建，状态：待复核");
    resetEntries();
  }
}

function refresh() {
  const result = store.refresh();
  auditActive.value = ["audit"];
  ElMessage[result.ok ? "success" : "warning"](
    result.ok ? "刷新体检通过：班次、损溢、归因、版本链一致" : `刷新发现 ${result.conflicts.length} 项一致性冲突`
  );
}

function resetSeed() {
  store.resetToSeed();
  resetEntries();
  ElMessage.info("已恢复演示数据");
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 加油站班次交接</p>
          <h1>油品损溢核销台</h1>
          <p class="subtitle">
            按油品录入开始罐存、结束罐存、温度、付油量与回罐量；按 20℃ 标准温度修正实存量，
            损溢率超过千分之三必须归因（计量 / 漏损 / 操作）并写明依据，未归因不得复核。
            复核即冻结班次与原始罐温，更正只产生带原因的新版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Element Plus</span>
          <span class="tag">Pinia</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>班次（版本链）</span>
          <strong>{{ store.groups.length }}</strong>
        </article>
        <article class="metric">
          <span>待复核 / 已冻结版本</span>
          <strong>{{ store.pendingCount }} / {{ store.frozenCount }}</strong>
        </article>
        <article class="metric">
          <span>各油品累计损溢</span>
          <strong :class="totalLoss < 0 ? 'loss-text' : 'gain-text'">{{ formatSigned(totalLoss) }}</strong>
        </article>
      </section>

      <section class="create-panel">
        <div class="panel-head">
          <h2>新增班次油品录入</h2>
          <div class="shift-fields">
            <el-date-picker v-model="shiftDate" type="date" value-format="YYYY-MM-DD" :clearable="false"
              placeholder="交接日期" style="width: 150px" />
            <el-select v-model="shiftType" style="width: 110px">
              <el-option label="早班" value="早班" />
              <el-option label="中班" value="中班" />
              <el-option label="晚班" value="晚班" />
            </el-select>
            <el-button type="primary" @click="submitShift">保存班次（待复核）</el-button>
          </div>
        </div>
        <EntryEditor v-model="entries" />
        <ConflictList v-if="formConflicts.length" :conflicts="formConflicts" title="班次保存被拦截" />
      </section>

      <section class="list-panel">
        <div class="toolbar">
          <h2>班次核销列表</h2>
          <div class="toolbar-right">
            <el-radio-group v-model="filter" size="small">
              <el-radio-button label="全部" />
              <el-radio-button label="待复核" />
              <el-radio-button label="已复核" />
            </el-radio-group>
            <el-button size="small" @click="refresh">刷新一致性体检</el-button>
            <el-button size="small" plain @click="resetSeed">恢复演示数据</el-button>
          </div>
        </div>

        <el-collapse v-if="auditActive.length" v-model="auditActive" class="audit-collapse">
          <el-collapse-item name="audit">
            <template #title>
              <el-tag size="small" :type="store.auditConflicts.length ? 'danger' : 'success'">
                刷新体检：{{ store.auditConflicts.length ? `${store.auditConflicts.length} 项冲突` : "一致" }}
              </el-tag>
              <span class="audit-title-text">班次、损溢、归因与版本链一致性结果（点击折叠）</span>
            </template>
            <ConflictList :conflicts="store.auditConflicts" title="刷新一致性体检" />
          </el-collapse-item>
        </el-collapse>

        <div v-if="filteredGroups.length === 0" class="empty">暂无匹配班次</div>
        <div class="shift-list">
          <ShiftCard v-for="group in filteredGroups" :key="group.rootId" :group="group" />
        </div>

        <section class="fuel-summary">
          <h3>各油品当前损溢汇总（取每班次最新版本）</h3>
          <el-table :data="store.fuelLossSummary" border size="small">
            <el-table-column prop="fuel" label="油品" width="120" />
            <el-table-column label="累计损溢量">
              <template #default="{ row }">
                <el-tag size="small" :type="row.gainLoss < 0 ? 'danger' : row.gainLoss > 0 ? 'warning' : 'info'">
                  {{ formatSigned(row.gainLoss) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <p class="rule-note">
            计算口径：实存量 = 结束罐存 × [1 + 0.0008 × (20 − 温度)]；账面量 = 开始罐存 − 付油量 + 回罐量；
            损溢率 = (实存量 − 账面量) / |账面量|，|损溢率| &gt; 3‰ 必须归因并写依据，未归因不得复核。
          </p>
        </section>
      </section>
    </div>
  </main>
</template>
