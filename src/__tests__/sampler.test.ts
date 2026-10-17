/**
 * 采样与父节点重连测试（FR-DT-04/05）
 */

import { describe, it, expect } from "vitest";
import { sampleCommits, reconnectParents } from "../core/sampler";
import { Commit } from "../core/types";

let seq = 0;
function mk(
  time: number,
  parents: string[] = [],
  isMerge = false
): Commit {
  seq += 1;
  return {
    id: `c${String(seq).padStart(3, "0")}`,
    parents,
    author: { name: "a", login: "a" },
    time,
    message: "feat: x",
    type: "feat",
    isMerge,
  };
}

describe("sampleCommits", () => {
  it("≤ maxCount 时全部保留，采样率 1.0", () => {
    const commits = Array.from({ length: 10 }, (_, i) => mk(i));
    const { commits: out, samplingRate } = sampleCommits(commits, new Set());
    expect(out).toHaveLength(10);
    expect(samplingRate).toBe(1.0);
  });

  it("强制保留最早、最新、merge 与带标签提交", () => {
    const commits = Array.from({ length: 1000 }, (_, i) => mk(i));
    commits[500].isMerge = true; // 制造一个 merge
    const tagged = new Set([commits[300].id]);

    const { commits: out } = sampleCommits(commits, tagged, 100);
    const ids = new Set(out.map((c) => c.id));

    expect(ids.has(commits[0].id)).toBe(true); // 最早
    expect(ids.has(commits[999].id)).toBe(true); // 最新
    expect(ids.has(commits[500].id)).toBe(true); // merge
    expect(ids.has(commits[300].id)).toBe(true); // 标签
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it("采样结果按时间升序且确定", () => {
    const commits = Array.from({ length: 1000 }, (_, i) => mk(i));
    const a = sampleCommits(commits, new Set(), 100);
    const b = sampleCommits(commits, new Set(), 100);
    expect(a.commits.map((c) => c.id)).toEqual(b.commits.map((c) => c.id));
    for (let i = 1; i < a.commits.length; i++) {
      expect(a.commits[i].time).toBeGreaterThanOrEqual(a.commits[i - 1].time);
    }
  });
});

describe("reconnectParents", () => {
  it("parents 指向最近的保留祖先", () => {
    // 链: c1 <- c2 <- c3 <- c4 <- c5，保留 c1 与 c5
    const c1 = mk(1);
    const c2 = mk(2, [c1.id]);
    const c3 = mk(3, [c2.id]);
    const c4 = mk(4, [c3.id]);
    const c5 = mk(5, [c4.id]);
    const all = [c1, c2, c3, c4, c5];
    const sampled = [c1, c5];

    const out = reconnectParents(sampled, all);
    const c5out = out.find((c) => c.id === c5.id)!;
    expect(c5out.parents).toEqual([c1.id]);
    const c1out = out.find((c) => c.id === c1.id)!;
    expect(c1out.parents).toEqual([]);
  });

  it("等距取页造成空洞时，连接到时间上更早的保留提交", () => {
    const c1 = mk(1);
    const c2 = mk(2, [c1.id]);
    const c3 = mk(3, [c2.id]);
    const c4 = mk(4, [c3.id]);
    // c4 的父链全部被丢弃, 且 c4 不是第一个
    const out = reconnectParents([c1, c4], [c1, c2, c3, c4]);
    const c4out = out.find((c) => c.id === c4.id)!;
    expect(c4out.parents).toEqual([c1.id]);
  });

  it("最早的提交为根", () => {
    const c1 = mk(1);
    const out = reconnectParents([c1], [c1]);
    expect(out[0].parents).toEqual([]);
  });

  it("重连后不修改原数组", () => {
    const c1 = mk(1);
    const c2 = mk(2, [c1.id]);
    const before = JSON.stringify(c2);
    reconnectParents([c1, c2], [c1, c2]);
    expect(JSON.stringify(c2)).toBe(before);
  });
});
