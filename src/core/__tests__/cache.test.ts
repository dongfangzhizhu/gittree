/**
 * 缓存模块测试：读写、校验、开关、枚举、年龄格式化
 * 使用内存 Map 假存储，不触碰真实 localStorage。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isCacheEnabled,
  setCacheEnabled,
  loadCached,
  saveCached,
  removeCached,
  listCached,
  formatCacheAge,
  isValidRawHistory,
  CACHE_VERSION,
} from "../cache";
import { RawHistory } from "../types";

/** 内存存储假实现（含 keys()，模拟 localStorage 可枚举） */
function memStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    keys: () => map.keys(),
  };
}

function mkRaw(shaPrefix = "a"): RawHistory {
  return {
    commits: [
      {
        sha: `${shaPrefix}111`,
        parents: [],
        author: { name: "晓", login: "xiao" },
        date: "2025-01-01T00:00:00Z",
        message: "feat: 初始提交",
      },
      {
        sha: `${shaPrefix}222`,
        parents: [`${shaPrefix}111`],
        author: { name: "晓", login: "xiao" },
        date: "2025-01-02T00:00:00Z",
        message: "fix: 修复",
      },
    ],
    tags: [{ name: "v1.0.0", commit: `${shaPrefix}222` }],
    metadata: { truncated: false, estimatedTotal: 2, droppedTags: 0 },
  };
}

describe("cache", () => {
  let storage: ReturnType<typeof memStorage>;
  beforeEach(() => {
    storage = memStorage();
  });

  it("默认关闭；可开启与关闭", () => {
    expect(isCacheEnabled(storage)).toBe(false);
    setCacheEnabled(true, storage);
    expect(isCacheEnabled(storage)).toBe(true);
    setCacheEnabled(false, storage);
    expect(isCacheEnabled(storage)).toBe(false);
  });

  it("写入后可原样读回", () => {
    const raw = mkRaw();
    const result = saveCached("owner/repo", raw, storage);
    expect(result.ok).toBe(true);
    const cached = loadCached("owner/repo", storage);
    expect(cached).not.toBeNull();
    expect(cached!.repo).toBe("owner/repo");
    expect(cached!.version).toBe(CACHE_VERSION);
    expect(cached!.raw.commits).toHaveLength(2);
    expect(cached!.raw.tags[0].name).toBe("v1.0.0");
    expect(cached!.savedAt).toBeGreaterThan(0);
  });

  it("未写入时读取返回 null", () => {
    expect(loadCached("owner/none", storage)).toBeNull();
  });

  it("损坏的 JSON 视为未命中", () => {
    storage.setItem("gittree:repo:owner/bad", "{not json");
    expect(loadCached("owner/bad", storage)).toBeNull();
  });

  it("版本不符的缓存被忽略", () => {
    storage.setItem(
      "gittree:repo:owner/old",
      JSON.stringify({ version: 999, savedAt: 1, repo: "owner/old", raw: mkRaw() })
    );
    expect(loadCached("owner/old", storage)).toBeNull();
  });

  it("repo 字段不匹配的缓存被忽略", () => {
    const raw = mkRaw();
    saveCached("owner/a", raw, storage);
    // 篡改 key 对应的 repo 字段
    const text = storage.getItem("gittree:repo:owner/a")!;
    const payload = JSON.parse(text);
    payload.repo = "owner/other";
    storage.setItem("gittree:repo:owner/a", JSON.stringify(payload));
    expect(loadCached("owner/a", storage)).toBeNull();
  });

  it("结构非法的 raw 被拒绝", () => {
    storage.setItem(
      "gittree:repo:owner/badshape",
      JSON.stringify({
        version: CACHE_VERSION,
        savedAt: 1,
        repo: "owner/badshape",
        raw: { commits: "not-array", tags: [], metadata: {} },
      })
    );
    expect(loadCached("owner/badshape", storage)).toBeNull();
  });

  it("isValidRawHistory 粗校验", () => {
    expect(isValidRawHistory(mkRaw())).toBe(true);
    expect(isValidRawHistory(null)).toBe(false);
    expect(isValidRawHistory({ commits: [], tags: [] })).toBe(false); // 缺 metadata
    expect(isValidRawHistory({ commits: [{}], tags: [], metadata: {} })).toBe(false);
  });

  it("删除单个仓库缓存", () => {
    saveCached("owner/a", mkRaw(), storage);
    saveCached("owner/b", mkRaw(), storage);
    removeCached("owner/a", storage);
    expect(loadCached("owner/a", storage)).toBeNull();
    expect(loadCached("owner/b", storage)).not.toBeNull();
  });

  it("listCached 按保存时间倒序列出全部仓库", () => {
    saveCached("owner/a", mkRaw(), storage);
    // 保证 b 的 savedAt 更大（秒级精度可能相同，直接篡改造差值）
    const text = storage.getItem("gittree:repo:owner/a")!;
    const payload = JSON.parse(text);
    payload.savedAt = 1000;
    storage.setItem("gittree:repo:owner/a", JSON.stringify(payload));
    saveCached("owner/b", mkRaw(), storage);

    const list = listCached(storage);
    expect(list.map((x) => x.repo).sort()).toEqual(["owner/a", "owner/b"]);
    expect(list[0].savedAt).toBeGreaterThanOrEqual(list[1].savedAt);
  });

  it("listCached 忽略非仓库键", () => {
    storage.setItem("gittree:cache-enabled", "1");
    saveCached("owner/a", mkRaw(), storage);
    const list = listCached(storage);
    expect(list).toHaveLength(1);
    expect(list[0].repo).toBe("owner/a");
  });

  it("formatCacheAge 分档输出", () => {
    const now = 1_000_000_000_000;
    expect(formatCacheAge(now, now)).toBe("刚刚");
    expect(formatCacheAge(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(formatCacheAge(now - 3 * 3600_000, now)).toBe("3 小时前");
    expect(formatCacheAge(now - 2 * 86400_000, now)).toBe("2 天前");
  });
});
