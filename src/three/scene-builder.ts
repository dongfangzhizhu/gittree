/**
 * 三维生长场景构建（纯函数）
 *
 * 由生长模型构建三维树的几何描述：主干沿 +Y 生长并带确定性偏摆，
 * 支线以 25°–60° 仰角、绕主干交替方位角分出，叶子/果实挂在段梢。
 * 不读时钟、不用 Math.random——随机数全部来自种子 PRNG（FR-TL-01 的三维版）。
 */

import { GrowthModel, Commit } from "../core/types";
import { seededRandom } from "../layout/prng";
import {
  ThreeScene,
  SceneSegment,
  SceneLeaf,
  SceneFruit,
  Vec3,
} from "./scene-types";

/** 布局常量（与 FR-TL-02/03/04/06 对应，世界单位） */
const MAX_RISE = 820; // 树冒高度上限
const TRUNK_SEG_LEN = { min: 3, max: 40 };
const BRANCH_SEG_LEN = { min: 3, max: 55 };
const BRANCH_ANGLE_RANGE = { minDeg: 25, maxDeg: 60 }; // 支线仰角 25°–60°
const TRUNK_SWAY_DEG = 7; // 主干每段偏摆 ±7°
const BRANCH_SWAY_DEG = 5;
const MIN_BRANCH_COMMITS = 3; // 少于此数的支线不单独分枝
const THICKNESS = { base: 1.8, min: 1.5, max: 22 };

/** 叶子颜色索引 12 = 紫色（spec:/hook: 提交） */
export const LEAF_COLOR_KIRO = 12;

/** 沉寂期阈值：与 FR-GM-03 保持一致 */
const DORMANCY_MIN_DAYS = 14;
const DORMANCY_SPAN_RATIO = 0.1;

export interface SceneOptions {
  seed?: string;
}

/** 三维向量小工具（避免在纯函数层引入 three） */
function vAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function vScale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function vNorm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * 构建三维场景描述（纯函数：同一 (model, seed) 必得同一结果）
 */
