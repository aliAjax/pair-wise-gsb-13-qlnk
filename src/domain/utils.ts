/** 通用工具 */

/** 深拷贝可能为 Vue 响应式代理的 JSON 数据（structuredClone 无法克隆 Proxy） */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
