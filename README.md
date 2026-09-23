# 加油站班次交接 · 油品损溢核销台

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Pinia、Element Plus
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

## 业务规则

- 按油品录入开始罐存、结束罐存、温度、付油量、回罐量；同油品同班不得重复。
- 温度修正：实存量 = 结束罐存 × [1 + 0.0008 × (20 − 温度)]；账面量 = 开始罐存 − 付油量 + 回罐量。
- 温度修正后的账面量与实存量相差超过千分之三时，必须选择计量、漏损或操作原因并写依据，未归因不得复核。
- 复核后冻结班次和原始罐温；更正不改原版本，而是另建带更正原因的新版本，按版本号连续挂在同一版本链上。
- "刷新一致性体检"重新加载存储并校验班次、损溢、归因与版本链，冲突列出油品、原值和规则。

## 分层结构

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 数据模型 | `src/domain/types.ts` | 纯类型定义 |
| 计算 | `src/domain/calculations.ts` | 温度修正、账面量、损溢率（纯函数） |
| 规则校验 | `src/domain/validation.ts` / `consistency.ts` | 录入/复核闸门、版本链体检 |
| 存储 | `src/data/storage.ts` | localStorage 读写（带 schema 版本与种子数据） |
| 状态 | `src/stores/shifts.ts` | Pinia 编排领域规则与存储 |
| 页面/组件 | `src/App.vue`、`src/components/*` | 仅展示与交互，通过 store 读写 |

数据默认保存在浏览器 localStorage，方便后续替换为接口、权限或图表能力。
