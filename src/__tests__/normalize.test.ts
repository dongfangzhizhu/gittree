/**
 * 提交规范化测试（FR-DT-01/02/03）
 */

import { describe, it, expect } from "vitest";
import { normalizeCommits, detectCommitType, associateTags } from "../core/normalize";
import { RawHistory } from "../core/types";

function raw(overrides: Partial<RawHistory> = {}): RawHistory {
  return {
    commits: [],
    tags: [],
    metadata: { truncated: false, droppedTags: 0 },
    ...overrides,
  };
}

function commit(sha: string, date: string, message: string, parents: string[] = []) {
  return {
    sha,
    parents,
    author: { name: " tester " },
    date,
    message,
  };
}

describe("detectCommitType", () => {
  it("识别标准前缀（允许 scope，不区分大小写）", () => {
    expect(detectCommitType("feat: 新功能")).toBe("feat");
    expect(detectCommitType("fix(core): 修 bug")).toBe("fix");
    expect(detectCommitType("DOCS: 文档")).toBe("docs");
    expect(detectCommitType("Refactor(x): 重构")).toBe("refactor");
    expect(detectCommitType("test: 测试")).toBe("test");
    expect(detectCommitType("perf: 优化")).toBe("perf");
    expect(detectCommitType("chore: 杂项")).toBe("chore");
  });

  it("识别 Merge / Revert 前缀", () => {
    expect(detectCommitType("Merge branch 'x'")).toBe("merge");
    expect(detectCommitType('Revert "feat: x"')).toBe("revert");
  });

  it("识别本项目约定前缀 spec: / hook:", () => {
    expect(detectCommitType("spec: 需求定稿")).toBe("spec");
    expect(detectCommitType("hook: 钩子实装")).toBe("hook");
  });

  it("其余为 other", () => {
    expect(detectCommitType("随便写点什么")).toBe("other");
    expect(detectCommitType("")).toBe("other");
  });
});

describe("normalizeCommits", () => {
  it("按时间升序排序，时间相同按 id 字典序", () => {
    const r = raw({
      commits: [
        commit("b", "2025-01-02T00:00:00Z", "feat: b"),
        commit("a", "2025-01-01T00:00:00Z", "feat: a"),
        commit("c", "2025-01-01T00:00:00Z", "feat: c"),
      ],
    });
    const out = normalizeCommits(r);
    expect(out.map((c) => c.id)).toEqual(["a", "c", "b"]);
  });

  it("以 id 去重", () => {
    const r = raw({
      commits: [
        commit("a", "2025-01-01T00:00:00Z", "feat: a"),
        commit("a", "2025-01-01T00:00:00Z", "feat: a2"),
      ],
    });
    const out = normalizeCommits(r);
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe("feat: a");
  });

  it("parents.length > 1 时 type 为 merge（即使消息不是 Merge 开头）", () => {
    const r = raw({
      commits: [
        commit("p1", "2025-01-01T00:00:00Z", "feat: p1"),
        commit("p2", "2025-01-02T00:00:00Z", "feat: p2"),
        commit("m", "2025-01-03T00:00:00Z", "fix: 合并修复", ["p1", "p2"]),
      ],
    });
    const out = normalizeCommits(r);
    const merge = out.find((c) => c.id === "m")!;
    expect(merge.type).toBe("merge");
    expect(merge.isMerge).toBe(true);
  });

  it("丢弃无有效日期的提交", () => {
    const r = raw({
      commits: [
        commit("a", "2025-01-01T00:00:00Z", "feat: a"),
        commit("bad", "not-a-date", "feat: bad"),
      ],
    });
    const out = normalizeCommits(r);
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("消息截断到 200 字符", () => {
    const long = "feat: " + "x".repeat(300);
    const r = raw({ commits: [commit("a", "2025-01-01T00:00:00Z", long)] });
    const out = normalizeCommits(r);
    expect(out[0].message).toHaveLength(200);
  });
});

describe("associateTags", () => {
  it("仅保留指向已取提交的标签（FR-IN-04）", () => {
    const commits = normalizeCommits(
      raw({ commits: [commit("a", "2025-01-01T00:00:00Z", "feat: a")] })
    );
    const map = associateTags(commits, [
      { name: "v1.0.0", commit: "a" },
      { name: "v9.9.9", commit: "missing" },
    ]);
    expect(map.get("a")).toEqual(["v1.0.0"]);
    expect(map.has("missing")).toBe(false);
  });
});
