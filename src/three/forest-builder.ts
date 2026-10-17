/**
 * 森林场景：把多棵树合成一个可渲染场景。
 *
 * 每棵树仍由 buildScene 独立生成（保证单棵树的确定性与既有单元测试），
 * 之后沿 X 轴平移排布并打上 treeIndex，渲染层按原逻辑消费同一个 ThreeScene。
 */

import { GrowthModel } from "../core/types";
import { buildScene } from "./scene-builder";
import {
  SceneBranch,
  SceneChapter,
  SceneFruit,
  SceneLeaf,
  SceneSegment,
  ThreeScene,
  Vec3,
} from "./scene-types";

export interface ForestInput {
  model: GrowthModel;
  /** 树的名牌（三维标签、HUD） */
  label: string;
  /** 仓库全名 owner/repo（信息面板「在 GitHub 查看」用） */
  repo?: string;
  /** 随机种子；缺省用 repo */
  seed?: string;
}

export interface ForestTreeMeta {
  index: number;
  label: string;
  repo: string;
  /** 树的栽种位置（世界单位） */
  x: number;
  z: number;
  /** 该树的高度与水平半径 */
  height: number;
  radius: number;
  commits: number;
}

export interface ForestScene extends ThreeScene {
  trees: ForestTreeMeta[];
  /** 焦点树：HUD 章节与日期取它（点击树上节点会切换） */
  focusIndex: number;
}

/** 相邻两棵树的中心距 = max(该树半径 * 该系数, 最小间距) */
const TREE_GAP_RATIO = 2.2;
const MIN_GAP = 240;

function shift(p: Vec3, dx: number): Vec3 {
  return [p[0] + dx, p[1], p[2]];
}

/** 空森林（无有效数据时的兜底，渲染层会直接返回） */
function emptyForest(): ForestScene {
  return {
    seed: "empty",
    segments: [],
    branches: [],
    leaves: [],
    fruits: [],
    chapters: [],
    timeMap: [
      [0, 0],
      [1, 0],
    ],
    height: 0,
    radius: 100,
    trees: [],
    focusIndex: 0,
  };
}

/**
 * 构建森林场景。
 * gap 可显式指定（测试用），缺省按最大冠幅推导。
 */
export function buildForestScene(
  inputs: ForestInput[],
  options: { gap?: number } = {}
): ForestScene {
  if (inputs.length === 0) return emptyForest();

  const built = inputs.map((input, index) => {
    const seed =
      input.seed || input.repo || `${input.model.source.owner}/${input.model.source.repo}` || `tree-${index}`;
    return { input, index, seed, scene: buildScene(input.model, { seed }) };
  });

  const maxRadius = built.reduce((max, b) => Math.max(max, b.scene.radius, 80), 80);
  const gap = options.gap ?? Math.max(MIN_GAP, maxRadius * TREE_GAP_RATIO);
  const totalWidth = gap * (built.length - 1);
  /** 让整片森林以原点为中心 */
  const startX = -totalWidth / 2;

  const segments: SceneSegment[] = [];
  const branches: SceneBranch[] = [];
  const leaves: SceneLeaf[] = [];
  const fruits: SceneFruit[] = [];
  const chapters: SceneChapter[] = [];
  const trees: ForestTreeMeta[] = [];

  let height = 0;
  let radius = 100;

  for (const { input, index, scene } of built) {
    const x = startX + index * gap;
    const z = 0;

    for (const seg of scene.segments) {
      segments.push({
        ...seg,
        id: `${index}-${seg.id}`,
        p0: shift(seg.p0, x),
        p1: shift(seg.p1, x),
        ctrl: seg.ctrl ? shift(seg.ctrl, x) : undefined,
        treeIndex: index,
      });
    }

    for (const branch of scene.branches) {
      branches.push({
        ...branch,
        points: branch.points.map((p) => shift(p, x)),
        treeIndex: index,
      });
    }

    for (const leaf of scene.leaves) {
      leaves.push({
        ...leaf,
        id: `${index}-${leaf.id}`,
        pos: shift(leaf.pos, x),
        treeIndex: index,
      });
    }

    for (const fruit of scene.fruits) {
      fruits.push({
        ...fruit,
        id: `${index}-${fruit.id}`,
        pos: shift(fruit.pos, x),
        treeIndex: index,
      });
    }

    for (const ch of scene.chapters) {
      chapters.push({ ...ch, treeIndex: index });
    }

    trees.push({
      index,
      label: input.label,
      repo: input.repo ?? "",
      x,
      z,
      height: scene.height,
      radius: scene.radius,
      commits: input.model.commits.length,
    });

    height = Math.max(height, scene.height);
    radius = Math.max(radius, Math.abs(x) + scene.radius);
  }

  return {
    seed: built.map((b) => b.seed).join("+"),
    segments,
    branches,
    leaves,
    fruits,
    chapters,
    // 焦点树的日期映射；森林里 HUD 只按焦点树显示真实日期
    timeMap: built[0].scene.timeMap,
    height,
    radius,
    trees,
    focusIndex: 0,
  };
}

/** 取某棵树的元信息（越界返回 undefined） */
export function treeAt(scene: ThreeScene, index: number): ForestTreeMeta | undefined {
  const forest = scene as ForestScene;
  if (!forest.trees) return undefined;
  return forest.trees[index];
}
