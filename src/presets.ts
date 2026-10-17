/**
 * 预置作品数据
 * 通过真实数据管线（normalize → sample → reconnect → buildGrowthModel）生成，
 * 与实时仓库使用同一结构；日期固定，保证确定性（FR-DT-06）。
 */

import { GrowthModel, RawHistory } from "./core/types";
import { normalizeCommits } from "./core/normalize";
import { sampleCommits, reconnectParents } from "./core/sampler";
import { buildGrowthModel } from "./core/growth-model";

/** 固定起点：2025-01-01T00:00:00Z（避免 Date.now() 破坏确定性） */
const EPOCH = Date.UTC(2025, 0, 1);
const DAY = 86400000;

interface RawCommit {
  sha: string;
  parents: string[];
  author: { name: string; login?: string };
  date: string;
  message: string;
}

function sha(n: number): string {
  return `c${String(n).padStart(39, "0")}`;
}

/**
 * 构造一份演示用原始历史：
 * - 100+8 个提交、3 位作者
 * - 一条 feature 分支（b0–b7）从 m40 分叉、在 m60 合并
 * - 标签 v1.0.0 / v1.1.0 / v2.0.0
 * - spec:/hook: 提交（紫色小花）
 * - m70 与 m71 之间 30 天沉寂（落叶表现）
 */
function buildDemoRawHistory(): RawHistory {
  const authors = [
    { name: "林晓", login: "linxiao" },
    { name: "阿豪", login: "ahao" },
    { name: "小满", login: "xiaoman" },
  ];
  const featMessages = [
    "feat: 新增树形布局引擎",
    "feat(canvas): 支持锥形笔触",
    "fix: 修复采样后父节点断裂",
    "docs: 补充需求规格说明",
    "refactor: 抽取纯函数渲染层",
    "test: 补充确定性单元测试",
    "perf: 布局缓存子树提交数",
    "chore: 升级构建工具链",
  ];

  const commits: RawCommit[] = [];
  const push = (n: number, parents: string[], dayOffset: number, msg: string, authorIdx: number) => {
    commits.push({
      sha: sha(n),
      parents,
      author: authors[authorIdx],
      date: new Date(EPOCH + dayOffset * DAY).toISOString(),
      message: msg,
    });
  };

  // 主干 m0..m99
  for (let i = 0; i < 100; i++) {
    const parents = i > 0 ? [sha(i - 1)] : [];
    let msg = featMessages[i % featMessages.length];
    let authorIdx = i % 3;
    // Kiro 痕迹提交
    if (i === 10) msg = "spec: 数据摄取需求定稿";
    if (i === 55) msg = "hook: PostFileSave 实装";
    if (i === 80) msg = "spec: 渲染层设计评审";
    // 合并提交 m60：并入 feature 分支
    if (i === 60) {
      commits.push({
        sha: sha(60),
        parents: [sha(59), sha(107)],
        author: authors[0],
        date: new Date(EPOCH + 180 * DAY).toISOString(),
        message: "Merge branch 'feature/leaf-shapes'",
      });
      continue;
    }
    // 沉寂期：m70 与 m71 之间隔 30 天
    const day = i <= 70 ? i * 3 : 240 + (i - 71) * 3;
    push(i, parents, day, msg, authorIdx);
  }

  // feature 分支 b0..b7（内部编号 100..107），从 m40 分叉
  for (let k = 0; k < 8; k++) {
    const parents = k > 0 ? [sha(100 + k - 1)] : [sha(40)];
    push(100 + k, parents, 125 + k * 4, `feat: 叶子形状 ${k + 1}/8`, 1);
  }

  const tags = [
    { name: "v1.0.0", commit: sha(30) },
    { name: "v1.1.0", commit: sha(60) },
    { name: "v2.0.0", commit: sha(95) },
    { name: "v1.0.1", commit: sha(45) },
  ];

  return {
    commits,
    tags,
    metadata: { truncated: false, estimatedTotal: commits.length, droppedTags: 0 },
  };
}

/**
 * 生成测试预置作品（与实时仓库同一管线）
 */
export function generateTestPreset(): GrowthModel {
  const raw = buildDemoRawHistory();
  const normalized = normalizeCommits(raw);
  const taggedIds = new Set(
    raw.tags.map((t) => t.commit).filter((id) => normalized.some((c) => c.id === id))
  );
  const { commits: sampled, samplingRate } = sampleCommits(normalized, taggedIds);
  const reconnected = reconnectParents(sampled, normalized);
  const model = buildGrowthModel(reconnected, raw.tags, samplingRate);
  model.source = { kind: "preset", owner: "gittree", repo: "demo" };
  return model;
}

export const PRESETS = [
  {
    name: "演示林",
    description: "示例数据 · 含分支与版本花",
    load: () => generateTestPreset(),
  },
];
