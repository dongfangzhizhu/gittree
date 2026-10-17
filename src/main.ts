/**
 * 代码年轮主入口（三维版）
 * 协调数据获取（含本地缓存）、场景构建、three.js 渲染、播放与交互
 */

import { GitHubSource } from "./core/github-source";
import { normalizeCommits, associateTags } from "./core/normalize";
import { sampleCommits, reconnectParents } from "./core/sampler";
import { buildGrowthModel } from "./core/growth-model";
import { buildScene } from "./three/scene-builder";
import { TreeRenderer, ViewName } from "./three/three-renderer";
import { parseGitHubInput } from "./core/input-parser";
import { AppError, ErrorMessages } from "./core/errors";
import { PRESETS } from "./presets";
import { createTokenUI } from "./ui/token-ui";
import { createInfoPanel, buildLeafInfo, buildFruitInfo, NodeInfo } from "./ui/info-panel";
import { formatErrorForUI } from "./ui/error-handler";
import { checkBrowserSupport, getExportWarnings } from "./ui/browser-check";
import {
  isCacheEnabled,
  setCacheEnabled,
  loadCached,
  saveCached,
  removeCached,
  formatCacheAge,
} from "./core/cache";
import { Commit, GrowthModel, RawHistory } from "./core/types";

interface AppState {
  isLoading: boolean;
  model: GrowthModel | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  token?: string;
  /** 本次加载是否命中了本地缓存 */
  fromCache: boolean;
  cacheSavedAt: number | null;
}

// 加载控制
let loadAbortController: AbortController | null = null;

const state: AppState = {
  isLoading: false,
  model: null,
  isPlaying: false,
  currentTime: 0,
  duration: 30,
  speed: 1,
  fromCache: false,
  cacheSavedAt: null,
};

// 浏览器兼容性检查
const browserSupport = checkBrowserSupport();
const warnings = getExportWarnings(browserSupport);
if (warnings.length > 0) {
  console.warn("Browser support warnings:", warnings);
}

// Token UI 初始化
const tokenUI = createTokenUI();

// UI 元素
const repoInput = document.getElementById("repoInput") as HTMLInputElement;
const loadBtn = document.getElementById("loadBtn") as HTMLButtonElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
const speedSelect = document.getElementById("speedSelect") as HTMLSelectElement;
const durationSelect = document.getElementById("durationSelect") as HTMLSelectElement;
const timeSlider = document.getElementById("timeSlider") as HTMLInputElement;
const timeDisplay = document.getElementById("timeDisplay") as HTMLElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const canvasContainer = document.getElementById("canvasContainer") as HTMLElement;
const controls = document.getElementById("controls") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const errorBox = document.getElementById("errorBox") as HTMLElement;
const presetsContainer = document.getElementById("presets") as HTMLElement;
const exportArea = document.getElementById("exportArea") as HTMLElement;
const cancelBtn = document.getElementById("cancelBtn") as HTMLButtonElement | null;
const hudChapter = document.getElementById("hudChapter") as HTMLElement;
const hudDate = document.getElementById("hudDate") as HTMLElement;
const pickHint = document.getElementById("pickHint") as HTMLElement;
const cacheToggle = document.getElementById("cacheToggle") as HTMLInputElement | null;
const cacheToggleLabel = document.getElementById("cacheToggleLabel") as HTMLElement | null;
const cacheStatus = document.getElementById("cacheStatus") as HTMLElement;
const autoRotateToggle = document.getElementById("autoRotate") as HTMLInputElement | null;

const infoPanel = createInfoPanel(document.getElementById("infoPanel") as HTMLElement);

let renderer: TreeRenderer | null = null;
let animationFrameId: number | null = null;
/** 当前仓库的完整名称（owner/repo），缓存状态展示用 */
let currentRepoFull = "";

// ==================== 渲染器生命周期 ====================

function ensureRenderer(): TreeRenderer | null {
  if (renderer) return renderer;
  try {
    renderer = new TreeRenderer(canvas);
  } catch (error: any) {
    showError(`无法初始化三维渲染器（WebGL）：${error?.message || "当前浏览器可能不支持 WebGL"}`);
    return null;
  }
  return renderer;
}

