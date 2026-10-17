/**
 * Canvas 渲染器测试：纯函数确定性（同一 geometry/t/opts → 同一调用序列）
 * 以及输入解析测试。
 */

import { describe, it, expect } from "vitest";
import { renderFrame } from "../rendering/canvas-renderer";
import { layout } from "../layout/tree-layout";
import { buildGrowthModel } from "../core/growth-model";
import { Commit, GrowthModel } from "../core/types";
import { parseGitHubInput } from "../core/input-parser";

const DAY = 86400000;
const T0 = Date.UTC(2025, 0, 1);

function mk(id: string, day: number, parents: string[] = []): Commit {
  return {
    id,
    parents,
    author: { name: "晓", login: "xiao" },
    time: T0 + day * DAY,
    message: "feat: x",
    type: "feat",
    isMerge: parents.length > 1,
  };
}

function demoModel(): GrowthModel {
  const commits: Commit[] = [];
  for (let i = 0; i < 30; i++) commits.push(mk(`m${i}`, i * 3));
  commits.push(mk("m1", 90, ["m29"]));
  const model = buildGrowthModel(commits, [{ name: "v1.0.0", commit: "m15" }], 1.0);
  model.source = { kind: "preset", owner: "t", repo: "r" };
  return model;
}

/** 记录型 2D 上下文 mock：按顺序记录所有调用 */
function recordingCtx() {
  const calls: string[] = [];
  const num = (v: unknown) => (typeof v === "number" ? v.toFixed(4) : String(v));
  const gradient = () => ({
    addColorStop: (offset: number, color: string) => {
      calls.push(`addColorStop(${num(offset)},${color})`);
    },
  });
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.map(num).join(",")})`);
          return gradient();
        };
      }
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.map(num).join(",")})`);
      };
    },
    set(target, prop: string, value) {
      calls.push(`set:${prop}=${num(value)}`);
      return true;
    },
  };
  const base: Record<string, unknown> = { __calls: calls };
  return new Proxy(base, handler) as unknown as CanvasRenderingContext2D & { __calls: string[] };
}

describe("renderFrame 纯函数确定性", () => {
  const model = demoModel();
  const geometry = layout(model, { seed: "t/r" });

  it("同一 (geometry, t, opts) 两次渲染调用序列逐字相同", () => {
    const ctxA = recordingCtx();
    const ctxB = recordingCtx();
    const opts = { width: 1200, height: 675, dpr: 2, theme: "dark" as const, sway: true };
    renderFrame(ctxA, geometry, 0.5, opts);
    renderFrame(ctxB, geometry, 0.5, opts);
    expect((ctxA as any).__calls.length).toBeGreaterThan(50);
    expect((ctxA as any).__calls).toEqual((ctxB as any).__calls);
  });

  it("不同 t 产生不同画面", () => {
    const ctxA = recordingCtx();
    const ctxB = recordingCtx();
    renderFrame(ctxA, geometry, 0.3, { width: 800, height: 450, dpr: 1, theme: "dark", sway: false });
    renderFrame(ctxB, geometry, 0.9, { width: 800, height: 450, dpr: 1, theme: "dark", sway: false });
    expect((ctxA as any).__calls).not.toEqual((ctxB as any).__calls);
  });

  it("t=0 时几乎不画线段（生长未开始）", () => {
    const ctx = recordingCtx();
    renderFrame(ctx, geometry, 0, { width: 800, height: 450, dpr: 1, theme: "dark", sway: false });
    const strokes = (ctx as any).__calls.filter((c: string) => c.startsWith("stroke("));
    expect(strokes.length).toBe(0);
  });

  it("t=1 时全部线段绘制完成", () => {
    const ctx = recordingCtx();
    renderFrame(ctx, geometry, 1, { width: 800, height: 450, dpr: 1, theme: "dark", sway: false });
    const strokes = (ctx as any).__calls.filter((c: string) => c.startsWith("stroke("));
    // 至少每个非零宽度段一次 stroke
    expect(strokes.length).toBeGreaterThanOrEqual(geometry.segments.length);
  });

  it("空几何不崩溃且有占位文字", () => {
    const ctx = recordingCtx();
    const empty = layout(buildGrowthModel([], [], 1.0), { seed: "x" });
    expect(() =>
      renderFrame(ctx, empty, 0.5, { width: 800, height: 450, dpr: 1, theme: "dark", sway: false })
    ).not.toThrow();
    const fills = (ctx as any).__calls.filter((c: string) => c.startsWith("fillText("));
    expect(fills.length).toBeGreaterThan(0);
  });

  it("DPR 通过 setTransform 应用", () => {
    const ctx = recordingCtx();
    renderFrame(ctx, geometry, 0.5, { width: 800, height: 450, dpr: 2, theme: "dark", sway: false });
    const calls = (ctx as any).__calls as string[];
    expect(calls.some((c) => c === "setTransform(2.0000,0.0000,0.0000,2.0000,0.0000,0.0000)")).toBe(true);
  });
});

describe("parseGitHubInput", () => {
  it("解析 owner/repo 简写", () => {
    expect(parseGitHubInput("facebook/react")).toEqual({ owner: "facebook", repo: "react" });
  });

  it("解析完整 URL（含 .git、末尾斜杠、子路径）", () => {
    expect(parseGitHubInput("https://github.com/facebook/react")).toEqual({ owner: "facebook", repo: "react" });
    expect(parseGitHubInput("https://github.com/facebook/react.git")).toEqual({ owner: "facebook", repo: "react" });
    expect(parseGitHubInput("https://github.com/facebook/react/")).toEqual({ owner: "facebook", repo: "react" });
    expect(parseGitHubInput("https://github.com/facebook/react/tree/main/src")).toEqual({ owner: "facebook", repo: "react" });
  });

  it("拒绝非 GitHub 域名", () => {
    expect(() => parseGitHubInput("https://gitlab.com/foo/bar")).toThrow();
  });

  it("拒绝无法解析的输入", () => {
    expect(() => parseGitHubInput("随便写的")).toThrow();
  });
});
