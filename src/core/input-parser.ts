/**
 * GitHub URL 解析器
 */

export interface ParsedRepo {
  owner: string;
  repo: string;
}

/**
 * 从 GitHub URL 或 owner/repo 简写解析出仓库信息
 * 支持格式:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/
 * - https://github.com/owner/repo/tree/...
 * - owner/repo
 */
export function parseGitHubInput(input: string): ParsedRepo {
  const trimmed = input.trim();

  // 尝试解析为 owner/repo 简写
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (simpleMatch) {
    return { owner: simpleMatch[1], repo: simpleMatch[2] };
  }

  // 尝试解析为 GitHub URL
  try {
    const urlStr = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    const url = new URL(urlStr);

    if (!url.hostname.includes("github.com")) {
      throw new Error("不支持的域名");
    }

    const parts = url.pathname.split("/").filter((p) => p);
    if (parts.length < 2) {
      throw new Error("URL 格式错误");
    }

    const owner = parts[0];
    let repo = parts[1];

    // 移除 .git 后缀
    if (repo.endsWith(".git")) {
      repo = repo.slice(0, -4);
    }

    if (!owner || !repo) {
      throw new Error("owner 或 repo 为空");
    }

    return { owner, repo };
  } catch (e) {
    throw new Error("无法解析 GitHub 地址");
  }
}