// ==================== 加载流程 ====================

/**
 * 加载仓库（勾选缓存时优先命中本地缓存）
 */
async function loadRepository() {
  const input = repoInput.value.trim();
  if (!input) {
    showError("请输入 GitHub 仓库地址");
    return;
  }

  try {
    state.isLoading = true;
    loadBtn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = "";
    clearError();

    const { owner, repo } = parseGitHubInput(input);
    const repoFull = `${owner}/${repo}`;
    currentRepoFull = repoFull;

    const cacheEnabled = isCacheEnabled();
    let raw: RawHistory | null = null;
    let fromCache = false;
    let cacheSavedAt: number | null = null;

    // 1. 命中缓存则跳过拉取
    if (cacheEnabled) {
      const cached = loadCached(repoFull);
      if (cached) {
        raw = cached.raw;
        fromCache = true;
        cacheSavedAt = cached.savedAt;
        showStatus(`命中本地缓存（${formatCacheAge(cached.savedAt)}），跳过拉取`);
      }
    }

    // 2. 未命中则请求 GitHub
    if (!raw) {
      showStatus("正在加载...");
      const source = new GitHubSource();
      loadAbortController = new AbortController();
      raw = await source.load(repoFull, { token: tokenUI.getToken() }, loadAbortController.signal);

      // 3. 勾选了缓存则写入
      if (cacheEnabled) {
        const result = saveCached(repoFull, raw);
        if (result.ok) {
          cacheSavedAt = Date.now();
        } else {
          // 缓存写入失败不阻塞主流程，但明确告知（不静默降级）
          showStatus(`数据已加载，但缓存写入失败：${result.error}`);
        }
      }
    }

    showStatus("正在处理数据...");

    // 规范化提交
    const normalized = normalizeCommits(raw);
    if (normalized.length === 0) {
      throw new AppError("EMPTY_REPO", ErrorMessages.EMPTY_REPO.message, 404);
    }
    const tagMap = associateTags(normalized, raw.tags);
    const taggedIds = new Set(Array.from(tagMap.keys()));

    // 采样
    const { commits: sampled, samplingRate } = sampleCommits(normalized, taggedIds);

    // 父节点重连
    const reconnected = reconnectParents(sampled, normalized);

    // 构建生长模型与三维场景
    const model = buildGrowthModel(reconnected, raw.tags, samplingRate);
    model.source = { kind: "github", owner, repo };
    const scene = buildScene(model, { seed: repoFull });

    state.model = model;
    state.fromCache = fromCache;
    state.cacheSavedAt = cacheSavedAt;

    const r = ensureRenderer();
    if (!r) return;
    r.setScene(scene);

    // 重置播放进度：新树从 t=0 开始生长
    pausePlayback();
    state.currentTime = 0;
    infoPanel.show(null);

    // 更新 URL 以便分享
    if (!window.location.search.includes(repoFull)) {
      window.history.replaceState({}, "", `?repo=${encodeURIComponent(repoFull)}`);
    }

    const cacheNote = fromCache && cacheSavedAt
      ? ` · 来自缓存（${formatCacheAge(cacheSavedAt)}）`
      : "";
    showStatus(`已加载 ${model.commits.length} 个提交（${Math.floor(samplingRate * 100)}% 采样）${cacheNote}`);
    refreshCacheStatus(repoFull);
    showCanvas();
    startPlayback(); // 自动播放
    render();
  } catch (error: any) {
    showError(formatErrorForUI(error));
  } finally {
    loadAbortController = null;
    if (cancelBtn) cancelBtn.style.display = "none";
    state.isLoading = false;
    loadBtn.disabled = false;
  }
}

/**
 * 加载预置（本地数据，不走缓存）
 */
