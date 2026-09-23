<script setup lang="ts">
import { computed } from "vue";
import ShiftBar from "./components/ShiftBar.vue";
import EntryForm from "./components/EntryForm.vue";
import EntryTable from "./components/EntryTable.vue";
import VersionChain from "./components/VersionChain.vue";
import ConflictPanel from "./components/ConflictPanel.vue";
import { round2 } from "./domain/calculations";
import { useShiftStore } from "./store/shiftStore";

const store = useShiftStore();
const shift = computed(() => store.selectedShift);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">加油站班次交接 · 油品损溢核销台</p>
          <h1>油品损溢核销台</h1>
          <p class="subtitle">
            按油品录入开始/结束罐存、罐温、付油量与回罐量；温度修正后账面量与实存量相差超过千分之三必须归因并写依据，
            未归因不得复核。复核后冻结班次与原始罐温，更正另建带原因版本。
          </p>
        </div>
        <ShiftBar />
      </header>

      <section v-if="shift" class="metrics">
        <article class="metric">
          <span>当班油品</span>
          <strong>{{ store.shiftSummary.count }} 种</strong>
        </article>
        <article class="metric">
          <span>损溢量合计</span>
          <strong
            :class="{
              gain: store.shiftSummary.totalVariance > 0,
              loss: store.shiftSummary.totalVariance < 0
            }"
          >
            {{ store.shiftSummary.totalVariance > 0 ? "+" : ""
            }}{{ round2(store.shiftSummary.totalVariance) }} L
          </strong>
        </article>
        <article class="metric">
          <span>超千分之三待处理</span>
          <strong :class="{ alarm: store.shiftSummary.overLimit > 0 }">
            {{ store.shiftSummary.overLimit }}
          </strong>
        </article>
        <article class="metric">
          <span>待复核更正版本</span>
          <strong :class="{ alarm: store.shiftSummary.pendingCorrections > 0 }">
            {{ store.shiftSummary.pendingCorrections }}
          </strong>
        </article>
      </section>

      <template v-if="shift">
        <section class="workspace">
          <EntryForm :shift="shift" />
          <div class="main-col">
            <ConflictPanel />
            <EntryTable :shift="shift" class="table-block" />
          </div>
        </section>
        <VersionChain />
      </template>

      <el-empty v-else description="暂无班次，请点击“新建班次”" />
    </div>
  </main>
</template>

<style scoped>
.main-col {
  display: grid;
  gap: 14px;
  align-content: start;
}
.table-block {
  min-width: 0;
}
.metric strong.gain { color: #14724f; }
.metric strong.loss { color: #c84b31; }
.metric strong.alarm { color: #e6a23c; }
</style>
