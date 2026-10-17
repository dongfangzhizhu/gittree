/**
 * Canvas 渲染器（纯函数）
 * renderFrame(ctx, geometry, t) 必须是确定性的：
 * 同一 (geometry, t, opts) 必产出相同画面；风动是 t 的函数，不读时钟。
 */

import { TreeGeometry, TreeSegment, TreeLeaf, TreeFlower } from "../core/types";

export interface RenderOptions {
  width: number;
  height: number;
  dpr: number;
  theme: "light" | "dark";
  sway: boolean;
  /** 是否绘制文字层（章节/日期/进度）。纪念卡等自带标题的场景应关闭 */
  overlay?: boolean;
}

/** 叶子调色板（索引 12 = 紫色，spec:/hook: 提交） */
const LEAF_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8",
  "#F7DC6F", "#BB8FCE", "#85C1E2", "#F8B88B", "#82E0AA",
  "#F1948A", "#D7DBDD", "#9B59B6",
];

interface Palette {
  bgTop: string;
  bgBottom: string;
  trunk: string;
  branch: string;
  graft: string;
  text: string;
  textDim: string;
  flower: string;
  ground: string;
}

const PALETTES: Record<"light" | "dark", Palette> = {
  dark: {
    bgTop: "#1a1f3a",
    bgBottom: "#0a0e27",
    trunk: "#2f5d3f",
    branch: "#4a7c59",
    graft: "#7a9b6a",
    text: "#ffffff",
    textDim: "#8a92b2",
    flower: "#FFD700",
    ground: "rgba(78, 205, 196, 0.08)",
  },
  light: {
    bgTop: "#eef2f7",
    bgBottom: "#ffffff",
    trunk: "#3d6b4f",
    branch: "#5a8a68",
    graft: "#8aa98a",
    text: "#1a1f3a",
    textDim: "#5a6178",
    flower: "#e6a700",
    ground: "rgba(46, 107, 74, 0.08)",
  },
};

/** 落叶持续时间（动画时间单位） */
const FALL_DURATION = 0.06;

/**
 * 主渲染函数（纯函数）
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  geometry: TreeGeometry,
  t: number,
  opts: RenderOptions
): void {
  const palette = PALETTES[opts.theme] || PALETTES.dark;

  // 重置变换并应用 DPR：backing store 为物理像素，绘制坐标为 CSS 像素
  ctx.setTransform(opts.dpr, 0, 0, opts.dpr, 0, 0);

  // 背景（铺满整个可视区域）
  const bg = ctx.createLinearGradient(0, 0, 0, opts.height);
  bg.addColorStop(0, palette.bgTop);
  bg.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, opts.width, opts.height);

  const geomW = geometry.width || 1920;
  const geomH = geometry.height || 1080;
  const scale = Math.min(opts.width / geomW, opts.height / geomH);
  const offsetX = (opts.width - geomW * scale) / 2;
  const offsetY = (opts.height - geomH * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // 空数据提示
  if (geometry.segments.length === 0) {
    ctx.fillStyle = palette.textDim;
    ctx.font = "28px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("暂无提交数据", geomW / 2, geomH / 2);
    ctx.textAlign = "left";
    ctx.restore();
    if (opts.overlay !== false) drawText(ctx, geometry, t, opts, palette);
    return;
  }

  // 风动：整树绕树根的轻微摆动（t 的确定性函数）
  if (opts.sway) {
    const swayAngle = Math.sin(t * Math.PI * 2 * 0.5) * 0.004;
    ctx.translate(960, 1000);
    ctx.rotate(swayAngle);
    ctx.translate(-960, -1000);
  }

  // 地面光晕
  const ground = ctx.createRadialGradient(960, 1000, 10, 960, 1000, 420);
  ground.addColorStop(0, palette.ground);
  ground.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ground;
  ctx.fillRect(540, 580, 840, 420);

  // 线段 → 叶子 → 花
  for (const segment of geometry.segments) {
    drawSegment(ctx, segment, t, palette);
  }
  for (const leaf of geometry.leaves) {
    drawLeaf(ctx, leaf, t, opts.sway);
  }
  for (const flower of geometry.flowers) {
    drawFlower(ctx, flower, t, palette, opts.sway);
  }

  ctx.restore();

  // 文字层（屏幕空间）
  if (opts.overlay !== false) {
    drawText(ctx, geometry, t, opts, palette);
  }
}

/** 二次贝塞尔采样点 */
function bezier2(p0: number, pc: number, p1: number, u: number): number {
  const mt = 1 - u;
  return mt * mt * p0 + 2 * mt * u * pc + u * u * p1;
}