async function loadPreset(index: number) {
  try {
    state.isLoading = true;
    showStatus("正在加载预置作品...");
    clearError();

    const preset = PRESETS[index];
    const model = preset.load();
    const scene = buildScene(model);

    state.model = model;
    state.fromCache = false;
    state.cacheSavedAt = null;
    currentRepoFull = "";

    const r = ensureRenderer();
    if (!r) return;
    r.setScene(scene);

    pausePlayback();
    state.currentTime = 0;
    infoPanel.show(null);

    showStatus(`已加载 ${model.commits.length} 个提交`);
    refreshCacheStatus("");
    showCanvas();
    startPlayback();
    render();
  } catch (error: any) {
    showError(formatErrorForUI(error));
  } finally {
    state.isLoading = false;
  }
}

// ==================== 播放与渲染 ====================

/**
 * 开始播放
 * 先取消可能存在的上一个动画帧，避免重复启动导致倍速
 */
function startPlayback() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  state.isPlaying = true;
  const startTime = performance.now();
  const startOffset = state.currentTime;

  function animate(now: number) {
    const elapsed = (now - startTime) / 1000;
    state.currentTime = startOffset + elapsed * state.speed;

    if (state.currentTime >= state.duration) {
      state.currentTime = state.duration;
      state.isPlaying = false;
      animationFrameId = null;
      render();
      return;
    }

    render();
    if (state.isPlaying) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      animationFrameId = null;
    }
  }

  animationFrameId = requestAnimationFrame(animate);
}

/**
 * 暂停播放
 */
function pausePlayback() {
  state.isPlaying = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

/**
 * 渲染当前帧：三维树 + HUD + 时间轴
 */
function render() {
  const r = renderer;
  if (!r || !state.model) return;

  const t = Math.max(0, Math.min(1, state.currentTime / state.duration));

  // 尺寸变化时调整（防守性编程：容器不可见时用计算样式兜底）
  let rect = canvasContainer.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    const cs = window.getComputedStyle(canvasContainer);
    rect = {
      width: parseFloat(cs.width) || 960,
      height: parseFloat(cs.height) || 540,
    } as DOMRect;
  }
  const dpr = window.devicePixelRatio || 1;
  r.resize(rect.width, rect.height, dpr);

  // 三维更新与绘制
  r.updateTree(t);
  r.render();

  // HUD：章节标题 + 日期 + 进度
  updateHud(t);

  // 时间轴
  const minutes = Math.floor(state.currentTime / 60);
  const seconds = Math.floor(state.currentTime % 60);
  timeDisplay.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  timeSlider.value = String((t * 100).toFixed(0));
}

/** HUD 文字层（章节标题、UTC 日期、进度） */
function updateHud(t: number) {
  const model = state.model;
  if (!model) return;
  const chapters = model.chapters;
  if (chapters.length > 0 && model.commits.length > 0) {
    const idx = Math.min(model.commits.length - 1, Math.round(t * (model.commits.length - 1)));
    const ch = chapters.find((c) => idx >= c.startIndex && idx <= c.endIndex) || chapters[0];
    hudChapter.textContent = ch.title;
  }
  const time = timeAt(t);
  const date = new Date(time);
  const dateStr = Number.isNaN(date.getTime())
    ? "--"
    : date.toISOString().split("T")[0];
  hudDate.textContent = `${dateStr} (UTC) · 进度 ${Math.floor(t * 100)}%`;
}

/** 按提交序号均匀映射 t → 真实时间（与 scene-builder 的 tOf 一致） */
function timeAt(t: number): number {
  const model = state.model;
  if (!model || model.commits.length === 0) return 0;
  const n = model.commits.length;
  if (n === 1) return model.commits[0].time;
  const idx = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
  return model.commits[idx].time;
}

/**
 * 显示画布容器
 * 注意：样式表中 .canvas-container / .controls / .export-area 均为 display:none，
 * 必须显式设为具体值（"block"/"flex"）。设为空字符串会回落到样式表的 none，画布将不可见。
 */
function showCanvas() {
  canvasContainer.style.display = "block";
  controls.style.display = "flex";
  exportArea.style.display = "flex";
}

// ==================== 交互：点击 / 悬停 / 视角 ====================

/** 指针按下/抬起判定点击（与轨道旋转拖拽区分） */
let pointerDown: { x: number; y: number; time: number } | null = null;

