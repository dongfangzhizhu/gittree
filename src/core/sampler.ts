/**
 * 提交采样 + 父节点重连
 */

import { Commit } from "./types";

export interface SamplingResult {
  commits: Commit[];
  samplingRate: number;
}

/**
 * 采样算法：
 * - commits ≤ 500 时全留
 * - 否则强制保留首尾 + merge + tag，剩余等距抽样至 500
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

  // 如果强制保留集已经 > maxCount，就在其中优先保留首尾和标签
  if (forcedKeep.size >= maxCount) {
    const kept = Array.from(forcedKeep);
    const result = commits.filter((c) => kept.includes(c.id));
    return {
      commits: result.slice(0, maxCount),
      samplingRate: maxCount / commits.length,
    };
  }

  // 剩余名额用等距抽样
  const remaining = maxCount - forcedKeep.size;
  const otherCommits = commits.filter((c) => !forcedKeep.has(c.id));
  const step = Math.max(1, Math.floor(otherCommits.length / remaining));

  const sampled: Commit[] = [];
  for (let i = 0; i < otherCommits.length; i += step) {
    sampled.push(otherCommits[i]);
  }

  // 合并强制保留和采样后的提交，按时间排序
  const allSampled = [...Array.from(forcedKeep).map((id) =>
    commits.find((c) => c.id === id)
  ), ...sampled].filter((c) => c !== undefined) as Commit[];

  const unique = Array.from(new Map(allSampled.map((c) => [c.id, c])).values());
  unique.sort((a, b) => a.time - b.time);

  return {
    commits: unique.slice(0, maxCount),
    samplingRate: Math.min(maxCount, unique.length) / commits.length,
  };
}

/**
 * 采样后重连父节点
 * 每个采样提交的 parents 指向其最近的保留祖先
 */
export function reconnectParents(
  sampledCommits: Commit[],
  allCommits: Commit[]
): Commit[] {
  const commitMap = new Map(allCommits.map((c) => [c.id, c]));
  const sampledIds = new Set(sampledCommits.map((c) => c.id));

  // 构建原始父子关系映射
  const parentMap = new Map<string, string[]>();
  for (const commit of allCommits) {
    parentMap.set(commit.id, commit.parents);
  }

  // 对每个采样提交，查找其最近保留祖先
  const result = sampledCommits.map((commit) => {
    const newParents: string[] = [];

    for (const parentId of commit.parents) {
      const ancestor = findNearestAncestor(
        parentId,
        sampledIds,
        parentMap,
        new Set()
      );
      if (ancestor) {
        newParents.push(ancestor);
      }
    }

    // 如果没找到任何祖先，连接到时间上最接近的早期提交
    if (newParents.length === 0 && commit !== sampledCommits[0]) {
      for (let i = sampledCommits.indexOf(commit) - 1; i >= 0; i--) {
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
 * BFS 查找最近的保留祖先
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
