/**
 * 三维场景构建测试（scene-builder）
 * 验证：确定性、几何量纲、时间窗口、叶子/果实派生、空数据保护
 */

import { describe, it, expect } from "vitest";
import { buildScene } from "../scene-builder";
import { buildGrowthModel } from "../../core/growth-model";
import { Commit, GrowthModel } from "../../core/types";

const DAY = 86400000;
const T0 = Date.UTC(2025, 0, 1);

function mk(
  id: string,
  day: number,
  parents: string[] = [],
  opts: { author?: string; message?: string; type?: Commit["type"] } = {}
): Commit {
  return {
    id,
    parents,
    author: { name: opts.author ?? "晓", login: "xiao" },
    time: T0 + day * DAY,
    message: opts.message ?? "feat: x",
    type: opts.type ?? "feat",
    isMerge: parents.length > 1,
  };
}

/** 构造一个带支线、合并、标签、spec 提交的模型 */
function buildTestModel(): GrowthModel {
  const commits: Commit[] = [];
  for (let i = 0; i < 12; i++) {
    commits.push(mk(`m${i}`, i * 3, i > 0 ? [`m${i - 1}`] : []));
  }
  // 合并提交 m6 并入支线
  commits.splice(6, 1, mk("m6", 18, ["m5", "b2"], { message: "Merge branch 'feature'" }));
  // 支线 b0 <- b1 <- b2，从 m3 分叉
  commits.push(mk("b0", 10, ["m3"], { author: "豪" }));
  commits.push(mk("b1", 13, ["b0"], { author: "豪" }));
  commits.push(mk("b2", 16, ["b1"], { author: "豪" }));
  // spec 痕迹提交
  commits.push(mk("s1", 20, ["m6"], { type: "spec", message: "spec: 需求定稿" }));
  commits.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  const tags = [
    { name: "v1.0.0", commit: "m2" },
    { name: "v1.0.1", commit: "m4" },
  ];
  return buildGrowthModel(commits, tags, 1);
}

describe("buildScene", () => {
  it("空模型返回空几何且不抛错", () => {
    const model = buildGrowthModel([], [], 1);
    const scene = buildScene(model);
    expect(scene.segments).toEqual([]);
    expect(scene.leaves).toEqual([]);
    expect(scene.fruits).toEqual([]);
    expect(scene.timeMap).toHaveLength(2);
  });

  it("确定性：同一模型与种子得到完全相同的场景", () => {
    const model = buildTestModel();
    const a = buildScene(model, { seed: "demo/seed" });
    const b = buildScene(model, { seed: "demo/seed" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("不同种子产生不同几何", () => {
    const model = buildTestModel();
    const a = buildScene(model, { seed: "demo/a" });
    const b = buildScene(model, { seed: "demo/b" });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("主干从原点出发且向上生长", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    const trunkSegs = scene.segments.filter((s) => s.kind === "trunk");
    expect(trunkSegs.length).toBeGreaterThan(0);
    expect(trunkSegs[0].p0).toEqual([0, 0, 0]);
    for (const seg of trunkSegs) {
      expect(seg.p1[1]).toBeGreaterThan(seg.p0[1]); // y 递增
    }
  });

  it("段梢位置随序号单调上升（同一 lane 内）", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    const trunk = scene.segments.filter((s) => s.kind === "trunk");
    for (let i = 1; i < trunk.length; i++) {
      expect(trunk[i].p0).toEqual(trunk[i - 1].p1);
    }
  });

  it("叶子数量 = 非 merge 提交数，颜色/形状按类型派生", () => {
    const model = buildTestModel();
    const scene = buildScene(model, { seed: "s" });
    const nonMerge = model.commits.filter((c) => !c.isMerge).length;
    expect(scene.leaves).toHaveLength(nonMerge);
    const specLeaf = scene.leaves.find((l) => l.commitId === "s1");
    expect(specLeaf?.shape).toBe("purple");
    expect(specLeaf?.colorIndex).toBe(12); // LEAF_COLOR_KIRO
  });

  it("果实包含全部标签；主版本标记为 major", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    const labels = scene.fruits.filter((f) => f.kind !== "spec").map((f) => f.label);
    expect(labels).toContain("v1.0.0");
    expect(labels).toContain("v1.0.1");
    const major = scene.fruits.find((f) => f.label === "v1.0.0");
    expect(major?.kind).toBe("major");
    const minor = scene.fruits.find((f) => f.label === "v1.0.1");
    expect(minor?.kind).toBe("normal");
  });

  it("spec 提交产生紫色 Kiro 果实", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    const specFruit = scene.fruits.find((f) => f.kind === "spec");
    expect(specFruit).toBeDefined();
    expect(specFruit?.commitId).toBe("s1");
  });

  it("merge 提交产生嫁接弧（graft）且带控制点", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    const grafts = scene.segments.filter((s) => s.kind === "graft");
    expect(grafts).toHaveLength(1);
    expect(grafts[0].commitId).toBe("m6");
    expect(grafts[0].ctrl).toBeDefined();
  });

  it("birth 窗口均在 [0,1] 内且 t0 <= t1", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    for (const seg of scene.segments) {
      const [t0, t1] = seg.birth;
      expect(t0).toBeGreaterThanOrEqual(0);
      expect(t1).toBeLessThanOrEqual(1);
      expect(t0).toBeLessThanOrEqual(t1);
    }
    for (const leaf of scene.leaves) {
      expect(leaf.birth).toBeGreaterThanOrEqual(0);
      expect(leaf.birth).toBeLessThanOrEqual(1);
    }
  });

  it("timeMap 覆盖 [0,1] 且时间单调不减", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    const map = scene.timeMap;
    expect(map[0][0]).toBe(0);
    expect(map[map.length - 1][0]).toBe(1);
    for (let i = 1; i < map.length; i++) {
      expect(map[i][1]).toBeGreaterThanOrEqual(map[i - 1][1]);
    }
  });

  it("锥形粗细：粗端在根部（w0 >= w1），且在常量范围内", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    for (const seg of scene.segments) {
      if (seg.kind === "graft") continue;
      expect(seg.w0).toBeGreaterThanOrEqual(seg.w1);
      expect(seg.w0).toBeLessThanOrEqual(22);
      expect(seg.w1).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("章节时间窗口与提交序号映射一致", () => {
    const model = buildTestModel();
    const scene = buildScene(model, { seed: "s" });
    const n = model.commits.length;
    for (const ch of scene.chapters) {
      expect(ch.t0).toBeGreaterThanOrEqual(0);
      expect(ch.t1).toBeLessThanOrEqual(1);
      expect(ch.t0).toBeLessThanOrEqual(ch.t1);
    }
    // 时间映射表长度 = 提交数
    expect(scene.timeMap).toHaveLength(n);
  });

  it("支线偏离主干轴（三维散开而非共面）", () => {
    const scene = buildScene(buildTestModel(), { seed: "s" });
    const branches = scene.segments.filter((s) => s.kind === "branch");
    expect(branches.length).toBeGreaterThan(0);
    // 至少存在 z 分量非零的支线方向
    const hasZ = branches.some((s) => Math.abs(s.p1[2] - s.p0[2]) > 1);
    expect(hasZ).toBe(true);
  });
});
