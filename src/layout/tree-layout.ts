/**
 * 树形布局引擎（纯函数）
 * 无副作用，不依赖 Date.now 或 Math.random；随机数只来自种子 PRNG（FR-TL-01）
 *
 * 坐标系（FR-TL-02）：逻辑画布 1920×1080，原点左上；
 * 树根 (960, 1000)，树冒高度不超过 820（y ≥ 180），水平范围 80–1840。
 */

import { GrowthModel, TreeGeometry, TreeSegment, TreeLeaf, TreeFlower, Commit } from "../core/types";
import { seededRandom } from "./prng";

export interface LayoutOptions {
  seed?: string;
  width?: number;
  height?: number;
}

/** 布局常量（FR-TL-02/03/04/06） */
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const ROOT_X = 960;
const ROOT_Y = 1000;
const MAX_RISE = 820; // 树冒高度上限
const X_MIN = 80;
const X_MAX = 1840;
const Y_MIN = 180;
const TRUNK_SEG_LEN = { min: 3, max: 40 };
const BRANCH_SEG_LEN = { min: 3, max: 55 };
const BRANCH_ANGLE_RANGE = { minDeg: 25, maxDeg: 60 }; // 支线角度 25°–60°
const TRUNK_SWAY_DEG = 7; // 主干每段左右偏摆 ±7°
const BRANCH_SWAY_DEG = 5;
const MIN_BRANCH_COMMITS = 3; // 少于此数的支线不单独分枝，表现为父枝上的叶
const THICKNESS = { base: 1.8, min: 1.5, max: 22 }; // 管道模型

/** 叶子颜色索引 12 = 紫色（spec:/hook: 提交的 Kiro 痕迹，FR-TL-07） */
export const LEAF_COLOR_KIRO = 12;

