/**
 * 提交采样 + 父节点重连（FR-DT-04/05）
 */

import { Commit } from "./types";

export interface SamplingResult {
  commits: Commit[];
  samplingRate: number;
}

/**
 * 采样算法：
 * - commits ≤ maxCount 时全留
 * - 否则强制保留首尾 + merge + tag，剩余等距抽样至 maxCount
 */
export function sampleCommits(
  commits: Commit[],
  taggedCommitIds: Set<string>,
  maxCount: number = 500
): SamplingResult {
  if (commits.length <= maxCount) {
    return { commits, samplingRate: 1.0 };
  }

  // 强制保留集
  const forcedKeep = new Set<string>();
  forcedKeep.add(commits[0].id); // 最早提交
  forcedKeep.add(commits[commits.length - 1].id); // 最新提交

  // 所有 merge 提交
  for (const commit of commits) {
    if (commit.isMerge) {
      forcedKeep.add(commit.id);
    }
  }

  // 所有带标签的提交
  for (const id of taggedCommitIds) {
    forcedKeep.add(id);
  }

  // 强制保留集已超上限：保留首尾 + 标签，其余丢弃
  if (forcedKeep.size >= maxCount) {
    const keepFirst = commits[0].id;
    const keepLast = commits[commits.length - 1].id;
    const priority = new Set<string>([keepFirst, keepLast, ...taggedCommitIds]);
    const ordered = commits.filter((c) => forcedKeep.has(c.id));
    const prioritized = ordered.filter((c) => priority.has(c.id));
    const rest = ordered.filter((c) => !priority.has(c.id));
    const result = [...prioritized, ...rest].slice(0, maxCount);
    return {
      commits: result,
      samplingRate: maxCount / commits.length,
    };
  }

  // 剩余名额用等距抽样（FR-DT-04：第 k 个取 round(k*(n-1)/(m-1))）
  const remaining = maxCount - forcedKeep.size;
  const otherCommits = commits.filter((c) => !forcedKeep.has(c.id));
  const n = otherCommits.length;
  const sampled: Commit[] = [];

  if (remaining > 0 && n > 0) {
    if (remaining === 1) {
      sampled.push(otherCommits[Math.floor((n - 1) / 2)]);
    } else {
      for (let k = 0; k < remaining; k++) {
        const idx = Math.round((k * (n - 1)) / (remaining - 1));
        sampled.push(otherCommits[idx]);
      }
    }
  }

  // 合并强制保留和采样后的提交，按时间排序（强制保留项绝不被丢弃）
  const forcedCommits: Commit[] = [];
  for (const id of forcedKeep) {
    const c = commits.find((commit) => commit.id === id);
    if (c) forcedCommits.push(c);
  }

  const allSampled = [...forcedCommits, ...sampled];
  const unique = Array.from(new Map(allSampled.map((c) => [c.id, c])).values());
  unique.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  return {
    commits: unique.slice(0, maxCount),
    samplingRate: Math.min(maxCount, unique.length) / commits.length,
  };
}

/**
 * 采样后重连父节点（FR-DT-05）
 * 每个采样提交的 parents 指向其最近的保留祖先；
 * 找不到保留祖先时，连接到时间上紧邻的更早保留提交；最早的提交为根。
 */
export function reconnectParents(
  sampledCommits: Commit[],
  allCommits: Commit[]
): Commit[] {
  const parentMap = new Map(allCommits.map((c) => [c.id, c.parents]));
  const sampledIds = new Set(sampledCommits.map((c) => c.id));
  const sampledIndex = new Map(sampledCommits.map((c, i) => [c.id, i]));

  const result = sampledCommits.map((commit) => {
    const newParents: string[] = [];

    for (const parentId of commit.parents) {
      const ancestor = findNearestAncestor(parentId, sampledIds, parentMap, new Set());
      if (ancestor && !newParents.includes(ancestor)) {
        newParents.push(ancestor);
      }
    }

    // 没找到保留祖先：连接到时间上最接近的更早保留提交
    if (newParents.length === 0) {
      const myIdx = sampledIndex.get(commit.id) ?? -1;
      for (let i = myIdx - 1; i >= 0; i--) {
        if (sampledCommits[i].time < commit.time) {
          newParents.push(sampledCommits[i].id);
          break;
        }
      }
    }

    return {
      ...commit,
      parents: newParents,
    };
  });

  return result;
}

/**
 * BFS 查找最近的保留祖先（沿被删节点向上，保持原 parents 顺序）
 */
function findNearestAncestor(
  commitId: string,
  sampledIds: Set<string>,
  parentMap: Map<string, string[]>,
  visited: Set<string>
): string | null {
  if (visited.has(commitId)) return null;
  visited.add(commitId);

  if (sampledIds.has(commitId)) {
    return commitId;
  }

  const parents = parentMap.get(commitId) || [];
  for (const parentId of parents) {
    const ancestor = findNearestAncestor(parentId, sampledIds, parentMap, visited);
    if (ancestor) return ancestor;
  }

  return null;
}