/**
 * 绘制单条线段（含生长进度与锥形粗细）
 */
function drawSegment(
  ctx: CanvasRenderingContext2D,
  segment: TreeSegment,
  t: number,
  palette: Palette
): void {
  const [t0, t1] = segment.birth;
  if (t < t0) return;
  const progress = t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 1;
  if (progress <= 0) return;

  const [x0, y0] = segment.p0;
  const [cx, cy] = segment.c;
  const [x1, y1] = segment.p1;

  // 颜色
  ctx.strokeStyle =
    segment.kind === "graft"
      ? palette.graft
      : segment.kind === "trunk"
        ? palette.trunk
        : palette.branch;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 沿曲线分带绘制，实现从 w0 到 w1 的锥形过渡
  const BANDS = 4;
  const steps = BANDS * 3;
  const pts: Array<[number, number]> = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    pts.push([bezier2(x0, cx, x1, u), bezier2(y0, cy, y1, u)]);
  }

  const grown = progress * steps;
  const fullBands = Math.floor(grown);
  for (let b = 0; b < BANDS; b++) {
    const bandStart = (b * steps) / BANDS;
    const bandEnd = ((b + 1) * steps) / BANDS;
    if (bandStart >= grown) break;
    const bandLimit = Math.min(grown, bandEnd);
    const midU = (bandStart + bandLimit) / 2 / steps;
    ctx.lineWidth = segment.w0 + (segment.w1 - segment.w0) * midU;
    ctx.beginPath();
    ctx.moveTo(pts[bandStart][0], pts[bandStart][1]);
    for (let s = bandStart + 1; s <= bandLimit; s++) {
      ctx.lineTo(pts[s][0], pts[s][1]);
    }
    ctx.stroke();
  }
  void fullBands;
}

/** 绘制叶子（形状、颜色、风动、落叶） */
function drawLeaf(
  ctx: CanvasRenderingContext2D,
  leaf: TreeLeaf,
  t: number,
  sway: boolean
): void {
  if (t < leaf.birth) return;

  let alpha = Math.min(1, (t - leaf.birth) / 0.08);
  let [x, y] = leaf.pos;

  // 落叶（FR-TL-08）
  if (leaf.fallAt !== undefined && t > leaf.fallAt) {
    const f = (t - leaf.fallAt) / FALL_DURATION;
    if (f >= 1) return; // 已落尽
    const idx = leaf.id.length;
    x += Math.sin(f * 6 + idx) * 24 * f;
    y += f * 140;
    alpha *= 1 - f;
  }

  // 风动：摇曳与呼吸（t 的确定性函数）
  let angle = leaf.angle;
  let size = leaf.size;
  if (sway) {
    const phase = (leaf.pos[0] + leaf.pos[1]) * 0.01;
    angle += Math.sin(t * Math.PI * 2 * 1.5 + phase) * 0.25;
    size *= 1 + Math.sin(t * Math.PI * 2 * 2 + phase) * 0.06;
  }
  if (alpha <= 0 || size <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = LEAF_COLORS[leaf.colorIndex] || "#cccccc";

  const r = 5.2 * size;
  switch (leaf.shape) {
    case "pointed":
      // 尖形（fix）
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.4);
      ctx.lineTo(r * 0.8, r);
      ctx.lineTo(-r * 0.8, r);
      ctx.closePath();
      ctx.fill();
      break;
    case "long":
      // 长形（docs）
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.7, r * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "triple":
      // 三小叶（refactor）
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "small":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "tiny":
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "withered":
      // 枯叶（revert）：暗褐色
      ctx.fillStyle = "#8d6e63";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.9, r * 0.5, 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "purple":
      // 紫色（spec/hook）
      ctx.fillStyle = LEAF_COLORS[12];
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "none":
      break;
    case "circle":
    default:
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      break;
  }

  ctx.restore();
}

