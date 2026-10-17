/**
 * 连续枝干几何（消除「多段圆柱拼接」的接缝）
 *
 * 每条 lane 生成一根连续的管状网格：
 * - 折线点经 CatmullRom 平滑
 * - 半径沿管长按控制点线性插值（锥度连续，无台阶）
 * - 用平行传输（parallel transport）建立标架，避免 Frenet 标架在直线段翻转
 * - 顶点法线用 computeVertexNormals 计算，环与环之间共享法线 → 无折痕
 * - 生长动画用索引缓冲的 drawRange 揭示，环序即时间序
 *
 * 纯几何代码，可在 Node 下单元测试（不需要 WebGL）。
 */

import * as THREE from "three";
import { SceneBranch } from "./scene-types";

/** 每段折线采样环数（越大越平滑） */
const RINGS_PER_SEGMENT = 6;
/** 每环径向分段数 */
const RADIAL_SEGMENTS = 8;

export interface BranchGeometryResult {
  geometry: THREE.BufferGeometry;
  /** 每个环的出生时间（升序），用于 drawRange 生长 */
  ringBirths: number[];
  /** 每环的索引数量（每段 R*6） */
  indicesPerRing: number;
  /** 环数（含首尾） */
  ringCount: number;
  /** 侧壁索引总数（不含端盖） */
  sideIndexCount: number;
  /** 含端盖的完整索引数 */
  fullIndexCount: number;
}

/**
 * 构建单条枝干的连续几何
 */
export function buildBranchGeometry(branch: SceneBranch): BranchGeometryResult {
  const pts = branch.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const radii = branch.radii;
  const segmentsCount = Math.max(1, pts.length - 1);

  // 少于两个点无法成管，返回空几何（调用方按空处理）
  if (pts.length < 2) {
    return {
      geometry: new THREE.BufferGeometry(),
      ringBirths: [],
      indicesPerRing: RADIAL_SEGMENTS * 6,
      ringCount: 0,
      sideIndexCount: 0,
      fullIndexCount: 0,
    };
  }

  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
  const S = Math.max(2, Math.round(segmentsCount * RINGS_PER_SEGMENT));
  const ringCount = S + 1;
  const radial = RADIAL_SEGMENTS;

  const positions: number[] = [];
  const indices: number[] = [];
  const ringBirths: number[] = [];

  // 平行传输标架
  let normal = new THREE.Vector3();
  let binormal = new THREE.Vector3();

  for (let i = 0; i < ringCount; i++) {
    const u = i / S;
    const pos = curve.getPoint(u);
    let tangent = curve.getTangent(u);
    if (tangent.lengthSq() < 1e-10) tangent = new THREE.Vector3(0, 1, 0);
    tangent.normalize();

    if (i === 0) {
      // 选一个与切线不平行的参考向量，构造初始标架
      const ref = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      normal = new THREE.Vector3().crossVectors(tangent, ref).normalize();
    } else {
      // 平行传输：把上一帧的法线投影到当前切线的垂直平面
      normal.sub(tangent.clone().multiplyScalar(normal.dot(tangent)));
      if (normal.lengthSq() < 1e-8) {
        const ref = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        normal = new THREE.Vector3().crossVectors(tangent, ref);
      }
      normal.normalize();
    }
    binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

    // 半径与出生时间：u → 折线段索引 → 线性插值
    const f = u * segmentsCount;
    const idx = Math.min(segmentsCount - 1, Math.floor(f));
    const frac = Math.min(1, Math.max(0, f - idx));
    const r0 = radii[idx] ?? radii[radii.length - 1] ?? 1;
    const r1 = radii[idx + 1] ?? r0;
    const radius = r0 + (r1 - r0) * frac;

    const [b0, b1] = branch.births[idx] ?? [0, 0];
    ringBirths.push(b0 + (b1 - b0) * frac);

    // 每环 radial+1 个顶点（接缝顶点重复，保证 UV/法线整洁）
    for (let j = 0; j <= radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const vx = pos.x + radius * (normal.x * cos + binormal.x * sin);
      const vy = pos.y + radius * (normal.y * cos + binormal.y * sin);
      const vz = pos.z + radius * (normal.z * cos + binormal.z * sin);
      positions.push(vx, vy, vz);
    }
  }

  // 侧面索引：按环推进，保证 drawRange 能顺序揭示
  const indicesPerRing = radial * 6;
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }
  const sideIndexCount = indices.length;

  // 端盖（追加在索引尾部，完整生长后才揭示）：根部与梢头各一个扇形
  const baseCenterIndex = positions.length / 3;
  const basePos = curve.getPoint(0);
  positions.push(basePos.x, basePos.y, basePos.z);
  const tipCenterIndex = positions.length / 3;
  const tipPos = curve.getPoint(1);
  positions.push(tipPos.x, tipPos.y, tipPos.z);

  for (let j = 0; j < radial; j++) {
    // 根部：法线朝向 −切线，环形绕序反向
    indices.push(baseCenterIndex, j + 1, j);
  }
  const tipRingStart = S * (radial + 1);
  for (let j = 0; j < radial; j++) {
    indices.push(tipCenterIndex, tipRingStart + j, tipRingStart + j + 1);
  }
  const fullIndexCount = indices.length;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return { geometry, ringBirths, indicesPerRing, ringCount, sideIndexCount, fullIndexCount };
}

/**
 * 计算某时刻应显示的环数（birth <= t 的环数）
 * ringBirths 升序，二分查找
 */
export function visibleRingCount(ringBirths: number[], t: number): number {
  if (ringBirths.length === 0) return 0;
  let lo = 0;
  let hi = ringBirths.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ringBirths[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
