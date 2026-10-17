/**
 * 三维场景描述类型（纯数据，无 three.js 依赖）
 * scene-builder 产出，three-renderer 消费；
 * 所有坐标均为世界单位（Y 轴向上，树根在原点）。
 */

export type Vec3 = [number, number, number];

/** 树枝段（主干 / 支线 / 嫁接弧） */
export interface SceneSegment {
  id: string;
  commitId: string;
  /** 所属 lane（主干为 0；调试与统计用） */
  laneId?: number;
  kind: "trunk" | "branch" | "graft";
  /** 段起点（根部一侧） */
  p0: Vec3;
  /** 段终点（梢头一侧） */
  p1: Vec3;
  /** 起点半径 / 终点半径（锥形） */
  w0: number;
  w1: number;
  /** 生长时间窗口 [t0, t1] */
  birth: [number, number];
  /** 嫁接弧的二次贝塞尔控制点（仅 kind="graft"） */
  ctrl?: Vec3;
  /** 所属树索引（森林模式；单树缺省 0） */
  treeIndex?: number;
}

/** 叶子（一个非 merge 提交） */
export interface SceneLeaf {
  id: string;
  commitId: string;
  pos: Vec3;
  size: number;
  shape: string;
  colorIndex: number;
  birth: number;
  /** 落叶起始时刻（其后有沉寂期时设定） */
  fallAt?: number;
  /** 摇曳相位（确定性） */
  phase: number;
  /** 自转轴（确定性） */
  axis: Vec3;
  /** 所属树索引（森林模式；单树缺省 0） */
  treeIndex?: number;
}

/** 果实 / 花（标签或 spec/hook 痕迹） */
export interface SceneFruit {
  id: string;
  /** 标签名或提交消息前缀（信息面板显示） */
  label: string;
  commitId: string;
  pos: Vec3;
  size: number;
  birth: number;
  kind: "major" | "normal" | "spec";
  /** 所属树索引（森林模式；单树缺省 0） */
  treeIndex?: number;
}

/** 一条枝干的连续折线（渲染时生成单根管状网格，避免逐段拼接的接缝） */
export interface SceneBranch {
  laneId: number;
  kind: "trunk" | "branch";
  /** 折线点（根 → 梢），长度 = 段数 + 1 */
  points: Vec3[];
  /** 每个点的半径（与 points 等长，锥度连续） */
  radii: number[];
  /** 每段的生长时间窗口，长度 = 段数 */
  births: Array<[number, number]>;
  /** 所属树索引（森林模式；单树缺省 0） */
  treeIndex?: number;
}

export interface SceneChapter {
  title: string;
  /** 所属树索引（森林模式；单树缺省 0） */
  treeIndex?: number;
  season: string;
  t0: number;
  t1: number;
  dateRange: [number, number];
}

export interface ThreeScene {
  seed: string;
  segments: SceneSegment[];
  /** 每条 lane 一根连续管（主干/支线），渲染器据此建单根平滑网格 */
  branches: SceneBranch[];
  leaves: SceneLeaf[];
  fruits: SceneFruit[];
  chapters: SceneChapter[];
  /** 提交序号 → 动画时间 t → 真实时间 的分段线性表 */
  timeMap: Array<[number, number]>;
  /** 树冠大致高度（世界单位，供相机取景） */
  height: number;
  /** 水平半径估计（供相机取景） */
  radius: number;
}