canvas.addEventListener("pointerdown", (e) => {
  pointerDown = { x: e.clientX, y: e.clientY, time: performance.now() };
});

canvas.addEventListener("pointerup", (e) => {
  if (!pointerDown || !renderer) return;
  const dx = e.clientX - pointerDown.x;
  const dy = e.clientY - pointerDown.y;
  const dt = performance.now() - pointerDown.time;
  pointerDown = null;
  if (Math.hypot(dx, dy) > 6 || dt > 500) return; // 拖拽，不当点击

  const hit = renderer.pick(e.clientX, e.clientY);
  if (!hit) {
    infoPanel.show(null);
    renderer.setSelected(null);
    return;
  }
  showNodeInfo(hit.kind, hit.item.id);
});

canvas.addEventListener("pointermove", (e) => {
  if (!renderer || pointerDown) return;
  const hit = renderer.pick(e.clientX, e.clientY);
  renderer.setHover(hit);
  canvas.style.cursor = hit ? "pointer" : "grab";
});

canvas.addEventListener("pointerleave", () => {
  renderer?.setHover(null);
});

/** 展示节点信息面板 */
function showNodeInfo(kind: "leaf" | "fruit", key: string) {
  const r = renderer;
  const model = state.model;
  if (!r || !model) return;

  const commitById = new Map(model.commits.map((c) => [c.id, c]));
  const source = model.source.kind === "github" ? model.source : null;

  const node = r.getNodeById(key);
  if (!node) return;

  let info: NodeInfo;
  if (node.kind === "leaf") {
    const commit = commitById.get(node.item.commitId);
    if (!commit) return;
    info = buildLeafInfo(node.item, commit, source);
  } else {
    const commit = commitById.get(node.item.commitId);
    info = buildFruitInfo(node.item, commit, source);
  }
  info.onLocate = () => r.focusNode(key);
  infoPanel.show(info);
  r.setSelected(key);
}

// 视角预设按钮
document.querySelectorAll<HTMLButtonElement>(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderer?.setView(btn.dataset.view as ViewName);
  });
});

if (autoRotateToggle) {
  autoRotateToggle.addEventListener("change", () => {
    renderer?.setAutoRotate(autoRotateToggle.checked);
  });
}

// ==================== 缓存开关 ====================

if (cacheToggle) {
  cacheToggle.checked = isCacheEnabled();
  syncCacheToggleStyle();
  cacheToggle.addEventListener("change", () => {
    setCacheEnabled(cacheToggle.checked);
    syncCacheToggleStyle();
    refreshCacheStatus(currentRepoFull);
    if (cacheToggle.checked) {
      showStatus("已开启缓存：之后加载的仓库数据会保存在浏览器本地");
    } else {
      showStatus("已关闭缓存：不会读取或写入本地缓存（已有缓存不会被删除）");
    }
  });
}

function syncCacheToggleStyle() {
  cacheToggleLabel?.classList.toggle("on", !!cacheToggle?.checked);
}

/** 刷新缓存状态展示（当前仓库是否有缓存 + 清除入口） */
function refreshCacheStatus(repoFull: string) {
  if (!repoFull || !isCacheEnabled()) {
    cacheStatus.textContent = "";
    return;
  }
  const cached = loadCached(repoFull);
  if (!cached) {
    cacheStatus.textContent = "该仓库暂无缓存";
    return;
  }
  cacheStatus.innerHTML = "";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "已缓存";
  const age = document.createElement("span");
  age.textContent = formatCacheAge(cached.savedAt);
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "清除";
  clearBtn.className = "ghost";
  clearBtn.addEventListener("click", () => {
    removeCached(repoFull);
    refreshCacheStatus(repoFull);
    showStatus(`已清除 ${repoFull} 的本地缓存`);
  });
  cacheStatus.append(badge, age, clearBtn);
}

// ==================== 导出 ====================

