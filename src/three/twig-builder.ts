/**
 * 细分枝生成（思路来自 ez-tree 的递归分支）
 *
 * ez-tree 的核心是「队列式递归」：每根分支按 children/angle/start/gnarliness
 * 分出子枝，子枝再分，直到最后一层长叶子。本项目的枝干必须与 git lane
 * 一一对应（分支 = 分支），不能整棵树替换成纯程序化生成，因此这里只做
 * 「装饰性细分枝」：在已有枝干（主干 / 每条 lane）的枝身上再长出 2–4 根
 * 细枝，让树冠从「几根光秃的长弧」变成有次级结构的枝组。
 *
 * 要点（对齐 ez-tree）：
 * - start：子枝在父枝上的位置按弧长均匀铺开，带种子扰动
 * - angle：子枝相对父枝的角度，细枝更平展（与半径成反比的趋势）
 * - gnarliness：弯曲度与半径成反比（1/√r），细枝更卷；沿枝长累积偏移
 * - taper：半径从基部到梢头线性收缩
 * - seed：所有随机量来自 seededRandom，同一仓库必得同一棵树
 *
 * 纯函数、无 three 依赖，可在 Node 下单测。
 */

import { seededRandom } from "../layout/prng";
import { SceneBranch, Vec3 } from "./scene-types";

/** 父枝：一根已生成好的连续折线枝干 */
export interface TwigParent {
  points: Vec3[];
  radii: number[];
  births: Array<[number, number]>;
  laneId: number;
  /** 父枝类型（仅用于日志/调试，不影响子枝形状） */
  kind: string;
}

export interface TwigTip {
  pos: Vec3;
  /** 叶簇出生时刻（子枝长成时） */
  birth: number;
  /** 梢头半径（决定叶簇大小） */
  radius: number;
  /** 挂点对应的提交 id（叶簇点击信息用） */
  commitId?: string;
}

export interface TwigOptions {
  seed: string;
  /** 父枝上长几根子枝 */
  twigCount: number;
  /** 子枝在父枝上的起始区间（弧长比例，避开根部和梢头） */
  uRange?: [number, number];
  /** 与父枝 committed 段对齐的提交 id（按段索引） */
  parentCommitIds?: string[];
}

export interface TwigResult {
  branches: SceneBranch[];
  tips: TwigTip[];
}

/** 折线总长 */
export function polylineLength(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i]);
  }
  return total;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 按弧长参数（u ∈ [0,1]）在折线上取点 */
export function samplePolyline(points: Vec3[], u: number): Vec3 {
  const n = points.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return [...points[0]] as Vec3;
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < n; i++) {
    const l = dist(points[i - 1], points[i]);
    segs.push(l);
    total += l;
  }
  if (total < 1e-6) return [...points[n - 1]] as Vec3;
  let target = clamp01(u) * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const f = segs[i] < 1e-6 ? 0 : Math.min(1, target / segs[i]);
      const a = points[i];
      const b = points[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    target -= segs[i];
  }
  return [...points[n - 1]] as Vec3;
}

/** 折线在 u 处的切向（确定性，中心差分） */
export function sampleTangent(points: Vec3[], u: number): Vec3 {
  const a = samplePolyline(points, Math.max(0, u - 0.03));
  const b = samplePolyline(points, Math.min(1, u + 0.03));
  return normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
}

/** 半径沿折线插值 */
export function sampleRadius(radii: number[], u: number): number {
  if (radii.length === 0) return 1;
  if (radii.length === 1) return radii[0];
  const f = clamp01(u) * (radii.length - 1);
  const i = Math.min(radii.length - 2, Math.floor(f));
  const k = Math.min(1, Math.max(0, f - i));
  return radii[i] + (radii[i + 1] - radii[i]) * k;
}

