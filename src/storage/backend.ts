/**
 * 存储层：持久化后端接口与实现。
 * 仓储只依赖 StorageBackend 接口：浏览器用 localStorage，
 * 测试/Node 用内存实现；将来换成 HTTP 接口只需新增一个实现。
 */

import type { StoreData } from "../domain/types";

export interface StorageBackend {
  load(): StoreData | null;
  save(data: StoreData): void;
}

const STORAGE_KEY = "fuel-shift-reconciliation:v1";

export class LocalStorageBackend implements StorageBackend {
  constructor(private readonly key: string = STORAGE_KEY) {}

  load(): StoreData | null {
    const raw = localStorage.getItem(this.key);
    if (!raw) return null;
    return JSON.parse(raw) as StoreData;
  }

  save(data: StoreData): void {
    localStorage.setItem(this.key, JSON.stringify(data));
  }
}

export class MemoryBackend implements StorageBackend {
  constructor(private data: StoreData | null = null) {}

  load(): StoreData | null {
    return this.data === null ? null : (JSON.parse(JSON.stringify(this.data)) as StoreData);
  }

  save(data: StoreData): void {
    this.data = JSON.parse(JSON.stringify(data)) as StoreData;
  }
}
