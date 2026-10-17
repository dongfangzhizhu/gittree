/**
 * GitHub 数据源测试：分页解析（FR-IN-03/04/05/06）
 * 用 mock fetch 验证请求序列，不消耗真实 API 限额。
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubSource } from "../core/github-source";
import { AppError } from "../core/errors";

/** 构造带 Link 头的响应 */
function jsonResponse(data: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(headers),
    json: async () => data,
  };
}

function errorResponse(status: number, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    statusText: "Error",
    headers: new Headers(headers),
    json: async () => ({}),
  };
}

const commit = (sha: string) => ({
  sha,
  parents: [],
  commit: { author: { name: "a", date: "2025-01-01T00:00:00Z" }, message: "feat: x" },
  author: { login: "a" },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubSource 分页（回归：per_page 误匹配）", () => {
  it("Link 头 rel=last 的页码正确解析（不被 per_page=100 干扰）", async () => {
    const requested: string[] = [];
    const fakeFetch = vi.fn(async (url: string) => {
      requested.push(url);
      if (url.includes("/repos/o/r?")) return jsonResponse({ full_name: "o/r" });
      if (url.includes("/commits?per_page=100&page=1")) {
        return jsonResponse([commit("a"), commit("b")], {
          // 关键：per_page=100 在查询串中位于 page=396 之前
          link: '<https://api.github.com/repositories/1/commits?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=100&page=396>; rel="last"',
        });
      }
      if (url.includes("/commits?per_page=100&page=")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return jsonResponse([commit(`c${page}`)]);
      }
      return jsonResponse([]); // tags
    });
    vi.stubGlobal("fetch", fakeFetch);

    const source = new GitHubSource();
    const raw = await source.load("o/r", {}, new AbortController().signal);

    // 请求的提交页必须是 396 页的等距采样，且包含第 1 页和最后一页
    const commitPages = requested
      .filter((u) => u.includes("/commits?per_page=100&page="))
      .map((u) => Number(new URL(u).searchParams.get("page")));
    expect(commitPages).toEqual([1, 45, 89, 133, 177, 220, 264, 308, 352, 396]);
    expect(commitPages[0]).toBe(1);
    expect(commitPages[commitPages.length - 1]).toBe(396);

    // 元数据：截断标记与估计总数
    expect(raw.metadata.truncated).toBe(true);
    expect(raw.metadata.estimatedTotal).toBe(396 * 100);
  });

  it("单页仓库（无 Link 头）只取第 1 页", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes("/repos/o/r?")) return jsonResponse({ full_name: "o/r" });
        if (url.includes("/commits?")) return jsonResponse([commit("a")]); // 无 link 头
        return jsonResponse([]);
      })
    );

    const source = new GitHubSource();
    const raw = await source.load("o/r", {}, new AbortController().signal);

    const commitPages = requested.filter((u) => u.includes("/commits?per_page=100&page="));
    expect(commitPages).toHaveLength(1);
    expect(raw.metadata.truncated).toBe(false);
    expect(raw.commits).toHaveLength(1);
  });

  it("仓库不存在抛 NOT_FOUND", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404))
    );
    const source = new GitHubSource();
    await expect(
      source.load("o/r", {}, new AbortController().signal)
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("限流抛 RATE_LIMITED 并带等待秒数", async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        errorResponse(403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(reset),
        })
      )
    );
    const source = new GitHubSource();
    const err: AppError = await source
      .load("o/r", {}, new AbortController().signal)
      .then(
        () => {
          throw new Error("should have thrown");
        },
        (e: AppError) => e
      );
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(120);
  });

  it("非限流的 403 抛 FORBIDDEN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(403, { "x-ratelimit-remaining": "59" }))
    );
    const source = new GitHubSource();
    await expect(
      source.load("o/r", {}, new AbortController().signal)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("携带 token 时请求头含 Authorization", async () => {
    let authHeader: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        authHeader = init.headers.Authorization ?? null;
        if (_url.includes("/repos/o/r?")) return jsonResponse({});
        return jsonResponse([]);
      })
    );
    const source = new GitHubSource();
    await source.load("o/r", { token: "ghp_test" }, new AbortController().signal);
    expect(authHeader).toBe("Bearer ghp_test");
  });
});
