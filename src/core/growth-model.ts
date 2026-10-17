/**
 * 生长模型构建
 * Lane 识别、作者统计、章节划分
 */

import { Commit, Lane, Chapter, AuthorStat, Stats, GrowthModel } from "./types";

/** 沉寂期判定阈值：连续无提交超过总跨度 10% 且超过 14 天（FR-GM-03） */
export const DORMANCY_MIN_DAYS = 14;
export const DORMANCY_SPAN_RATIO = 0.1;

/**
 * 识别主干与支线（FR-GM-01）
 * - 主干：从最新提交沿 parents[0]（first-parent）回溯，laneId = 0
 * - 支线：merge 提交第二父节点为根、沿 first-parent 链收集，merged = true
 * - 剩余未分配提交：每条 first-parent 链一个 lane，merged = false
 * 每个 lane 的 commitIds 按时间升序排列
 */
export function identifyLanes(commits: Commit[]): Lane[] {
  if (commits.length === 0) return [];

  const byId = new Map(commits.map((c) => [c.id, c]));
  const lanes: Lane[] = [];
  const assigned = new Set<string>();

  // 1. 主干：从最新提交沿 parents[0] 回溯（按时间取最新，不依赖输入顺序）
  const trunkIds: string[] = [];
  let current: Commit | undefined = commits.reduce((a, b) => (b.time >= a.time ? b : a), commits[0]);
  while (current && !assigned.has(current.id)) {
    assigned.add(current.id);
    trunkIds.push(current.id);
    const parentId: string | undefined =
      current.parents.length > 0 ? current.parents[0] : undefined;
    current = parentId ? byId.get(parentId) : undefined;
  }
  trunkIds.reverse(); // 回溯得到的是新→旧，翻转为时间升序
  lanes.push({
    id: 0,
    parentLane: null,
    forkCommitId: null,
    merged: true,
    commitIds: trunkIds,
  });

  // 2. 已合并支线：按 merge 提交时间从旧到新处理（确定性）
  const merges = commits.filter((c) => c.isMerge && c.parents.length > 1);
  let nextLaneId = 1;
  for (const merge of merges) {
    const branchRootId = merge.parents[1];
    if (!branchRootId || assigned.has(branchRootId)) continue;

    // 沿 parents[0] 收集分支链，碰到已分配提交即止
    const branchCommits = collectFirstParentChain(branchRootId, byId, assigned);
    if (branchCommits.length === 0) continue;

    // fork 点：分支最旧提交沿 parents[0] 找到的第一个已分配提交
    const oldest = byId.get(branchCommits[branchCommits.length - 1]);
    const forkCommitId = findForkPoint(oldest, byId, assigned);

    for (const id of branchCommits) assigned.add(id);
    branchCommits.reverse(); // 时间升序
    lanes.push({
      id: nextLaneId,
      parentLane: 0,
      forkCommitId,
      mergeCommitId: merge.id,
      merged: true,
      commitIds: branchCommits,
    });
    nextLaneId++;
  }

  // 3. 未合并的孤立支线：剩余提交按 first-parent 链归组（同链多个提交属于同一支线）
  const firstParentChildren = new Map<string, Commit[]>();
  for (const c of commits) {
    if (c.parents.length > 0) {
      const p = c.parents[0];
      const list = firstParentChildren.get(p) || [];
      list.push(c);
      firstParentChildren.set(p, list);
    }
  }

  for (const commit of commits) {
    if (assigned.has(commit.id)) continue;
    // 仅从链根开始收集（父提交未分配说明还有更旧的同链提交未处理）
    if (commit.parents.length > 0) {
      const p = commit.parents[0];
      if (byId.has(p) && !assigned.has(p)) continue;
    }

    // 沿 first-parent 子链向前收集整条支线
    const chain: string[] = [];
    const seen = new Set<string>();
    const queue: Commit[] = [commit];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (seen.has(node.id) || assigned.has(node.id)) continue;
      seen.add(node.id);
      chain.push(node.id);
      for (const child of firstParentChildren.get(node.id) || []) {
        if (!assigned.has(child.id) && !seen.has(child.id)) queue.push(child);
      }
    }
    if (chain.length === 0) continue;

    chain.sort((a, b) => {
      const ca = byId.get(a)!;
      const cb = byId.get(b)!;
      return ca.time - cb.time || a.localeCompare(b);
    });
    for (const id of chain) assigned.add(id);

    // fork 点：链最旧提交沿 parents[0] 找到的第一个已分配提交
    const forkCommitId = findForkPoint(byId.get(chain[0]), byId, assigned);

    lanes.push({
      id: nextLaneId,
      parentLane: 0,
      forkCommitId,
      merged: false,
      commitIds: chain,
    });
    nextLaneId++;
  }

  return lanes;
}

