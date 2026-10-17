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
  SceneBranch,
  SceneLeaf,
  SceneFruit,
  Vec3,
} from "./scene-types";

/** 布局常量（与 FR-TL-02/03/04/06 对应，世界单位） */
const MAX_RISE = 820; // 树冒高度上限
/** 每深一级，枝条长度按此比例收缩（0.7³ ≈ 0.34） */
const BRANCH_DEPTH_SHRINK = 0.70;
/** 每深一级，目标仰角降低的度数（越深的枝越平展） */
const BRANCH_DEPTH_FLATTEN_DEG = 9;
/** 一级枝的伸展长度基准 = 树高 × 该系数（决定冠幅） */
const LIMB_LEN_RATIO = 0.55;
/** 每个提交长出的叶子数量（叶簇：单片叶太稀，看不出树冠） */
const LEAVES_PER_CLUSTER = 9;
/** 黄金角：让枝条绕主干均匀铺开，而不是挤在同一侧 */
const GOLDEN_ANGLE = 2.399963229728653;
const THICKNESS = { base: 2.2, min: 1.5, max: 30, basalFlare: 1.1, flareDecay: 50 };

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
      branches: [],
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
  const branches: SceneBranch[] = [];
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

  // 分枝层级：主干 0，直接分出的 1，二级枝 2……（越深越短、越向上，避免树冠横向无限扩张）
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const depthOf = (laneId: number): number => {
    let depth = 0;
    let cur = laneById.get(laneId);
    while (cur && cur.parentLane !== null && cur.parentLane !== undefined && depth < 6) {
      cur = laneById.get(cur.parentLane);
      depth++;
    }
    return depth;
  };

  // ==================== 1) 主干骨架 ====================
  // 主干用参数曲线生成：高度单调上升，横向按正弦缓慢摆动。
  // 随机游走式的偏摆会互相抵消，把主干画成一根笔直的杆；参数曲线则有真实树干的姿态，
  // 且相邻段严格首尾相接（p1 直接取曲线上的下一个采样点）。
  const trunkLane = lanes.find((l) => l.id === 0) ?? lanes[0];
  const trunkCommits = laneCommitsOf(trunkLane);
  const trunkCount = Math.max(1, trunkCommits.length);

  const leanAngle = seededRandom(`${seed}:trunk-lean`, 0) * Math.PI * 2;
  const leanAmp = 0.05 + seededRandom(`${seed}:trunk-lean`, 1) * 0.045;
  const leanPhase = seededRandom(`${seed}:trunk-lean`, 2) * Math.PI;
  /** 主干在高度 y 处的世界坐标（x/z 由两个正弦叠加出的缓弯决定） */
  const trunkAt = (y: number): Vec3 => {
    const u = clamp(y / MAX_RISE, 0, 1.4);
    const bend = (t: number) =>
      Math.sin(t * Math.PI * 0.85 + leanPhase) * 0.75 + Math.sin(t * Math.PI * 1.9 + leanPhase * 1.7) * 0.25;
    // 减去 y=0 处的偏移，保证主干严格从原点起笔
    const amp = leanAmp * MAX_RISE * (bend(u) - bend(0));
    // `|| 0` 把 -0 归一成 0，便于测试比较
    return [Math.cos(leanAngle) * amp || 0, y, Math.sin(leanAngle) * amp || 0];
  };

  const trunkSegLen = MAX_RISE / trunkCount;
  const trunkPoints: Vec3[] = [trunkAt(0)];
  const trunkRadii: number[] = [];
  const trunkBirths: Array<[number, number]> = [];

  for (let i = 0; i <= trunkCount; i++) {
    if (i > 0) trunkPoints.push(trunkAt(i * trunkSegLen));
  }

  trunkCommits.forEach((commit, i) => {
    const p0 = trunkPoints[i];
    const p1 = trunkPoints[i + 1];
    const globalIdx = commitIndex.get(commit.id) ?? i;
    const t0 = tOf(globalIdx);
    const t1 = globalIdx + 1 < commitCount ? tOf(globalIdx + 1) : 1;

    const subtree = trunkCount - i;
    const flare = (y: number) =>
      1 + THICKNESS.basalFlare * Math.exp(-Math.max(0, y) / THICKNESS.flareDecay);
    const w0 = clamp(THICKNESS.base * Math.sqrt(subtree), THICKNESS.min, THICKNESS.max) * flare(p0[1]);
    const w1 = clamp(THICKNESS.base * Math.sqrt(Math.max(1, subtree - 1)), THICKNESS.min, THICKNESS.max) * flare(p1[1]);

    const birth: [number, number] = [t0, Math.min(1, Math.max(t1, t0 + 1e-6))];
    segments.push({
      id: `seg-${trunkLane.id}-${i}`,
      commitId: commit.id,
      laneId: trunkLane.id,
      kind: "trunk",
      p0: [...p0] as Vec3,
      p1: [...p1] as Vec3,
      w0,
      w1,
      birth,
    });
    if (trunkRadii.length === 0) trunkRadii.push(w0);
    trunkRadii.push(w1);
    trunkBirths.push(birth);
    tips.set(commit.id, [...p1] as Vec3);
  });

  if (trunkBirths.length > 0) {
    branches.push({
      laneId: trunkLane.id,
      kind: "trunk",
      points: trunkPoints,
      radii: trunkRadii,
      births: trunkBirths,
    });
  }

  // ==================== 2) 枝条 ====================
  // 每条非主干 lane 是一根从主干（或父枝）伸出的连续弧线：
  // 起点取在主干上部（按 fork 时间换算高度），方向由仰角+黄金角方位角决定，
  // 沿二次贝塞尔弧生长，末端上拱——避免出现「笔直的针」和「贴干的芦苇」。
  const limbLanes = lanes
    .filter((lane) => lane !== trunkLane)
    .map((lane) => ({ lane, depth: depthOf(lane.id), laneCommits: laneCommitsOf(lane) }))
    .filter((it) => it.laneCommits.length > 0)
    // 父枝先建，子枝才能挂到父枝的梢部
    .sort((a, b) => a.depth - b.depth || a.lane.id - b.lane.id);

  /** 树冠包络半径：枝条末端不得超出，否则冠幅会失控 */
  const crownRadius = MAX_RISE * 0.58;

  // 一级枝在主干上的挂点高度：按 fork 时间排位次后均匀铺满树冠区。
  // 直接用 forkT 会挤在低处（多数分支都在早期分叉），留出一大截秃顶的主干。
  const primaryLanes = limbLanes
    .filter((it) => it.depth <= 1)
    .map((it) => ({
      laneId: it.lane.id,
      forkT:
        it.lane.forkCommitId && commitIndex.get(it.lane.forkCommitId) !== undefined
          ? tOf(commitIndex.get(it.lane.forkCommitId)!)
          : 0.5,
    }))
    .sort((a, b) => a.forkT - b.forkT);
  const attachYOf = new Map<number, number>();
  const CROWN_BASE = 0.3;
  const CROWN_TOP = 0.93;
  primaryLanes.forEach((item, rank) => {
    const u = primaryLanes.length <= 1 ? 0.5 : rank / (primaryLanes.length - 1);
    attachYOf.set(item.laneId, MAX_RISE * (CROWN_BASE + (CROWN_TOP - CROWN_BASE) * u));
  });

  /** 一级枝的弧线：主干上的提交没有枝条可挂叶，就把叶簇挂到最近的这根枝上 */
  const limbArcs: Array<{ attachY: number; at: (u: number) => Vec3 }> = [];

  for (const { lane, depth, laneCommits } of limbLanes) {
    // 起点
    let p: Vec3;
    if (depth <= 1) {
      p = trunkAt(attachYOf.get(lane.id) ?? MAX_RISE * 0.6);
    } else {
      const parentTip = lane.forkCommitId ? tips.get(lane.forkCommitId) : undefined;
      p = parentTip ? ([...parentTip] as Vec3) : trunkAt(MAX_RISE * 0.7);
    }

    const r0 = seededRandom(`${seed}:lane:${lane.id}`, 0);
    const heightRatio = clamp(p[1] / MAX_RISE, 0, 1);
    // 顶端优势：越高处的枝越竖直；层级越深越平展
    const elevDeg = clamp(
      58 - heightRatio * 26 - depth * BRANCH_DEPTH_FLATTEN_DEG + (r0 * 2 - 1) * 10,
      12,
      66
    );
    const elevation = (elevDeg * Math.PI) / 180;
    const azimuth =
      lane.id * GOLDEN_ANGLE + (seededRandom(`${seed}:lane-az:${lane.id}`, 1) * 2 - 1) * 0.6;
    const dir = vNorm([
      Math.cos(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.sin(azimuth) * Math.cos(elevation),
    ]);

    // 长度：提交越多越长，短枝也有可见长度；再叠一层种子扰动，避免所有枝一样长（像铁丝笼）
    const lenFactor = Math.min(1, laneCommits.length / 14);
    const length =
      MAX_RISE *
      LIMB_LEN_RATIO *
      Math.pow(BRANCH_DEPTH_SHRINK, depth) *
      (0.5 + 0.75 * lenFactor) *
      (0.72 + seededRandom(`${seed}:lane-len:${lane.id}`, 4) * 0.62);

    let tip = vAdd(p, vScale(dir, length));
    const radial = Math.hypot(tip[0], tip[2]);
    if (radial > crownRadius) {
      const k = crownRadius / radial;
      tip = [tip[0] * k, tip[1], tip[2] * k];
    }

    // 二次贝塞尔：中点向外上拱，得到自然的枝条弧线
    const ctrl: Vec3 = [
      (p[0] + tip[0]) / 2 + dir[0] * length * 0.1,
      (p[1] + tip[1]) / 2 + length * 0.16,
      (p[2] + tip[2]) / 2 + dir[2] * length * 0.1,
    ];
    const at = (u: number): Vec3 => {
      const m = 1 - u;
      return [
        m * m * p[0] + 2 * m * u * ctrl[0] + u * u * tip[0],
        m * m * p[1] + 2 * m * u * ctrl[1] + u * u * tip[1],
        m * m * p[2] + 2 * m * u * ctrl[2] + u * u * tip[2],
      ];
    };
    if (depth <= 1) limbArcs.push({ attachY: p[1], at });

    const n = laneCommits.length;
    const branchPoints: Vec3[] = [at(0)];
    const branchRadii: number[] = [];
    const branchBirths: Array<[number, number]> = [];
    /** 枝条比主干细：同一「子树提交数」下约为主干的 0.62 倍 */
    const limbThicknessScale = 0.62;

    laneCommits.forEach((commit, i) => {
      const p0 = at(i / n);
      const p1 = at((i + 1) / n);
      const globalIdx = commitIndex.get(commit.id) ?? i;
      const t0 = tOf(globalIdx);
      const t1 = globalIdx + 1 < commitCount ? tOf(globalIdx + 1) : 1;

      const subtree = n - i;
      // 枝条粗细：短枝也要有肉眼可见的径（最小 2.4 单位），否则树冠只剩一堆细线
      const w0 = clamp(THICKNESS.base * limbThicknessScale * Math.sqrt(subtree), 3, 15);
      const w1 = clamp(
        THICKNESS.base * limbThicknessScale * Math.sqrt(Math.max(1, subtree - 1)),
        3,
        15
      );
      const birth: [number, number] = [t0, Math.min(1, Math.max(t1, t0 + 1e-6))];

      segments.push({
        id: `seg-${lane.id}-${i}`,
        commitId: commit.id,
        laneId: lane.id,
        kind: "branch",
        p0,
        p1,
        w0,
        w1,
        birth,
      });
      if (branchRadii.length === 0) branchRadii.push(w0);
      branchRadii.push(w1);
      branchPoints.push(p1);
      branchBirths.push(birth);
      tips.set(commit.id, p1);
    });

    if (branchBirths.length > 0) {
      branches.push({
        laneId: lane.id,
        kind: "branch",
        points: branchPoints,
        radii: branchRadii,
        births: branchBirths,
      });
    }
  }

  // 叶子：每个非 merge 提交（FR-TL-07）
  const trunkCommitIds = new Set(trunkCommits.map((c) => c.id));
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

    // 叶簇中心
    const radial = Math.hypot(tip[0], tip[2]);
    const outX = radial > 1e-3 ? tip[0] / radial : Math.cos(idx * GOLDEN_ANGLE);
    const outZ = radial > 1e-3 ? tip[2] / radial : Math.sin(idx * GOLDEN_ANGLE);
    let center: Vec3;
    if (trunkCommitIds.has(commit.id) && limbArcs.length > 0) {
      // 主干上没有枝条，叶簇挂到高度最接近的那根枝条上——叶子绝不能悬在半空
      let best = limbArcs[0];
      for (const arc of limbArcs) {
        if (Math.abs(arc.attachY - tip[1]) < Math.abs(best.attachY - tip[1])) best = arc;
      }
      const u = 0.18 + seededRandom(`${seed}:${commit.id}`, 9) * 0.78;
      const point = best.at(u);
      center = [point[0], point[1] + 4, point[2]];
    } else {
      const push = 6 + seededRandom(`${seed}:${commit.id}`, 1) * 12;
      center = [tip[0] + outX * push, tip[1] + 4, tip[2] + outZ * push];
    }

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

    // 一簇叶子：k=0 为主叶（信息面板定位锚点），其余散布成叶团
    for (let k = 0; k < LEAVES_PER_CLUSTER; k++) {
      const r1 = seededRandom(`${seed}:${commit.id}:${k}`, 11);
      const r2 = seededRandom(`${seed}:${commit.id}:${k}`, 12);
      const r3 = seededRandom(`${seed}:${commit.id}:${k}`, 13);
      const r4 = seededRandom(`${seed}:${commit.id}:${k}`, 14);
      const dist = 3 + r1 * 9;
      const theta = Math.acos(1 - r2 * 0.85); // 偏向上半球
      const phi = k * GOLDEN_ANGLE + r3 * Math.PI;
      const pos: Vec3 =
        k === 0
          ? center
          : [
              center[0] + Math.cos(phi) * Math.sin(theta) * dist,
              center[1] + Math.cos(theta) * dist * 0.85,
              center[2] + Math.sin(phi) * Math.sin(theta) * dist,
            ];

      leaves.push({
        id: k === 0 ? `leaf-${idx}` : `leaf-${idx}-${k}`,
        commitId: commit.id,
        pos,
        size: leafSizeOf(commit) * (k === 0 ? 1 : 0.72 + r4 * 0.42),
        shape: leafShapeOf(commit),
        colorIndex,
        birth: t1,
        fallAt,
        phase: (pos[0] + pos[1] + pos[2]) * 0.01,
        axis: vNorm([
          seededRandom(`${seed}:${commit.id}:${k}`, 6) * 2 - 1,
          seededRandom(`${seed}:${commit.id}:${k}`, 7) * 2 - 1,
          seededRandom(`${seed}:${commit.id}:${k}`, 8) * 2 - 1,
        ]),
      });
    }
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
    branches,
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
