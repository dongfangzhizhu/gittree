import { describe, it, expect } from "vitest";
import { PerfMonitor, qualityLabel, QualityLevel } from "../perf-monitor";

/**
 * 构造一段稳定的帧序列：每帧间隔 frameMs 毫秒
 */
function feed(monitor: PerfMonitor, frameMs: number, count: number, startAt = 0): number {
  let now = startAt;
  for (let i = 0; i < count; i++) {
    now += frameMs;
    monitor.sample(now);
  }
  return now;
}

/** 触发一次降级所需的帧数（预热 + 连续 strikeLimit 个完整窗口） */
function framesNeededToDowngrade(): number {
  const warmup = 12;
  const windows = 2;
  const perWindow = 45;
  return warmup + windows * perWindow + 1;
}

describe("PerfMonitor", () => {
  it("默认从高画质开始", () => {
    const m = new PerfMonitor();
    expect(m.getLevel()).toBe("high");
    expect(m.getFps()).toBe(0);
    expect(m.hasDowngraded()).toBe(false);
  });

  it("稳定 60fps 不降级", () => {
    const changes: QualityLevel[] = [];
    const m = new PerfMonitor({ onLevelChange: (l) => changes.push(l) });
    feed(m, 1000 / 60, 400);
    expect(m.getLevel()).toBe("high");
    expect(changes).toEqual([]);
    expect(m.getFps()).toBeGreaterThan(55);
  });

  it("持续低帧率会逐级降档，且每档只降一次", () => {
    const changes: QualityLevel[] = [];
    const reasons: string[] = [];
    const m = new PerfMonitor({
      onLevelChange: (l, r) => {
        changes.push(l);
        reasons.push(r);
      },
    });
    // 一直喂 20fps（50ms/帧）：high → medium → low，然后停在 low
    feed(m, 50, framesNeededToDowngrade() * 3);
    expect(changes).toEqual(["medium", "low"]);
    expect(m.getLevel()).toBe("low");
    expect(m.hasDowngraded()).toBe(true);
    expect(reasons[0]).toMatch(/帧率/);
  });

  it("单次卡顿（窗口内只有一两个坏帧）不会降级", () => {
    const changes: QualityLevel[] = [];
    const m = new PerfMonitor({ onLevelChange: (l) => changes.push(l) });
    // 60fps 跑满预热，然后来 3 帧 50ms 的坏帧，再回到 60fps
    feed(m, 1000 / 60, 20);
    feed(m, 50, 3);
    feed(m, 1000 / 60, 200);
    expect(m.getLevel()).toBe("high");
    expect(changes).toEqual([]);
  });

  it("超过 maxFrameMs 的间隔被当作停顿剔除，不算低帧率", () => {
    const changes: QualityLevel[] = [];
    const m = new PerfMonitor({ onLevelChange: (l) => changes.push(l) });
    // 切后台：每次间隔 5 秒（远超 260ms 阈值）
    feed(m, 5000, 300);
    expect(m.getLevel()).toBe("high");
    expect(changes).toEqual([]);
    expect(m.stats().stalls).toBeGreaterThan(0);
  });

  it("降档后有冷却期，不会一帧内连降多级", () => {
    const changes: QualityLevel[] = [];
    const m = new PerfMonitor({
      cooldownMs: 100000, // 冷却期拉长到几乎不可能结束
      onLevelChange: (l) => changes.push(l),
    });
    feed(m, 50, framesNeededToDowngrade() * 5);
    expect(changes).toEqual(["medium"]);
    expect(m.getLevel()).toBe("medium");
  });

  it("已在最低档时不再变化", () => {
    const changes: QualityLevel[] = [];
    const m = new PerfMonitor({ onLevelChange: (l) => changes.push(l) });
    m.setLevel("low", "测试");
    feed(m, 200, 1000); // 5fps，烂到极点
    expect(changes).toEqual(["low"]); // 只有手动那一次
    expect(m.getLevel()).toBe("low");
  });

  it("手动 setLevel 立即生效并回调，不受冷却限制", () => {
    const changes: Array<{ level: QualityLevel; reason: string }> = [];
    const m = new PerfMonitor({
      onLevelChange: (l, r) => changes.push({ level: l, reason: r }),
    });
    m.setLevel("medium", "手动切换");
    m.setLevel("high", "手动切回");
    expect(changes).toEqual([
      { level: "medium", reason: "手动切换" },
      { level: "high", reason: "手动切回" },
    ]);
    expect(m.getLevel()).toBe("high");
  });

  it("setLevel 设为相同档位不触发回调", () => {
    const changes: QualityLevel[] = [];
    const m = new PerfMonitor({ onLevelChange: (l) => changes.push(l) });
    m.setLevel("high", "无变化");
    expect(changes).toEqual([]);
  });

  it("reset() 清空统计但保留档位", () => {
    const m = new PerfMonitor();
    m.setLevel("low", "测试");
    feed(m, 50, framesNeededToDowngrade());
    m.reset();
    expect(m.getLevel()).toBe("low"); // 档位不倒退
    expect(m.getFps()).toBe(0);
    expect(m.stats().strikes).toBe(0);
  });

  it("阈值判定：47fps 以下算不达标，55fps 算达标", () => {
    const low = new PerfMonitor({ targetFps: 60 });
    feed(low, 1000 / 46, 200);
    expect(low.stats().strikes).toBeGreaterThan(0);

    const ok = new PerfMonitor({ targetFps: 60 });
    feed(ok, 1000 / 55, 200);
    expect(ok.stats().strikes).toBe(0);
  });

  it("fps 读数随帧间隔变化", () => {
    const m = new PerfMonitor();
    feed(m, 1000 / 60, 100);
    const fast = m.getFps();
    feed(m, 1000 / 20, 100);
    const slow = m.getFps();
    expect(slow).toBeLessThan(fast);
  });

  it("同一时刻重复采样（delta <= 0）被忽略", () => {
    const m = new PerfMonitor();
    m.sample(100);
    m.sample(100);
    m.sample(100);
    feed(m, 1000 / 60, 100);
    expect(m.getFps()).toBeGreaterThan(50);
  });

  it("qualityLabel 覆盖全部档位", () => {
    expect(qualityLabel("high")).toMatch(/高/);
    expect(qualityLabel("medium")).toBeTruthy();
    expect(qualityLabel("low")).toBeTruthy();
  });
});