export function buildScene(model: GrowthModel, options: SceneOptions = {}): ThreeScene {
  const seed = options.seed || `${model.source.owner || "x"}/${model.source.repo || "y"}`;

  if (model.commits.length === 0) {
    return {
      seed,
      segments: [],
      leaves: [],
      fruits: [],
      chapters: [],
      timeMap: [
        [0, 0],
        [1, 0],
      ],
      height: MAX_RISE,
      radius: 400,
    };
  }

  const commits = model.commits;
  const commitCount = commits.length;
  const commitById = new Map(commits.map((c) => [c.id, c]));
  const commitIndex = new Map(commits.map((c, i) => [c.id, i]));

  /** 提交序号 → 动画时间 t（按序号均匀分配） */
  const tOf = (idx: number): number =>
    commitCount <= 1 ? 0 : idx / (commitCount - 1);

  const segments: SceneSegment[] = [];
  const leaves: SceneLeaf[] = [];
  const fruits: SceneFruit[] = [];

  /** commitId → 段梢位置（挂叶子/果实用） */
  const tips = new Map<string, Vec3>();

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

  const laneCommitsOf = (lane: (typeof lanes)[number]): Commit[] =>
    lane.commitIds
      .map((id) => commitById.get(id))
      .filter((c): c is Commit => c !== undefined)
      .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  // 同一 fork 点的支线方位角交替（FR-TL-04 的三维版：左右 → 绕干交替）
  const forkSideCount = new Map<string, number>();
  const sideOf = (forkCommitId: string | null, laneId: number): number => {
    if (forkCommitId) {
      const n = forkSideCount.get(forkCommitId) || 0;
      forkSideCount.set(forkCommitId, n + 1);
      return n % 2 === 0 ? -1 : 1;
    }
    return laneId % 2 === 1 ? -1 : 1;
  };

  lanes.forEach((lane) => {
    const laneCommits = laneCommitsOf(lane);
    if (laneCommits.length === 0) return;

    const isTrunk = lane.id === 0;
    const isBranchable = isTrunk || laneCommits.length >= MIN_BRANCH_COMMITS;

    // 起点
    let p: Vec3 = [0, 0, 0];
    if (!isTrunk && lane.forkCommitId) {
      const forkTip = tips.get(lane.forkCommitId);
      if (forkTip) p = [...forkTip] as Vec3;
    }

    const segLen = isTrunk
      ? clamp(MAX_RISE / laneCommits.length, TRUNK_SEG_LEN.min, TRUNK_SEG_LEN.max)
      : clamp((MAX_RISE * 0.75) / laneCommits.length, BRANCH_SEG_LEN.min, BRANCH_SEG_LEN.max);

    // 初始方向：主干竖直向上；支线由仰角 + 方位角确定
    let dir: Vec3 = [0, 1, 0];
    if (!isTrunk) {
      const side = sideOf(lane.forkCommitId, lane.id);
      const r = seededRandom(`${seed}:lane:${lane.id}`, 0);
      const magDeg = BRANCH_ANGLE_RANGE.minDeg + r * (BRANCH_ANGLE_RANGE.maxDeg - BRANCH_ANGLE_RANGE.minDeg);
      const elevation = (magDeg * Math.PI) / 180;
      // 方位角：侧向 ±90° 为基础，加种子扰动，使支线绕主干散开
      const azimuth = (side * Math.PI) / 2 + (seededRandom(`${seed}:lane-az:${lane.id}`, 1) * 2 - 1) * 0.9;
      dir = vNorm([
        Math.cos(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.sin(azimuth) * Math.cos(elevation),
      ]);
    }

    laneCommits.forEach((commit, i) => {
      // 确定性偏摆：在垂直于当前方向的平面上扰动（FR-TL：主干 ±7°）
      const swayR = seededRandom(`${seed}:${commit.id}`, 0);
      const swayDeg = (swayR * 2 - 1) * (isTrunk ? TRUNK_SWAY_DEG : BRANCH_SWAY_DEG);
      dir = perturb(dir, swayDeg, seededRandom(`${seed}:${commit.id}`, 1) * Math.PI * 2);
      if (isTrunk) {
        // 主干保持向上生长趋势：轻度收敛水平分量（过强会把 ±7° 偏摆压成直线）
        dir = vNorm([dir[0] * 0.85, Math.max(dir[1], 0.55), dir[2] * 0.85]);
      } else {
        // 支线略向上抬，避免垂下
        dir = vNorm([dir[0], dir[1] + 0.06, dir[2]]);
      }

      const p0 = p;
      const p1 = vAdd(p0, vScale(dir, segLen));

      const globalIdx = commitIndex.get(commit.id) ?? i;
      const t0 = tOf(globalIdx);
      const t1 = globalIdx + 1 < commitCount ? tOf(globalIdx + 1) : 1;

      // 管道粗细（FR-TL-06）
      const subtree = laneCommits.length - i;
      const w0 = clamp(THICKNESS.base * Math.sqrt(subtree), THICKNESS.min, THICKNESS.max);
      const w1 = clamp(THICKNESS.base * Math.sqrt(Math.max(1, subtree - 1)), THICKNESS.min, THICKNESS.max);

      if (isBranchable) {
        segments.push({
          id: `seg-${lane.id}-${i}`,
          commitId: commit.id,
          laneId: lane.id,
          kind: isTrunk ? "trunk" : "branch",
          p0,
          p1,
          w0,
          w1,
          birth: [t0, Math.min(1, Math.max(t1, t0 + 1e-6))],
        });
      }
      tips.set(commit.id, p1);
      p = [...p1] as Vec3;
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
    const tip = tips.get(commit.id);
    if (!tip) return;

    const t0 = tOf(idx);
    const t1 = idx + 1 < commitCount ? tOf(idx + 1) : 1;

    // 叶尖偏移：以段梢为球心、向上半球随机散开
    const offR = seededRandom(`${seed}:${commit.id}`, 1);
    const offPhi = seededRandom(`${seed}:${commit.id}`, 2) * Math.PI * 2;
    const offTheta = 0.35 + seededRandom(`${seed}:${commit.id}`, 5) * 0.9; // 仰角
    const offDist = 8 + offR * 14;
    const offset: Vec3 = [
      Math.cos(offPhi) * Math.cos(offTheta) * offDist,
      Math.sin(offTheta) * offDist,
      Math.sin(offPhi) * Math.cos(offTheta) * offDist,
    ];
    const pos = vAdd(tip, offset);

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
      size: leafSizeOf(commit),
      shape: leafShapeOf(commit),
      colorIndex,
      birth: t1,
      fallAt,
      phase: (pos[0] + pos[1] + pos[2]) * 0.01,
      axis: vNorm([
        seededRandom(`${seed}:${commit.id}`, 6) * 2 - 1,
        seededRandom(`${seed}:${commit.id}`, 7) * 2 - 1,
        seededRandom(`${seed}:${commit.id}`, 8) * 2 - 1,
      ]),
    });
  });

  // 果实：标签（FR-TL-07 的三维版）
  model.tags.forEach((tag, i) => {
    const idx = commitIndex.get(tag.commitId);
    if (idx === undefined) return; // 标签指向未取到的提交
    const tip = tips.get(tag.commitId);
    if (!tip) return;

    const isMajor = /^v?\d+\.0(\.0)?$/.test(tag.name);
    const offR = seededRandom(`${seed}:tag:${tag.name}`, 0);
    const side = offR < 0.5 ? -1 : 1;
    fruits.push({
      id: `fruit-${i}`,
      label: tag.name,
      commitId: tag.commitId,
      pos: vAdd(tip, [side * (14 + offR * 20), 14 + offR * 8, (offR - 0.5) * 24]),
      size: isMajor ? 1.6 : 1.0,
      birth: tOf(idx),
      kind: isMajor ? "major" : "normal",
    });
  });

  // 紫花：spec:/hook: 提交的 Kiro 痕迹（FR-TL-07）
  commits.forEach((commit, idx) => {
    if (commit.type !== "spec" && commit.type !== "hook") return;
    const tip = tips.get(commit.id);
    if (!tip) return;
    fruits.push({
      id: `kiro-fruit-${idx}`,
      label: commit.message.slice(0, 12),
      commitId: commit.id,
      pos: vAdd(tip, [10, 16, (idx % 5) - 2]),
      size: 0.7,
      birth: tOf(idx) + 1 / Math.max(1, commitCount - 1),
      kind: "spec",
    });
  });

  // 嫁接：merge 提交处，从被合并支线末端到 merge 点的弧线（FR-TL-05）
  for (const lane of lanes) {
    if (lane.id === 0 || !lane.merged || !lane.mergeCommitId) continue;
    const mergeCommit = commitById.get(lane.mergeCommitId);
    const mergeTip = tips.get(lane.mergeCommitId);
    const laneCommits = laneCommitsOf(lane);
    const branchTipCommit = laneCommits[laneCommits.length - 1];
    const branchTip = branchTipCommit ? tips.get(branchTipCommit.id) : undefined;
    if (!mergeCommit || !mergeTip || !branchTip) continue;

    const mergeIdx = commitIndex.get(lane.mergeCommitId) ?? 0;
    // 控制点：两点中点 + 向外（远离主干轴）且向上凸出
    const mid: Vec3 = [
      (branchTip[0] + mergeTip[0]) / 2,
      (branchTip[1] + mergeTip[1]) / 2,
      (branchTip[2] + mergeTip[2]) / 2,
    ];
    const horiz = Math.hypot(mid[0], mid[2]) || 1;
    const outward: Vec3 = [mid[0] / horiz, 0, mid[2] / horiz];
    const ctrl = vAdd(vAdd(mid, vScale(outward, 60)), [0, 40, 0]);

    segments.push({
      id: `graft-${lane.id}`,
      commitId: lane.mergeCommitId,
      laneId: lane.id,
      kind: "graft",
      p0: branchTip,
      p1: mergeTip,
      ctrl,
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

  // 时间映射表：分段线性（序号 → 真实时间），供字幕使用
  const timeMap: Array<[number, number]> = commits.map((c, i) => [tOf(i), c.time]);
  if (timeMap.length === 1) timeMap.push([1, commits[0].time]);

  // 取景范围估计
  let height = 0;
  let radius = 100;
  for (const seg of segments) {
    height = Math.max(height, seg.p1[1]);
    radius = Math.max(radius, Math.hypot(seg.p1[0], seg.p1[2]));
  }
  for (const leaf of leaves) {
    height = Math.max(height, leaf.pos[1]);
    radius = Math.max(radius, Math.hypot(leaf.pos[0], leaf.pos[2]));
  }

  return {
    seed,
    segments,
    leaves,
    fruits,
    chapters,
    timeMap,
    height,
    radius,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 在垂直于 dir 的平面上，按角度扰动方向（确定性偏摆）
 */
function perturb(dir: Vec3, deg: number, spin: number): Vec3 {
  // 构造正交基
  const up: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = vNorm(cross(dir, up));
  const t2 = vNorm(cross(dir, t1));
  const a = (deg * Math.PI) / 180;
  const s = Math.sin(a);
  const offset = vAdd(vScale(t1, Math.cos(spin) * s), vScale(t2, Math.sin(spin) * s));
  return vNorm(vAdd(dir, offset));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** 叶子形状按提交类型查表（附录 B，与二维版一致） */
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
