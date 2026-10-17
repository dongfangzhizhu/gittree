/**
 * Canvas 渲染器（纯函数）
 * renderFrame(ctx, geometry, t) 必须是确定性的
 */

import { TreeGeometry } from "../core/types";

export interface RenderOptions {
  width: number;
  height: number;
  dpr: number;
  theme: "light" | "dark";
  sway: boolean;
}

/**
 * 主渲染函数（纯函数）
 * 同一 (geometry, t, opts) 必产出相同画面
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  geometry: TreeGeometry,
  t: number,
  opts: RenderOptions
): void {
  // 清空画布
  ctx.fillStyle = opts.theme === "dark" ? "#0a0e27" : "#ffffff";
  ctx.fillRect(0, 0, opts.width, opts.height);

  // 计算缩放因子
  const scaleX = opts.width / geometry.width;
  const scaleY = opts.height / geometry.height;
  const scale = Math.min(scaleX, scaleY);

  ctx.save();
  ctx.translate((opts.width - geometry.width * scale) / 2, (opts.height - geometry.height * scale) / 2);
  ctx.scale(scale, scale);

  // 绘制背景（可选）
  drawBackground(ctx, geometry, t, opts);

  // 绘制线段
  drawSegments(ctx, geometry, t, opts);

  // 绘制叶子
  drawLeaves(ctx, geometry, t, opts);

  // 绘制花
  drawFlowers(ctx, geometry, t, opts);

  // 绘制文字
  drawText(ctx, geometry, t, opts);

  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, geometry: TreeGeometry, t: number, opts: RenderOptions): void {
  // 简单背景渐变
  const gradient = ctx.createLinearGradient(0, 0, 0, geometry.height);
  gradient.addColorStop(0, opts.theme === "dark" ? "#1a1f3a" : "#f0f0f0");
  gradient.addColorStop(1, opts.theme === "dark" ? "#0a0e27" : "#ffffff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, geometry.width, geometry.height);
}

function drawSegments(ctx: CanvasRenderingContext2D, geometry: TreeGeometry, t: number, opts: RenderOptions): void {
  for (const segment of geometry.segments) {
    const [t0, t1] = segment.birth;
    if (t < t0) continue;

    // 计算该线段的生长进度
    const progress = t < t1 ? (t - t0) / (t1 - t0) : 1;

    // 贝塞尔曲线从 p0 到 p1
    const [x0, y0] = segment.p0;
    const [cx, cy] = segment.c;
    const [x1, y1] = segment.p1;

    // 绘制已生长部分
    ctx.strokeStyle = opts.theme === "dark" ? "#4a7c59" : "#2d5a3d";
    ctx.lineWidth = segment.w0 * (1 - progress * 0.3); // 粗细渐变
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(x0, y0);

    // 沿贝塞尔曲线绘制
    for (let p = 0; p < progress; p += 0.02) {
      const px = bezier(x0, cx, x1, p);
      const py = bezier(y0, cy, y1, p);
      ctx.lineTo(px, py);
    }
    
    // 显式绘制最终点，确保曲线完整到终点
    const pxFinal = bezier(x0, cx, x1, progress);
    const pyFinal = bezier(y0, cy, y1, progress);
    ctx.lineTo(pxFinal, pyFinal);

    ctx.stroke();
  }
}

function bezier(p0: number, pc: number, p1: number, t: number): number {
  // 二次贝塞尔曲线
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * pc + t * t * p1;
}

function drawLeaves(ctx: CanvasRenderingContext2D, geometry: TreeGeometry, t: number, opts: RenderOptions): void {
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
    "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#82E0AA",
    "#F1948A", "#D7DBDB",
  ];

  for (const leaf of geometry.leaves) {
    if (t < leaf.birth) continue;

    const opacity = Math.min(1, (t - leaf.birth) / 0.1); // 200ms 内展开

    ctx.globalAlpha = opacity;
    ctx.fillStyle = colors[leaf.colorIndex] || "#cccccc";

    const [x, y] = leaf.pos;
    const size = leaf.size * opacity;

    // 简单圆形叶子
    ctx.beginPath();
    ctx.arc(x, y, 3 * size, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }
}

function drawFlowers(ctx: CanvasRenderingContext2D, geometry: TreeGeometry, t: number, opts: RenderOptions): void {
  for (const flower of geometry.flowers) {
    if (t < flower.birth) continue;

    const opacity = Math.min(1, (t - flower.birth) / 0.15);

    ctx.globalAlpha = opacity;
    ctx.fillStyle = flower.kind === "spec" ? "#9B59B6" : "#FFD700";

    const [x, y] = flower.pos;
    const size = flower.size * opacity;

    // 绘制花（五角星或圆）
    if (flower.kind === "major") {
      drawStar(ctx, x, y, 5 * size);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 2 * size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawText(ctx: CanvasRenderingContext2D, geometry: TreeGeometry, t: number, opts: RenderOptions): void {
  // 获取当前日期和统计
  const timeIdx = Math.floor(t * (geometry.timeMap.length - 1));
  const [, timestamp] = geometry.timeMap[timeIdx] || [t, geometry.timeMap[0][1]];
  const date = new Date(timestamp).toISOString().split("T")[0];

  ctx.fillStyle = opts.theme === "dark" ? "#ffffff" : "#000000";
  ctx.font = "bold 24px Arial";
  ctx.fillText(`Date: ${date}`, 50, 50);

  // 进度
  ctx.font = "16px Arial";
  const progress = Math.floor(t * 100);
  ctx.fillText(`Progress: ${progress}%`, 50, 80);
}

