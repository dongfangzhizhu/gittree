/**
 * 生长模型测试：lane 识别、章节划分、统计（FR-GM-01/03/04/05）
 */

import { describe, it, expect } from "vitest";
import {
  identifyLanes,
  computeAuthors,
  computeChapters,
  computeStats,
  buildGrowthModel,
  isMajorVersionTag,
} from "../core/growth-model";
import { Commit } from "../core/types";
import { normalizeCommits } from "../core/normalize";
import { RawHistory } from "../core/types";

const DAY = 86400000;
const T0 = Date.UTC(2025, 0, 1);

function mk(
  id: string,
  day: number,
  parents: string[] = [],
  opts: { author?: string; login?: string; message?: string; type?: Commit["type"] } = {}
): Commit {
  return {
    id,
    parents,
    author: { name: opts.author ?? "晓", login: opts.login ?? "xiao" },
    time: T0 + day * DAY,
    message: opts.message ?? "feat: x",
    type: opts.type ?? "feat",
    isMerge: parents.length > 1,
  };
}

describe("identifyLanes", () => {
  it("空输入返回空", () => {
    expect(identifyLanes([])).toEqual([]);
  });

  it("线性历史只有主干，commitIds 时间升序", () => {
    const commits = [mk("a", 1), mk("b", 2, ["a"]), mk("c", 3, ["b"])];
    const lanes = identifyLanes(commits);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe(0);
    expect(lanes[0].commitIds).toEqual(["a", "b", "c"]);
  });

  it("merge 的第二父节点形成支线，forkCommitId 为分叉点", () => {
    // 主干 a <- b <- m(merge)；支线 x <- y，从 a 分叉，y 并入 m
    const a = mk("a", 1);
    const x = mk("x", 2, ["a"]);
    const y = mk("y", 3, ["x"]);
    const b = mk("b", 4, ["a"]);
    const m = mk("m", 5, ["b", "y"]);
    const commits = [a, x, y, b, m];

    const lanes = identifyLanes(commits);
    expect(lanes).toHaveLength(2);

    const trunk = lanes[0];
    expect(trunk.commitIds).toEqual(["a", "b", "m"]);

    const branch = lanes[1];
    expect(branch.commitIds).toEqual(["x", "y"]);
    expect(branch.forkCommitId).toBe("a"); // 分叉点是 a，不是支线尖端 y
    expect(branch.mergeCommitId).toBe("m");
    expect(branch.merged).toBe(true);
  });

  it("未合并的孤立支线 merged=false", () => {
    const a = mk("a", 1);
    const x = mk("x", 2, ["a"]);
    const y = mk("y", 3, ["x"]);
    const b = mk("b", 4, ["a"]);
    const commits = [a, x, y, b];

    const lanes = identifyLanes(commits);
    expect(lanes).toHaveLength(2);
    expect(lanes[1].merged).toBe(false);
    expect(lanes[1].forkCommitId).toBe("a");
    expect(lanes[1].commitIds).toEqual(["x", "y"]);
  });

  it("所有提交都被分配到某个 lane", () => {
    const a = mk("a", 1);
    const x = mk("x", 2, ["a"]);
    const y = mk("y", 3, ["x"]);
    const b = mk("b", 4, ["a"]);
    const m = mk("m", 5, ["b", "y"]);
    const lanes = identifyLanes([a, x, y, b, m]);
    const assigned = lanes.flatMap((l) => l.commitIds);
    expect(new Set(assigned).size).toBe(5);
    expect(assigned.length).toBe(5);
  });
});

describe("computeChapters", () => {
  const tags = [
    { name: "v1.0.0", commitId: "d" },
    { name: "v1.0.1", commitId: "e" },
  ];

  it("空输入返回空", () => {
    expect(computeChapters([], [])).toEqual([]);
  });

  it("输出 3–6 个章节", () => {
    // 400 天跨度，密度不均 + 一个 30 天沉寂 + 主版本标签
    const commits: Commit[] = [];
    for (let i = 0; i < 60; i++) {
      commits.push(mk(`m${i}`, i * 2));
    }
    for (let i = 0; i < 40; i++) {
      commits.push(mk(`n${i}`, 200 + i * 5)); // 中段稀疏
    }
    commits.push(mk("d", 120)); // 主版本标签所在
    commits.sort((a, b) => a.time - b.time);

    const chapters = computeChapters(commits, tags);
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    expect(chapters.length).toBeLessThanOrEqual(6);
    for (const ch of chapters) {
      expect(ch.title).toBeTruthy();
      expect(ch.startIndex).toBeLessThanOrEqual(ch.endIndex);
    }
  });

  it("所有时间相同 → 单章「萌芽期」", () => {
    const commits = [mk("a", 1), mk("b", 1)];
    const chapters = computeChapters(commits, []);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("萌芽期");
    expect(chapters[0].season).toBe("spring");
  });

  it("第一章为萌芽期，最后一章为当下（无主版本标签时）", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 100; i++) commits.push(mk(`m${i}`, i * 4));
    const chapters = computeChapters(commits, []);
    expect(chapters[0].title).toBe("萌芽期");
    expect(chapters[chapters.length - 1].title).toBe("当下");
  });

  it("isMajorVersionTag 识别规则", () => {
    expect(isMajorVersionTag("v1.0")).toBe(true);
    expect(isMajorVersionTag("v2.0.0")).toBe(true);
    expect(isMajorVersionTag("1.0")).toBe(true);
    expect(isMajorVersionTag("v1.0.1")).toBe(false);
    expect(isMajorVersionTag("v1.2.0")).toBe(false);
  });
});