/** 绘制花（标签 / Kiro 紫花） */
function drawFlower(
  ctx: CanvasRenderingContext2D,
  flower: TreeFlower,
  t: number,
  palette: Palette,
  sway: boolean
): void {
  if (t < flower.birth) return;
  const alpha = Math.min(1, (t - flower.birth) / 0.2);
  if (alpha <= 0) return;

  let [x, y] = flower.pos;
  let size = flower.size;
  if (sway) {
    const phase = (x + y) * 0.01;
    x += Math.sin(t * Math.PI * 2 * 1.2 + phase) * 2;
    size *= 1 + Math.sin(t * Math.PI * 2 * 2 + phase) * 0.08;
  }

  ctx.save();
  ctx.globalAlpha = alpha;

  if (flower.kind === "major") {
    // 主版本：金色五角星
    ctx.fillStyle = palette.flower;
    drawStar(ctx, x, y, 8 * size);
  } else if (flower.kind === "spec") {
    // Kiro 痕迹：紫色四瓣小花
    ctx.fillStyle = LEAF_COLORS[12];
    const pr = 3.0 * size;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * pr, y + Math.sin(a) * pr, pr * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f1c40f";
    ctx.beginPath();
    ctx.arc(x, y, pr * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 普通标签：金色小圆
    ctx.fillStyle = palette.flower;
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number
): void {
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

/** 在 timeMap 上分段线性插值，t → 真实时间（ms） */
function timeAt(geometry: TreeGeometry, t: number): number {
  const map = geometry.timeMap;
  if (!map || map.length === 0) return 0;
  if (map.length === 1) return map[0][1];
  if (t <= map[0][0]) return map[0][1];
  if (t >= map[map.length - 1][0]) return map[map.length - 1][1];
  for (let i = 0; i < map.length - 1; i++) {
    const [t0, time0] = map[i];
    const [t1, time1] = map[i + 1];
    if (t >= t0 && t <= t1) {
      if (t1 === t0) return time0;
      const u = (t - t0) / (t1 - t0);
      return time0 + (time1 - time0) * u;
    }
  }
  return map[map.length - 1][1];
}

/** 当前所在章节 */
function currentChapter(geometry: TreeGeometry, t: number) {
  if (geometry.chapters.length === 0) return null;
  for (const ch of geometry.chapters) {
    if (t >= ch.t0 && t <= ch.t1) return ch;
  }
  return t < geometry.chapters[0].t0
    ? geometry.chapters[0]
    : geometry.chapters[geometry.chapters.length - 1];
}

/**
 * 文字层：章节标题、日期（UTC）、进度（FR-TL-09 / US-3）
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  geometry: TreeGeometry,
  t: number,
  opts: RenderOptions,
  palette: Palette
): void {
  const chapter = currentChapter(geometry, t);
  const date = new Date(timeAt(geometry, t));
  const dateStr = Number.isNaN(date.getTime())
    ? "--"
    : date.toISOString().split("T")[0];
  const progress = Math.floor(t * 100);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // 章节标题
  ctx.fillStyle = palette.text;
  ctx.font = "bold 22px 'Microsoft YaHei', 'PingFang SC', sans-serif";
  ctx.fillText(chapter ? chapter.title : "代码年轮", 24, 42);

  // 日期与进度
  ctx.fillStyle = palette.textDim;
  ctx.font = "15px 'Microsoft YaHei', 'PingFang SC', sans-serif";
  ctx.fillText(`${dateStr} (UTC) · 进度 ${progress}%`, 24, 68);
}
