/**
 * 连续枝干几何测试
 * 验证：环数/半径连续性/出生时间单调/端盖索引/二分查找
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildBranchGeometry, visibleRingCount, RADIAL_SEGMENTS } from "../branch-geometry";
import { SceneBranch } from "../scene-types";

/** 一条竖直向上的直枝 */
function straightBranch(segments = 3): SceneBranch {
  const points: Array<[number, number, number]> = [];
  const radii: number[] = [];
  const births: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    points.push([0, i * 10, 0]);
    radii.push(10 - i * 1.5);
  }
  for (let i = 0; i < segments; i++) {
    births.push([i / segments, (i + 1) / segments]);
  }
  return { laneId: 0, kind: "trunk", points, radii, births };
}

describe("buildBranchGeometry", () => {
  it("少于两个点返回空几何", () => {
    const result = buildBranchGeometry({
      laneId: 0,
      kind: "trunk",
      points: [[0, 0, 0]],
      radii: [1],
      births: [],
    });
    expect(result.ringCount).toBe(0);
    expect(result.ringBirths).toHaveLength(0);
  });

  it("环数 = 段数 × 每段采样 + 1", () => {
    const result = buildBranchGeometry(straightBranch(3));
    // 3 段 × 6 环/段 + 1
    expect(result.ringCount).toBe(3 * 6 + 1);
    expect(result.ringBirths).toHaveLength(result.ringCount);
  });

  it("出生时间单调不减，首尾覆盖整段生长窗口", () => {
    const branch = straightBranch(4);
    const { ringBirths } = buildBranchGeometry(branch);
    expect(ringBirths[0]).toBeCloseTo(branch.births[0][0], 6);
    expect(ringBirths[ringBirths.length - 1]).toBeCloseTo(
      branch.births[branch.births.length - 1][1],
      6
    );
    for (let i = 1; i < ringBirths.length; i++) {
      expect(ringBirths[i]).toBeGreaterThanOrEqual(ringBirths[i - 1] - 1e-9);
    }
  });

  it("半径沿管长连续收缩（无台阶）", () => {
    const branch = straightBranch(3);
    const { geometry, ringCount } = buildBranchGeometry(branch);
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const radial = RADIAL_SEGMENTS;
    // 直枝：环上顶点到轴线的距离 = 该环半径
    const radii: number[] = [];
    for (let ring = 0; ring < ringCount; ring++) {
      const idx = ring * (radial + 1); // 第 0 个环上顶点
      const x = pos.getX(idx);
      const z = pos.getZ(idx);
      radii.push(Math.hypot(x, z));
    }
    // 严格递减且相邻差值平滑（无跳变）
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeLessThanOrEqual(radii[i - 1] + 1e-6);
      expect(radii[i - 1] - radii[i]).toBeLessThan(0.6);
    }
    expect(radii[0]).toBeCloseTo(branch.radii[0], 1);
    expect(radii[radii.length - 1]).toBeCloseTo(
      branch.radii[branch.radii.length - 1],
      1
    );
  });

  it("包含端盖索引：完整索引数大于侧壁索引数", () => {
    const result = buildBranchGeometry(straightBranch(2));
    expect(result.fullIndexCount).toBeGreaterThan(result.sideIndexCount);
    const indexCount = result.geometry.getIndex()!.count;
    expect(indexCount).toBe(result.fullIndexCount);
  });

  it("相邻环中心间距均匀（CatmullRom 等参采样，无突变）", () => {
    const branch: SceneBranch = {
      laneId: 0,
      kind: "branch",
      points: [
        [0, 0, 0],
        [10, 12, 4],
        [26, 18, -6],
        [40, 30, 2],
      ],
      radii: [8, 6, 5, 3.5],
      births: [
        [0, 0.3],
        [0.3, 0.6],
        [0.6, 1],
      ],
    };
    const { geometry, ringCount } = buildBranchGeometry(branch);
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const radial = 8;
    const centers: THREE.Vector3[] = [];
    for (let ring = 0; ring < ringCount; ring++) {
      // 取环上所有顶点的均值作为环中心
      const c = new THREE.Vector3();
      for (let j = 0; j <= radial; j++) {
        const idx = ring * (radial + 1) + j;
        c.add(new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx)));
      }
      centers.push(c.divideScalar(radial + 1));
    }
    const steps: number[] = [];
    for (let i = 1; i < centers.length; i++) {
      steps.push(centers[i].distanceTo(centers[i - 1]));
    }
    const avg = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const s of steps) {
      expect(s).toBeGreaterThan(avg * 0.4);
      expect(s).toBeLessThan(avg * 1.8);
    }
  });

  it("确定性：同一输入产出同一几何", () => {
    const a = buildBranchGeometry(straightBranch(3));
    const b = buildBranchGeometry(straightBranch(3));
    const pa = a.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pb = b.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(pa.count).toBe(pb.count);
    for (let i = 0; i < pa.count; i++) {
      expect(pa.getX(i)).toBe(pb.getX(i));
      expect(pa.getY(i)).toBe(pb.getY(i));
      expect(pa.getZ(i)).toBe(pb.getZ(i));
    }
  });
});

describe("visibleRingCount", () => {
  const births = [0, 0.1, 0.2, 0.5, 1];

  it("t 小于首环出生时间返回 0", () => {
    expect(visibleRingCount(births, -0.1)).toBe(0);
  });

  it("t 覆盖全部返回所有环", () => {
    expect(visibleRingCount(births, 1)).toBe(5);
    expect(visibleRingCount(births, 2)).toBe(5);
  });

  it("区间内返回正确个数", () => {
    expect(visibleRingCount(births, 0.2)).toBe(3);
    expect(visibleRingCount(births, 0.25)).toBe(3);
    expect(visibleRingCount(births, 0.5)).toBe(4);
  });

  it("空输入返回 0", () => {
    expect(visibleRingCount([], 0.5)).toBe(0);
  });
});