describe("computeStats", () => {
  it("统计天数、贡献者、最活跃一天、最长沉寂", () => {
    const commits = [
      mk("a", 0, [], { login: "u1" }),
      mk("b", 1, ["a"], { login: "u1" }),
      mk("c", 1, ["b"], { login: "u2" }), // 与 b 同一天
      mk("d", 30, ["c"], { login: "u1" }), // 29 天沉寂
    ];
    const stats = computeStats(commits);
    expect(stats.days).toBe(30);
    expect(stats.totalCommits).toBe(4);
    expect(stats.contributors).toBe(2);
    expect(stats.busiestDay.commits).toBe(2);
    expect(stats.longestDormancy.days).toBe(29);
    expect(stats.longestDormancy.from).toBe(commits[2].time);
    expect(stats.longestDormancy.to).toBe(commits[3].time);
  });

  it("空输入返回零值", () => {
    const stats = computeStats([]);
    expect(stats.totalCommits).toBe(0);
    expect(stats.busiestDay.date).toBe("N/A");
  });
});

describe("computeAuthors", () => {
  it("按 login 合并同一作者，按提交数降序", () => {
    const commits = [
      mk("a", 1, [], { author: "晓", login: "xiao" }),
      mk("b", 2, ["a"], { author: "晓风", login: "xiao" }), // 同名不同 login 名
      mk("c", 3, ["b"], { author: "豪", login: "hao" }),
    ];
    const authors = computeAuthors(commits);
    expect(authors).toHaveLength(2);
    expect(authors[0].key).toBe("xiao");
    expect(authors[0].commits).toBe(2);
    expect(authors[0].colorIndex).toBe(0);
    expect(authors[1].colorIndex).toBe(1);
  });

  it("第 12 位起 colorIndex 固定为 11（其他）", () => {
    const commits = Array.from({ length: 15 }, (_, i) =>
      mk(`c${i}`, i, [`c${i - 1}`], { login: `u${i}` })
    );
    const authors = computeAuthors(commits);
    expect(authors[11].colorIndex).toBe(11);
    expect(authors[14].colorIndex).toBe(11);
  });
});

describe("buildGrowthModel 端到端", () => {
  it("从 RawHistory 产出完整模型", () => {
    const raw: RawHistory = {
      commits: [
        { sha: "a", parents: [], author: { name: "晓" }, date: new Date(T0).toISOString(), message: "feat: 初始" },
        { sha: "x", parents: ["a"], author: { name: "豪" }, date: new Date(T0 + DAY).toISOString(), message: "feat: 分支" },
        { sha: "y", parents: ["x"], author: { name: "豪" }, date: new Date(T0 + 2 * DAY).toISOString(), message: "fix: 分支修复" },
        { sha: "b", parents: ["a"], author: { name: "晓" }, date: new Date(T0 + 3 * DAY).toISOString(), message: "feat: 主干" },
        { sha: "m", parents: ["b", "y"], author: { name: "晓" }, date: new Date(T0 + 4 * DAY).toISOString(), message: "Merge branch" },
      ],
      tags: [{ name: "v1.0.0", commit: "b" }],
      metadata: { truncated: false, droppedTags: 0 },
    };

    const normalized = normalizeCommits(raw);
    const model = buildGrowthModel(normalized, raw.tags, 1.0);

    expect(model.schemaVersion).toBe(1);
    expect(model.commits).toHaveLength(5);
    expect(model.lanes).toHaveLength(2);
    expect(model.tags).toEqual([{ name: "v1.0.0", commitId: "b" }]);
    expect(model.stats.totalCommits).toBe(5);
    expect(model.chapters.length).toBeGreaterThanOrEqual(3);
    // 每个 lane 非空
    for (const lane of model.lanes) {
      expect(lane.commitIds.length).toBeGreaterThan(0);
    }
  });
});
