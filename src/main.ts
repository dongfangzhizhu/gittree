/**
 * 代码年轮主入口
 * 协调数据获取、布局、渲染和播放
 */

import { GitHubSource } from "./core/github-source";
import { normalizeCommits, associateTags } from "./core/normalize";
import { sampleCommits, reconnectParents } from "./core/sampler";
import { buildGrowthModel } from "./core/growth-model";
import { layout } from "./layout/tree-layout";
import { renderFrame } from "./rendering/canvas-renderer";
import { parseGitHubInput } from "./core/input-parser";
import { AppError, ErrorMessages } from "./core/errors";
import { PRESETS } from "./presets";
import { createTokenUI } from "./ui/token-ui";
import { formatErrorForUI } from "./ui/error-handler";
import { checkBrowserSupport, getExportWarnings } from "./ui/browser-check";

interface AppState {
  isLoading: boolean;
  geometry: any;
  model: any;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  token?: string;
}

// 加载控制
let loadAbortController: AbortController | null = null;

const state: AppState = {
  isLoading: false,
  geometry: null,
  model: null,
  isPlaying: false,
  currentTime: 0,
  duration: 30,
  speed: 1,
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

const ctx = canvas.getContext("2d");
let animationFrameId: number | null = null;

// 事件监听器
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
 * 加载仓库
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
    showStatus("正在加载...");
    clearError();

    // 解析输入
    const { owner, repo } = parseGitHubInput(input);

    // 获取数据
    const source = new GitHubSource();
    loadAbortController = new AbortController();
const signal = loadAbortController.signal;
    const raw = await source.load(`${owner}/${repo}`, { token: tokenUI.getToken() }, signal);

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

    // 构建生长模型
    const model = buildGrowthModel(reconnected, raw.tags, samplingRate);
    model.source = { kind: "github", owner, repo };

    // 生成布局
    const geometry = layout(model, { seed: `${owner}/${repo}` });

    state.model = model;
    state.geometry = geometry;

    // 重置播放进度：新树从 t=0 开始生长
    pausePlayback();
    state.currentTime = 0;

    // 更新 URL 以便分享
    const sourceRepo = model.source?.repo ? `${model.source.owner}/${model.source.repo}` : "";
    if (sourceRepo && !window.location.search.includes(sourceRepo)) {
      window.history.replaceState({}, "", `?repo=${encodeURIComponent(sourceRepo)}`);
    }

    showStatus(`已加载 ${model.commits.length} 个提交（${Math.floor(samplingRate * 100)}% 采样）`);
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
 * 加载预置
 */
async function loadPreset(index: number) {
  try {
    state.isLoading = true;
    showStatus("正在加载预置作品...");
    clearError();

    const preset = PRESETS[index];
    const model = preset.load();

    // 生成布局
    const geometry = layout(model);

    state.model = model;
    state.geometry = geometry;

    // 重置播放进度：新树从 t=0 开始生长
    pausePlayback();
    state.currentTime = 0;

    // 更新 URL 以便分享
    const sourceRepo = model.source?.repo ? `${model.source.owner}/${model.source.repo}` : "";
    if (sourceRepo && !window.location.search.includes(sourceRepo)) {
      window.history.replaceState({}, "", `?repo=${encodeURIComponent(sourceRepo)}`);
    }

    showStatus(`已加载 ${model.commits.length} 个提交`);
    showCanvas();
    startPlayback();
    render();
  } catch (error: any) {
    showError(formatErrorForUI(error));
  } finally {
    loadAbortController = null;
    state.isLoading = false;
  }
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
  if (!state.geometry) {
    showError("没有可导出的树");
    return;
  }

  try {
    showStatus("正在导出视频...");
    loadBtn.disabled = true;

    const duration = state.duration * 1000;
    const fps = 30;
    const frameCount = Math.max(1, Math.round((duration / 1000) * fps));

    // 创建离屏 canvas
    const offCanvas = document.createElement("canvas");
    offCanvas.width = 1920;
    offCanvas.height = 1080;
    const offCtx = offCanvas.getContext("2d");
    if (!offCtx) throw new Error("无法创建离屏 canvas");

    // 获取录制流（兼容 codec 协商）
    const stream = offCanvas.captureStream(fps);
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
      renderFrame(offCtx, state.geometry, t, {
        width: 1920,
        height: 1080,
        dpr: 1,
        theme: "dark",
        sway: false, // 关闭风动以加快导出
      });
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
 */
async function exportCard() {
  if (!browserSupport.canExportCard) {
    showError("Card export not supported in this browser. Please update your browser.");
    return;
  }
  if (!state.geometry || !canvas) {
    showError("没有可导出的树");
    return;
  }

  try {
    showStatus("正在导出纪念卡...");

    // 创建竖版 canvas (1080×1350)
    const cardCanvas = document.createElement("canvas");
    cardCanvas.width = 1080;
    cardCanvas.height = 1350;
    const cardCtx = cardCanvas.getContext("2d");
    if (!cardCtx) throw new Error("无法创建 canvas");

    // 深色背景
    cardCtx.fillStyle = "#0a0e27";
    cardCtx.fillRect(0, 0, 1080, 1350);

    // 中部：完整的树 (t=1)，关闭字幕层（卡片自带标题）
    // 注意：必须先画树（其背景会覆盖整个绘制区），再画文字
    renderFrame(cardCtx, state.geometry, 1.0, {
      width: 1080,
      height: 800,
      dpr: 1,
      theme: "dark",
      sway: false,
      overlay: false,
    });

    // 顶部文字（画在树之后，避免被树的背景覆盖）
    cardCtx.fillStyle = "#ffffff";
    cardCtx.font = "bold 32px Arial";
    const repoLabel = state.model?.source?.owner && state.model?.source?.repo
      ? `${state.model.source.owner}/${state.model.source.repo}`
      : "代码年轮";
    cardCtx.fillText(repoLabel, 50, 60);

    cardCtx.font = "16px Arial";
    cardCtx.fillStyle = "#aaa";
    const days = state.model.stats.days;
    const growthMsg =
      days < 90 ? "刚刚发芽" : days < 730 ? "正在拔节" : "已经成林";
    cardCtx.fillText(`已经生长 ${days} 天 · ${growthMsg}`, 50, 100);

    // 下部：统计数据 (2×3 格子)
    const stats = [
      [`首次提交`, new Date(state.model.stats.firstTime).toLocaleDateString()],
      [`总提交数`, state.model.stats.totalCommits.toString()],
      [`贡献者`, state.model.stats.contributors.toString()],
      [`最活跃`, state.model.stats.busiestDay.date],
      [`最长沉寂`, `${state.model.stats.longestDormancy.days} 天`],
      [`章节数`, state.model.chapters.length.toString()],
    ];

    cardCtx.fillStyle = "#ffffff";
    cardCtx.font = "14px Arial";
    let idx = 0;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 50 + col * 320;
        const y = 1050 + row * 100;
        const [label, value] = stats[idx++];

        cardCtx.fillStyle = "#666";
        cardCtx.fillText(label, x, y);
        cardCtx.fillStyle = "#4ecdc4";
        cardCtx.font = "bold 18px Arial";
        cardCtx.fillText(value, x, y + 40);
      }
    }

    // 底部
    cardCtx.fillStyle = "#555";
    cardCtx.font = "12px Arial";
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
  const startTime = Date.now();
  const startOffset = state.currentTime;

  function animate() {
    const elapsed = (Date.now() - startTime) / 1000;
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
  }
}

/**
 * 渲染当前帧
 */
function render() {
  if (!state.geometry || !ctx) return;

  const t = Math.max(0, Math.min(1, state.currentTime / state.duration));

  // 调整 canvas 尺寸，使用防守性编程
  let rect = canvasContainer.getBoundingClientRect();

  // 如果容器尺寸为 0，使用备用值
  if (rect.width === 0 || rect.height === 0) {
    const containerStyle = window.getComputedStyle(canvasContainer);
    rect = {
      width: parseFloat(containerStyle.width) || 800,
      height: parseFloat(containerStyle.height) || 450,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect;
  }

  const dpr = window.devicePixelRatio || 1;
  // 仅在尺寸变化时重设 backing store（重设会清空画布并触发重分配）
  const targetW = Math.round(rect.width * dpr);
  const targetH = Math.round(rect.height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  // 渲染（renderFrame 内部按 dpr 设置变换，传入 CSS 像素尺寸）
  renderFrame(ctx, state.geometry, t, {
    width: rect.width,
    height: rect.height,
    dpr,
    theme: "dark",
    sway: true,
  });

  // 更新时间轴
  const minutes = Math.floor(state.currentTime / 60);
  const seconds = Math.floor(state.currentTime % 60);
  timeDisplay.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  timeSlider.value = String((t * 100).toFixed(0));
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
  presetsContainer.style.display = "grid";
}

// 处理 URL 参数加载仓库
function initFromURL() {
  const params = new URLSearchParams(window.location.search);
  const repo = params.get("repo");
  if (repo) {
    repoInput.value = repo;
    // 自动加载
    setTimeout(() => loadRepository(), 500);
  }
}

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
    chapters: state.model?.chapters.map((c: any) => c.title) ?? [],
    segments: state.geometry?.segments.length ?? 0,
    leaves: state.geometry?.leaves.length ?? 0,
    flowers: state.geometry?.flowers.length ?? 0,
    firstCommitTime: state.model?.commits[0]?.time ?? null,
    lastCommitTime: state.model?.commits[state.model?.commits.length - 1]?.time ?? null,
    commitTimeAt: (idx: number) => state.model?.commits[idx]?.time ?? null,
    timeMapHead: state.geometry?.timeMap.slice(0, 5) ?? [],
    timeMapTail: state.geometry?.timeMap.slice(-5) ?? [],
    source: state.model?.source ?? null,
  }),
};

// 添加导出按钮事件（假设存在 HTML 中）
const exportVideoBtn = document.querySelector("[data-action=export-video]") as HTMLButtonElement;
const exportCardBtn = document.querySelector("[data-action=export-card]") as HTMLButtonElement;
if (exportVideoBtn) exportVideoBtn.addEventListener("click", exportVideo);
if (exportCardBtn) exportCardBtn.addEventListener("click", exportCard);

// 首页自动加载第一个预置
window.addEventListener("load", () => {
  if (PRESETS.length > 0) {
    setTimeout(() => loadPreset(0), 500);
  }
});










