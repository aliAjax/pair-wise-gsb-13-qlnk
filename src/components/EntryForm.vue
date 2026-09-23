<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { computeVariance, formatPermyriad, round2 } from "../domain/calculations";
import { ATTRIBUTION_KINDS, type AttributionKind, type Conflict, type Shift } from "../domain/types";
import { useShiftStore } from "../store/shiftStore";

const props = defineProps<{ shift: Shift }>();

const store = useShiftStore();
const isCorrection = computed(
  () => props.shift.locked && store.correctingProduct !== null
);

interface FormState {
  productCode: string;
  openingStock: number | undefined;
  closingStock: number | undefined;
  temperature: number | undefined;
  delivered: number | undefined;
  returned: number | undefined;
  attributionKind: AttributionKind | null;
  attributionBasis: string;
  correctionReason: string;
}

function blank(): FormState {
  const draft = store.blankDraft();
  return {
    productCode: draft.productCode,
    openingStock: undefined,
    closingStock: undefined,
    temperature: draft.temperature,
    delivered: undefined,
    returned: undefined,
    attributionKind: null,
    attributionBasis: "",
    correctionReason: ""
  };
}

const form = reactive<FormState>(blank());
const errors = ref<Conflict[]>([]);

// 切换班次或结束更正 -> 重置表单
watch(
  () => [props.shift.id, store.correctingProduct] as const,
  () => {
    const productCode = store.correctingProduct;
    if (productCode && props.shift.locked) {
      const draft = store.draftFromHead(props.shift.id, productCode);
      if (draft) Object.assign(form, draft);
    } else {
      Object.assign(form, blank());
    }
    errors.value = [];
  },
  { immediate: true }
);

const product = computed(() =>
  store.products.find((item) => item.code === form.productCode)
);

const availableProducts = computed(() => {
  if (isCorrection.value) return store.products;
  return store.products.filter(
    (item) => !store.isProductUsedInShift(props.shift.id, item.code)
  );
});

const ready = computed(
  () =>
    form.openingStock !== undefined &&
    form.closingStock !== undefined &&
    form.temperature !== undefined &&
    form.delivered !== undefined &&
    form.returned !== undefined &&
    form.productCode !== ""
);

const result = computed(() => {
  if (!ready.value || !product.value) return null;
  return computeVariance(
    {
      productCode: form.productCode,
      openingStock: Number(form.openingStock),
      closingStock: Number(form.closingStock),
      temperature: Number(form.temperature),
      delivered: Number(form.delivered),
      returned: Number(form.returned)
    },
    product.value
  );
});

const attributionRequired = computed(() => result.value?.overLimit === true);
const formInvalid = computed(() => {
  if (!ready.value) return true;
  if (isCorrection.value && form.correctionReason.trim() === "") return true;
  if (attributionRequired.value) {
    return form.attributionKind === null || form.attributionBasis.trim() === "";
  }
  return false;
});

function save(): void {
  errors.value = [];
  const conflicts = store.saveEntry(props.shift.id, {
    productCode: form.productCode,
    openingStock: Number(form.openingStock),
    closingStock: Number(form.closingStock),
    temperature: Number(form.temperature),
    delivered: Number(form.delivered),
    returned: Number(form.returned),
    attributionKind: attributionRequired.value ? form.attributionKind : null,
    attributionBasis: form.attributionBasis,
    correctionReason: form.correctionReason
  });
  if (conflicts) {
    errors.value = conflicts;
    ElMessage.error("保存被规则拦截，请按下方冲突提示修正");
    return;
  }
  Object.assign(form, blank());
  ElMessage.success(isCorrection.value ? "更正版本已保存，待重新复核" : "录入已保存");
}

function cancelCorrection(): void {
  store.correctingProduct = null;
}
</script>

