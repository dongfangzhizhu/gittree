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

export interface ParsedRepoList {
  /** 去重后的 owner/repo */
  repos: string[];
  /** 解析失败的原始片段 */
  invalid: string[];
}

/**
 * 解析「多个仓库」输入：支持逗号、分号、空白、换行、顿号分隔。
 * 单条解析失败不影响其它条目（记录在 invalid 里由调用方提示）。
 */
export function parseGitHubList(input: string): ParsedRepoList {
  const parts = input
    .split(/[,;，；、\s\n\r\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const repos: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    try {
      const { owner, repo } = parseGitHubInput(part);
      const full = `${owner}/${repo}`;
      if (!seen.has(full.toLowerCase())) {
        seen.add(full.toLowerCase());
        repos.push(full);
      }
    } catch {
      invalid.push(part);
    }
  }

  return { repos, invalid };
}
