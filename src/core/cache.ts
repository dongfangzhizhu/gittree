/**
 * 仓库数据本地缓存（localStorage）
 * 勾选「缓存此项目数据」后，首次拉取写入缓存，再次加载同一仓库直接命中，
 * 不再请求 GitHub API。存储可注入，便于单元测试使用内存假实现。
 */

import { RawHistory } from "./types";

/** 缓存结构版本：字段不兼容变更时递增，旧版本缓存自动忽略 */
export const CACHE_VERSION = 1;

const REPO_PREFIX = "gittree:repo:";
const ENABLED_KEY = "gittree:cache-enabled";

/** 缓存条目 */
export interface CachedPayload {
  version: number;
  savedAt: number;
  repo: string;
  raw: RawHistory;
}

/** 存储适配器接口（localStorage 的子集） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 默认存储：浏览器 localStorage；非浏览器环境退化为内存 Map */
function defaultStorage(): StorageLike {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const probe = "gittree:probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // 隐私模式等场景下 localStorage 不可用，落到内存存储
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

function cacheKey(repo: string): string {
  return `${REPO_PREFIX}${repo}`;
}

/** 读取缓存开关（默认关闭：未经用户勾选不主动写 localStorage） */
export function isCacheEnabled(storage: StorageLike = defaultStorage()): boolean {
  return storage.getItem(ENABLED_KEY) === "1";
}

/** 设置缓存开关 */
export function setCacheEnabled(enabled: boolean, storage: StorageLike = defaultStorage()): void {
  storage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

/** 校验并读取缓存；结构不符或版本过期返回 null */
export function loadCached(
  repo: string,
  storage: StorageLike = defaultStorage()
): CachedPayload | null {
  const text = storage.getItem(cacheKey(repo));
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as CachedPayload;
    if (parsed?.version !== CACHE_VERSION) return null;
    if (parsed.repo !== repo) return null;
    if (!isValidRawHistory(parsed.raw)) return null;
    return parsed;
  } catch {
    return null; // 损坏的 JSON 视为未命中
  }
}

/** 写入缓存；配额溢出等失败时返回错误信息而不抛出 */
export function saveCached(
  repo: string,
  raw: RawHistory,
  storage: StorageLike = defaultStorage()
): { ok: true } | { ok: false; error: string } {
  const payload: CachedPayload = {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    repo,
    raw,
  };
  try {
    storage.setItem(cacheKey(repo), JSON.stringify(payload));
    return { ok: true };
  } catch (error: any) {
    const name = error?.name || "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      return { ok: false, error: "本地存储空间不足，未能写入缓存" };
    }
    return { ok: false, error: error?.message || "写入缓存失败" };
  }
}

/** 删除单个仓库缓存 */
export function removeCached(repo: string, storage: StorageLike = defaultStorage()): void {
  storage.removeItem(cacheKey(repo));
}

/** 列出所有仓库缓存（按保存时间倒序） */
export function listCached(
  storage: StorageLike = defaultStorage()
): Array<{ repo: string; savedAt: number }> {
  const out: Array<{ repo: string; savedAt: number }> = [];
  const keys: string[] = [];
  // localStorage 可枚举；内存 Map 适配器也支持 keys()
  const anyStorage = storage as StorageLike & {
    keys?: () => Iterable<string>;
    length?: number;
    key?: (i: number) => string | null;
  };
  try {
    if (typeof anyStorage.keys === "function") {
      keys.push(...Array.from(anyStorage.keys()));
    } else if (typeof anyStorage.key === "function" && typeof anyStorage.length === "number") {
      for (let i = 0; i < anyStorage.length; i++) {
        const k = anyStorage.key(i);
        if (k) keys.push(k);
      }
    }
  } catch {
    return out;
  }
  for (const key of keys) {
    if (!key.startsWith(REPO_PREFIX)) continue;
    try {
      const parsed = JSON.parse(storage.getItem(key) || "") as CachedPayload;
      if (parsed?.repo) out.push({ repo: parsed.repo, savedAt: parsed.savedAt || 0 });
    } catch {
      // 忽略损坏条目
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** 「x 分钟前」格式的缓存年龄 */
export function formatCacheAge(savedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - savedAt);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(savedAt).toLocaleDateString("zh-CN");
}

/** RawHistory 结构校验（粗校验：够用来防损坏数据） */
export function isValidRawHistory(raw: any): raw is RawHistory {
  if (!raw || typeof raw !== "object") return false;
  if (!Array.isArray(raw.commits)) return false;
  if (!Array.isArray(raw.tags)) return false;
  if (!raw.metadata || typeof raw.metadata !== "object") return false;
  for (const c of raw.commits) {
    if (!c || typeof c.sha !== "string" || !Array.isArray(c.parents)) return false;
    if (typeof c.date !== "string" || typeof c.message !== "string") return false;
  }
  for (const t of raw.tags) {
    if (!t || typeof t.name !== "string") return false;
  }
  return true;
}
