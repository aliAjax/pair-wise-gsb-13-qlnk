<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { formatPermyriad, round2 } from "../domain/calculations";
import { useShiftStore } from "../store/shiftStore";

const store = useShiftStore();

const visible = computed({
  get: () => store.chainKey !== null,
  set: (value: boolean) => {
    if (!value) store.closeChain();
  }
});

const productCode = computed(() => store.chainKey?.productCode ?? "");

function copyChain(): void {
  const lines = store.versionChain.map((entry) =>
    [
      `v${entry.version}`,
      `开始${entry.openingStock}L`,
      `结束${entry.closingStock}L`,
      `罐温${entry.temperature}℃`,
      `付油${entry.delivered}L`,
      `回罐${entry.returned}L`,
      entry.attributionKind ? `归因:${entry.attributionKind}` : "",
      entry.correctionReason ? `更正原因:${entry.correctionReason}` : ""
    ].filter(Boolean).join(" ")
  );
  navigator.clipboard?.writeText(`${productCode.value} 版本链\n${lines.join("\n")}`);
  ElMessage.success("版本链已复制");
}
</script>

<template>
  <el-dialog v-model="visible" :title="`版本链：${productCode}`" width="860px" top="6vh">
    <el-timeline>
      <el-timeline-item
        v-for="entry in [...store.versionChain].reverse()"
        :key="entry.id"
        :type="entry.supersededAt === null ? 'primary' : 'info'"
        :hollow="entry.supersededAt === null"
        size="large"
      >
        <el-card shadow="never" :class="['version-card', { active: entry.supersededAt === null }]">
          <div class="version-head">
            <span class="version-title">v{{ entry.version }}</span>
            <el-tag v-if="entry.frozen" size="small" type="info">已冻结（原始罐温 {{ entry.temperature }}℃）</el-tag>
            <el-tag v-else size="small" type="warning">待复核</el-tag>
            <el-tag v-if="entry.supersededAt === null" size="small" type="primary">当前生效</el-tag>
            <span class="time">{{ new Date(entry.createdAt).toLocaleString("zh-CN") }}</span>
          </div>
          <div class="version-grid">
            <span>开始罐存：{{ entry.openingStock }} L</span>
            <span>结束罐存：{{ entry.closingStock }} L</span>
            <span>罐温：{{ entry.temperature }} ℃</span>
            <span>付油量：{{ entry.delivered }} L</span>
            <span>回罐量：{{ entry.returned }} L</span>
            <span v-if="entry.reviewedAt">复核时间：{{ new Date(entry.reviewedAt).toLocaleString("zh-CN") }}</span>
          </div>
          <div v-if="entry.attributionKind" class="version-note">
            {{ entry.attributionKind }}｜依据：{{ entry.attributionBasis }}
          </div>
          <div v-if="entry.correctionReason" class="version-note correction">
            更正原因：{{ entry.correctionReason }}
            <span v-if="entry.correctedFrom" class="sub">（自 v{{ entry.version - 1 }} 更正）</span>
          </div>
        </el-card>
      </el-timeline-item>
    </el-timeline>
    <template #footer>
      <el-button @click="copyChain">复制版本链</el-button>
      <el-button type="primary" @click="store.closeChain()">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.version-card.active {
  border-color: #176b87;
}
.version-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.version-title {
  font-weight: 700;
  font-size: 15px;
}
.time {
  margin-left: auto;
  color: #93a0b5;
  font-size: 12px;
}
.version-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 12px;
  font-size: 13px;
  color: #445069;
}
.version-note {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #eef5fb;
  font-size: 13px;
  color: #445069;
}
.version-note.correction {
  background: #fdf6ec;
}
.sub {
  color: #93a0b5;
}
</style>
