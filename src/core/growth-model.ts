/**
 * 生长模型构建
 * Lane 识别、作者统计、章节划分
 */

import { Commit, Lane, Chapter, AuthorStat, Stats, GrowthModel } from "./types";

/**
 * 识别主干与支线
 */
export function identifyLanes(commits: Commit[]): Lane[] {
  if (commits.length === 0) return [];

  const lanes: Lane[] = [];
  const commitToLane = new Map<string, number>();

  // 主干：从最新提交沿 parents[0] 回溯
  const trunkIds = new Set<string>();
  let current: Commit | undefined = commits[commits.length - 1];
  while (current) {
    trunkIds.add(current.id);
    commitToLane.set(current.id, 0);
    current = current.parents.length > 0
      ? commits.find((c) => c.id === current!.parents[0])
      : undefined;
  }

  lanes.push({
    id: 0,
    parentLane: null,
    forkCommitId: null,
    merged: true,
    commitIds: Array.from(trunkIds),
  });

  // 支线：从 merge 提交处分叉
  let nextLaneId = 1;
  for (const commit of commits) {
    if (commit.isMerge && commit.parents.length > 1) {
      // 第二个 parent 是被合并分支的起点
      const branchParent = commit.parents[1];
      if (branchParent && !commitToLane.has(branchParent)) {
        const branchCommits = collectBranchCommits(branchParent, commits, commitToLane);
        if (branchCommits.length > 0) {
          lanes.push({
            id: nextLaneId,
            parentLane: 0,
            forkCommitId: branchParent,
            mergeCommitId: commit.id,
            merged: true,
            commitIds: branchCommits,
          });
          nextLaneId++;
        }
      }
    }
  }

  return lanes;
}

function collectBranchCommits(
  startId: string,
  allCommits: Commit[],
  assignedLanes: Map<string, number>
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id) || assignedLanes.has(id)) continue;

    visited.add(id);
    result.push(id);

    const commit = allCommits.find((c) => c.id === id);
    if (commit?.parents.length || 0 > 0) {
      queue.push(...commit!.parents);
    }
  }

  return result;
}

/**
 * 统计作者（前 11 + 其他）
 */