/** 在导出画面上绘制字幕层（章节标题 + UTC 日期 + 进度） */
function drawOverlayText(ctx: CanvasRenderingContext2D, t: number) {
  const model = state.model;
  if (!model) return;

  let chapterTitle = "代码年轮";
  if (model.chapters.length > 0 && model.commits.length > 0) {
    const idx = Math.min(model.commits.length - 1, Math.round(t * (model.commits.length - 1)));
    const ch = model.chapters.find((c) => idx >= c.startIndex && idx <= c.endIndex);
    if (ch) chapterTitle = ch.title;
  }
  const date = new Date(timeAt(t));
  const dateStr = Number.isNaN(date.getTime()) ? "--" : date.toISOString().split("T")[0];

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 34px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(chapterTitle, 48, 78);
  ctx.fillStyle = "#8a92b2";
  ctx.font = "22px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(`${dateStr} (UTC) · 进度 ${Math.floor(t * 100)}%`, 48, 116);
}

/**
 * 导出视频 (WebM)
 * 注意：MediaRecorder 依赖浏览器合成器捕获画面，逐帧渲染之间必须让出主线程，
 * 否则所有帧在一个任务内绘完，录制品可能只有最后一帧。
 */
async function exportVideo() {
  if (!browserSupport.canExportVideo) {
    showError("当前浏览器不支持视频导出，请使用 Chrome、Edge 或 Firefox。");
    return;
  }
  const r = renderer;
  if (!r || !state.model) {
    showError("没有可导出的树");
    return;
  }

  try {
    showStatus("正在导出视频...");
    loadBtn.disabled = true;
    pausePlayback();

    const duration = state.duration * 1000;
    const fps = 30;
    const frameCount = Math.max(1, Math.round((duration / 1000) * fps));

    // 合成画布：三维画面 + 章节/日期字幕（与二维版导出的信息层对齐）
    const OUT_W = 1920;
    const OUT_H = 1080;
    const outCanvas = document.createElement("canvas");
    outCanvas.width = OUT_W;
    outCanvas.height = OUT_H;
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) throw new Error("无法创建导出画布");

    const srcCanvas = r.captureCanvas();
    const stream = outCanvas.captureStream(fps);
    let mimeType = "video/webm";
    if (typeof MediaRecorder.isTypeSupported === "function") {
      if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
        mimeType = "video/webm;codecs=vp9";
      } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
        mimeType = "video/webm;codecs=vp8";
      }
    }
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onerror = () => {
      showError("视频录制出错");
      loadBtn.disabled = false;
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      if (blob.size === 0) {
        showError("导出失败：录制品为空");
        loadBtn.disabled = false;
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tree-${new Date().toISOString().split("T")[0]}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus("导出完成");
      loadBtn.disabled = false;
    };

    mediaRecorder.start();

    // 逐帧渲染，每帧之间让出主线程保证被捕获
    for (let frame = 0; frame < frameCount; frame++) {
      const t = frame / frameCount;
      r.updateTree(t);
      r.render();

      // 合成：背景 + 三维画面（等比铺满）+ 字幕
      outCtx.fillStyle = "#0a0e27";
      outCtx.fillRect(0, 0, OUT_W, OUT_H);
      const scale = Math.min(OUT_W / srcCanvas.width, OUT_H / srcCanvas.height);
      const dw = srcCanvas.width * scale;
      const dh = srcCanvas.height * scale;
      outCtx.drawImage(srcCanvas, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
      drawOverlayText(outCtx, t);

      showStatus(`导出中... ${Math.floor((frame / frameCount) * 100)}%`);
      await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
    }

    // 保持一小段再停止，确保最后一帧被写入
    await new Promise((resolve) => setTimeout(resolve, 300));
    mediaRecorder.stop();
  } catch (error: any) {
    showError(formatErrorForUI(error));
    loadBtn.disabled = false;
  }
}

/**
 * 导出纪念卡 (PNG)
 * 三维画面截图 + 文字统计，合成竖版卡片
 */
