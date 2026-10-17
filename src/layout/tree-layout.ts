/**
 * 树形布局引擎（纯函数）
 * 无副作用，不依赖 Date.now 或 Math.random
 */

import { GrowthModel, TreeGeometry, TreeSegment, TreeLeaf } from "../core/types";
import { seededRandom } from "./prng";

export interface LayoutOptions {
  seed?: string;
  width?: number;
  height?: number;
}

/**
 * 主布局函数（纯函数）
 */
export function layout(
  model: GrowthModel,
  options: LayoutOptions = {}
): TreeGeometry {
  const { seed = `${model.source.owner}/${model.source.repo}`, width = 1920, height = 1080 } = options;

  const segments: TreeSegment[] = [];
  const leaves: TreeLeaf[] = [];
  const flowers = [];

  // 简化布局：每个提交对应一个向上的线段
  const commitCount = model.commits.length;
  const segmentHeight = Math.min(40, Math.max(3, Math.floor(820 / commitCount)));

  for (let i = 0; i < model.commits.length; i++) {
    const commit = model.commits[i];
    const t = i / Math.max(1, commitCount - 1); // 时间位置 [0, 1]

    // 主干垂直向上
    const x = width / 2 + (seededRandom(commit.id, 0) - 0.5) * 40; // 左右偏摆
    const y0 = height - 100 - i * segmentHeight;
    const y1 = y0 - segmentHeight;

    segments.push({
      id: `seg-${i}`,
      commitId: commit.id,
      laneId: 0,
      kind: "trunk",
      p0: [x, y0],
      c: [x, (y0 + y1) / 2], // 贝塞尔控制点
      p1: [x, y1],
      w0: 3,
      w1: 2,
      birth: [t, t + 1 / commitCount],
    });

    // 添加叶子
    leaves.push({
      id: `leaf-${i}`,
      commitId: commit.id,
      pos: [x + 15, y1 - 10],
      angle: seededRandom(commit.id, 1) * Math.PI * 2,
      size: 1.0,
      shape: getLeafShape(commit.type),
      colorIndex: model.authors.find((a) => a.name === commit.author.name)?.colorIndex || 11,
      birth: t + 1 / commitCount / 2,
    });
  }

  // 时间映射：线性映射
  const timeMap: Array<[number, number]> = [
    [0, model.commits[0].time],
    [1, model.commits[commitCount - 1].time],
  ];

  return {
    width,
    height,
    segments,
    leaves,
    flowers,
    chapters: model.chapters.map((ch, idx) => ({
      title: ch.title,
      season: ch.season,
      t0: ch.startIndex / commitCount,
      t1: ch.endIndex / commitCount,
      dateRange: [ch.startTime, ch.endTime],
    })),
    timeMap,
  };
}

function getLeafShape(type: string): string {
  const shapes: Record<string, string> = {
    feat: "circle",
    fix: "pointed",
    docs: "long",
    refactor: "triple",
    test: "small",
    perf: "small",
    chore: "tiny",
    other: "tiny",
    merge: "none",
    revert: "withered",
  };
  return shapes[type] || "circle";
}
