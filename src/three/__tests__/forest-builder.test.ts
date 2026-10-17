/**
 * 森林场景构建测试（forest-builder）
 * 验证：空输入兜底、单树等价性、多树排布对称与不重叠、treeIndex 标注、
 *       id 唯一性、确定性，以及 treeAt 越界保护
 */

import { describe, it, expect } from "vitest";
import { buildForestScene, treeAt, ForestInput } from "../forest-builder";
import { buildScene } from "../scene-builder";
import { buildGrowthModel } from "../../core/growth-model";
import { Commit, GrowthModel } from "../../core/types";

const DAY = 86400000;
const T0 = Date.UTC(2025, 0, 1);

function mk(id: string, day: number, parents: string[] = []): Commit {
  return {
    id,
    parents,
    author: { name: "晓", login: "xiao" },
    time: T0 + day * DAY,
    message: "feat: x",
    type: "feat",
    isMerge: parents.length > 1,
  };
}

/** n 个提交的线性历史模型（n 越大树冠越大） */
function makeModel(n: number, owner = "o", repo = "r"): GrowthModel {
  const commits: Commit[] = [];
  for (let i = 0; i < n; i++) {
    commits.push(mk(`${repo}-${i}`, i * 2, i > 0 ? [`${repo}-${i - 1}`] : []));
  }
  const model = buildGrowthModel(commits, [], 1);
  model.source = { kind: "github", owner, repo };
  return model;
}

function input(model: GrowthModel, label = "t", repo = ""): ForestInput {
  return { model, label, repo, seed: label };
}

