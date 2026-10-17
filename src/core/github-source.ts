/**
 * GitHub API 数据源实现
 * 等距采样 10 页，获取提交和标签
 */

import { HistorySource, RawHistory } from "./types";
import { AppError } from "./errors";

export class GitHubSource implements HistorySource {
  private baseUrl = "https://api.github.com";
  private perPage = 100;
  private maxPages = 10;

  async load(
    input: string,
    options: { token?: string },
    signal: AbortSignal
  ): Promise<RawHistory> {
    const [owner, repo] = input.split("/");

    try {
      // Step 1: 获取仓库信息
      const repoInfo = await this.fetchWithRetry(
        `${this.baseUrl}/repos/${owner}/${repo}`,
        options.token,
        signal
      );

      // Step 2: 获取第一页提交以确定总页数
      const firstPageUrl = `${this.baseUrl}/repos/${owner}/${repo}/commits?per_page=${this.perPage}&page=1`;
      const firstPageResponse = await this.fetchWithRetry(
        firstPageUrl,
        options.token,
        signal
      );

      const linkHeader = firstPageResponse.headers?.get("link") || "";
      const totalPages = this.extractLastPage(linkHeader) || 1;

      // Step 3: 确定要获取的页码（第 1 页已取到，跳过避免重复请求）
      const pagesToFetch =
        totalPages <= this.maxPages
          ? Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2)
          : this.getEquidistantPages(totalPages, this.maxPages).filter((p) => p !== 1);

      // Step 4: 并行获取其余页的提交（含已取到的第 1 页）
      const commitResponses = await Promise.all(
        pagesToFetch.map((page) =>
          this.fetchWithRetry(
            `${this.baseUrl}/repos/${owner}/${repo}/commits?per_page=${this.perPage}&page=${page}`,
            options.token,
            signal
          )
        )
      );

      const allCommits = [
        ...(firstPageResponse.data || []),
        ...commitResponses.flatMap((response) => response.data || []),
      ];

      // Step 5: 获取标签（最多 3 页）
      const tagsResponses = await Promise.all(
        Array.from({ length: Math.min(3, 1 + Math.ceil(totalPages / 100)) }, (_, i) =>
          this.fetchWithRetry(
            `${this.baseUrl}/repos/${owner}/${repo}/tags?per_page=100&page=${i + 1}`,
            options.token,
            signal
          ).catch(() => ({ data: [] }))
        )
      );

      const allTags = tagsResponses.flatMap((response) => response.data || []);

      // Step 6: 转换数据格式
      const commits = allCommits.map((commit: any) => ({
        sha: commit.sha,
        parents: commit.parents?.map((p: any) => p.sha) || [],
        author: {
          name: commit.commit?.author?.name || "Unknown",
          login: commit.author?.login,
        },
        date: commit.commit?.author?.date,
        message: commit.commit?.message?.split("\n")[0] || "",
      }));

      const tags = allTags.map((tag: any) => ({
        name: tag.name,
        commit: tag.commit?.sha,
      }));

      return {
        commits,
        tags,
        metadata: {
          truncated: totalPages > this.maxPages,
          estimatedTotal: totalPages * this.perPage,
          droppedTags: 0,
        },
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      if (error?.status === 404) {
        throw new AppError("NOT_FOUND", "仓库未找到", 404);
      }
      // 403/429 且限额耗尽 → RATE_LIMITED（FR-IN-05）
      // 注意：headers 是 Headers 实例，必须用 get()，下标访问永远取不到值
      if (error?.status === 403 || error?.status === 429) {
        const remaining = error?.headers?.get?.("x-ratelimit-remaining");
        if (remaining === "0") {
          const resetTime = parseInt(error?.headers?.get?.("x-ratelimit-reset") || "0", 10);
          const waitSeconds = Math.max(0, resetTime - Math.floor(Date.now() / 1000));
          throw new AppError(
            "RATE_LIMITED",
            `限流：请等待 ${waitSeconds} 秒`,
            429,
            waitSeconds
          );
        }
        if (error?.status === 403) {
          throw new AppError("FORBIDDEN", "无法访问该仓库", 403);
        }
      }
      throw new AppError("NETWORK", error?.message || "网络请求失败");
    }
  }

  private async fetchWithRetry(
    url: string,
    token: string | undefined,
    signal: AbortSignal,
    retries = 1
  ): Promise<any> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(url, { headers, signal });

        if (!response.ok) {
          const error = new Error(response.statusText);
          (error as any).status = response.status;
          (error as any).headers = response.headers;
          throw error;
        }

        const data = await response.json();
        return { data, headers: response.headers };
      } catch (error: any) {
        // 4xx（除 429 限流）不重试；仅网络错误与 429/5xx 重试一次
        const status = error?.status;
        const retryable =
          error?.name === "AbortError" ? false
          : error instanceof TypeError ? true // fetch 网络错误
          : status === 429 || (status !== undefined && status >= 500);
        if (i === retries || !retryable) throw error;
        // 退避 800ms 后重试
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  private extractLastPage(linkHeader: string): number | null {
    const lastLink = linkHeader.split(",").find((link) => link.includes('rel="last"'));
    if (!lastLink) return null;

    // 必须匹配查询参数中的 page=，不能用 /page=(\d+)/——
    // 那会先命中 per_page=100 里的 "page=100"，把总页数误判为 100
    const match = lastLink.match(/[?&]page=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  private getEquidistantPages(total: number, count: number): number[] {
    const pages: number[] = [];
    for (let i = 0; i < count; i++) {
      pages.push(Math.round(1 + (i * (total - 1)) / (count - 1)));
    }
    return [...new Set(pages)].sort((a, b) => a - b);
  }
}