<template>
  <el-card shadow="never" class="entry-form">
    <template #header>
      <div class="card-head">
        <span>{{ isCorrection ? `更正录入：${store.correctingProduct}（新增版本）` : "油品录入" }}</span>
        <el-tag v-if="isCorrection" type="warning" size="small">原值冻结 · 新版本待复核</el-tag>
      </div>
    </template>

    <el-form label-position="top" :disabled="false">
      <el-form-item label="油品">
        <el-select v-model="form.productCode" style="width: 100%" :disabled="isCorrection">
          <el-option
            v-for="item in availableProducts"
            :key="item.code"
            :label="`${item.code} ${item.name}`"
            :value="item.code"
          />
        </el-select>
      </el-form-item>

      <div class="num-grid">
        <el-form-item label="开始罐存 L">
          <el-input-number v-model="form.openingStock" :min="0" :precision="1" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束罐存 L">
          <el-input-number v-model="form.closingStock" :min="0" :precision="1" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="罐温 ℃">
          <el-input-number v-model="form.temperature" :min="-40" :max="60" :precision="1" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="付油量 L">
          <el-input-number v-model="form.delivered" :min="0" :precision="1" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="回罐量 L">
          <el-input-number v-model="form.returned" :min="0" :precision="1" :controls="false" style="width: 100%" />
        </el-form-item>
      </div>

      <div v-if="result" class="live-result" :class="{ alarm: result.overLimit }">
        <div class="result-row">
          <span>VCF 温度修正系数</span><strong>{{ result.vcf.toFixed(4) }}</strong>
        </div>
        <div class="result-row">
          <span>修正后开始 / 结束罐存</span>
          <strong>{{ round2(result.openingStandard) }} / {{ round2(result.closingStandard) }} L</strong>
        </div>
        <div class="result-row">
          <span>账面量（开始+回罐−付油）</span><strong>{{ round2(result.bookQuantity) }} L</strong>
        </div>
        <div class="result-row">
          <span>实存量（修正后结束罐存）</span><strong>{{ round2(result.actualQuantity) }} L</strong>
        </div>
        <div class="result-row emphasis">
          <span>损溢量 / 损溢率</span>
          <strong>
            {{ result.variance > 0 ? "+" : "" }}{{ round2(result.variance) }} L ·
            <em :class="{ over: result.overLimit }">{{ formatPermyriad(result.varianceRate) }}</em>
          </strong>
        </div>
        <el-alert
          v-if="result.overLimit"
          type="warning"
          :closable="false"
          show-icon
          title="账面量与实存量相差超过千分之三，必须选择原因并填写依据，否则不得复核"
        />
      </div>

      <template v-if="attributionRequired">
        <el-form-item label="损溢原因（必选）">
          <el-radio-group v-model="form.attributionKind">
            <el-radio-button v-for="kind in ATTRIBUTION_KINDS" :key="kind" :label="kind" />
          </el-radio-group>
        </el-form-item>
        <el-form-item label="归因依据（必填）">
          <el-input
            v-model="form.attributionBasis"
            type="textarea"
            :rows="2"
            placeholder="检尺数据、现场检查记录、工作联系单编号等"
          />
        </el-form-item>
      </template>

      <el-form-item v-if="isCorrection" label="更正原因（必填）">
        <el-input
          v-model="form.correctionReason"
          type="textarea"
          :rows="2"
          placeholder="说明原值错误点及更正依据；旧版本与原始罐温将冻结保留"
        />
      </el-form-item>

      <el-alert
        v-for="(conflict, index) in errors"
        :key="index"
        :title="conflict.message"
        type="error"
        :closable="false"
        show-icon
        class="conflict-alert"
      >
        <div class="rule-text">规则：{{ conflict.rule }}</div>
      </el-alert>

      <div class="form-actions">
        <el-button v-if="isCorrection" @click="cancelCorrection">取消更正</el-button>
        <el-button type="primary" :disabled="formInvalid" @click="save">
          {{ isCorrection ? "保存更正（新版本）" : "保存录入" }}
        </el-button>
      </div>
    </el-form>
  </el-card>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}
.num-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 12px;
}
.live-result {
  border: 1px solid #e3eaf3;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: #f8fafc;
}
.live-result.alarm {
  border-color: #e6a23c;
  background: #fdf6ec;
}
.result-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: #5b667a;
  padding: 3px 0;
}
.result-row strong {
  color: #172033;
  font-variant-numeric: tabular-nums;
}
.result-row.emphasis {
  border-top: 1px dashed #d5deea;
  margin-top: 4px;
  padding-top: 7px;
}
.result-row em {
  font-style: normal;
}
.result-row em.over {
  color: #e6a23c;
  font-weight: 700;
}
.conflict-alert {
  margin-bottom: 8px;
}
.rule-text {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 2px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