export function computeAuthors(commits: Commit[]): AuthorStat[] {
  const authorMap = new Map<string, { name: string; commits: number; firstTime: number; lastTime: number }>();

  for (const commit of commits) {
    const key = commit.author.login || commit.author.name;
    const existing = authorMap.get(key) || {
      name: commit.author.name,
      commits: 0,
      firstTime: commit.time,
      lastTime: commit.time,
    };

    existing.commits++;
    existing.firstTime = Math.min(existing.firstTime, commit.time);
    existing.lastTime = Math.max(existing.lastTime, commit.time);

    authorMap.set(key, existing);
  }

  return Array.from(authorMap.entries())
    .map(([key, author], idx) => ({
      key,
      name: author.name,
      commits: author.commits,
      firstTime: author.firstTime,
      lastTime: author.lastTime,
      colorIndex: idx < 11 ? idx : 11, // 第 12 为「其他」
    }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}

/**
 * 章节划分（3-6 个）
 */
export function computeChapters(commits: Commit[]): Chapter[] {
  if (commits.length === 0) return [];

  const startTime = commits[0].time;
  const endTime = commits[commits.length - 1].time;
  const duration = endTime - startTime;

  if (duration === 0) {
    return [{
      title: "当下",
      season: "autumn",
      startIndex: 0,
      endIndex: commits.length - 1,
      startTime,
      endTime,
    }];
  }

  // 等分 20 个窗口，统计密度
  const windowCount = 20;
  const windowSize = duration / windowCount;
  const density = Array(windowCount).fill(0);

  for (const commit of commits) {
    const windowIdx = Math.min(
      windowCount - 1,
      Math.floor((commit.time - startTime) / windowSize)
    );
    density[windowIdx]++;
  }

  // 简单章节划分规则
  const avgDensity = commits.length / windowCount;
  const chapters: Chapter[] = [];
  let currentChapterStart = 0;

  for (let i = 1; i < windowCount; i++) {
    const densityChange = Math.abs(density[i] - density[i - 1]) / Math.max(density[i - 1], 1);
    // 密度明显下降时分割
    if (densityChange > 0.3) {
      const chapterStartTime = startTime + currentChapterStart * windowSize;
      const chapterEndTime = startTime + i * windowSize;
      const chapterCommits = commits.filter(
        (c) => c.time >= chapterStartTime && c.time < chapterEndTime
      );

      if (chapterCommits.length > 0) {
        chapters.push({
          title: `第 ${chapters.length + 1} 章`,
          season: ["spring", "summer", "autumn", "winter"][chapters.length % 4] as any,
          startIndex: commits.indexOf(chapterCommits[0]),
          endIndex: commits.indexOf(chapterCommits[chapterCommits.length - 1]),
          startTime: chapterStartTime,
          endTime: chapterEndTime,
        });
      }
      currentChapterStart = i;
    }
  }

  // 最后一个章节
  if (currentChapterStart < windowCount) {
    const chapterCommits = commits.slice(
      currentChapterStart === 0 ? 0 : commits.filter(
        (c) => c.time >= startTime + currentChapterStart * windowSize
      )[0] ? commits.indexOf(commits.filter(
        (c) => c.time >= startTime + currentChapterStart * windowSize
      )[0]) : 0
    );
    chapters.push({
      title: chapters.length === 0 ? "成长历程" : `第 ${chapters.length + 1} 章`,
      season: "autumn",
      startIndex: chapters.length === 0 ? 0 : chapters[chapters.length - 1].endIndex + 1,
      endIndex: commits.length - 1,
      startTime: chapters.length === 0 ? startTime : startTime + currentChapterStart * windowSize,
      endTime,
    });
  }

  // 确保 3-6 个章节
  if (chapters.length < 3) {
    return [{
      title: "成长历程",
      season: "spring",
      startIndex: 0,
      endIndex: commits.length - 1,
      startTime,
      endTime,
    }];
  }

  if (chapters.length > 6) {
    // 合并最小的相邻两个章节
    while (chapters.length > 6) {
      let minIdx = 0;
      let minSize = chapters[0].endIndex - chapters[0].startIndex;
      for (let i = 1; i < chapters.length - 1; i++) {
        const size = chapters[i].endIndex - chapters[i].startIndex;
        if (size < minSize) {
          minSize = size;
          minIdx = i;
        }
      }
      // 合并 minIdx 和 minIdx+1
      chapters[minIdx].endIndex = chapters[minIdx + 1].endIndex;
      chapters[minIdx].endTime = chapters[minIdx + 1].endTime;
      chapters.splice(minIdx + 1, 1);
    }
  }

  return chapters;
}

/**
 * 统计数据
 */
export function computeStats(commits: Commit[]): Stats {
  if (commits.length === 0) {
    return {
      firstTime: 0,
      lastTime: 0,
      days: 0,
      totalCommits: 0,
      contributors: 0,
      busiestDay: { date: "N/A", commits: 0 },
      longestDormancy: { days: 0, from: 0, to: 0 },
    };
  }

  const firstTime = commits[0].time;
  const lastTime = commits[commits.length - 1].time;
  const days = Math.ceil((lastTime - firstTime) / (1000 * 60 * 60 * 24));

  // 最活跃的一天
  const dailyCommits = new Map<string, number>();
  for (const commit of commits) {
    const date = new Date(commit.time).toISOString().split("T")[0];
    dailyCommits.set(date, (dailyCommits.get(date) || 0) + 1);
  }
  const [busiestDate, busiestCount] = Array.from(dailyCommits.entries()).reduce((a, b) =>
    b[1] > a[1] ? b : a
  ) || ["N/A", 0];

  // 最长沉寂期
  let maxDormancy = 0;
  let dormancyStart = firstTime;
  let dormancyEnd = firstTime;
  for (let i = 1; i < commits.length; i++) {
    const gap = commits[i].time - commits[i - 1].time;
    const gapDays = Math.ceil(gap / (1000 * 60 * 60 * 24));
    if (gapDays > maxDormancy) {
      maxDormancy = gapDays;
      dormancyStart = commits[i - 1].time;
      dormancyEnd = commits[i].time;
    }
  }

  const contributors = new Set(commits.map((c) => c.author.login || c.author.name)).size;

  return {
    firstTime,
    lastTime,
    days,
    totalCommits: commits.length,
    contributors,
    busiestDay: { date: busiestDate, commits: busiestCount },
    longestDormancy: { days: maxDormancy, from: dormancyStart, to: dormancyEnd },
  };
}

/**
 * 构建完整生长模型
 */
export function buildGrowthModel(
  commits: Commit[],
  tags: Array<{ name: string; commit: string }>,
  samplingRate: number
): GrowthModel {
  const lanes = identifyLanes(commits);
  const authors = computeAuthors(commits);
  const chapters = computeChapters(commits);
  const stats = computeStats(commits);

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    source: { kind: "github" },
    commits,
    lanes,
    tags: tags.map((t) => ({ name: t.name, commitId: t.commit })),
    authors,
    chapters,
    stats,
    metadata: {
      truncated: false,
      samplingRate,
      droppedTags: 0,
    },
  };
}