/**
 * 分支最旧提交沿 parents[0] 找到的第一个已分配提交（即分叉点）；
 * 找不到返回 null。
 */
function findForkPoint(
  oldest: Commit | undefined,
  byId: Map<string, Commit>,
  assigned: Set<string>
): string | null {
  let node = oldest;
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const parentId = node.parents.length > 0 ? node.parents[0] : undefined;
    if (!parentId) return null;
    if (assigned.has(parentId)) return parentId;
    node = byId.get(parentId);
  }
  return null;
}

/**
 * 从 startId 沿 parents[0] 收集尚未分配的提交链（遇到已分配提交或环即停）
 */
function collectFirstParentChain(
  startId: string,
  byId: Map<string, Commit>,
  assigned: Set<string>
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let node = byId.get(startId);
  while (node && !assigned.has(node.id) && !seen.has(node.id)) {
    seen.add(node.id);
    chain.push(node.id);
    const parentId = node.parents.length > 0 ? node.parents[0] : undefined;
    node = parentId ? byId.get(parentId) : undefined;
  }
  return chain;
}

/**
 * 统计作者（前 11 + 其他）
 * 同一作者的多个 name 按 login 合并；没有 login 时按 name 合并（FR-GM-02）
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

/** 主版本标签：v1.0 / v2.0.0 / 1.0 等（FR-GM-03） */
export function isMajorVersionTag(name: string): boolean {
  return /^v?\d+\.0(\.0)?$/.test(name);
}

/**
 * 章节划分（FR-GM-03，3–6 个）
 * - 时间跨度等分 20 个窗口统计密度
 * - 强制切分点：① 主版本标签所在窗口；② 沉寂期（间隔 > max(总跨度 10%, 14 天)）；
 *   ③ 相邻窗口密度变化 > 30%
 * - 超过 6 段时反复合并提交数最少的相邻两段；不足 3 段时对最大章节对半切
 */
export function computeChapters(
  commits: Commit[],
  tags: Array<{ name: string; commitId: string }> = []
): Chapter[] {
  if (commits.length === 0) return [];

  const startTime = commits[0].time;
  const endTime = commits[commits.length - 1].time;
  const duration = endTime - startTime;

  if (duration === 0) {
    return [{
      title: "萌芽期",
      season: "spring",
      startIndex: 0,
      endIndex: commits.length - 1,
      startTime,
      endTime,
    }];
  }

  const windowCount = 20;
  const windowSize = duration / windowCount;
  const density = Array<number>(windowCount).fill(0);
  for (const commit of commits) {
    const idx = Math.min(
      windowCount - 1,
      Math.max(0, Math.floor((commit.time - startTime) / windowSize))
    );
    density[idx]++;
  }
  const avgDensity = commits.length / windowCount;

  // 收集切分窗口（1..windowCount-1）
  const splitWindows = new Set<number>();

  // ① 主版本标签
  const commitTimeById = new Map(commits.map((c) => [c.id, c.time]));
  for (const tag of tags) {
    if (!isMajorVersionTag(tag.name)) continue;
    const tagTime = commitTimeById.get(tag.commitId);
    if (tagTime === undefined) continue;
    const w = Math.floor((tagTime - startTime) / windowSize);
    if (w > 0 && w < windowCount) splitWindows.add(w);
  }

  // ② 沉寂期
  const dormancyThreshold = Math.max(duration * DORMANCY_SPAN_RATIO, DORMANCY_MIN_DAYS * 86400000);
  for (let i = 1; i < commits.length; i++) {
    const gap = commits[i].time - commits[i - 1].time;
    if (gap > dormancyThreshold) {
      const w = Math.floor((commits[i].time - startTime) / windowSize);
      if (w > 0 && w < windowCount) splitWindows.add(w);
    }
  }

  // ③ 密度变化 > 30%
  for (let i = 1; i < windowCount; i++) {
    const change = Math.abs(density[i] - density[i - 1]) / Math.max(density[i - 1], 1);
    if (change > 0.3) splitWindows.add(i);
  }

  // 切分窗口 → 提交索引边界
  const boundaries: number[] = [0];
  for (const w of Array.from(splitWindows).sort((a, b) => a - b)) {
    const splitTime = startTime + w * windowSize;
    const idx = commits.findIndex((c) => c.time >= splitTime);
    if (idx <= 0 || idx >= commits.length) continue;
    if (boundaries[boundaries.length - 1] < idx) boundaries.push(idx);
  }
  boundaries.push(commits.length);

  // 构造原始章节
  let chapters: Chapter[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const s = boundaries[i];
    const e = boundaries[i + 1] - 1;
    if (e < s) continue;
    chapters.push({
      title: "",
      season: "autumn",
      startIndex: s,
      endIndex: e,
      startTime: commits[s].time,
      endTime: commits[e].time,
    });
  }

  // 超过 6 段：合并提交数最少的相邻两段
  while (chapters.length > 6) {
    let minIdx = 0;
    let minSize = Infinity;
    for (let i = 0; i < chapters.length - 1; i++) {
      const size =
        chapters[i].endIndex - chapters[i].startIndex + 1 +
        chapters[i + 1].endIndex - chapters[i + 1].startIndex + 1;
      if (size < minSize) {
        minSize = size;
        minIdx = i;
      }
    }
    chapters[minIdx].endIndex = chapters[minIdx + 1].endIndex;
    chapters[minIdx].endTime = chapters[minIdx + 1].endTime;
    chapters.splice(minIdx + 1, 1);
  }

  // 不足 3 段：对最大章节按提交数对半切
  while (chapters.length < 3) {
    let maxIdx = 0;
    let maxSize = 0;
    for (let i = 0; i < chapters.length; i++) {
      const size = chapters[i].endIndex - chapters[i].startIndex + 1;
      if (size > maxSize) {
        maxSize = size;
        maxIdx = i;
      }
    }
    if (maxSize < 2) break; // 无法再分
    const ch = chapters[maxIdx];
    const mid = ch.startIndex + Math.floor((ch.endIndex - ch.startIndex) / 2);
    const right: Chapter = {
      title: "",
      season: "autumn",
      startIndex: mid + 1,
      endIndex: ch.endIndex,
      startTime: commits[mid + 1].time,
      endTime: ch.endTime,
    };
    ch.endIndex = mid;
    ch.endTime = commits[mid].time;
    chapters.splice(maxIdx + 1, 0, right);
  }

  // 统一生成标题与季节（FR-GM-04）
  chapters = chapters.map((ch, i) =>
    titleChapter(ch, i, chapters.length, commits, tags, avgDensity, windowSize)
  );

  // 同卡片标题去重：后缀「· 二」「· 三」
  const titleCount = new Map<string, number>();
  for (const ch of chapters) {
    const n = (titleCount.get(ch.title) || 0) + 1;
    titleCount.set(ch.title, n);
    if (n > 1) {
      const suffix = ["", "· 二", "· 三", "· 四", "· 五"][Math.min(n - 1, 4)];
      ch.title = ch.title + suffix;
    }
  }

  return chapters;
}

