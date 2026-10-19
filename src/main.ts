/**
 * 代码年轮主入口（三维版）
 * 协调数据获取（含本地缓存）、场景构建、three.js 渲染、播放与交互
 */

import { GitHubSource } from "./core/github-source";
import { normalizeCommits, associateTags } from "./core/normalize";
import { sampleCommits, reconnectParents } from "./core/sampler";
import { buildGrowthModel } from "./core/growth-model";
import { buildForestScene, ForestInput, ForestScene, ForestTreeMeta } from "./three/forest-builder";
import { TreeRenderer, ViewName } from "./three/three-renderer";
import { parseGitHubInput, parseGitHubList } from "./core/input-parser";
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
import { GrowthMusic } from "./audio/growth-music";
import { PerfMonitor, qualityLabel, QualityLevel } from "./core/perf-monitor";

interface AppState {
  isLoading: boolean;
  /** 焦点树的模型（HUD / 导出用它；森林里点哪棵树就切到哪棵） */
  model: GrowthModel | null;
  /** 当前森林：每棵树一个条目 */
  forest: ForestEntry[];
  /** 焦点树索引 */
  focusIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  speed: number;
  token?: string;
  /** 本次加载是否命中了本地缓存 */
  fromCache: boolean;
  cacheSavedAt: number | null;
}

/** 森林里的一棵树 */
interface ForestEntry {
  model: GrowthModel;
  label: string;
  repo: string;
}

// 加载控制
let loadAbortController: AbortController | null = null;