async function exportCard() {
  if (!browserSupport.canExportCard) {
    showError("当前浏览器不支持纪念卡导出，请更新浏览器。");
    return;
  }
  const r = renderer;
  if (!r || !state.model) {
    showError("没有可导出的树");
    return;
  }

  try {
    showStatus("正在导出纪念卡...");

    // 先以完整形态（t=1）渲染一帧，再截图
    r.updateTree(1);
    const dataUrl = r.snapshotDataURL();
    const image = await loadImage(dataUrl);

    // 创建竖版 canvas (1080×1350)
    const cardCanvas = document.createElement("canvas");
    cardCanvas.width = 1080;
    cardCanvas.height = 1350;
    const cardCtx = cardCanvas.getContext("2d");
    if (!cardCtx) throw new Error("无法创建 canvas");

    // 深色背景
    cardCtx.fillStyle = "#0a0e27";
    cardCtx.fillRect(0, 0, 1080, 1350);

    // 中部：完整的树（保持比例绘制）
    const treeH = 800;
    const scale = Math.min(1080 / image.width, treeH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    cardCtx.drawImage(image, (1080 - drawW) / 2, 210, drawW, drawH);

    // 顶部文字（画在树之后，避免被覆盖）
    cardCtx.fillStyle = "#ffffff";
    cardCtx.font = "bold 34px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const repoLabel = state.model?.source?.owner && state.model?.source?.repo
      ? `${state.model.source.owner}/${state.model.source.repo}`
      : "代码年轮";
    cardCtx.fillText(repoLabel, 50, 66);

    cardCtx.font = "16px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    cardCtx.fillStyle = "#8a92b2";
    const days = state.model.stats.days;
    const growthMsg =
      days < 90 ? "刚刚发芽" : days < 730 ? "正在拔节" : "已经成林";
    cardCtx.fillText(`已经生长 ${days} 天 · ${growthMsg}`, 50, 104);

    // 下部：统计数据 (2×3 格子)
    const stats: Array<[string, string]> = [
      ["首次提交", new Date(state.model.stats.firstTime).toLocaleDateString("zh-CN")],
      ["总提交数", state.model.stats.totalCommits.toString()],
      ["贡献者", state.model.stats.contributors.toString()],
      ["最活跃", state.model.stats.busiestDay.date],
      ["最长沉寂", `${state.model.stats.longestDormancy.days} 天`],
      ["章节数", state.model.chapters.length.toString()],
    ];

    let idx = 0;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 50 + col * 330;
        const y = 1070 + row * 100;
        const [label, value] = stats[idx++];

        cardCtx.fillStyle = "#6b7490";
        cardCtx.font = "14px 'PingFang SC', 'Microsoft YaHei', sans-serif";
        cardCtx.fillText(label, x, y);
        cardCtx.fillStyle = "#4ecdc4";
        cardCtx.font = "bold 20px 'PingFang SC', 'Microsoft YaHei', sans-serif";
        cardCtx.fillText(value, x, y + 40);
      }
    }

    // 底部
    cardCtx.fillStyle = "#5d6580";
    cardCtx.font = "12px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    cardCtx.fillText("由代码年轮生成 · https://github.com/yourusername/gittree", 50, 1320);

    // 下载
    cardCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `card-${new Date().toISOString().split("T")[0]}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus("纪念卡已导出");
    });
  } catch (error: any) {
    showError(formatErrorForUI(error));
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("截图解码失败"));
    img.src = src;
  });
}

// ==================== 事件监听 ====================

loadBtn.addEventListener("click", loadRepository);
playBtn.addEventListener("click", () => startPlayback());
pauseBtn.addEventListener("click", () => pausePlayback());
if (cancelBtn) {
  cancelBtn.addEventListener("click", () => {
    if (loadAbortController) {
      loadAbortController.abort();
      showStatus("已取消加载");
    }
  });
}
speedSelect.addEventListener("change", (e) => {
  state.speed = parseFloat((e.target as HTMLSelectElement).value);
});
durationSelect.addEventListener("change", (e) => {
  state.duration = parseFloat((e.target as HTMLSelectElement).value);
});
timeSlider.addEventListener("input", (e) => {
  state.currentTime = (parseFloat((e.target as HTMLInputElement).value) / 100) * state.duration;
  // 拖动时间轴时暂停，否则动画帧会立刻覆盖拖动结果
  pausePlayback();
  render();
});

// 键盘快捷键
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (state.isPlaying) pausePlayback();
    else startPlayback();
  }
  if (e.code === "ArrowLeft") {
    state.currentTime = Math.max(0, state.currentTime - 1);
    render();
  }
  if (e.code === "ArrowRight") {
    state.currentTime = Math.min(state.duration, state.currentTime + 1);
    render();
  }
  if (e.code === "Home") {
    state.currentTime = 0;
    pausePlayback();
    render();
  }
  if (e.code === "End") {
    state.currentTime = state.duration;
    pausePlayback();
    render();
  }
});

/**
 * 显示状态消息
 */
function showStatus(msg: string) {
  statusEl.textContent = msg;
}

/**
 * 显示错误消息
 */
function showError(msg: string) {
  errorBox.textContent = msg;
  errorBox.style.display = "";
}

/**
 * 清除错误消息
 */
function clearError() {
  errorBox.style.display = "none";
}

/**
 * 初始化预置
 */
function initPresets() {
  presetsContainer.innerHTML = "";
  for (let i = 0; i < PRESETS.length; i++) {
    const preset = PRESETS[i];
    const card = document.createElement("div");
    card.className = "preset-card";
    card.innerHTML = `<div>${preset.name}</div><strong>${preset.description}</strong>`;
    card.addEventListener("click", () => loadPreset(i));
    presetsContainer.appendChild(card);
  }
}

// 处理 URL 参数加载仓库
function initFromURL() {
  const params = new URLSearchParams(window.location.search);
  const repo = params.get("repo");
  if (repo) {
    repoInput.value = repo;
    setTimeout(() => loadRepository(), 500);
  }
}

// 添加导出按钮事件
const exportVideoBtn = document.querySelector("[data-action=export-video]") as HTMLButtonElement;
const exportCardBtn = document.querySelector("[data-action=export-card]") as HTMLButtonElement;
if (exportVideoBtn) exportVideoBtn.addEventListener("click", exportVideo);
if (exportCardBtn) exportCardBtn.addEventListener("click", exportCard);

// 初始化
window.addEventListener("resize", render);
initPresets();
initFromURL();

// 调试钩子：暴露内部状态供端到端测试检查（只读快照）
(window as any).__gittree = {
  getState: () => ({
    commits: state.model?.commits.length ?? 0,
    samplingRate: state.model?.metadata?.samplingRate ?? 0,
    lanes: state.model?.lanes.length ?? 0,
    chapters: state.model?.chapters.map((c) => c.title) ?? [],
    segments: renderer?.stats().segments ?? 0,
    leaves: renderer?.stats().leaves ?? 0,
    flowers: renderer?.stats().fruits ?? 0,
    fruits: renderer?.stats().fruits ?? 0,
    firstCommitTime: state.model?.commits[0]?.time ?? null,
    lastCommitTime: state.model?.commits[state.model?.commits.length - 1]?.time ?? null,
    commitTimeAt: (idx: number) => state.model?.commits[idx]?.time ?? null,
    source: state.model?.source ?? null,
    cache: {
      enabled: isCacheEnabled(),
      fromCache: state.fromCache,
      savedAt: state.cacheSavedAt,
    },
  }),
  /** 画布像素统计（WebGL readPixels） */
  sampleCanvas: () => renderer?.sampleCanvas() ?? null,
  /** 三维渲染器实例（测试检查相机/视角用） */
  getCamera: () =>
    renderer
      ? {
          position: renderer.camera.position.toArray(),
          target: renderer.controls.target.toArray(),
          autoRotate: renderer.controls.autoRotate,
        }
      : null,
  /** 节点世界坐标 → 屏幕坐标（测试点击用） */
  nodeScreenPos: (key: string) => renderer?.nodeScreenPos(key) ?? null,
  /** 枚举叶子/果实 key（测试用） */
  sampleLeafKeys: (n?: number) => renderer?.sampleLeafKeys(n) ?? [],
  sampleFruitKeys: (n?: number) => renderer?.sampleFruitKeys(n) ?? [],
};

// 首页自动加载第一个预置
window.addEventListener("load", () => {
  if (PRESETS.length > 0) {
    setTimeout(() => loadPreset(0), 500);
  }
});
