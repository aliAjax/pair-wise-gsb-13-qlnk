<script setup lang="ts">
/** 班次卡片：冻结信息展示、复核、更正另建版本、版本链查看 */
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { calcEntry, calcShift, formatPermille, formatSigned } from "../domain/calculations";
import type { Conflict, FuelEntry, ShiftGroup } from "../domain/types";
import { useShiftStore } from "../stores/shifts";
import { deepClone } from "../domain/utils";
import ConflictList from "./ConflictList.vue";
import EntryEditor from "./EntryEditor.vue";

const props = defineProps<{ group: ShiftGroup }>();
const store = useShiftStore();

const showCorrection = ref(false);
const showChain = ref(false);
const showEdit = ref(false);
const correctionReason = ref("");
const correctionEntries = ref<FuelEntry[]>([]);
const correctionConflicts = ref<Conflict[]>([]);
const draftEntries = ref<FuelEntry[]>([]);
const draftConflicts = ref<Conflict[]>([]);
const gateConflicts = ref<Conflict[]>([]);

const current = computed(() => props.group.current);
const isFrozen = computed(() => current.value.status === "已复核");
const summary = computed(() => calcShift(current.value.entries));

function openEdit() {
  draftEntries.value = deepClone(current.value.entries);
  draftConflicts.value = [];
  showEdit.value = true;
}

function saveDraft() {
  const result = store.updateDraft(current.value.id, draftEntries.value);
  draftConflicts.value = result.conflicts;
  if (result.ok) {
    ElMessage.success("草稿已更新");
    showEdit.value = false;
  }
}

function openCorrection() {
  correctionEntries.value = deepClone(current.value.entries).map((e) => ({
    ...e,
    id: crypto.randomUUID()
  }));
  correctionReason.value = "";
  correctionConflicts.value = [];
  showCorrection.value = true;
}

function submitCorrection() {
  const result = store.correct(current.value.id, correctionEntries.value, correctionReason.value);
  correctionConflicts.value = result.conflicts;
  if (result.ok) {
    ElMessage.success("已基于冻结版本创建更正版本（原版本保留冻结）");
    showCorrection.value = false;
  }
}

function review() {
  const result = store.review(current.value.id);
  gateConflicts.value = result.conflicts;
  if (result.ok) ElMessage.success("复核通过：班次与原始罐温已冻结");
}

function removeDraft() {
  const result = store.removeDraft(current.value.id);
  if (!result.ok) gateConflicts.value = result.conflicts;
  else ElMessage.info("待复核草稿已删除");
}
</script>

