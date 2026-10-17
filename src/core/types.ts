/**
 * 代码年轮 - 核心数据类型定义
 * 无 DOM 依赖，支持 Node.js 复用
 */

export type CommitType = 
  | "feat" 
  | "fix" 
  | "docs" 
  | "refactor" 
  | "test" 
  | "perf" 
  | "chore" 
  | "merge" 
  | "revert" 
  | "spec" 
  | "hook" 
  | "other";

/** 单个提交 */
export interface Commit {
  id: string;                           // SHA-1 commit hash
  parents: string[];                    // 父提交 ID 列表（采样后重连）
  author: { name: string; login?: string };
  time: number;                         // Unix ms, UTC 升序排列
  message: string;                      // 首行，≤200 字符
  type: CommitType;
  isMerge: boolean;                     // parents.length > 1
  weight?: number;                      // P2 才填充（行数）
  filesChanged?: number;                // P2 才填充
}

/** 主干与支线 */
export interface Lane {
  id: number;
  parentLane: number | null;
  forkCommitId: string | null;
  mergeCommitId?: string;
  merged: boolean;
  commitIds: string[];
}

/** 标签 */
export interface Tag {
  name: string;
  commitId: string;
}

/** 作者统计 */
export interface AuthorStat {
  key: string;
  name: string;
  commits: number;
  firstTime: number;
  lastTime: number;
  colorIndex: number;
}

/** 章节 */
export interface Chapter {
  title: string;
  season: "spring" | "summer" | "autumn" | "winter";
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
}

/** 统计数据 */
export interface Stats {
  firstTime: number;
  lastTime: number;
  days: number;
  totalCommits: number;
  contributors: number;
  busiestDay: { date: string; commits: number };
  longestDormancy: { days: number; from: number; to: number };
}

/** 完整生长模型 */
export interface GrowthModel {
  schemaVersion: number;
  generatedAt: number;
  source: { kind: "github" | "local" | "preset"; owner?: string; repo?: string; defaultBranch?: string };
  commits: Commit[];
  lanes: Lane[];
  tags: Tag[];
  authors: AuthorStat[];
  chapters: Chapter[];
  stats: Stats;
  metadata: { truncated: boolean; estimatedTotal?: number; samplingRate: number; droppedTags: number };
}

/** 原始 GitHub 数据 */
export interface RawHistory {
  commits: Array<{
    sha: string;
    parents: string[];
    author: { name: string; login?: string };
    date: string;
    message: string;
  }>;
  tags: Array<{ name: string; commit: string }>;
  metadata: {
    truncated: boolean;
    estimatedTotal?: number;
    droppedTags: number;
  };
}

/** 数据源接口 */
export interface HistorySource {
  load(input: string, options: { token?: string }, signal: AbortSignal): Promise<RawHistory>;
}
