# Bugfix Requirements Document

## Introduction

Canvas tree animation is completely non-functional despite successful data loading (46 commits visible in status bar). The progress bar animates correctly, confirming the render loop is active, but no tree segments are visible. This is a critical rendering bug that requires systematic diagnosis and repair using the bug condition methodology to ensure the fix works for all buggy inputs while preserving correct behavior for non-buggy scenarios.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN canvas renders during animation (t changes from 0 to 1) THEN no tree segments are drawn on the canvas despite data being loaded and render() being called
1.2 WHEN drawSegments() iterates through geometry.segments with progress values between 0 and 1 THEN the step size of 0.02 causes the loop to potentially skip the final progress value, resulting in incomplete or missing curve endpoints
1.3 WHEN drawSegments() completes its loop with progress < t1 THEN the final endpoint at (x1, y1) is not explicitly drawn, leaving the curve endpoint disconnected
1.4 WHEN ctx.scale() is called with devicePixelRatio twice (once in render() and implicitly in rendering context) THEN the canvas coordinates may be incorrectly scaled, misaligning drawn content with viewport

### Expected Behavior (Correct)

2.1 WHEN canvas renders during animation (t changes from 0 to 1) THEN visible tree segments grow along bezier curves from their birth time to current time
2.2 WHEN drawSegments() iterates through geometry.segments with progress values between 0 and 1 THEN the loop completes and the final endpoint at (x1, y1) is always explicitly included
2.3 WHEN drawSegments() draws a curve segment THEN the curve path from p0 to p1 is complete without gaps or missing endpoints
2.4 WHEN ctx.scale() is applied to set the correct device pixel ratio THEN the canvas coordinates are properly mapped to the viewport and rendered content is visible

### Unchanged Behavior (Regression Prevention)

3.1 WHEN geometry is null or undefined THEN the render() function returns early without attempting to render
3.2 WHEN t is outside the [0, 1] range THEN it is clamped to valid values before being used for animation timing
3.3 WHEN canvasContainer has zero dimensions THEN fallback dimensions (800x450) are used instead of crashing
3.4 WHEN canvas and context are properly initialized THEN non-segment elements (leaves, flowers, text) continue to render correctly
3.5 WHEN the device pixel ratio changes THEN the canvas maintains correct rendering without double-scaling artifacts

---

## 第二轮深挖（2026-10-17）：真实根因与完整修复

> 上一轮结论（双倍 DPR 缩放 / 贝塞尔端点）**被证伪**：无头浏览器实测显示，修复后画布容器
> 计算样式仍是 `display:none`、`rect=0x0`，页面无任何 JS 异常。以下为本次定位到的
> 真实根因清单，按严重度排序。

### 根因 1（致命）：`showCanvas()` 的 display 写法错误

`src/main.ts` 原实现：

```ts
canvasContainer.style.display = "";   // 空串 = 移除内联样式
controls.style.display = "flex";
```

样式表中 `.canvas-container { display: none }`。设为空串会**移除内联样式**，元素回落
到样式表的 `display: none` —— 画布容器从头到尾不可见。渲染循环、数据加载全部正常，
但用户什么都看不到。这解释了全部症状：状态栏动、进度条动、无图像。

**修复**：显式 `canvasContainer.style.display = "block"`；同时补上 `exportArea`
（导出按钮原本同样永远不可见）。

### 根因 2：DPR 变换缺失（反向问题）

上一轮删掉 `ctx.scale(dpr, dpr)` 后，`renderFrame` 收到的 width/height 是 CSS 像素，
而 backing store 是物理像素，且渲染器内部**没有**任何 DPR 变换 —— HiDPI 屏幕上画面
会被限制在左上角。**修复**：`renderFrame` 入口统一
`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`，`main.ts` 传 CSS 像素 + dpr。

### 根因 3：GitHub 分页解析错误（数据完整性）

`github-source.ts` 的 `extractLastPage` 用正则 `/page=(\d+)/` 解析 Link 头，而
`per_page=100` 在查询串中位于 `page=N` **之前**，正则先命中 `page=100` —— 所有
超过 10 页的仓库总页数被误判为 100，等距页取成 [1,12,...,100]，最旧的大段历史
整体丢失（实测 microsoft/TypeScript 的树起点从 2014 年退到 2020 年）。
**修复**：`/[?&]page=(\d+)/`；并消除第 1 页重复请求、4xx 不再重试。

### 根因 4：限流检测从未生效

`error.headers["x-ratelimit-remaining"]` 用下标访问 `Headers` 实例，永远取不到值，
`RATE_LIMITED` 分支不可达，用户看到的是含糊的 FORBIDDEN。**修复**：改用 `.get()`，
并支持 429。

### 其余修复（详见 git 提交与 README）

- `presets.ts` 的 `buildGrowthModel` 参数传反（tags↔commits）
- `identifyLanes` 假设输入有序、forkCommitId 语义错误、孤立支线碎片化
- `computeChapters` 重写（FR-GM-03/04）
- 采样算法按 FR-DT-04 精确等距且不再丢弃强制保留项
- 布局/渲染按 FR-TL 重写（支线、粗细、叶形、落叶、风动、字幕）
- 导出视频改异步帧步进；纪念卡绘制顺序修正
- 取消按钮补事件监听；加载新树重置进度；播放防重复启动

### 验证方式（本次新增，全部通过）

| 层级 | 结果 |
| --- | --- |
| 单元测试（vitest，含分页回归） | 61/61 |
| 端到端（Playwright + 系统 Chrome） | 13/13（预置 + AudioCpp.NET 1.7s + dist 产物） |
| 导出（WebM/PNG 魔数与大小） | 4/4 |
| 边界（404 不崩溃 / 396 页巨库采样） | 通过 |
| `tsc --noEmit` / `vite build` | 通过（gzip 14.6 KB） |