describe("buildForestScene", () => {
  it("空输入返回空森林，不抛错", () => {
    const scene = buildForestScene([]);
    expect(scene.trees).toEqual([]);
    expect(scene.segments).toEqual([]);
    expect(scene.leaves).toEqual([]);
    expect(scene.fruits).toEqual([]);
    expect(scene.height).toBe(0);
    expect(scene.focusIndex).toBe(0);
  });

  it("单棵树：与 buildScene 结果等价（数量一致、位置不偏移）", () => {
    const model = makeModel(12);
    const single = buildScene(model, { seed: "solo" });
    const scene = buildForestScene([input(model, "solo")]);

    expect(scene.trees).toHaveLength(1);
    expect(scene.trees[0].x).toBe(0);
    expect(scene.trees[0].z).toBe(0);
    expect(scene.trees[0].index).toBe(0);
    expect(scene.trees[0].commits).toBe(12);

    expect(scene.segments).toHaveLength(single.segments.length);
    expect(scene.branches).toHaveLength(single.branches.length);
    expect(scene.leaves).toHaveLength(single.leaves.length);
    expect(scene.fruits).toHaveLength(single.fruits.length);

    // 单树不偏移：坐标与独立构建一致
    expect(scene.segments[0].p0).toEqual(single.segments[0].p0);
    expect(scene.leaves[0].pos).toEqual(single.leaves[0].pos);
    // 但 id 仍带上了 treeIndex 前缀
    expect(scene.leaves[0].id).toBe(`0-${single.leaves[0].id}`);
  });

  it("多棵树沿 X 轴对称排布且互不重叠", () => {
    const scene = buildForestScene([
      input(makeModel(12), "a"),
      input(makeModel(18), "b"),
      input(makeModel(9), "c"),
    ]);

    expect(scene.trees).toHaveLength(3);
    // 整体以原点居中
    const xs = scene.trees.map((t) => t.x);
    expect(xs[0] + xs[2]).toBeCloseTo(0, 6);
    expect(xs[1]).toBeCloseTo(0, 6);
    // 单调递增
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeGreaterThan(xs[1]);

    // 相邻树间距 ≥ 两树半径之和（树冠不相交）
    for (let i = 1; i < scene.trees.length; i++) {
      const gap = scene.trees[i].x - scene.trees[i - 1].x;
      const need = scene.trees[i].radius + scene.trees[i - 1].radius;
      expect(gap).toBeGreaterThanOrEqual(need);
    }
  });

  it("每棵树的节点都带上正确的 treeIndex", () => {
    const scene = buildForestScene([input(makeModel(10), "a"), input(makeModel(10), "b")]);

    for (const leaf of scene.leaves) expect(leaf.treeIndex).toBeTypeOf("number");
    for (const fruit of scene.fruits) expect(fruit.treeIndex).toBeTypeOf("number");
    for (const seg of scene.segments) expect(seg.treeIndex).toBeTypeOf("number");
    for (const br of scene.branches) expect(br.treeIndex).toBeTypeOf("number");

    // 两棵树的节点都在，且分属 0 / 1
    const idx = new Set(scene.leaves.map((l) => l.treeIndex));
    expect(idx).toEqual(new Set([0, 1]));

    // 树 i 的节点 X 坐标都在树 i 的位置附近（平移过）
    for (const leaf of scene.leaves) {
      const tree = scene.trees[leaf.treeIndex!];
      const span = tree.radius + 200;
      expect(Math.abs(leaf.pos[0] - tree.x)).toBeLessThan(span);
    }
  });

  it("所有节点 id 全局唯一", () => {
    const scene = buildForestScene([input(makeModel(14), "a"), input(makeModel(14), "b")]);
    const ids = [
      ...scene.segments.map((s) => s.id),
      ...scene.leaves.map((l) => l.id),
      ...scene.fruits.map((f) => f.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("森林的整体半径覆盖所有树，高度取最大值", () => {
    const scene = buildForestScene([
      input(makeModel(10), "a"),
      input(makeModel(30), "b"),
      input(makeModel(10), "c"),
    ]);
    const maxR = Math.max(...scene.trees.map((t) => Math.abs(t.x) + t.radius));
    expect(scene.radius).toBeCloseTo(maxR, 6);
    expect(scene.height).toBe(Math.max(...scene.trees.map((t) => t.height)));
  });

  it("gap 可显式指定（测试与排布调试用）", () => {
    const scene = buildForestScene([input(makeModel(8), "a"), input(makeModel(8), "b")], {
      gap: 500,
    });
    expect(scene.trees[0].x).toBe(-250);
    expect(scene.trees[1].x).toBe(250);
  });

  it("同输入两次构建结果完全一致（确定性）", () => {
    const inputs = [input(makeModel(11), "a"), input(makeModel(7), "b")];
    const s1 = buildForestScene(inputs);
    const s2 = buildForestScene(inputs);
    expect(s1.trees).toEqual(s2.trees);
    expect(s1.leaves.length).toBe(s2.leaves.length);
    expect(s1.leaves[0].pos).toEqual(s2.leaves[0].pos);
    expect(s1.segments[0].id).toBe(s2.segments[0].id);
  });

  it("treeAt 按索引取树，越界返回 undefined", () => {
    const scene = buildForestScene([input(makeModel(6), "a"), input(makeModel(6), "b")]);
    expect(treeAt(scene, 0)?.label).toBe("a");
    expect(treeAt(scene, 1)?.label).toBe("b");
    expect(treeAt(scene, 2)).toBeUndefined();
    expect(treeAt(scene, -1)).toBeUndefined();
  });

  it("仓库名/default seed 让两棵同名数据的树长得一样，不同 seed 不同", () => {
    const same1 = buildForestScene([
      { model: makeModel(10, "o", "x"), label: "x", repo: "o/x" },
      { model: makeModel(10, "o", "x"), label: "x2", repo: "o/x" },
    ]);
    const diff = buildForestScene([
      { model: makeModel(10, "o", "x"), label: "x", repo: "o/x" },
      { model: makeModel(10, "o", "y"), label: "y", repo: "o/y" },
    ]);
    // 同 seed：两棵树的树冠在各自局部坐标下形状一致（高度相同）
    expect(same1.trees[0].height).toBe(same1.trees[1].height);
    expect(same1.trees[0].radius).toBe(same1.trees[1].radius);
    // 不同 seed：形状不同（半径或高度至少一项不同）
    const shapeDiffers =
      diff.trees[0].height !== diff.trees[1].height || diff.trees[0].radius !== diff.trees[1].radius;
    expect(shapeDiffers).toBe(true);
  });
});
