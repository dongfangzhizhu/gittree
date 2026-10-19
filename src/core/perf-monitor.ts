/**
 * 帧率监测与自动画质降级
 *
 * 设计原则：
 * - 纯逻辑、无 DOM 依赖 → 可单测（只依赖 performance.now，由调用方喂进来）
 * - 只降不升：避免在阈值附近来回抖动造成「画质跳舞」；用户可在 UI 手动切回高档
 * - 防抖：连续多个统计窗口不达标 + 冷却期，才真正降一档
 * - 剔除停顿：帧间隔 > maxFrameMs 的（切后台、GC、着色器编译）不计入统计，
 *   否则一回到前台就会被误判为「卡顿」而莫名降档
 */

export type QualityLevel = "high" | "medium" | "low";

/** 档位从高到低 */
const LADDER: QualityLevel[] = ["high", "medium", "low"];

export interface PerfMonitorOptions {
  /** 目标帧率（默认 60） */
  targetFps?: number;
  /** 单个统计窗口的帧数（默认 45，60fps 下约 0.75 秒） */
  windowFrames?: number;
  /** 连续多少个窗口不达标才降级（默认 2） */
  strikeLimit?: number;
  /** 两次降级之间的最小间隔 ms（默认 4000） */
  cooldownMs?: number;
  /** 帧间隔超过该值视为停顿，不计入统计（默认 260ms） */
  maxFrameMs?: number;
  /** 开头的预热帧数：着色器编译/首帧上传会拖慢前几帧，不采样（默认 12） */
  warmupFrames?: number;
  /** 档位变化回调（自动降级或手动设置时触发） */
  onLevelChange?: (level: QualityLevel, reason: string) => void;
}

export class PerfMonitor {
  private targetFps: number;
  private windowFrames: number;
  private strikeLimit: number;
  private cooldownMs: number;
  private maxFrameMs: number;
  private warmupFrames: number;
  private onLevelChange?: (level: QualityLevel, reason: string) => void;

  private level: QualityLevel = "high";
  private lastNow: number | null = null;
  private frames = 0;
  private totalMs = 0;
  private strikes = 0;
  private warmup = 0;
  private lastChangeAt = -Infinity;
  private fps = 0;
  /** 累计被剔除的停顿帧数（调试用） */
  private stalls = 0;

  constructor(options: PerfMonitorOptions = {}) {
    this.targetFps = options.targetFps ?? 60;
    this.windowFrames = options.windowFrames ?? 45;
    this.strikeLimit = options.strikeLimit ?? 2;
    this.cooldownMs = options.cooldownMs ?? 4000;
    this.maxFrameMs = options.maxFrameMs ?? 260;
    this.warmupFrames = options.warmupFrames ?? 12;
    this.onLevelChange = options.onLevelChange;
  }

  /** 喂入一帧的时间戳（performance.now()） */
  sample(now: number): void {
    const prev = this.lastNow;
    this.lastNow = now;
    if (prev === null) return;

    const delta = now - prev;
    if (delta <= 0) return;
    if (delta > this.maxFrameMs) {
      // 停顿帧：重置当前窗口，避免把「切后台的时间」算成低帧率
      this.stalls++;
      this.frames = 0;
      this.totalMs = 0;
      return;
    }
    if (this.warmup < this.warmupFrames) {
      this.warmup++;
      return;
    }

    this.frames++;
    this.totalMs += delta;
    if (this.frames < this.windowFrames) return;

    this.evaluateWindow(now);
    this.frames = 0;
    this.totalMs = 0;
  }

  /** 窗口结算：均帧 → fps → 达标判定 */
  private evaluateWindow(now: number): void {
    const avg = this.totalMs / this.frames;
    // 指数平滑，避免 fps 读数跳变
    this.fps = this.fps === 0 ? 1000 / avg : this.fps * 0.6 + (1000 / avg) * 0.4;

    const threshold = this.targetFps * 0.78;
    if (this.fps < threshold) {
      this.strikes++;
    } else {
      this.strikes = 0;
      return;
    }
    if (this.strikes < this.strikeLimit) return;
    if (now - this.lastChangeAt < this.cooldownMs) return;
    this.downgrade(now, this.fps);
  }

  /** 降一档；已在最低档则什么都不做 */
  private downgrade(now: number, fps: number): void {
    const idx = LADDER.indexOf(this.level);
    if (idx >= LADDER.length - 1) {
      this.strikes = 0;
      return;
    }
    this.level = LADDER[idx + 1];
    this.strikes = 0;
    this.lastChangeAt = now;
    this.onLevelChange?.(
      this.level,
      `帧率约 ${fps.toFixed(0)}fps，低于 ${(this.targetFps * 0.78).toFixed(0)}fps`
    );
  }

  /** 手动设置档位（用户主动选择，不受冷却限制） */
  setLevel(level: QualityLevel, reason = "手动设置"): void {
    if (level === this.level) return;
    this.level = level;
    this.strikes = 0;
    this.lastChangeAt = this.lastNow ?? 0;
    this.onLevelChange?.(level, reason);
  }

  /** 当前档位 */
  getLevel(): QualityLevel {
    return this.level;
  }

  /** 平滑后的估计帧率（0 = 还没采到样本） */
  getFps(): number {
    return this.fps;
  }

  /** 是否已降过档 */
  hasDowngraded(): boolean {
    return this.level !== "high";
  }

  /** 调试快照 */
  stats(): { level: QualityLevel; fps: number; strikes: number; stalls: number } {
    return { level: this.level, fps: this.fps, strikes: this.strikes, stalls: this.stalls };
  }

  /** 重置统计（切换场景/仓库时调用，避免上一个场景的坏帧影响新场景） */
  reset(): void {
    this.lastNow = null;
    this.frames = 0;
    this.totalMs = 0;
    this.strikes = 0;
    this.warmup = 0;
    this.fps = 0;
  }
}

/** 档位 → 给人看的中文名 */
export function qualityLabel(level: QualityLevel): string {
  switch (level) {
    case "high":
      return "高画质";
    case "medium":
      return "均衡";
    case "low":
    default:
      return "流畅优先";
  }
}
