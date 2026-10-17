/**
 * 提交规范化 + 去重 + 排序（FR-DT-01/02/03）
 */

import { Commit, CommitType, RawHistory } from "./types";

export function normalizeCommits(raw: RawHistory): Commit[] {
  const commits = new Map<string, Commit>();

  // 规范化提交
  for (const commit of raw.commits) {
    const time = new Date(commit.date).getTime();
    if (Number.isNaN(time)) continue; // 无有效日期的提交无法上树，丢弃

    const isMerge = commit.parents.length > 1;
    const type = isMerge ? "merge" : detectCommitType(commit.message);

    const normalized: Commit = {
      id: commit.sha,
      parents: commit.parents,
      author: commit.author,
      time,
      message: (commit.message || "").substring(0, 200),
      type,
      isMerge,
    };

    // 去重：以 id 为键
    if (!commits.has(commit.sha)) {
      commits.set(commit.sha, normalized);
    }
  }

  // 按时间升序；时间相同按 id 字典序（保证确定性，FR-DT-03）
  return Array.from(commits.values()).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/**
 * 检测提交类型（FR-DT-02）
 * feat|fix|docs|refactor|test|perf|chore（不区分大小写，允许 scope）；
 * Merge/Revert 开头；本项目约定前缀 spec:、hook:
 */
export function detectCommitType(message: string): CommitType {
  if (!message) return "other";

  const msg = message.toLowerCase();

  // 特殊提交类型
  if (msg.startsWith("merge")) return "merge";
  if (msg.startsWith("revert")) return "revert";
  if (msg.startsWith("spec:") || msg.startsWith("spec(")) return "spec";
  if (msg.startsWith("hook:") || msg.startsWith("hook(")) return "hook";

  // 标准提交前缀
  const patterns: Record<CommitType, RegExp> = {
    feat: /^feat(\(.+\))?:/i,
    fix: /^fix(\(.+\))?:/i,
    docs: /^docs(\(.+\))?:/i,
    refactor: /^refactor(\(.+\))?:/i,
    test: /^test(\(.+\))?:/i,
    perf: /^perf(\(.+\))?:/i,
    chore: /^chore(\(.+\))?:/i,
    merge: /^merge/i,
    revert: /^revert/i,
    spec: /^spec/i,
    hook: /^hook/i,
    other: /^/,
  };

  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(message)) {
      return type as CommitType;
    }
  }

  return "other";
}

/**
 * 关联标签到提交
 */
export function associateTags(commits: Commit[], tags: RawHistory["tags"]): Map<string, string[]> {
  const commitTags = new Map<string, string[]>();
  const knownIds = new Set(commits.map((c) => c.id));

  for (const tag of tags) {
    // 仅保留 commit sha 存在于已取提交中的标签（FR-IN-04）
    if (tag.commit && knownIds.has(tag.commit)) {
      const existing = commitTags.get(tag.commit) || [];
      existing.push(tag.name);
      commitTags.set(tag.commit, existing);
    }
  }

  return commitTags;
}
