/**
 * 代码年轮主入口
 * 协调数据获取、布局、渲染和播放
 */

import { GitHubSource } from "./core/github-source";
import { normalizeCommits, detectCommitType, associateTags } from "./core/normalize";
import { sampleCommits, reconnectParents } from "./core/sampler";
import { buildGrowthModel } from "./core/growth-model";
import { layout } from "./layout/tree-layout";
import { renderFrame } from "./rendering/canvas-renderer";
import { parseGitHubInput } from "./core/input-parser";

interface AppState {
  isLoading: boolean;
  geometry: any;
  model: any;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
}

const state: AppState = {
  isLoading: false,
  geometry: null,
  model: null,
  isPlaying: false,
  currentTime: 0,
  duration: 30,
  speed: 1,
};

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

const ctx = canvas.getContext("2d");
let animationFrameId: number | null = null;

// 事件监听器
loadBtn.addEventListener("click", loadRepository);
playBtn.addEventListener("click", () => startPlayback());
pauseBtn.addEventListener("click", () => pausePlayback());
speedSelect.addEventListener("change", (e) => {
  state.speed = parseFloat((e.target as HTMLSelectElement).value);
});
durationSelect.addEventListener("change", (e) => {
  state.duration = parseFloat((e.target as HTMLSelectElement).value);
});
timeSlider.addEventListener("input", (e) => {
  state.currentTime = (parseFloat((e.target as HTMLInputElement).value) / 100) * state.duration;
  render();
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
    showStatus("正在加载...");
    clearError();

    // 解析输入
    const { owner, repo } = parseGitHubInput(input);

    // 获取数据
    const source = new GitHubSource();
    const signal = new AbortController().signal;
    const raw = await source.load(`${owner}/${repo}`, {}, signal);

    showStatus("正在处理数据...");

    // 规范化提交
    const normalized = normalizeCommits(raw);
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

    showStatus(`已加载 ${model.commits.length} 个提交（${Math.floor(samplingRate * 100)}% 采样）`);
    showCanvas();
    render();
  } catch (error: any) {
    showError(error.message || "加载失败");
  } finally {
    state.isLoading = false;
    loadBtn.disabled = false;
  }
}

/**
 * 开始播放
 */
function startPlayback() {
  state.isPlaying = true;
  const startTime = Date.now();
  const startOffset = state.currentTime;

  function animate() {
    const elapsed = (Date.now() - startTime) / 1000;
    state.currentTime = startOffset + elapsed * state.speed;

    if (state.currentTime >= state.duration) {
      state.currentTime = state.duration;
      state.isPlaying = false;
      render();
      return;
    }

    render();
    if (state.isPlaying) {
      animationFrameId = requestAnimationFrame(animate);
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

  // 调整 canvas 尺寸
  const rect = canvasContainer.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  // 渲染
  renderFrame(ctx, state.geometry, t, {
    width: rect.width,
    height: rect.height,
    dpr: window.devicePixelRatio,
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
 */
function showCanvas() {
  canvasContainer.style.display = "";
  controls.style.display = "flex";
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

// 初始化
window.addEventListener("resize", render);