/** 出生时刻沿折线插值（与 branch-geometry 的映射保持一致） */
export function sampleBirth(births: Array<[number, number]>, u: number): number {
  if (births.length === 0) return 0;
  if (births.length === 1) return births[0][0];
  const f = clamp01(u) * (births.length - 1);
  const i = Math.min(births.length - 2, Math.floor(f));
  const k = Math.min(1, Math.max(0, f - i));
  return births[i][0] + (births[i][1] - births[i][0]) * k;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** 与 dir 不平行的任意向量 */
function referenceFor(dir: Vec3): Vec3 {
  return Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
}

/**
 * 把 dir 绕「垂直于 dir 的轴」旋转 angle 弧度（azimuth 决定转到哪一侧）。
 * 与 ez-tree 里「径向角 + 分支角」的合成等效。
 */
export function tiltDirection(dir: Vec3, angle: number, azimuth: number): Vec3 {
  const t1 = normalize(cross(dir, referenceFor(dir)));
  const t2 = normalize(cross(dir, t1));
  const s = Math.sin(angle);
  const offset = add(scale(t1, Math.cos(azimuth) * s), scale(t2, Math.sin(azimuth) * s));
  return normalize(add(dir, offset));
}

/** 黄金角：让子枝绕父枝均匀铺开 */
const GOLDEN_ANGLE = 2.399963229728653;

/** 子枝相对父枝的角度范围（度）——ez-tree 的 branch.angle */
const TWIG_ANGLE_RANGE: [number, number] = [30, 62];
/** 子枝长度 = 父枝长度 × 该区间（ez-tree 的 length[level]） */
const TWIG_LEN_RATIO: [number, number] = [0.28, 0.52];
/** 子枝半径 = 父枝半径 × 该系数（ez-tree 的 radius[level]） */
const TWIG_RADIUS_RATIO = 0.52;
/** 弯曲度基准（ez-tree 的 gnarliness）：与半径成反比 */
const TWIG_GNARL = 1.5;

/**
 * 在一根父枝上长出若干子枝。
 * 子枝的出生窗口挂在父枝对应位置的时刻之后，随父枝生长依次展开。
 */
export function growTwigs(parent: TwigParent, opts: TwigOptions): TwigResult {
  const branches: SceneBranch[] = [];
  const tips: TwigTip[] = [];
  const count = Math.max(0, Math.floor(opts.twigCount));
  if (count === 0 || parent.points.length < 2) return { branches, tips };

  const parentLen = polylineLength(parent.points);
  if (parentLen < 30) return { branches, tips };

  const [uMin, uMax] = opts.uRange ?? [0.2, 0.9];
  const span = Math.max(0.02, uMax - uMin);

  for (let j = 0; j < count; j++) {
    const rnd = (k: number) => seededRandom(`${opts.seed}:twig:${parent.laneId}:${j}`, k);

    // start：沿父枝均匀铺开 + 扰动，避开根部和梢头
    const base = count === 1 ? uMin + span * 0.5 : uMin + (j / (count - 1)) * span;
    const u = Math.min(uMax, Math.max(uMin, base + (rnd(1) * 2 - 1) * span * 0.16));

    const origin = samplePolyline(parent.points, u);
    const parentDir = sampleTangent(parent.points, u);
    const parentRadius = sampleRadius(parent.radii, u);
    const tStart = sampleBirth(parent.births, u);
    // 子枝在父枝长到该位置后开始生长，跨度约为剩余动画的 1/6
    const tEnd = Math.min(1, tStart + Math.max(0.04, (1 - tStart) * 0.22));

    // angle：细枝更平展； azimuth 用黄金角铺开
    const angleDeg =
      TWIG_ANGLE_RANGE[0] +
      (TWIG_ANGLE_RANGE[1] - TWIG_ANGLE_RANGE[0]) * (0.35 + rnd(2) * 0.65) -
      Math.min(18, parentRadius * 0.25);
    const angle = (angleDeg * Math.PI) / 180;
    const azimuth = j * GOLDEN_ANGLE + (rnd(3) * 2 - 1) * 0.5;
    const dir = tiltDirection(parentDir, angle, azimuth);

    // length：与父枝同数量级但明显更短
    const length = parentLen * (TWIG_LEN_RATIO[0] + rnd(4) * (TWIG_LEN_RATIO[1] - TWIG_LEN_RATIO[0]));
    const radius = Math.max(1.5, parentRadius * (TWIG_RADIUS_RATIO + rnd(5) * 0.16));

    // gnarliness：越细越卷，偏移沿枝长累积
    const gnarl = (TWIG_GNARL / Math.sqrt(Math.max(0.6, radius))) * (0.55 + rnd(6) * 0.9);
    const perp = normalize(cross(dir, referenceFor(dir)));
    const upRef = normalize(cross(perp, dir)); // 与 dir、perp 都垂直

    const tip = add(origin, scale(dir, length));
    // 四个采样点构成二次弧：初始切向保持 dir，中段向外+向上拱，梢头继续弯
    const pts: Vec3[] = [
      origin,
      add(add(origin, scale(dir, length * 0.34)), add(scale(perp, gnarl * length * 0.05), scale(upRef, length * 0.035))),
      add(add(origin, scale(dir, length * 0.68)), add(scale(perp, gnarl * length * 0.16), scale(upRef, length * 0.1))),
      add(tip, scale(perp, gnarl * length * 0.1)),
    ];
    const radii = [radius, radius * 0.84, radius * 0.62, radius * 0.34];

    // 每段的出生窗口：把 [tStart, tEnd] 均分到 3 段
    const births: Array<[number, number]> = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const b0 = tStart + ((tEnd - tStart) * s) / (pts.length - 1);
      const b1 = tStart + ((tEnd - tStart) * (s + 1)) / (pts.length - 1);
      births.push([b0, Math.max(b1, b0 + 1e-6)]);
    }

    branches.push({
      laneId: parent.laneId,
      kind: "twig",
      points: pts,
      radii,
      births,
    });

    const commitIdx = opts.parentCommitIds
      ? Math.min(
          opts.parentCommitIds.length - 1,
          Math.max(0, Math.floor(u * Math.max(1, opts.parentCommitIds.length - 1)))
        )
      : -1;
    tips.push({
      pos: pts[pts.length - 1],
      birth: tEnd,
      radius,
      commitId: commitIdx >= 0 ? opts.parentCommitIds?.[commitIdx] : undefined,
    });
  }

  return { branches, tips };
}
