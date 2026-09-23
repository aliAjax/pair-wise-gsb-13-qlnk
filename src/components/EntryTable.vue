<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { formatPermyriad, round2 } from "../domain/calculations";
import type { Conflict, Shift } from "../domain/types";
import { useShiftStore } from "../store/shiftStore";

const props = defineProps<{ shift: Shift }>();
const store = useShiftStore();

function correct(productCode: string): void {
  const draft = store.draftFromHead(props.shift.id, productCode);
  if (!draft) ElMessage.error("未找到生效版本");
}

async function remove(productCode: string): Promise<void> {
  await ElMessageBox.confirm(
    `确定删除 ${productCode} 在本班次的全部录入？待复核班次方可删除。`,
    "删除确认",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
  );
  const conflicts = store.deleteEntry(props.shift.id, productCode);
  if (conflicts) ElMessage.error(conflicts.map((item: Conflict) => item.message).join("；"));
  else ElMessage.success("已删除");
}

function review(): void {
  const conflicts = store.review(props.shift.id);
  if (conflicts) {
    ElMessage.error(`复核被拦截：${conflicts.map((item) => item.message).join("；")}`);
    return;
  }
  ElMessage.success("复核通过：班次、原始罐温已冻结");
}

function tagType(overLimit: boolean, attributed: boolean): "success" | "warning" | "info" {
  if (!overLimit) return "success";
  return attributed ? "info" : "warning";
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-head">
        <span>当班油品损溢（{{ store.activeEntryViews.length }} 种）</span>
        <div class="head-actions">
          <el-tag :type="shift.locked ? 'info' : 'warning'">
            {{ shift.locked ? "已复核冻结" : "待复核" }}
          </el-tag>
          <el-button
            type="primary"
            :disabled="store.activeEntryViews.length === 0 || store.shiftSummary.pendingCorrections === 0 && shift.locked"
            @click="review"
          >
            {{ shift.locked ? "重新复核（冻结更正版本）" : "复核班次" }}
          </el-button>
        </div>
      </div>
    </template>

    <el-table :data="store.activeEntryViews" stripe style="width: 100%" empty-text="本班次暂无油品录入">
      <el-table-column label="油品" width="130">
        <template #default="{ row }">
          <strong>{{ row.entry.productCode }}</strong>
          <div class="sub">{{ row.product?.name ?? "油品档案缺失" }}</div>
        </template>
      </el-table-column>
      <el-table-column label="罐存(开始/结束)L" width="150">
        <template #default="{ row }">
          {{ row.entry.openingStock }} / {{ row.entry.closingStock }}
          <div class="sub">罐温 {{ row.entry.temperature }}℃ · VCF {{ row.result.vcf.toFixed(4) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="付油/回罐 L" width="130">
        <template #default="{ row }">{{ row.entry.delivered }} / {{ row.entry.returned }}</template>
      </el-table-column>
      <el-table-column label="账面量 L" width="110" align="right">
        <template #default="{ row }">{{ round2(row.result.bookQuantity) }}</template>
      </el-table-column>
      <el-table-column label="实存量 L" width="110" align="right">
        <template #default="{ row }">{{ round2(row.result.actualQuantity) }}</template>
      </el-table-column>
      <el-table-column label="损溢量 L" width="105" align="right">
        <template #default="{ row }">
          <span :class="row.result.variance > 0 ? 'gain' : row.result.variance < 0 ? 'loss' : ''">
            {{ row.result.variance > 0 ? "+" : "" }}{{ round2(row.result.variance) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="损溢率" width="90">
        <template #default="{ row }">
          <span :class="{ over: row.result.overLimit }">
            {{ formatPermyriad(row.result.varianceRate) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="归因" min-width="180">
        <template #default="{ row }">
          <el-tag size="small" :type="tagType(row.result.overLimit, row.entry.attributionKind !== null)">
            <template v-if="!row.result.overLimit">未超阈值</template>
            <template v-else>{{ row.entry.attributionKind ?? "未归因（阻断复核）" }}</template>
          </el-tag>
          <div v-if="row.entry.attributionBasis" class="sub basis">{{ row.entry.attributionBasis }}</div>
        </template>
      </el-table-column>
      <el-table-column label="版本/状态" width="110">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="store.openChain(shift.id, row.entry.productCode)">
            v{{ row.entry.version }}
            <template v-if="row.chainLength > 1"> / {{ row.chainLength }} 版</template>
          </el-button>
          <el-tag v-if="row.entry.frozen" size="small" type="info">冻结</el-tag>
          <el-tag v-else-if="row.pendingCorrection" size="small" type="warning">待复核</el-tag>
          <el-tag v-else size="small" type="success">草稿</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            size="small"
            :disabled="!shift.locked || row.pendingCorrection"
            @click="correct(row.entry.productCode)"
          >
            更正
          </el-button>
          <el-button link type="danger" size="small" :disabled="shift.locked" @click="remove(row.entry.productCode)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="store.shiftSummary.pendingCorrections > 0" class="pending-tip">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        :title="`有 ${store.shiftSummary.pendingCorrections} 条更正版本待重新复核；复核后将冻结新版本`"
      />
    </div>
  </el-card>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sub {
  font-size: 12px;
  color: #93a0b5;
  line-height: 1.4;
}
.basis {
  margin-top: 2px;
  color: #69758c;
  max-width: 320px;
}
.gain { color: #14724f; font-weight: 600; }
.loss { color: #c84b31; font-weight: 600; }
.over { color: #e6a23c; font-weight: 700; }
.pending-tip { margin-top: 12px; }
</style>
