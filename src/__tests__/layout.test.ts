/**
 * 布局引擎测试：确定性、纯度、分支结构（FR-TL-01/03/04/11）
 */

import { describe, it, expect } from "vitest";
import { layout } from "../layout/tree-layout";
import { buildGrowthModel } from "../core/growth-model";
import { normalizeCommits } from "../core/normalize";
import { Commit, GrowthModel, RawHistory } from "../core/types";

const DAY = 86400000;
const T0 = Date.UTC(2025, 0, 1);

function mk(
  id: string,
  day: number,
  parents: string[] = [],
  type: Commit["type"] = "feat",
  author = "晓"
): Commit {
  return {
    id,
    parents,
    author: { name: author, login: author },
    time: T0 + day * DAY,
    message: `${type}: x`,
    type,
    isMerge: parents.length > 1,
  };
}

/** 构造带一条已合并支线的模型（数据自洽：merge 是后续主干的祖先） */
function branchModel(): GrowthModel {
  const commits: Commit[] = [];
  // 主干 m0..m14
  for (let i = 0; i < 15; i++) commits.push(mk(`m${i}`, i * 3, i > 0 ? [`m${i - 1}`] : []));
  // 支线 b0..b5，从 m10 分叉
  for (let i = 0; i < 6; i++) {
    commits.push(mk(`b${i}`, 40 + i * 3, i === 0 ? ["m10"] : [`b${i - 1}`]));
  }
  // merge 并入支线尖端 b5
  commits.push(mk("merge", 60, ["m14", "b5"]));
  // 主干继续 m15..m29（父链穿过 merge）
  for (let i = 15; i < 30; i++) {
    commits.push(mk(`m${i}`, 63 + (i - 15) * 3, i === 15 ? ["merge"] : [`m${i - 1}`]));
  }
  const model = buildGrowthModel(commits, [{ name: "v1.0.0", commit: "m20" }], 1.0);
  model.source = { kind: "preset", owner: "t", repo: "r" };
  return model;
}

describe("layout 确定性（FR-DT-06 / FR-TL-01）", () => {
  it("同一模型同一 seed 两次布局逐字相同", () => {
    const model = branchModel();
    const g1 = layout(model, { seed: "t/r" });
    const g2 = layout(model, { seed: "t/r" });
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });

  it("不同 seed 产生不同偏摆", () => {
    const model = branchModel();
    const g1 = layout(model, { seed: "t/r" });
    const g2 = layout(model, { seed: "other/repo" });
    expect(JSON.stringify(g1)).not.toBe(JSON.stringify(g2));
  });

  it("预置管线（normalize→model→layout）可复现", () => {
    const raw: RawHistory = {
      commits: Array.from({ length: 40 }, (_, i) => ({
        sha: `s${i}`,
        parents: i > 0 ? [`s${i - 1}`] : [],
        author: { name: "晓" },
        date: new Date(T0 + i * DAY).toISOString(),
        message: "feat: x",
      })),
      tags: [],
      metadata: { truncated: false, droppedTags: 0 },
    };
    const run = () => {
      const model = buildGrowthModel(normalizeCommits(raw), [], 1.0);
      return JSON.stringify(layout(model, { seed: "o/r" }));
    };
    expect(run()).toBe(run());
  });
});

describe("layout 结构（FR-TL-03/04/06/07）", () => {
  const model = branchModel();
  const geo = layout(model, { seed: "t/r" });

  it("空模型返回空几何且不崩溃", () => {
    const empty = buildGrowthModel([], [], 1.0);
    const g = layout(empty, { seed: "x" });
    expect(g.segments).toEqual([]);
    expect(g.leaves).toEqual([]);
    expect(g.timeMap.length).toBeGreaterThan(0);
  });

  it("主干线段存在且 kind=trunk", () => {
    const trunk = geo.segments.filter((s) => s.kind === "trunk");
    expect(trunk.length).toBeGreaterThan(0);
  });

  it("支线生成 branch 线段与 graft 嫁接", () => {
    const branches = geo.segments.filter((s) => s.kind === "branch");
    const grafts = geo.segments.filter((s) => s.kind === "graft");
    expect(branches.length).toBe(6); // 6 个支线提交
    expect(grafts.length).toBe(1); // 1 个 merge
  });

  it("thickness 在 [1.5, 22] 且向梢变细", () => {
    for (const seg of geo.segments) {
      expect(seg.w0).toBeGreaterThanOrEqual(1.5);
      expect(seg.w0).toBeLessThanOrEqual(22);
      expect(seg.w1).toBeLessThanOrEqual(seg.w0);
    }
    // 主干第一段（最旧）应显著粗于最后一段
    const trunk = geo.segments.filter((s) => s.kind === "trunk");
    expect(trunk[0].w0).toBeGreaterThan(trunk[trunk.length - 1].w0);
  });

  it("merge 提交不生成叶子", () => {
    const mergeId = "merge";
    expect(geo.leaves.some((l) => l.commitId === mergeId)).toBe(false);
  });

  it("标签生成花，主版本为大花", () => {
    const major = geo.flowers.filter((f) => f.kind === "major");
    expect(major.length).toBe(1); // v1.0.0
    expect(major[0].tag).toBe("v1.0.0");
  });

  it("spec/hook 提交生成紫色花", () => {
    const commits = [mk("s1", 1, [], "spec"), mk("s2", 2, ["s1"], "hook"), mk("s3", 3, ["s2"])];
    const m = buildGrowthModel(commits, [], 1.0);
    const g = layout(m, { seed: "x" });
    const purple = g.flowers.filter((f) => f.kind === "spec");
    expect(purple.length).toBe(2);
  });

  it("坐标范围合规（FR-TL-02）", () => {
    for (const seg of geo.segments) {
      for (const [x, y] of [seg.p0, seg.p1]) {
        expect(x).toBeGreaterThanOrEqual(80);
        expect(x).toBeLessThanOrEqual(1840);
        expect(y).toBeGreaterThanOrEqual(180);
        expect(y).toBeLessThanOrEqual(1040);
      }
    }
  });

  it("timeMap 单调递增，覆盖 [0,1]", () => {
    expect(geo.timeMap[0][0]).toBe(0);
    expect(geo.timeMap[geo.timeMap.length - 1][0]).toBe(1);
    for (let i = 1; i < geo.timeMap.length; i++) {
      expect(geo.timeMap[i][1]).toBeGreaterThanOrEqual(geo.timeMap[i - 1][1]);
    }
  });

  it("birth 时间都在 [0,1] 且 t0 <= t1", () => {
    for (const seg of geo.segments) {
      const [t0, t1] = seg.birth;
      expect(t0).toBeGreaterThanOrEqual(0);
      expect(t1).toBeLessThanOrEqual(1);
      expect(t1).toBeGreaterThanOrEqual(t0);
    }
    for (const leaf of geo.leaves) {
      expect(leaf.birth).toBeGreaterThanOrEqual(0);
      expect(leaf.birth).toBeLessThanOrEqual(1);
    }
  });
});