const state: AppState = {
  isLoading: false,
  model: null,
  forest: [],
  focusIndex: 0,
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
const playPauseBtn = document.getElementById("playPauseBtn") as HTMLButtonElement;
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

/**
 * 生长音乐引擎（Web Audio 手搓 MIDI 合成器）
 * 上下文懒创建：只有用户点过音乐按钮才真正出声（浏览器自动播放策略）
 */
const growthMusic = new GrowthMusic({ volume: 0.5 });

/**
 * 帧率监测 → 自动画质降级。
 * 连续多个统计窗口掉到 60fps 的 78%（≈47fps）以下时，依次关高 DPR / 关泛光，
 * 保证老机器与集显也能流畅看完生长动画；用户可在顶栏手动切回高画质。
 */
const perfMonitor = new PerfMonitor({
  onLevelChange: (level, reason) => {
    renderer?.setQuality(level);
    syncQualityButton();
    showStatus(`⚡ 已自动切换到「${qualityLabel(level)}」（${reason}）`);
  },
});

let renderer: TreeRenderer | null = null;
let animationFrameId: number | null = null;
/** 当前仓库的完整名称（owner/repo），缓存状态展示用 */
let currentRepoFull = "";

// ==================== 渲染器生命周期 ====================

function ensureRenderer(): TreeRenderer | null {
  if (renderer) return renderer;
  try {
    renderer = new TreeRenderer(canvas);
    // 每次绘制后把 HTML 名牌摆到对应树的树冠上（相机旋转/缩放时跟随）
    renderer.onAfterRender = updateTreeLabels;
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
/** 加载项：预置 / 内置快照 / 真实仓库 */
type LoadItem =
  | { kind: "preset"; index: number }
  | { kind: "snapshot"; entry: SnapshotEntry }
  | { kind: "repo"; repo: string };

/** 规范化 → 采样 → 生长模型 */
function modelFromRaw(raw: RawHistory, owner: string, repo: string): GrowthModel {
  const normalized = normalizeCommits(raw);
  if (normalized.length === 0) {
    throw new AppError("EMPTY_REPO", ErrorMessages.EMPTY_REPO.message, 404);
  }
  const tagMap = associateTags(normalized, raw.tags || []);
  const { commits: sampled, samplingRate } = sampleCommits(normalized, new Set(tagMap.keys()));
  const reconnected = reconnectParents(sampled, normalized);
  const model = buildGrowthModel(reconnected, raw.tags || [], samplingRate);
  model.source = { kind: "github", owner, repo };
  return model;
}

/** 拉取单个仓库（勾选缓存时优先命中本地缓存） */
async function loadRepo(
  rawRepo: string
): Promise<{ model: GrowthModel; fromCache: boolean; savedAt: number | null }> {
  const { owner, repo } = parseGitHubInput(rawRepo);
  const repoFull = `${owner}/${repo}`;
  const cacheEnabled = isCacheEnabled();
  let raw: RawHistory | null = null;
  let fromCache = false;
  let savedAt: number | null = null;

  if (cacheEnabled) {
    const cached = loadCached(repoFull);
    if (cached) {
      raw = cached.raw;
      fromCache = true;
      savedAt = cached.savedAt;
      showStatus(`命中 ${repoFull} 的本地缓存（${formatCacheAge(cached.savedAt)}）`);
    }
  }

  if (!raw) {
    showStatus(`正在请求 ${repoFull} ...`);
    const source = new GitHubSource();
    loadAbortController = new AbortController();
    raw = await source.load(repoFull, { token: tokenUI.getToken() }, loadAbortController.signal);
    if (cacheEnabled) {
      const result = saveCached(repoFull, raw);
      if (result.ok) {
        savedAt = Date.now();
      } else {
        showStatus(`数据已加载，但缓存写入失败：${result.error}`);
      }
    }
  }

  return { model: modelFromRaw(raw, owner, repo), fromCache, savedAt };
}

/**
 * 统一加载入口：1..N 个项目 → 森林
 * 单个项目就是「一棵树的森林」，与多项目共享同一条渲染/交互路径。
 */
async function loadItems(items: LoadItem[]) {
  if (items.length === 0) return;
  state.isLoading = true;
  loadBtn.disabled = true;
  syncSelectionBar();
  if (cancelBtn) cancelBtn.style.display = "";
  clearError();

  try {
    const entries: ForestEntry[] = [];
    let anyCache = false;
    let lastSaved: number | null = null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (items.length > 1) showStatus(`正在加载第 ${i + 1}/${items.length} 个项目...`);

      if (item.kind === "preset") {
        const preset = PRESETS[item.index];
        entries.push({ model: preset.load(), label: preset.name, repo: "" });
      } else if (item.kind === "snapshot") {
        const entry = item.entry;
        const res = await fetch(`snapshots/${entry.file}`);
        if (!res.ok) throw new Error(`快照读取失败（HTTP ${res.status}）`);
        const data = await res.json();
        const raw = data.raw as RawHistory;
        if (!raw || !Array.isArray(raw.commits)) throw new Error("快照结构异常：缺少提交数据");
        const [owner, repo] = entry.repo.split("/");
        entries.push({ model: modelFromRaw(raw, owner, repo), label: entry.label, repo: entry.repo });
        anyCache = true; // 快照等同「本地已有数据」
        lastSaved = data.fetchedAt ?? null;
      } else {
        const r = await loadRepo(item.repo);
        if (r.fromCache) anyCache = true;
        if (r.savedAt) lastSaved = r.savedAt;
        const [owner, repo] = item.repo.split("/");
        entries.push({ model: r.model, label: repo || item.repo, repo: `${owner}/${repo}` });
      }
    }

    state.fromCache = anyCache;
    state.cacheSavedAt = lastSaved;
    showForest(entries);
    updateUrl(entries);
  } catch (error: any) {
    showError(formatErrorForUI(error));
  } finally {
    loadAbortController = null;
    if (cancelBtn) cancelBtn.style.display = "none";
    state.isLoading = false;
    loadBtn.disabled = false;
    syncSelectionBar();
  }
}

/** 输入框 → 加载（支持一次输入多个仓库，生成森林） */
async function loadRepository() {
  const input = repoInput.value.trim();
  if (!input) {
    showError("请输入 GitHub 仓库地址");
    return;
  }
  const { repos, invalid } = parseGitHubList(input);
  if (repos.length === 0) {
    showError(invalid.length ? `无法解析：${invalid.slice(0, 3).join("、")}` : "请输入 GitHub 仓库地址");
    return;
  }
  if (invalid.length > 0) {
    showStatus(`已忽略无法解析的输入：${invalid.slice(0, 3).join("、")}`);
  }
  await loadItems(repos.map((repo) => ({ kind: "repo" as const, repo })));
}

/** 公共收尾：多棵树 → 森林场景 → 重置进度 → 自动播放 */
function showForest(entries: ForestEntry[]): boolean {
  const r = ensureRenderer();
  if (!r || entries.length === 0) return false;

  const inputs: ForestInput[] = entries.map((e) => ({
    model: e.model,
    label: e.label,
    repo: e.repo,
  }));
  const scene: ForestScene = buildForestScene(inputs);

  state.forest = entries;
  state.focusIndex = 0;
  state.model = entries[0].model;
  currentRepoFull = entries.length === 1 ? entries[0].repo : "";
  repoInput.value = entries
    .map((e) => e.repo)
    .filter(Boolean)
    .join(", ");

  r.setScene(scene);
  pausePlayback();
  state.currentTime = 0;
  // 新场景重新统计帧率：不继承上一个仓库的坏帧，也不重复降档
  perfMonitor.reset();
  infoPanel.show(null);
  mountTreeLabels(scene.trees);
  syncFocusLabels();

  const totalCommits = entries.reduce((n, e) => n + e.model.commits.length, 0);
  const statusText =
    entries.length === 1
      ? `已加载 ${entries[0].model.commits.length} 个提交 · ${entries[0].label}`
      : `已生成 ${entries.length} 棵树的森林 · 共 ${totalCommits} 个提交`;
  showStatus(statusText);
  showCanvas();
  // 换乐谱：焦点树的历史 → 一段五声音阶的「生长音乐」
  growthMusic.setModel(state.model, state.duration);
  startPlayback();
  render();
  refreshCacheStatus(currentRepoFull);
  return true;
}

/** 单项目便捷入口（卡片双击） */
function loadSingle(item: LoadItem) {
  void loadItems([item]);
}

/**
 * 切换焦点树：HUD / 导出 / 信息面板都以焦点树的模型为准
 * 点击某棵树上的叶子或果实、或点击名牌都会调用
 */
function setFocusTree(index: number) {
  const entry = state.forest[index];
  if (!entry) return;
  const changed = state.focusIndex !== index;
  state.focusIndex = index;
  state.model = entry.model;
  currentRepoFull = entry.repo;
  // 焦点树的音乐也跟着换：点哪棵树，就听哪棵树的历史
  growthMusic.setModel(entry.model, state.duration);
  syncFocusLabels();
  if (!changed) return;
  render();
  refreshCacheStatus(currentRepoFull);
  showStatus(
    state.forest.length > 1
      ? `焦点切换到「${entry.label}」· ${entry.model.commits.length} 个提交`
      : `已加载 ${entry.model.commits.length} 个提交 · ${entry.label}`
  );
}

/** 名牌高亮：焦点树加 .focused */
function syncFocusLabels() {
  treeLabelEls.forEach((el, i) => el.classList.toggle("focused", i === state.focusIndex));
}

/** 更新分享链接：多仓库用 ?repos=a/b,c/d */
function updateUrl(entries: ForestEntry[]) {
  const repos = entries.map((e) => e.repo).filter(Boolean);
  if (repos.length === 0) return;
  const next =
    repos.length === 1
      ? `?repo=${encodeURIComponent(repos[0])}`
      : `?repos=${repos.map(encodeURIComponent).join(",")}`;
  if (window.location.search !== next) {
    window.history.replaceState({}, "", next);
  }
}

// ==================== 三维名牌 ====================

const treeLabelsEl = document.getElementById("treeLabels") as HTMLElement | null;
let treeLabelEls: HTMLElement[] = [];

/** 为每棵树创建 HTML 名牌（跟随三维位置） */
function mountTreeLabels(trees: ForestTreeMeta[]) {
  if (!treeLabelsEl) return;
  treeLabelsEl.innerHTML = "";
  treeLabelEls = trees.map((tree) => {
    const el = document.createElement("div");
    el.className = "tree-label";
    const name = document.createElement("span");
    name.textContent = tree.label;
    const meta = document.createElement("span");
    meta.className = "tree-commits";
    meta.textContent = `${tree.commits} 提交`;
    el.append(name, meta);
    // 点名牌也能切换焦点树
    el.addEventListener("click", () => setFocusTree(tree.index));
    treeLabelsEl.appendChild(el);
    return el;
  });
  updateTreeLabels();
}

/** 每帧把名牌摆到对应树的树冠上方 */
function updateTreeLabels() {
  const r = renderer;
  if (!r || treeLabelEls.length === 0) return;
  const anchors = r.treeAnchors();
  const w = canvasContainer.clientWidth || 960;
  const h = canvasContainer.clientHeight || 540;
  for (let i = 0; i < treeLabelEls.length; i++) {
    const anchor = anchors[i];
    const el = treeLabelEls[i];
    if (!anchor || !el) continue;
    const p = r.projectToScreen(anchor);
    // 相机拉远/旋转后树冠可能投影到画布外，超界就隐藏
    const outside = !p.visible || p.x < -60 || p.y < -30 || p.x > w + 60 || p.y > h + 60;
    el.style.display = outside ? "none" : "";
    if (!outside) {
      // 名牌是 translate(-50%,-100%)，把锚点夹在画布内，避免贴在画布外看不见
      const left = Math.min(Math.max(p.x, 46), w - 46);
      const top = Math.min(Math.max(p.y, 26), h - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
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
  // 已播到末尾时再次播放：从头开始，否则会立刻结束
  if (state.currentTime >= state.duration) {
    state.currentTime = 0;
    render();
  }
  state.isPlaying = true;
  syncPlayButton();
  let startTime = performance.now();
  let startOffset = state.currentTime;
  let lastFrameAt = startTime;

  function animate(now: number) {
    // 切后台再回来：rAF 会暂停，回来时 now 跳变一大段。
    // 若直接按 elapsed 推进，动画会「瞬移」到结尾，这里检测到停顿就重新对表。
    if (now - lastFrameAt > 400) {
      startTime = now;
      startOffset = state.currentTime;
    }
    lastFrameAt = now;
    const elapsed = (now - startTime) / 1000;
    state.currentTime = startOffset + elapsed * state.speed;

    if (state.currentTime >= state.duration) {
      state.currentTime = state.duration;
      state.isPlaying = false;
      animationFrameId = null;
      perfMonitor.reset();
      syncPlayButton();
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
  syncPlayButton();
}

/** 同步播放/暂停开关的外观 */
function syncPlayButton() {
  if (!playPauseBtn) return;
  playPauseBtn.textContent = state.isPlaying ? "⏸ 暂停" : "▶ 播放";
  playPauseBtn.classList.toggle("is-playing", state.isPlaying);
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

  // 音乐：把这一帧「新长出来」的提交变成音符（指针推进，不会重播）
  growthMusic.update(t);

  // 帧率采样：连续掉帧就自动降画质（切后台的大间隔帧已被 PerfMonitor 剔除）
  perfMonitor.sample(performance.now());

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
  pointerDown = null;
  // 仅按位移判定拖拽（原先还限制 500ms，慢速点击会被误判为拖拽而不响应）
  if (Math.hypot(dx, dy) > 6) return;

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
  if (!r) return;

  const node = r.getNodeById(key);
  if (!node) return;

  // 森林里每个节点都带 treeIndex：点谁就把焦点切到哪棵树
  const treeIndex = node.item.treeIndex ?? 0;
  if (state.forest[treeIndex]) setFocusTree(treeIndex);

  const model = state.forest[treeIndex]?.model ?? state.model;
  if (!model) return;

  const commitById = new Map(model.commits.map((c) => [c.id, c]));
  const source = model.source.kind === "github" ? model.source : null;

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
    cardCtx.fillText("由代码年轮生成 · https://github.com/dongfangzhizhu/gittree", 50, 1320);

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
// 播放/暂停合并开关：按当前状态切换
playPauseBtn.addEventListener("click", () => {
  if (state.isPlaying) pausePlayback();
  else startPlayback();
});
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
  growthMusic.setDuration(state.duration);
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
  // M：音乐开关（与顶栏按钮同一逻辑）
  if (e.code === "KeyM" && !e.metaKey && !e.ctrlKey) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    e.preventDefault();
    void toggleMusic();
  }
  // P：画质档位循环（与顶栏按钮同一逻辑）
  if (e.code === "KeyP" && !e.metaKey && !e.ctrlKey) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    e.preventDefault();
    cycleQuality();
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

/** 内置快照条目（public/snapshots/index.json） */
interface SnapshotEntry {
  repo: string;
  label: string;
  description: string;
  file: string;
  commits?: number;
  tags?: number;
  tagsTotal?: number;
  fetchedAt?: number;
  sampled?: boolean;
  tagsError?: string | null;
}

// ==================== 项目多选（生成森林） ====================

/** 已选项目：key → 加载项 */
const selection = new Map<string, LoadItem>();
/** 已选卡片：key → 卡片元素（用于切换 .selected） */
const selectionCards = new Map<string, HTMLElement>();
/** 演示预置卡片，首页自动选中第一个用 */
const presetCards: HTMLElement[] = [];

const forestCount = document.getElementById("forestCount") as HTMLElement | null;
const growForestBtn = document.getElementById("growForestBtn") as HTMLButtonElement | null;
const clearSelectionBtn = document.getElementById("clearSelectionBtn") as HTMLButtonElement | null;
const forestHint = document.getElementById("forestHint") as HTMLElement | null;

/** 选中项唯一 key（大小写不敏感，避免同一仓库重复选中） */
function itemKey(item: LoadItem): string {
  if (item.kind === "preset") return `preset:${item.index}`;
  if (item.kind === "snapshot") return `snapshot:${item.entry.repo.toLowerCase()}`;
  return `repo:${item.repo.toLowerCase()}`;
}

/** 点击卡片：加入 / 移出选中集合 */
function toggleSelect(key: string, item: LoadItem, card: HTMLElement) {
  if (selection.has(key)) {
    selection.delete(key);
    selectionCards.delete(key);
    card.classList.remove("selected");
    card.removeAttribute("aria-selected");
  } else {
    selection.set(key, item);
    selectionCards.set(key, card);
    card.classList.add("selected");
    card.setAttribute("aria-selected", "true");
  }
  syncSelectionBar();
}

/** 清空选中 */
function clearSelection() {
  for (const card of selectionCards.values()) {
    card.classList.remove("selected");
    card.removeAttribute("aria-selected");
  }
  selection.clear();
  selectionCards.clear();
  syncSelectionBar();
}

/** 选中态 / 计数 / 按钮可用性 */
function syncSelectionBar() {
  const n = selection.size;
  if (forestCount) {
    forestCount.innerHTML = `已选 <strong>${n}</strong> 个项目`;
    forestCount.classList.toggle("is-empty", n === 0);
  }
  if (growForestBtn) {
    growForestBtn.disabled = n === 0 || state.isLoading;
    growForestBtn.textContent = n > 1 ? `🌱 生长这片森林（${n} 棵）` : "🌳 生长这棵树";
  }
  if (forestHint) {
    forestHint.textContent =
      n === 0
        ? "点卡片可多选；也可在上方输入多个仓库（逗号或换行分隔）"
        : n === 1
          ? "再点其他卡片可继续多选，一次性生成森林"
          : "选好了，点左侧按钮生成森林";
  }
}

/** 按当前选中集合生成森林 */
function growForest() {
  const items = Array.from(selection.values());
  if (items.length === 0) {
    showError("请先选择至少一个项目");
    return;
  }
  void loadItems(items);
}

if (growForestBtn) growForestBtn.addEventListener("click", growForest);
if (clearSelectionBtn) {
  clearSelectionBtn.addEventListener("click", () => {
    clearSelection();
    showStatus("已清空选中项目");
  });
}

/**
 * 初始化预置：演示数据 + 精选真实仓库（内置快照）
 * 卡片点击 = 切换选中（支持多选），由森林条统一触发生长
 */
function initPresets() {
  presetsContainer.innerHTML = "";
  presetCards.length = 0;

  const demoGroup = document.createElement("div");
  demoGroup.className = "preset-group";
  const demoTitle = document.createElement("div");
  demoTitle.className = "preset-group-title";
  demoTitle.textContent = "演示";
  const demoGrid = document.createElement("div");
  demoGrid.className = "presets-grid";

  for (let i = 0; i < PRESETS.length; i++) {
    const preset = PRESETS[i];
    const item: LoadItem = { kind: "preset", index: i };
    const key = itemKey(item);
    const card = document.createElement("div");
    card.className = "preset-card";
    card.dataset.key = key;
    card.innerHTML = `<div>${preset.name}</div><strong>${preset.description}</strong>`;
    card.addEventListener("click", () => toggleSelect(key, item, card));
    presetCards.push(card);
    demoGrid.appendChild(card);
  }
  demoGroup.append(demoTitle, demoGrid);
  presetsContainer.appendChild(demoGroup);

  void initSnapshots();
}

/**
 * 加载内置快照索引并渲染精选仓库卡片
 * 快照是可选加速项：读取失败时在状态栏说明，不阻断主流程
 */
async function initSnapshots() {
  try {
    const res = await fetch("snapshots/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list: SnapshotEntry[] = Array.isArray(data.snapshots) ? data.snapshots : [];
    if (list.length === 0) return;

    const group = document.createElement("div");
    group.className = "preset-group";
    const title = document.createElement("div");
    title.className = "preset-group-title";
    title.textContent = "精选真实仓库（内置快照，无需等待 API）";
    const grid = document.createElement("div");
    grid.className = "presets-grid";

    for (const entry of list) {
      const item: LoadItem = { kind: "snapshot", entry };
      const key = itemKey(item);
      const card = document.createElement("div");
      card.className = "preset-card snapshot-card";
      card.dataset.key = key;
      const name = document.createElement("div");
      name.textContent = entry.label;
      const desc = document.createElement("strong");
      desc.textContent = entry.description;
      const meta = document.createElement("span");
      meta.className = "preset-meta";
      const tagNote =
        entry.tagsTotal && entry.tagsTotal > 0
          ? `${entry.tags ?? 0}/${entry.tagsTotal} 标签`
          : "无标签";
      meta.textContent = `${entry.commits ?? "?"} 提交 · ${tagNote}`;
      card.append(name, desc, meta);
      card.addEventListener("click", () => toggleSelect(key, item, card));
      grid.appendChild(card);
    }

    group.append(title, grid);
    presetsContainer.appendChild(group);
  } catch (error: any) {
    console.warn("内置快照索引加载失败：", error?.message || error);
    showStatus("内置快照不可用（不影响手动加载仓库）");
  }
}

// 处理 URL 参数加载仓库（支持 ?repo=a/b 与 ?repos=a/b,c/d）
function initFromURL() {
  const params = new URLSearchParams(window.location.search);
  const pack = params.get("repos") || params.get("repo");
  if (!pack) return;
  const { repos } = parseGitHubList(pack);
  if (repos.length === 0) return;
  repoInput.value = repos.join(", ");
  setTimeout(() => loadRepository(), 500);
}

// 添加导出按钮事件
const exportVideoBtn = document.querySelector("[data-action=export-video]") as HTMLButtonElement;
const exportCardBtn = document.querySelector("[data-action=export-card]") as HTMLButtonElement;
if (exportVideoBtn) exportVideoBtn.addEventListener("click", exportVideo);
if (exportCardBtn) exportCardBtn.addEventListener("click", exportCard);

// ==================== 生长音乐 ====================

const musicBtn = document.getElementById("musicBtn") as HTMLButtonElement | null;
const midiBtn = document.getElementById("midiBtn") as HTMLButtonElement | null;

/** 同步音乐按钮外观（有声 / 静音） */
function syncMusicButton() {
  if (!musicBtn) return;
  const on = growthMusic.isRunning();
  musicBtn.textContent = on ? "🎵 音乐开" : "🔇 音乐关";
  musicBtn.classList.toggle("is-on", on);
  musicBtn.title = on
    ? "生长音乐播放中：点此静音（快捷键 M）"
    : "点此开启生长音乐：每个提交对应一个音（快捷键 M）";
}

/**
 * 音乐开关：必须在用户手势里创建/恢复 AudioContext，
 * 否则浏览器自动播放策略会把它挂起（表现为「点了没声音」）
 */
async function toggleMusic() {
  if (growthMusic.isMuted()) {
    growthMusic.setMuted(false);
    await growthMusic.resume(); // 恢复被挂起的上下文
    if (!state.model) {
      showError("还没有可播放的项目：先加载一个仓库或点一张卡片");
    } else {
      growthMusic.setModel(state.model, state.duration);
      growthMusic.startDrone();
      showStatus(`🎵 生长音乐已开启 · ${growthMusic.stats().total} 个音符，与生长进度同步`);
    }
  } else {
    growthMusic.setMuted(true);
    growthMusic.stopDrone();
    showStatus("🔇 生长音乐已静音");
  }
  syncMusicButton();
}

if (musicBtn) musicBtn.addEventListener("click", () => void toggleMusic());
if (midiBtn) {
  midiBtn.addEventListener("click", () => {
    if (!state.model) {
      showError("还没有可导出的项目：先加载一个仓库或点一张卡片");
      return;
    }
    growthMusic.exportMidi();
    showStatus("🎹 已导出这段生长音乐的 MIDI 文件（可拖进任意 DAW / 打谱软件）");
  });
}

// ==================== 画质档位 ====================

const qualityBtn = document.getElementById("qualityBtn") as HTMLButtonElement | null;
const QUALITY_ORDER: QualityLevel[] = ["high", "medium", "low"];
const QUALITY_ICON: Record<QualityLevel, string> = {
  high: "✨",
  medium: "⚖",
  low: "🍃",
};

/** 同步画质按钮外观（档位 → 图标/文案/配色，配色由 data-level 驱动 CSS） */
function syncQualityButton() {
  if (!qualityBtn) return;
  const level = perfMonitor.getLevel();
  qualityBtn.textContent = `${QUALITY_ICON[level]} ${qualityLabel(level)}`;
  qualityBtn.dataset.level = level;
  qualityBtn.title =
    level === "high"
      ? "当前高画质（泛光 + 高分辨率）。掉帧时会自动降档，点此手动切换"
      : `当前「${qualityLabel(level)}」。点此切换到更高画质`;
}

/** 手动循环切换画质：高 → 均衡 → 流畅 → 高 */
function cycleQuality() {
  const idx = QUALITY_ORDER.indexOf(perfMonitor.getLevel());
  const next = QUALITY_ORDER[(idx + 1) % QUALITY_ORDER.length];
  perfMonitor.setLevel(next, "手动切换");
  renderer?.setQuality(next);
  syncQualityButton();
  showStatus(`🎨 画质已切换到「${qualityLabel(next)}」`);
}

if (qualityBtn) qualityBtn.addEventListener("click", cycleQuality);

// 初始化
window.addEventListener("resize", render);
initPresets();
initFromURL();
syncMusicButton();
syncQualityButton();

// 调试钩子：暴露内部状态供端到端测试检查（只读快照）
(window as any).__gittree = {
  getState: () => ({
    commits: state.model?.commits.length ?? 0,
    samplingRate: state.model?.metadata?.samplingRate ?? 0,
    lanes: state.model?.lanes.length ?? 0,
    chapters: state.model?.chapters.map((c) => c.title) ?? [],
    segments: renderer?.stats().segments ?? 0,
    branches: renderer?.stats().branches ?? 0,
    leaves: renderer?.stats().leaves ?? 0,
    flowers: renderer?.stats().fruits ?? 0,
    fruits: renderer?.stats().fruits ?? 0,
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    firstCommitTime: state.model?.commits[0]?.time ?? null,
    lastCommitTime: state.model?.commits[state.model?.commits.length - 1]?.time ?? null,
    commitTimeAt: (idx: number) => state.model?.commits[idx]?.time ?? null,
    source: state.model?.source ?? null,
    trees: renderer?.stats().trees ?? 0,
    focusIndex: state.focusIndex,
    forest: state.forest.map((e) => ({
      label: e.label,
      repo: e.repo,
      commits: e.model.commits.length,
    })),
    selection: selection.size,
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
  /** 生长音乐状态（测试/调试） */
  music: () => ({ ...growthMusic.stats(), muted: growthMusic.isMuted(), running: growthMusic.isRunning() }),
  /** 切换音乐（需在用户手势里调用，测试用 click 即可） */
  toggleMusic: () => void toggleMusic(),
  /** 画质/帧率状态（测试/调试） */
  perf: () => perfMonitor.stats(),
  /** WebGL 渲染开销（draw call / 三角面 / 显存对象数） */
  drawInfo: () => {
    const info = renderer?.renderer.info;
    if (!info) return null;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      quality: renderer?.getQuality() ?? "high",
      bloom: renderer?.isBloomEnabled() ?? false,
    };
  },
  /** 手动设置画质档位（测试用） */
  setQuality: (level: QualityLevel) => {
    perfMonitor.setLevel(level, "调试钩子");
    renderer?.setQuality(level);
    syncQualityButton();
  },
  /** 每棵树的树冠锚点（世界坐标） */
  treeAnchors: () => renderer?.treeAnchors() ?? [],
  /** 每棵树的树冠锚点 → 页面坐标（测试名牌位置） */
  treeLabelPos: () =>
    treeLabelEls.map((el) => ({
      text: el.textContent ?? "",
      display: el.style.display,
      left: el.style.left,
      top: el.style.top,
      focused: el.classList.contains("focused"),
    })),
  /** 当前选中集合（测试多选） */
  selectionKeys: () => Array.from(selection.keys()),
  /** 点击第 i 张卡片（preset 或 snapshot 索引） */
  clickCard: (index: number, scope: "preset" | "snapshot" = "preset") => {
    const el =
      scope === "preset"
        ? presetCards[index]
        : presetsContainer.querySelectorAll<HTMLElement>(".snapshot-card")[index];
    el?.click();
    return !!el;
  },
  /** 切换焦点树 */
  selectTree: (index: number) => {
    setFocusTree(index);
    return state.focusIndex;
  },
  /** 直接按预置索引生成单棵树 */
  loadPreset: (index: number) => {
    if (!PRESETS[index]) return false;
    loadSingle({ kind: "preset", index });
    return true;
  },
  /** 按「owner/repo」列表生成森林（内置快照优先，否则走 API） */
  growRepos: (repos: string[]) => {
    void loadItems(repos.map((repo) => ({ kind: "repo" as const, repo })));
    return repos.length;
  },
};

// 首页自动加载第一个预置（同时点亮它的卡片选中态）
window.addEventListener("load", () => {
  if (PRESETS.length === 0) return;
  setTimeout(() => {
    const card = presetCards[0];
    if (card && !selection.has("preset:0")) toggleSelect("preset:0", { kind: "preset", index: 0 }, card);
    loadSingle({ kind: "preset", index: 0 });
  }, 500);
});