/**
 * 规则标题（FR-GM-04，按顺序匹配）
 */
function titleChapter(
  ch: Chapter,
  index: number,
  total: number,
  commits: Commit[],
  tags: Array<{ name: string; commitId: string }>,
  avgDensity: number,
  windowSize: number
): Chapter {
  const count = ch.endIndex - ch.startIndex + 1;
  const spanWindows = Math.max(1, (ch.endTime - ch.startTime) / windowSize);
  const chapterDensity = count / spanWindows;

  let refactorCount = 0;
  for (let i = ch.startIndex; i <= ch.endIndex; i++) {
    if (commits[i].type === "refactor") refactorCount++;
  }
  const refactorRatio = refactorCount / count;

  const commitIdsInChapter = new Set(
    commits.slice(ch.startIndex, ch.endIndex + 1).map((c) => c.id)
  );
  const hasMajorTag = tags.some(
    (t) => isMajorVersionTag(t.name) && commitIdsInChapter.has(t.commitId)
  );

  let title: string;
  let season: Chapter["season"];

  if (index === 0) {
    title = "萌芽期";
    season = "spring";
  } else if (hasMajorTag) {
    title = "里程碑期";
    season = "summer";
  } else if (chapterDensity >= avgDensity * 1.5) {
    title = "扩张期";
    season = "summer";
  } else if (refactorRatio > 0.2) {
    title = "重构期";
    season = "autumn";
  } else if (chapterDensity <= avgDensity * 0.5) {
    title = "沉淀期";
    season = "winter";
  } else if (index === total - 1) {
    title = "当下";
    season = "autumn";
  } else {
    title = "稳定期";
    season = "autumn";
  }

  return { ...ch, title, season };
}

/**
 * 统计数据（FR-GM-05，在采样前的全部已取提交上计算）
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
  let busiestDate = "N/A";
  let busiestCount = 0;
  for (const [date, count] of dailyCommits) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestDate = date;
    }
  }

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
  // 防御性排序：契约要求 commits 按时间升序（FR-DT-03），
  // 即使调用方传入未排序数据也保证模型自洽
  const sorted = [...commits].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  const lanes = identifyLanes(sorted);
  const authors = computeAuthors(sorted);
  const chapters = computeChapters(
    sorted,
    tags.map((t) => ({ name: t.name, commitId: t.commit }))
  );
  const stats = computeStats(sorted);

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    source: { kind: "github" },
    commits: sorted,
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