interface Placement {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 沉寂期阈值：与 FR-GM-03 保持一致 */
const DORMANCY_MIN_DAYS = 14;
const DORMANCY_SPAN_RATIO = 0.1;

/**
 * 主布局函数（纯函数）
 */
export function layout(
  model: GrowthModel,
  options: LayoutOptions = {}
): TreeGeometry {
  const {
    seed = `${model.source.owner}/${model.source.repo}`,
    width = CANVAS_W,
    height = CANVAS_H,
  } = options;

  // 空数据保护：返回空几何，渲染器据此只画背景
  if (model.commits.length === 0) {
    return {
      width,
      height,
      segments: [],
      leaves: [],
      flowers: [],
      chapters: [],
      timeMap: [
        [0, 0],
        [1, 0],
      ],
    };
  }

  const commits = model.commits;
  const commitCount = commits.length;
  const commitIndex = new Map(commits.map((c, i) => [c.id, i]));
  const commitById = new Map(commits.map((c) => [c.id, c]));

  /** 提交序号 → 动画时间 t（FR-TL-09：按序号均匀分配） */
  const tOf = (idx: number): number =>
    commitCount <= 1 ? 0 : idx / (commitCount - 1);

  const segments: TreeSegment[] = [];
  const leaves: TreeLeaf[] = [];
  const flowers: TreeFlower[] = [];
  const placements = new Map<string, Placement>();

  // lane 列表：缺省时退化为单主干
  const lanes =
    model.lanes.length > 0
      ? model.lanes
      : [
          {
            id: 0,
            parentLane: null,
            forkCommitId: null,
            merged: true,
            commitIds: commits.map((c) => c.id),
          },
        ];

  // 每个 lane 的提交按时间升序（model.commits 本身有序，稳定）
  const laneCommitsOf = (lane: (typeof lanes)[number]): Commit[] =>
    lane.commitIds
      .map((id) => commitById.get(id))
      .filter((c): c is Commit => c !== undefined)
      .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  // 同一 fork 点的支线左右交替（FR-TL-04）
  const forkSideCount = new Map<string, number>();
  const sideOf = (forkCommitId: string | null, laneId: number): number => {
    if (forkCommitId) {
      const n = forkSideCount.get(forkCommitId) || 0;
      forkSideCount.set(forkCommitId, n + 1);
      return n % 2 === 0 ? -1 : 1;
    }
    return laneId % 2 === 1 ? -1 : 1;
  };

  // 逐 lane 生成线段
  lanes.forEach((lane, laneOrder) => {
    const laneCommits = laneCommitsOf(lane);
    if (laneCommits.length === 0) return;

    const isTrunk = lane.id === 0;
    const isBranchable = isTrunk || laneCommits.length >= MIN_BRANCH_COMMITS;

    // 起点
    let px = ROOT_X;
    let py = ROOT_Y;
    if (!isTrunk && lane.forkCommitId) {
      const forkPlacement = placements.get(lane.forkCommitId);
      if (forkPlacement) {
        px = forkPlacement.x1;
        py = forkPlacement.y1;
      }
    }

    // 基础角度与段长
    const segLen = isTrunk
      ? clamp(MAX_RISE / laneCommits.length, TRUNK_SEG_LEN.min, TRUNK_SEG_LEN.max)
      : clamp((MAX_RISE * 0.75) / laneCommits.length, BRANCH_SEG_LEN.min, BRANCH_SEG_LEN.max);

    let baseAngle = 0; // 弧度，相对竖直向上，正方向右
    if (!isTrunk) {
      const side = sideOf(lane.forkCommitId, lane.id);
      const r = seededRandom(`${seed}:lane:${lane.id}`, 0);
      const magDeg = BRANCH_ANGLE_RANGE.minDeg + r * (BRANCH_ANGLE_RANGE.maxDeg - BRANCH_ANGLE_RANGE.minDeg);
      baseAngle = (side * magDeg * Math.PI) / 180;
    }

    laneCommits.forEach((commit, i) => {
      const swayR = seededRandom(`${seed}:${commit.id}`, 0);
      const swayDeg = (swayR * 2 - 1) * (isTrunk ? TRUNK_SWAY_DEG : BRANCH_SWAY_DEG);
      const angle = baseAngle + (swayDeg * Math.PI) / 180;

      const x0 = px;
      const y0 = py;
      let x1 = x0 + segLen * Math.sin(angle);
      let y1 = y0 - segLen * Math.cos(angle);
      // 范围保护（FR-TL-02）
      x1 = clamp(x1, X_MIN, X_MAX);
      y1 = clamp(y1, Y_MIN, height - 40);

      const globalIdx = commitIndex.get(commit.id) ?? i;
      const t0 = tOf(globalIdx);
      const t1 = globalIdx + 1 < commitCount ? tOf(globalIdx + 1) : 1;

      // 管道粗细：thickness = clamp(1.2 * sqrt(子树提交数), 1, 22)（FR-TL-06）
      const subtree = laneCommits.length - i;
      const w0 = clamp(THICKNESS.base * Math.sqrt(subtree), THICKNESS.min, THICKNESS.max);
      const w1 = clamp(THICKNESS.base * Math.sqrt(Math.max(1, subtree - 1)), THICKNESS.min, THICKNESS.max);

      if (isBranchable) {
        segments.push({
          id: `seg-${lane.id}-${i}`,
          commitId: commit.id,
          laneId: lane.id,
          kind: isTrunk ? "trunk" : "branch",
          p0: [x0, y0],
          c: [x0, (y0 + y1) / 2], // 二次贝塞尔控制点（垂直中线，保持挺直）
          p1: [x1, y1],
          w0,
          w1,
          birth: [t0, Math.min(1, Math.max(t1, t0 + 1e-6))],
        });
        placements.set(commit.id, { x0, y0, x1, y1 });
      } else {
        // 小支线：不画线段，提交表现为父枝上的叶
        placements.set(commit.id, { x0, y0, x1, y1 });
      }

      px = x1;
      py = y1;
    });
  });

  // 叶子：每个非 merge 提交（FR-TL-07）
  const authorColorByName = new Map(model.authors.map((a) => [a.name, a.colorIndex]));
  const dormancyThreshold =
    commitCount >= 2
      ? Math.max(
          (commits[commitCount - 1].time - commits[0].time) * DORMANCY_SPAN_RATIO,
          DORMANCY_MIN_DAYS * 86400000
        )
      : Infinity;

  commits.forEach((commit, idx) => {
    if (commit.isMerge) return; // merge 提交不画叶
    const placement = placements.get(commit.id);
    if (!placement) return;

    const t0 = tOf(idx);
    const t1 = idx + 1 < commitCount ? tOf(idx + 1) : 1;

    const offR = seededRandom(`${seed}:${commit.id}`, 1);
    const side = offR < 0.5 ? -1 : 1;
    const offset = 8 + seededRandom(`${seed}:${commit.id}`, 2) * 14;
    const pos: [number, number] = [placement.x1 + side * offset, placement.y1 - 6];

    const typeColor = commit.type === "spec" || commit.type === "hook";
    const colorIndex = typeColor
      ? LEAF_COLOR_KIRO
      : authorColorByName.get(commit.author.name) ?? 11;

    // 落叶：其后出现沉寂期时，在沉寂区间内飘落（FR-TL-08）
    let fallAt: number | undefined;
    if (idx + 1 < commitCount) {
      const gap = commits[idx + 1].time - commit.time;
      if (gap > dormancyThreshold) {
        const fallR = seededRandom(`${seed}:${commit.id}`, 3);
        fallAt = t0 + fallR * (t1 - t0);
      }
    }

    leaves.push({
      id: `leaf-${idx}`,
      commitId: commit.id,
      pos,
      angle: seededRandom(`${seed}:${commit.id}`, 4) * Math.PI * 2,
      size: leafSizeOf(commit),
      shape: leafShapeOf(commit),
      colorIndex,
      birth: t1,
      fallAt,
    });
  });

  // 花：标签（FR-TL-07）
  model.tags.forEach((tag, i) => {
    const idx = commitIndex.get(tag.commitId);
    if (idx === undefined) return; // 标签指向未取到的提交
    const placement = placements.get(tag.commitId);
    if (!placement) return;

    const isMajor = /^v?\d+\.0(\.0)?$/.test(tag.name);
    const offR = seededRandom(`${seed}:tag:${tag.name}`, 0);
    const side = offR < 0.5 ? -1 : 1;
    flowers.push({
      id: `flower-${i}`,
      tag: tag.name,
      pos: [placement.x1 + side * (14 + offR * 20), placement.y1 - 14],
      size: isMajor ? 1.6 : 1.0,
      birth: tOf(idx),
      kind: isMajor ? "major" : "normal",
    });
  });

  // 紫花：spec:/hook: 提交的 Kiro 痕迹（FR-TL-07）
  commits.forEach((commit, idx) => {
    if (commit.type !== "spec" && commit.type !== "hook") return;
    const placement = placements.get(commit.id);
    if (!placement) return;
    flowers.push({
      id: `kiro-flower-${idx}`,
      tag: commit.message.slice(0, 12),
      pos: [placement.x1 + 10, placement.y1 - 16],
      size: 0.7,
      birth: tOf(idx) + 1 / Math.max(1, commitCount - 1),
      kind: "spec",
    });
  });

  // 嫁接：merge 提交处，从被合并支线末端到 merge 点的弧线（FR-TL-05）
  for (const lane of lanes) {
    if (lane.id === 0 || !lane.merged || !lane.mergeCommitId) continue;
    const mergeCommit = commitById.get(lane.mergeCommitId);
    const mergePlacement = placements.get(lane.mergeCommitId);
    const laneCommits = laneCommitsOf(lane);
    const branchTip = laneCommits[laneCommits.length - 1];
    const branchPlacement = branchTip ? placements.get(branchTip.id) : undefined;
    if (!mergeCommit || !mergePlacement || !branchPlacement) continue;

    const mergeIdx = commitIndex.get(lane.mergeCommitId) ?? 0;
    const bx = branchPlacement.x1;
    const by = branchPlacement.y1;
    const mx = mergePlacement.x0;
    const my = mergePlacement.y0;
    // 控制点向外凸出，形成弧线
    const cx = (bx + mx) / 2 + (bx < mx ? -30 : 30);
    const cy = Math.min(by, my) - 20;

    segments.push({
      id: `graft-${lane.id}`,
      commitId: lane.mergeCommitId,
      laneId: lane.id,
      kind: "graft",
      p0: [bx, by],
      c: [cx, cy],
      p1: [mx, my],
      w0: 2,
      w1: 1.5,
      birth: [tOf(mergeIdx), Math.min(1, tOf(mergeIdx) + 1 / Math.max(1, commitCount - 1))],
    });
  }

  // 章节（t0/t1 按提交序号）
  const chapters = model.chapters.map((ch) => ({
    title: ch.title,
    season: ch.season,
    t0: tOf(ch.startIndex),
    t1: tOf(ch.endIndex),
    dateRange: [ch.startTime, ch.endTime] as [number, number],
  }));

  // 时间映射表：分段线性（序号 → 真实时间），供字幕使用（FR-TL-09）
  const timeMap: Array<[number, number]> = commits.map((c, i) => [tOf(i), c.time]);
  if (timeMap.length === 1) timeMap.push([1, commits[0].time]);

  return {
    width,
    height,
    segments,
    leaves,
    flowers,
    chapters,
    timeMap,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 叶子形状按提交类型查表（附录 B） */
function leafShapeOf(commit: Commit): string {
  const shapes: Record<string, string> = {
    feat: "circle",
    fix: "pointed",
    docs: "long",
    refactor: "triple",
    test: "small",
    perf: "small",
    chore: "tiny",
    other: "tiny",
    revert: "withered",
    spec: "purple",
    hook: "purple",
  };
  return shapes[commit.type] || "circle";
}

/** 叶子大小按提交类型 */
function leafSizeOf(commit: Commit): number {
  const sizes: Record<string, number> = {
    feat: 1.6,
    fix: 1.4,
    docs: 1.5,
    refactor: 1.4,
    test: 1.1,
    perf: 1.2,
    chore: 1.0,
    other: 1.0,
    revert: 1.1,
    spec: 1.2,
    hook: 1.2,
  };
  return sizes[commit.type] ?? 1.4;
}
