/**
 * 预置作品数据
 * 这里用简单的测试数据，生产环境应该从 public/presets/ 加载 JSON
 */

import { GrowthModel } from "./core/types";

/**
 * 生成测试预置数据
 */
export function generateTestPreset(): GrowthModel {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // 模拟 100 个提交的历史
  const commits = Array.from({ length: 100 }, (_, i) => ({
    id: `commit-${i}`.padEnd(40, "0"),
    parents: i > 0 ? [`commit-${i - 1}`.padEnd(40, "0")] : [],
    author: {
      name: ["Alice", "Bob", "Charlie"][i % 3],
      login: ["alice", "bob", "charlie"][i % 3],
    },
    time: now - (100 - i) * dayMs * 3,
    message: ["feat: Add new feature", "fix: Bug fix", "docs: Update README", "refactor: Cleanup code"][i % 4],
    type: ["feat", "fix", "docs", "refactor"][i % 4] as any,
    isMerge: i % 5 === 0,
  }));

  return {
    schemaVersion: 1,
    generatedAt: now,
    source: { kind: "preset", owner: "test", repo: "test-repo" },
    commits,
    lanes: [
      {
        id: 0,
        parentLane: null,
        forkCommitId: null,
        merged: true,
        commitIds: commits.map((c) => c.id),
      },
    ],
    tags: [
      { name: "v1.0.0", commitId: `commit-50`.padEnd(40, "0") },
      { name: "v1.1.0", commitId: `commit-75`.padEnd(40, "0") },
    ],
    authors: [
      { key: "alice", name: "Alice", commits: 34, firstTime: commits[0].time, lastTime: commits[99].time, colorIndex: 0 },
      { key: "bob", name: "Bob", commits: 33, firstTime: commits[0].time, lastTime: commits[99].time, colorIndex: 1 },
      { key: "charlie", name: "Charlie", commits: 33, firstTime: commits[0].time, lastTime: commits[99].time, colorIndex: 2 },
    ],
    chapters: [
      {
        title: "萌芽期",
        season: "spring",
        startIndex: 0,
        endIndex: 24,
        startTime: commits[0].time,
        endTime: commits[24].time,
      },
      {
        title: "成长期",
        season: "summer",
        startIndex: 25,
        endIndex: 74,
        startTime: commits[25].time,
        endTime: commits[74].time,
      },
      {
        title: "稳定期",
        season: "autumn",
        startIndex: 75,
        endIndex: 99,
        startTime: commits[75].time,
        endTime: commits[99].time,
      },
    ],
    stats: {
      firstTime: commits[0].time,
      lastTime: commits[99].time,
      days: 300,
      totalCommits: 100,
      contributors: 3,
      busiestDay: { date: "2026-08-15", commits: 5 },
      longestDormancy: { days: 7, from: commits[50].time, to: commits[51].time },
    },
    metadata: {
      truncated: false,
      samplingRate: 1.0,
      droppedTags: 0,
    },
  };
}

export const PRESETS = [
  {
    name: "测试项目",
    description: "演示数据",
    load: () => generateTestPreset(),
  },
];