<template>
  <el-card class="shift-card" shadow="never">
    <template #header>
      <div class="card-head">
        <div>
          <span class="shift-name">{{ current.shiftDate }} {{ current.shiftType }}</span>
          <el-tag size="small" class="ver-tag">v{{ current.version }}</el-tag>
          <el-tag size="small" :type="isFrozen ? 'success' : 'warning'">
            {{ current.status }}{{ isFrozen ? " · 已冻结" : "" }}
          </el-tag>
        </div>
        <div class="card-actions">
          <el-button size="small" @click="showChain = true">
            版本链 ({{ group.chain.length }})
          </el-button>
          <el-button v-if="isFrozen" size="small" type="primary" @click="openCorrection">更正（另建版本）</el-button>
          <template v-else>
            <el-button size="small" @click="openEdit">编辑草稿</el-button>
            <el-button size="small" type="success" @click="review">复核冻结</el-button>
          </template>
          <el-button v-if="!isFrozen" size="small" type="danger" plain @click="removeDraft">删除草稿</el-button>
        </div>
      </div>
    </template>

    <el-table :data="current.entries" border size="small">
      <el-table-column prop="fuel" label="油品" width="80" />
      <el-table-column label="开始罐存" width="100">
        <template #default="{ row }">{{ row.startStock.toFixed(1) }}</template>
      </el-table-column>
      <el-table-column label="结束罐存" width="100">
        <template #default="{ row }">{{ row.endStock.toFixed(1) }}</template>
      </el-table-column>
      <el-table-column label="原始罐温" width="100">
        <template #default="{ row }">
          <span :class="{ frozen_temp: isFrozen }">🔒 {{ row.temperature.toFixed(1) }}℃</span>
        </template>
      </el-table-column>
      <el-table-column label="付油量" width="90">
        <template #default="{ row }">{{ row.delivered.toFixed(1) }}</template>
      </el-table-column>
      <el-table-column label="回罐量" width="90">
        <template #default="{ row }">{{ row.returned.toFixed(1) }}</template>
      </el-table-column>
      <el-table-column label="账面量" width="100">
        <template #default="{ row }">{{ calcEntry(row).bookStock.toFixed(1) }}</template>
      </el-table-column>
      <el-table-column label="20℃实存量" width="110">
        <template #default="{ row }">{{ calcEntry(row).actualStock.toFixed(1) }}</template>
      </el-table-column>
      <el-table-column label="损溢(率)" width="135">
        <template #default="{ row }">
          <el-tag size="small" :type="calcEntry(row).overThreshold ? 'danger' : calcEntry(row).gainLoss === 0 ? 'info' : 'warning'">
            {{ formatSigned(calcEntry(row).gainLoss) }} {{ formatPermille(calcEntry(row).ratio) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="归因" min-width="150">
        <template #default="{ row }">
          <template v-if="row.reason">
            <el-tag size="small" type="primary">{{ row.reason }}</el-tag>
            <div class="basis">{{ row.basis }}</div>
          </template>
          <el-tag v-else size="small" :type="calcEntry(row).overThreshold ? 'danger' : 'info'">
            {{ calcEntry(row).overThreshold ? "待归因（阻断复核）" : "无需归因" }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div class="shift-summary">
      整班账面 {{ summary.bookStock.toFixed(1) }} L ｜ 累计损溢
      <b :class="summary.gainLoss < 0 ? 'loss' : 'gain'">{{ formatSigned(summary.gainLoss) }}</b>
      （{{ formatPermille(summary.ratio) }}）
      <template v-if="isFrozen">
        ｜ 复核人：{{ current.reviewer }} ｜ 冻结时间：{{ new Date(current.reviewedAt!).toLocaleString("zh-CN") }}
      </template>
      <template v-else-if="current.version > 1">
        ｜ 更正原因：{{ current.correctionReason }}
      </template>
    </div>

    <ConflictList v-if="gateConflicts.length" :conflicts="gateConflicts" title="复核被拦截" />

    <!-- 编辑草稿对话框 -->
    <el-dialog v-model="showEdit" title="编辑待复核草稿" width="96%" top="3vh">
      <EntryEditor v-model="draftEntries" />
      <ConflictList v-if="draftConflicts.length" :conflicts="draftConflicts" title="保存未通过" />
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="saveDraft">保存草稿</el-button>
      </template>
    </el-dialog>

    <!-- 更正对话框 -->
    <el-dialog v-model="showCorrection" title="更正班次（原冻结版本保留，新建带原因版本）" width="96%" top="3vh">
      <el-alert type="info" :closable="false" show-icon class="freeze-note">
        原版本 {{ current.shiftDate }} {{ current.shiftType }} v{{ current.version }} 已冻结，以下修改将生成
        v{{ current.version + 1 }}，复核规则（同油品不重复、超 3‰ 必须归因）重新生效。
      </el-alert>
      <el-form label-width="92px" class="correction-form">
        <el-form-item label="更正原因" required>
          <el-input v-model="correctionReason" placeholder="如：开始罐存单记错登 100L / 罐温探头偏差 1.2℃" />
        </el-form-item>
      </el-form>
      <EntryEditor v-model="correctionEntries" />
      <ConflictList v-if="correctionConflicts.length" :conflicts="correctionConflicts" title="更正版本校验未通过" />
      <template #footer>
        <el-button @click="showCorrection = false">取消</el-button>
        <el-button type="primary" @click="submitCorrection">创建更正版本</el-button>
      </template>
    </el-dialog>

    <!-- 版本链对话框 -->
    <el-dialog v-model="showChain" title="版本链" width="720px">
      <el-timeline>
        <el-timeline-item v-for="v in [...group.chain].reverse()" :key="v.id"
          :type="v.status === '已复核' ? 'success' : 'warning'"
          :timestamp="`v${v.version} · ${v.status} · ${new Date(v.createdAt).toLocaleString('zh-CN')}`">
          <p class="chain-title">
            {{ v.shiftDate }} {{ v.shiftType }}
            <span v-if="v.reviewedAt">｜ 复核人 {{ v.reviewer }} ｜ {{ new Date(v.reviewedAt).toLocaleString('zh-CN') }}</span>
          </p>
          <p v-if="v.correctionReason" class="chain-reason">更正原因：{{ v.correctionReason }}</p>
          <p v-else-if="v.parentId" class="chain-reason" style="color:#c84b31">更正版本缺少原因</p>
          <ul class="chain-entries">
            <li v-for="e in v.entries" :key="e.id">
              {{ e.fuel }}：{{ calcEntry(e).bookStock.toFixed(1) }} → {{ calcEntry(e).actualStock.toFixed(1) }} L，
              {{ formatSigned(calcEntry(e).gainLoss) }}（{{ formatPermille(calcEntry(e).ratio) }}）
              <template v-if="e.reason">｜{{ e.reason }}：{{ e.basis }}</template>
            </li>
          </ul>
        </el-timeline-item>
      </el-timeline>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.card-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.shift-name { font-weight: 700; font-size: 16px; margin-right: 8px; }
.ver-tag { margin-right: 6px; }
.card-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.frozen_temp { font-weight: 700; color: #14724f; }
.basis { font-size: 12px; color: #5b667a; margin-top: 2px; line-height: 1.5; }
.shift-summary { margin-top: 10px; font-size: 13px; color: #445069; }
.shift-summary .loss { color: #c84b31; }
.shift-summary .gain { color: #b87a12; }
.freeze-note { margin-bottom: 12px; }
.correction-form { margin-bottom: 4px; }
.chain-title { margin: 0; font-weight: 600; }
.chain-reason { margin: 4px 0; color: #176b87; font-size: 13px; }
.chain-entries { margin: 4px 0 0; padding-left: 18px; font-size: 13px; color: #536078; line-height: 1.8; }
</style>
