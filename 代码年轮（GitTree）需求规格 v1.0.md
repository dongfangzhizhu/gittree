# 代码年轮（GitTree）需求规格 v1.0

> 面向 Kiro「鬼点子」计划 · 5 阶段路线 · 阶段 1 为参赛 MVP（2026.10.17–10.22）。产品名为暂定，可替换。

## 0. 项目概述

### 0.1 一句话

输入一个 GitHub 仓库地址，生成一棵随提交历史生长的树；可播放、可拖动时间轴，可导出视频和成长纪念卡。

### 0.2 愿景与赛道定位

- 主赛道：**无心之心**（代码很冷，内核很暖）——给每个项目一份成长纪念。
- 兼具**无趣之趣**：不讲价值，打开即好玩。
- 长期愿景：让任何仓库的历史都能被看见、被讲述、被珍惜。

### 0.3 目标用户

| 用户 | 场景 | 核心诉求 |
| --- | --- | --- |
| 个人开发者 | 项目周年、离职纪念 | 一张好看的纪念卡 |
| 开源维护者 | 版本回顾、README 展示 | 一段可分享的视频或图 |
| 团队负责人 | 年终复盘 | 看清阶段与贡献者 |
| 评委 / 路人 | 打开链接的前 10 秒 | 立刻看到一棵树在生长 |

### 0.4 产品原则

1. **确定性**：同一输入、同一参数，必得同一棵树。
2. **渲染纯函数**：画面只由 (geometry, t) 决定，不读时钟、不用随机数。
3. **零上传**：本地数据不离开浏览器；token 不落盘、不入日志、不进 URL。
4. **优雅降级**：任何一步失败都有明确提示和兜底（预置作品）。
5. **先竖切后打磨**：先打通「输入→树→播放→导出」，再提升视觉。
6. **内容合规**：只展示公开仓库的公开信息。
7. **为后续阶段留口**：数据源抽象、core 不依赖 DOM、数据带 schemaVersion。

### 0.5 阶段 1 明确不做

本地目录读取、CLI、GitHub Action、LLM 叙事、MP4 逐帧离线导出、多仓库森林、非 GitHub 平台、私有仓库。

## 1. 阶段总览

| 阶段 | 时间 | 主题 | 交付物 |
| --- | --- | --- | --- |
| **P1** | 10.17–10.22 | 参赛 MVP | 在线网页：GitHub 地址→树→播放→导出 WebM→纪念卡；预置作品集；Kiro 工程化证据 |
| P2 | 赛后 1–2 周 | 本地与质量 | 本地目录读取、精确改动统计、缓存、MP4 逐帧导出、交互与视觉升级 |
| P3 | 赛后 3–4 周 | 自动化与分发 | CLI、GitHub Action、README 徽章、npm 包、SVG 渲染后端 |
| P4 | 赛后 1–2 月 | 智能叙事与个性化 | LLM 章节叙事、多语言、主题皮肤、竖屏短视频、团队年度回顾 |
| P5 | 赛后 2–4 月 | 规模与生态 | 多仓库森林、Gitee/GitLab、私有仓库、WASM 大仓库、嵌入组件、插件与画廊 |

优先级标记：**\[M\]** 必须 · **\[S\]** 应该 · **\[C\]** 可以。

## 2. 阶段 1：参赛 MVP

### 2.1 用户故事

- US-1：作为评委，我打开链接不输入任何东西，就能看到一棵树在自动生长。
- US-2：作为用户，我粘贴一个 GitHub 仓库地址，几秒内看到它的树。
- US-3：作为用户，我能播放、暂停、调速、拖动时间轴，并看到当前处于哪个阶段。
- US-4：作为用户，我能把生长过程导出为视频，并导出一张成长纪念卡。
- US-5：作为开发者，我能看到这个项目是如何用 Kiro 的 Spec、Steering、Hooks 做出来的。

### 2.2 数据摄取（FR-IN）

**FR-IN-01 \[M\] 输入解析**

- 接受 `https://github.com/{owner}/{repo}`（允许 `.git` 后缀、末尾斜杠、`/tree/...` 子路径）和 `owner/repo` 简写，解析出 owner 与 repo。
- 其他域名返回 `UNSUPPORTED_HOST`；无法解析返回 `INVALID_INPUT`。

**FR-IN-02 \[M\] 数据源抽象**

- 定义接口 `HistorySource.load(input, options, signal): Promise<RawHistory>`；P1 只实现 `GitHubSource`。
- `src/core` 下的代码不得引用 `window`、`document`，以便 P3 在 Node 中复用。

**FR-IN-03 \[M\] 仓库与提交获取**

- 先请求 `GET /repos/{owner}/{repo}` 获取默认分支与创建时间。
- 请求 `GET /repos/{owner}/{repo}/commits?per_page=100&page=1`，从响应头 `Link` 的 `rel=last` 得到总页数 N。
- 当 N ≤ 10：取全部页。当 N > 10：取 10 个**等距页**，页码为 `round(1 + i*(N-1)/9)`，i=0..9，保证包含第 1 页和最后一页（最旧提交）。
- 合并去重后写入 `metadata.truncated=true` 与 `estimatedTotal = N*100`。
- 单次加载最多 14 个请求（含 tags），以适应未登录 60 次/小时的限额。

**FR-IN-04 \[M\] 标签获取**

- 请求 `GET /repos/{owner}/{repo}/tags?per_page=100`，最多 3 页。
- 仅保留其 commit sha 存在于已取提交中的标签；其余计入 `metadata.droppedTags`。
- 已知限制：截断时部分标签会丢失，P2 用 GraphQL 修复。

**FR-IN-05 \[M\] 限流处理**

- 当响应为 403/429 且 `X-RateLimit-Remaining` 为 0 时，抛出 `RATE_LIMITED`，附带 `retryAfterSeconds`（由 `X-RateLimit-Reset` 计算）。
- UI 显示倒计时，并提示可输入个人 token 或试用预置作品。

**FR-IN-06 \[M\] 超时、重试与取消**

- 单请求超时 15 秒；网络错误重试 1 次（退避 800ms）；4xx 不重试。
- 全流程使用 `AbortController`，用户点击取消后立即停止并回到 idle。

**FR-IN-07 \[M\] 进度反馈**

- 加载中显示「已获取 x / y 页」与当前步骤（仓库信息→提交→标签→整理→布局）。

**FR-IN-08 \[S\] Token 支持**

- 提供折叠的 token 输入框；token 仅存内存，用户勾选「本次会话记住」时才写 `sessionStorage`。
- token 不得出现在日志、URL、错误上报中。

**FR-IN-09 \[S\] 会话缓存**

- 同一仓库在同一会话内再次加载，直接使用内存缓存，并提示「使用缓存数据」。

### 2.3 归一化与采样（FR-DT）

**FR-DT-01 \[M\] 统一提交模型**

- 每个提交包含：`id, parents, author{name, login?}, time(毫秒), message(仅首行，≤200 字符), type, isMerge, weight?, filesChanged?`。
- `weight`、`filesChanged` 在 GitHub 来源下不提供（可选字段）。

**FR-DT-02 \[M\] 类型识别**

- 按前缀识别 `feat|fix|docs|refactor|test|perf|chore`（不区分大小写，允许 scope，如 `fix(core):`）。
- 以 ` Merge  ` 开头或 `parents.length > 1` 视为 `merge`；以 `Revert` 开头视为 `revert`；其余为 `other`。
- 另识别本项目约定前缀 `spec:`、`hook:`（见 FR-KR）。

**FR-DT-03 \[M\] 排序与去重**

- 按 `time` **升序**排序；时间相同按 `id` 字典序，保证确定性。
- 以 `id` 去重。

**FR-DT-04 \[M\] 采样**

- 当提交数 ≤ 500：全部保留。
- 否则先确定强制保留集：最早提交、最新提交、全部 merge、全部带标签的提交。
- 剩余名额 = 500 − 强制集大小；若 ≤ 0，则在强制集内优先保留首尾与标签，merge 按序号等距抽样补足至 500。
- 剩余名额 > 0 时，对其余提交按**序号等距**选取：第 k 个取 `round(k*(n-1)/(m-1))`。
- 采样结果写入 `metadata.samplingRate = 保留数 / 总数`。

**FR-DT-05 \[M\] 父节点重连**

- 采样后，每个保留提交的 `parents` 替换为其最近的保留祖先（沿被删节点向上广度优先，保持原 parents 顺序）。
- 找不到保留祖先时（例如等距取页造成的空洞），连接到时间上紧邻的更早保留提交；最早的提交为根。
- 重连后图必须是单根有向无环图。

**FR-DT-06 \[M\] 确定性**

- 同一 `RawHistory` 与参数，多次运行输出的 JSON 字符串逐字相同（有单元测试）。
- 禁止在 `core` 与 `layout` 中使用 `Math.random()`、`Date.now()`、`new Date()` 无参调用。

### 2.4 生长模型（FR-GM）

**FR-GM-01 \[M\] 主干与支线识别**

- 从最新提交沿 `parents[0]`（first-parent）回溯得到**主干**（`laneId = 0`）。
- 不在主干上的提交，按它们被合并进主干的 merge 提交的第二父节点起，沿 first-parent 链划分为**支线**，并分配递增的 `laneId`。
- 未被合并的孤立支线（分支尚未 merge）也归为独立 lane，标记 `merged=false`。
- 每个 lane 记录：`parentLane`、`forkCommitId`、`mergeCommitId?`、`commitIds[]`。

**FR-GM-02 \[M\] 贡献者统计**

- 统计每位作者：`commits`、`firstTime`、`lastTime`；按提交数降序、同数量按名字字典序排列。
- 前 11 位分配独立颜色，其余合并为「其他」（第 12 色）。颜色由排名决定，不随机。
- 同一作者的多个 `name` 按 `login` 合并；没有 `login` 时按 `name` 合并。

**FR-GM-03 \[M\] 章节划分（3–6 个）**

- 将时间跨度等分为 20 个窗口，统计每窗提交数，得到密度曲线。
- 强制切分点：① 主版本标签（匹配 `^v?\d+\.0(\.0)?$`）；② 沉寂期（连续无提交超过总跨度 10% 且超过 14 天）。
- 切分后合并到 3–6 段：段数超过 6 时，反复合并提交数最少的相邻两段；不足 3 时，按提交数等分补足。
- 章节只记录 `startIndex`、`endIndex`、`startTime`、`endTime`、`season`、`title`，**不内嵌 commit 对象**。

**FR-GM-04 \[M\] 规则标题（不依赖 LLM）**

| 条件（按顺序匹配） | 标题 | 季节 |
| --- | --- | --- |
| 第 1 章 | 萌芽期 | 春 |
| 含主版本标签 | 里程碑期 | 夏 |
| 密度 ≥ 均值×1.5 | 扩张期 | 夏 |
| refactor 占比 > 20% | 重构期 | 秋 |
| 密度 ≤ 均值×0.5 | 沉淀期 | 冬 |
| 最后 1 章 | 当下 | 秋 |
| 其他 | 稳定期 | 秋 |

- 同一张卡片中标题重复时，后缀「· 二」「· 三」。

**FR-GM-05 \[M\] 纪念统计**（在采样**前**的全部已取提交上计算）

- 首次提交日期、最近提交日期、存续天数、总提交数（截断时标「约」）、贡献者数、最活跃的一天及当天提交数、最长沉寂期（天数及起止日期）。
- 所有日期按 UTC 计算并在界面标注「UTC」。

**FR-GM-06 \[M\] 模型版本**

- 输出包含 `schemaVersion`（P1 = 1）、`generatedAt`、`source{kind, owner, repo, defaultBranch}`，预置作品与实时生成使用同一结构。
- `generatedAt` 仅用于展示，不参与任何布局或渲染计算。

### 2.5 树布局（FR-TL）

**FR-TL-01 \[M\] 纯函数布局**

- 签名：`layout(model, options{seed, width=1920, height=1080}): TreeGeometry`。
- 无副作用，不访问 DOM，不读时钟；随机数只允许来自种子 PRNG（mulberry32），种子 = `hash32(seed + commit.id)`。
- 默认 `seed` = 仓库全名 `owner/repo`，使同一仓库的树稳定。

**FR-TL-02 \[M\] 坐标系**

- 逻辑画布 1920×1080，原点左上。树根在 (960, 1000)，树冒高度不超过 820，水平范围在 80–1840。

**FR-TL-03 \[M\] 主干**

- 主干的每个提交对应一段线段（二次贝塞尔），总体向上，每段左右偏摆 ±7°（由 hash 决定）。
- 段长度 = `clamp(820 / n_trunk, 3, 40)`。

**FR-TL-04 \[M\] 支线分枝**

- 支线从 `forkCommitId` 的线段末端分出，角度 25°–55°（hash 决定），同一父节点的相邻支线**左右交替**。
- 递归深度上限 3，更深的支线按深度 3 处理。少于 3 个提交的支线不单独分枝，直接表现为父枝上的叶。

**FR-TL-05 \[M\] merge 嫁接**

- 在 merge 提交处，从被合并支线末端到 merge 点画一条弧线（`kind=graft`），嫁接线在 merge 提交的 `birth` 时刻延伸完成。

**FR-TL-06 \[M\] 粗细**

- 采用管道模型：`thickness = clamp(1.2 * sqrt(子树提交数), 1, 22)`，向梢逐渐变细。
- 有 `weight` 时（本地来源，阶段 2）叠加其影响；P1 不依赖 `weight`。

**FR-TL-07 \[M\] 叶、花、果**

- 每个非 merge 提交在其线段末端附近生成一片叶（偏移与朝向由 hash 决定），颜色 = 作者色，形状和大小按类型查表（见附录 B）。
- 每个标签生成一朵花；主版本标签生成大花和一颗果实。
- `spec:` 和 `hook:` 提交生成紫色小花，用于展示项目自身的 Kiro 使用痕迹。

**FR-TL-08 \[M\] 落叶与冬季**

- 每片叶有 `fallAt`：若其后出现沉寂期（FR-GM-03 的定义），则在沉寂期起点之后的 `t` 段内逐批飘落；否则不落。
- 落叶时刻由叶的 hash 在该区间内散布。沉寂期结束后，新提交重新发芽。

**FR-TL-09 \[M\] 时间映射**

- 动画时间 `t ∈ [0,1]` 按**提交序号**均匀分配，不按真实时间，避免长沉寂期让动画空转。
- 每个沉寂期在动画中占固定的 `t` 区间（全片的 4%）用于冬季表现；真实日期通过 `t → date` 的分段线性映射表提供给字幕。

**FR-TL-10 \[M\] 规模保护**

- 支线超过 300 条时，只独立渲染提交数最多的 60 条，其余折叠为父枝上的叶。布局不做精确碰撞避让，靠角度交替和长度缩放保证可读。

**FR-TL-11 \[M\] 输出结构 `TreeGeometry`**

- `segments[]`：`id, commitId, laneId, kind(trunk|branch|graft), p0, c, p1, w0, w1, birth:[t0,t1]`。
- `leaves[]`：`id, commitId, pos, angle, size, shape, authorColor, birth, fallAt?`。
- `flowers[]`：`id, tag, pos, size, birth, kind(normal|major|spec)`。
- `chapters[]`：`title, season, t0, t1, dateRange`；`timeMap[]`：`[t, epochMs]` 分段点。
- 性能：500 个提交的布局耗时≤ 200ms（主流笔记本）。

### 2.6 渲染与播放（FR-RD）

**FR-RD-01 \[M\] 纯函数渲染**

- 签名：`renderFrame(ctx, geometry, t, opts{width, height, dpr, sway, theme, labels})`。
- 同一 (geometry, t, opts) 必得同一画面，不读 `Date.now`/`performance.now`/`Math.random`。
- 高度自适应，内部布局统一用 1920×1080 逻辑坐标缩放。

**FR-RD-02 \[M\] 生长动画**

- 线段在 `birth=[t0,t1]` 内按 easeOutCubic 从 p0 向 p1 生长（沿贝塞尔曲线的已生长部分）。
- 叶在其 `birth` 时刻从 0 放大到目标尺寸（200ms 等效的 `t` 跨度）；花在 birth 时刻绿放。
- 风动（`sway`）：径向摆动相位由 `t` 推导，不依赖墙上时钟；控制项可关闭。

**FR-RD-03 \[M\] 季节与背景**

- 天空和地面颜色按当前章节的 `season` 在章节边界附近 5% 的 `t` 内平滑插值。
- 冬季叶色变淡、落叶、可选飘雪（由 `t` 和粒子索引确定性推导）。

**FR-RD-04 \[M\] 播放控制**

- 播放/暂停（空格键）、速度 0.5×/1×/2×/4×、渲染循环用 `requestAnimationFrame`，`t` 由播放器累加得到。
- 默认总时长 30 秒，可选 10/30/60/120 秒。到达末尾后停止，点击「重播」回到 t=0。
- 时间轴可拖动（实时重绘），键盘 ←/→ 按一个提交步进、Home/End 跳到头尾。
- 时间轴上显示章节分段和标签刻度。

**FR-RD-05 \[M\] 信息显示**

- 画面内显示当前章节标题、当前日期（由 `timeMap` 插值）、已生长的提交数 / 总数。
- 图例：作者色（前 5 + 其他）、叶形含义。

**FR-RD-06 \[S\] 悬停详情**

- 鼠标悬停在叶/花上时显示提示：7 位 hash、作者、日期（YYYY-MM-DD）、首行消息；命中测试使用网格空间索引，只命中当前已生长的元素。

**FR-RD-07 \[M\] 响应式**

- 画布按容器宽度自适应，保持 16:9；DPR 上限 2；窗口缩放时重绘。移动端支持观看和拖动时间轴，不要求导出。

**FR-RD-08 \[M\] 性能**

- 500 提交规模下，主流笔记本上目标 ≥ 50 fps。
- 连续 1 秒平均低于 30 fps 时自动降级：关闭风动和阴影，再降级则关闭粒子。
- 跳过已完全生长、且不受风动影响的静态元素重绘：可将已完全生长的贝塞尔线段缓存为离屏 Path2D。

**FR-RD-09 \[M\] 无障碗与偏好**

- 系统设置 `prefers-reduced-motion` 时，默认不自动播放，直接展示完整的树，关闭风动和落叶。
- 控件可用键盘操作，文字对比度达到 WCAG AA，画布带 `aria-label`（包含仓库名与统计摘要）。

### 2.7 视频导出（FR-EX）

**FR-EX-01 \[M\] 浏览器端录制**

- 点击「导出视频」后，在离屏 Canvas（1920×1080 或 1280×720，由用户选择）上从 t=0 到 t=1 按所选时长播放，用 `canvas.captureStream(30)` 与 `MediaRecorder` 录制。
- 编码优先 `video/webm;codecs=vp9`，不支持时回退 `vp8`；都不支持（如部分 Safari）时提示「请使用最新的 Chrome 或 Edge 导出」。
- 录制和预览调用同一个 `renderFrame`。

**FR-EX-02 \[M\] 导出交互**

- 导出期间显示进度条和「取消」按钮，禁用播放控制和输入框；取消则丢弃已录制数据并回到 ready 状态。
- 页面切到后台会导致 `requestAnimationFrame` 暂停，导出期间显示「请保持本页为前台」的提示。

**FR-EX-03 \[S\] 片头片尾与字幕**

- 片头 1.5 秒：仓库名、日期范围、一句温暖的文案；片尾 2 秒：纪念统计（存续天数、提交数、贡献者）。
- 播放期间底部显示当前章节标题与日期，章节切换时有 0.4 秒淡入。

**FR-EX-04 \[M\] 输出与失败处理**

- 文件名 `{repo}-growth-{yyyymmdd}.webm`；完成后提示文件大小并触发下载。
- `MediaRecorder` 不可用、编码报错、内存不足时给出明确原因，不得无响应。

**FR-EX-05 已知限制（写入 README）**

- 实时录制的帧时间不严格确定，但每一帧的画面内容由 `t` 决定；严格逐帧、MP4 输出在阶段 2/3 提供。

### 2.8 成长纪念卡（FR-CD）

**FR-CD-01 \[M\] 导出 PNG**

- 竖版 1080×1350：顶部仓库名与「已经生长 N 天」；中部为 t=1 的完整树；下部为 2×3 的数据格（首次提交、总提交、贡献者、最活跃的一天、最长沉寂、章节数）；底部章节进度条和「由代码年轮生成」。
- 没有标签数据时该格改显示「章节」，不显示 0 或 undefined。

**FR-CD-02 \[M\] 文案**

- 按存续天数选择文案模板：< 90 天「刚刚发芽」、 90–730 天「正在拔节」、> 730 天「已经成林」。文案由规则产生，不调用外部服务。

**FR-CD-03 \[S\] 隐私开关**

- 提供「隐藏贡献者姓名」开关，开启后所有展示位置只显示「贡献者 1、贡献者 2…」。

**FR-CD-04 \[C\] 复制到剪贴板**。

### 2.9 预置作品集（FR-PR）

**FR-PR-01 \[M\] 预置数据**

- 5 个仓库的 `GrowthModel` JSON 放在 `public/presets/{owner}__{repo}.json`，每个 ≤ 150 KB，附 `index.json`（列表、许可证、来源链接）。
- 选择标准：许可证允许展示（MIT/Apache-2.0/BSD）、内容合规、历史有看点；规模涵盖小（<100）、中（≈500）、大（>5000，已采样），并**包含本项目自身**。

**FR-PR-02 \[M\] 生成脚本**

- `scripts/build-presets.ts` 使用环境变量 `GITHUB_TOKEN` 拉取并走与网页完全相同的 core 管线，输出 JSON；脚本可重复运行，输出确定（除 `generatedAt`）。

**FR-PR-03 \[M\] 默认体验**

- 首页打开即自动载入一个预置作品并开始播放（`prefers-reduced-motion` 时显示静态完整树），下方展示预置卡片，点击切换。
- 预置作品也支持导出视频和纪念卡。
- 页面显示每个预置仓库的来源链接与许可证。

### 2.10 界面（FR-UI）

**FR-UI-01 \[M\] 单页布局**

- 顶部品牌与一句话介绍；输入区（仓库地址输入框 + 「让它生长」按钮 + 折叠 token）；舞台（16:9 画布）；控制条（播放、速度、时长、时间轴、章节刻度）；导出区（视频、纪念卡）；预置作品卡片。

**FR-UI-02 \[M\] 状态机**

- `idle → loading → ready → playing ⇄ paused → exporting`；任何状态出错进入 `error`，点击「重试」或「试试预置作品」回到 idle。
- 状态转移集中在一个纯函数 reducer 中，并有单元测试。

**FR-UI-03 \[M\] 文案**

- 界面全中文，文案集中在 `src/ui/strings.zh.ts`（为 P4 的多语言留口）；语气温暖，不显示技术堆栈。

**FR-UI-04 \[S\] 链接分享**

- 支持 `#/r/{owner}/{repo}`：打开后自动加载（预置优先，否则实时获取）；该地址不得包含 token。

**FR-UI-05 \[M\] 视觉基调**

- 深色背景，树和叶为主视觉；不用外部 UI 框架，样式用 CSS 变量管理（为 P4 主题皮肤留口）。

### 2.11 Kiro 工程化（FR-KR，占评分 35%）

**FR-KR-01 \[M\] Steering**

- `.kiro/steering/product.md`：产品目标、赛道定位、产品原则；`tech.md`：TypeScript strict、Vite、原生 Canvas、禁用 `Math.random`/`Date.now` 的区域；`structure.md`：目录边界（`core` 不依赖 DOM）。

**FR-KR-02 \[M\] Specs**

- `.kiro/specs/ingestion`、`tree-render`、`export-card` 三个 spec，各有 `requirements.md`、`design.md`、`tasks.md`。
- 需求变更通过在 Kiro 中对话更新 spec，而不是手改文件，以保留迭代记录。

**FR-KR-03 \[M\] Hooks（≥ 2 个）**

- 保存 `src/**/*.ts` 时运行 `tsc --noEmit` 与相关 Vitest。
- 任务完成或提交前核对 README 功能清单与实际功能是否一致（\[S\]）。

**FR-KR-04 \[S\] MCP 与其他能力**

- 时间允许时接入 Git 或文件系统 MCP；如果使用了 Kiro CLI、Web 或 Crew，在说明文档中如实写明用在哪一步。

**FR-KR-05 \[M\] 提交约定**

- Conventional Commits，并额外使用 `spec:`（规格变更）和 `hook:`（钩子变更）前缀，使项目自己的树上出现紫花。

**FR-KR-06 \[M\] 证据文档 `docs/KIRO.md`**

- 记录：每个 spec 的演进（一句话需求→需求→设计→任务）、Hooks 的触发与效果、哪些模块由 Kiro agent 生成、关键截图、遇到的问题与 spec 调整过程。

**FR-KR-07 \[M\] 仓库**

- 公开仓库、MIT 许可证、保留 `.kiro` 目录；首个提交发生在活动期间，提交历史完整不重写。

### 2.12 交付物（FR-DL）

- **FR-DL-01 \[M\]** 公开在线链接（HTTPS、无需登录、静态托管），在无痕窗口中打开即可立刻看到树在长。
- **FR-DL-02 \[M\]** Demo 说明 ≤ 200 字：简述技术实现和使用的 Kiro 能力（Spec、Steering、Hooks 等）。
- **FR-DL-03 \[M\]** README：功能、架构图、运行方式、已知限制（数据源限额、截断、WebM）、Kiro 使用说明（链接 `docs/KIRO.md`）。
- **FR-DL-04 \[S\]** 演示录屏（备份）：时长以报名页要求为准，含字幕或语音；结构为「树在长 → 输入仓库 → 拖时间轴 → 导出 → Kiro 过程 → 项目自己的树」。
- **FR-DL-05 \[M\]** 通过报名表单提交：https://www.infoq.cn/form/?id=3286。截止时间以报名页为准，目标「10.22 白天」提交。

### 2.13 非功能需求（NFR）

| ID | 项 | 标准 |
| --- | --- | --- |
| NFR-01 | 首屏 | 导入后 2 秒内开始播放预置树；实时仓库在网络正常时 ≤ 8 秒出树 |
| NFR-02 | 体积 | 程序 gzip ≤ 200 KB（不含预置 JSON）；运行时依赖 ≤ 3 个 |
| NFR-03 | 兼容 | 最新版 Chrome/Edge 全功能；Firefox 可看可导出（如不支持则提示）；Safari 可看、导出可能受限 |
| NFR-04 | 确定性 | 单元测试：同输入两次布局，`JSON.stringify` 相等；同 (geometry,t) 两次渲染，像素相等 |
| NFR-05 | 测试 | Vitest 覆盖 `core`、`layout`、状态 reducer；不做 Canvas mock 测试 |
| NFR-06 | 代码质量 | TypeScript strict，ESLint 无错误，`tsc --noEmit` 通过 |
| NFR-07 | 安全 | token 不入日志/URL；设置 CSP；不渲染用户输入的 HTML（提交信息一律作纯文本） |
| NFR-08 | 隐私 | 不收集用户数据；不接入第三方统计 |
| NFR-09 | 可靠性 | 任何失败路径不白屏，均有中文提示和可点击的下一步 |
| NFR-10 | 合规 | 仅展示公开仓库的公开信息；预置作品标注来源与许可证 |

### 2.14 错误码表

| 错误码 | 触发 | 用户提示 | 可用的下一步 |
| --- | --- | --- | --- |
| INVALID\_INPUT | 地址无法解析 | 这看起来不像 GitHub 仓库地址 | 显示格式示例 |
| UNSUPPORTED\_HOST | 非 github.com | 目前只支持 GitHub | 试试预置作品 |
| NOT\_FOUND | 404 | 仓库不存在或不是公开仓库 | 检查地址 |
| FORBIDDEN | 403（非限流） | 该仓库无法访问 | 预置作品 |
| RATE\_LIMITED | 限流 | 请求太频繁，X 分钟后再试 | 输入 token / 预置作品 |
| NETWORK | 超时/断网 | 网络似乎不太稳定 | 重试 |
| EMPTY\_REPO | 没有提交 | 这个仓库还没有提交 | 预置作品 |
| EXPORT\_UNSUPPORTED | 浏览器不支持录制 | 请用 Chrome 或 Edge 导出 | 导出纪念卡图片 |
| EXPORT\_FAILED | 编码失败 | 导出中断了 | 降低分辨率重试 |

### 2.15 阶段 1 完成定义与降级顺序

**完成定义（全部满足才算可提交）**

1. 公开链接打开即见树在长；粘贴一个公开 GitHub 地址能得到自己的树。
2. 能播放、暂停、拖动时间轴，显示章节和日期。
3. 能导出可播放的 WebM 和 PNG 纪念卡。
4. 布局与模型的确定性测试通过。
5. 仓库里有 steering、至少 3 个 spec、至少 2 个 hooks 和 `docs/KIRO.md`。
6. README、200 字说明、（备份）演示视频都已完成。

**降级顺序（时间不够时从上到下砸）**

1. 链接分享 FR-UI-04；复制到剪贴板 FR-CD-04。
2. 悬停详情 FR-RD-06；隐私开关 FR-CD-03。
3. 片头片尾和字幕 FR-EX-03；token 输入 FR-IN-08。
4. 预置作品由 5 个减到 3 个。
5. 风动、落雪等装饰性效果。
6. **绝不砸的主线**：输入→树→播放→导出视频→在线链接→Kiro 证据。

## 3. 阶段 2：本地与质量（赛后 1–2 周）

目标：补齐阶段 1 的已知限制，让数据更准、导出更稳、交互更完整。

- **FR-L2-01 \[M\] 本地目录读取**：`showDirectoryPicker`（或拖入目录的 `getAsFileSystemHandle`）+ isomorphic-git，编写基于目录句柄的 fs 适配层，在 Web Worker 中运行，主线程不阻塞。实现 `LocalSource`（复用 `HistorySource` 接口）。零上传。支持 packed refs、packfile、浅克隆提示。不支持的浏览器给出明确提示。
- **FR-L2-02 \[M\] 精确改动统计**：本地来源计算每次提交的 `filesChanged` 与 `weight`（新增+删除行数），进度可见、可取消；采样后再计算以控制耗时。树的粗细与叶大小纳入 `weight`。
- **FR-L2-03 \[M\] GitHub GraphQL 增强**：用户提供 token 时使用 GraphQL 一次获取带 `additions/deletions`、`tags`、`branches` 的提交，修复阶段 1 的「标签丢失」和「权重缺失」。
- **FR-L2-04 \[S\] IndexedDB 缓存与增量更新**：缓存原始历史（按仓库 + 分支），再次打开只拉取新提交；提供清除缓存按钮。
- **FR-L2-05 \[M\] 逐帧 MP4 导出**：使用 WebCodecs `VideoEncoder` 和 MP4 封装库，按 `t = frame / (fps*duration)` 逐帧调用 `renderFrame`，不依赖实时播放，结果严格确定、可加速导出；支持 30/60 fps、720p/1080p。不支持 WebCodecs 时回退到阶段 1 的 WebM。
- **FR-L2-06 \[S\] 背景音乐**：内置 3 首可商用、标注来源的音乐，导出时混入视频；默认关闭。
- **FR-L2-07 \[M\] 交互升级**：点击叶/花显示提交详情面板（链接到 GitHub 提交页）；贡献者面板（高亮某人的全部叶子）；章节条点击跳转；缩放平移（滚轮、拖动、双指）。
- **FR-L2-08 \[S\] 渲染性能**：用 `OffscreenCanvas` + Worker 渲染，主线程只保留 UI；支持 2000+ 节点的高密度树。
- **FR-L2-09 \[S\] 视觉升级**：光影、风场、贝塞尔细节、相机缓慢拉远（由 `t` 推导）。
- **FR-L2-10 \[M\] 测试体系**：Playwright 端到端测试（预置载入、拖动、导出）；基于确定性的视觉回归快照（固定参数的关键帧像素对比）。
- **验收**：本地目录和 GitHub 的同一仓库产出的树结构一致；MP4 两次导出逐帧 hash 相同。

## 4. 阶段 3：自动化与分发（赛后 3–4 周）

目标：让「一棵树」走进 README 和 CI，产品自己传播。

- **FR-L3-01 \[M\] 包拆分**：仓库改为 monorepo：`@gittree/core`（摄取+模型+布局，无 DOM）、`@gittree/render`（`renderFrame`，接受任何兼容 2D 上下文）、`@gittree/web`、`@gittree/cli`。发布到 npm。
- **FR-L3-02 \[M\] CLI**：`npx gittree <url|path> --out tree.mp4 --duration 30 --size 1080p --seed <str>`，也支持 `--format png|svg|json`。本地路径直接调用 `git log`（含 numstat），URL 用 `git clone --filter=tree:0`。退出码、错误信息与网页端错误码一致。
- **FR-L3-03 \[M\] 无头逐帧渲染**：Node 端用 `skia-canvas`（或 Playwright）逐帧调用 `renderFrame`，管道给 ffmpeg；与网页端对同一输入应得到视觉一致的结果。
- **FR-L3-04 \[M\] SVG 渲染后端**：`renderFrameSvg(geometry, t)` 输出矢量图，用于徽章和文档。
- **FR-L3-05 \[M\] GitHub Action**：`gittree-action`，输入仓库（默认当前仓库）、输出路径，产物 `gittree.svg`、`gittree.gif/mp4`；可配置定时任务（每周/每月）自动更新到指定分支，供 README 引用。
- **FR-L3-06 \[S\] README 徽章**：静态 SVG（最后一帧树 + 「已生长 N 天」），给出 Markdown 复制片段。
- **FR-L3-07 \[S\] Docker 镜像**：在无头环境一键运行 CLI。
- **FR-L3-08 \[M\] 文档站**：快速开始、CLI 参数、Action 示例、数据模型说明、确定性保证。
- **验收**：在一个空仓库中用 Action 一键生成并在 README 显示树；CLI 与网页对同一仓库布局 JSON 完全一致。

## 5. 阶段 4：智能叙事与个性化（赛后 1–2 月）

目标：让树不只是「好看」，还能「讲故事」，并支持个性化。

- **FR-L4-01 \[M\] LLM 章节叙事**：输入章节的时间范围、关键提交信息、类型分布、标签，生成章节标题和 1–2 句旁白。支持用户自带 key 或平台代理（带用量上限）；结果缓存；失败或超时回退到规则标题（阶段 1），不阻塞主流程。发送给模型的只有提交摘要，不含代码内容，用户可预览和关闭。
- **FR-L4-02 \[S\] 旁白与语音**：视频字幕显示旁白；可选 TTS 语音轨。
- **FR-L4-03 \[M\] 多语言**：基于 `strings.zh.ts` 抽取多语言资源，提供中文与英文；旁白语言可切换。
- **FR-L4-04 \[M\] 主题皮肤**：基于 CSS 变量和绘制参数的主题：樱花、松林、盆景、像素、夜光；主题只影响渲染参数，不改变布局。
- **FR-L4-05 \[S\] 贡献者头像叶**：可选用 GitHub 头像作为叶片纹理；默认关闭，开启前提示隐私。
- **FR-L4-06 \[M\] 竖屏短视频**：导出 9:16 的短视频（1080×1920），适合传播平台；布局与字幕自适应。
- **FR-L4-07 \[M\] 里程碑标注**：用户可手动添加事件（上线、融资、换负责人），在树上显示为特殊的果；保存在本地，可导入导出。
- **FR-L4-08 \[S\] 团队年度回顾**：选定时间范围生成「年终树」，附年度数据页、章节卡片、贡献者榜。
- **验收**：关闭 LLM 时行为与阶段 1 一致；主题切换不改变布局 JSON。

## 6. 阶段 5：规模与生态（赛后 2–4 月）

目标：支持更大、更多、更开放的使用场景。

- **FR-L5-01 \[M\] 多平台**：基于 `HistorySource` 增加 Gitee、GitLab、Bitbucket 适配（中文开发者常用 Gitee），统一错误码。
- **FR-L5-02 \[M\] 私有仓库**：GitHub App 或 OAuth Device Flow 授权，仅读权限；token 仅在浏览器内使用；清晰列出读取范围。
- **FR-L5-03 \[M\] 超大仓库**：用 Rust（gix）编译为 WASM 或服务端预处理，流式解析；支持百万级提交的逐层聚合（按周/月分桶）并保持确定性。
- **FR-L5-04 \[M\] 多仓库森林**：输入一组仓库或一个组织/用户，形成一片森林，每棵树大小和色调反映项目规模与活跃度；支持森林的整体播放和导出。
- **FR-L5-05 \[S\] 嵌入**：Web Component `<git-tree repo="...">` 与 iframe 嵌入程序，支持属性：主题、自动播放、起止时间。
- **FR-L5-06 \[S\] 插件 API**：主题、布局策略、数据源三类插件接口，稳定的 `schemaVersion` 迁移工具。
- **FR-L5-07 \[C\] 社区画廊**：用户自愿提交树，审核后展示；举报与下架机制；仅展示公开仓库。
- **FR-L5-08 \[S\] 隐私与自托管**：可自托管版本（Docker）、默认无追踪，可选匿名统计。
- **验收**：10 万提交级仓库在可接受时间内生成并保持布局确定性；三个平台各至少一个真实仓库验证。

## 附录 A：核心数据模型（阶段 1）

```ts
type CommitType = 'feat' | 'fix' | 'docs' | 'refactor' | 'test' | 'perf' | 'chore' | 'merge' | 'revert' | 'spec' | 'hook' | 'other';

interface Commit {
  id: string;
  parents: string[];
  author: { name: string; login?: string };
  time: number;            // ms, UTC
  message: string;         // first line only, <= 200 chars
  type: CommitType;
  isMerge: boolean;
  weight?: number;         // optional (P2 fills it)
  filesChanged?: number;   // optional (P2 fills it)
}

interface Lane { id: number; parentLane: number | null; forkCommitId: string | null; mergeCommitId?: string; merged: boolean; commitIds: string[]; }
interface Tag { name: string; commitId: string; }
interface AuthorStat { key: string; name: string; commits: number; firstTime: number; lastTime: number; colorIndex: number; }
interface Chapter { title: string; season: 'spring' | 'summer' | 'autumn' | 'winter'; startIndex: number; endIndex: number; startTime: number; endTime: number; }
interface Stats { firstTime: number; lastTime: number; days: number; totalCommits: number; contributors: number; busiestDay: { date: string; commits: number }; longestDormancy: { days: number; from: number; to: number }; }

interface GrowthModel {
  schemaVersion: 1;
  generatedAt: number;     // display only
  source: { kind: 'github' | 'local' | 'preset'; owner?: string; repo?: string; defaultBranch?: string };
  commits: Commit[];       // ascending by time
  lanes: Lane[];
  tags: Tag[];
  authors: AuthorStat[];
  chapters: Chapter[];
  stats: Stats;
  metadata: { truncated: boolean; estimatedTotal?: number; samplingRate: number; droppedTags: number };
}

interface TreeGeometry {
  width: 1920; height: 1080;
  segments: Array<{ id: string; commitId: string; laneId: number; kind: 'trunk' | 'branch' | 'graft'; p0: [number, number]; c: [number, number]; p1: [number, number]; w0: number; w1: number; birth: [number, number] }>;
  leaves: Array<{ id: string; commitId: string; pos: [number, number]; angle: number; size: number; shape: string; colorIndex: number; birth: number; fallAt?: number }>;
  flowers: Array<{ id: string; tag: string; pos: [number, number]; size: number; birth: number; kind: 'normal' | 'major' | 'spec' }>;
  chapters: Array<{ title: string; season: string; t0: number; t1: number; dateRange: [number, number] }>;
  timeMap: Array<[number, number]>;
}

interface HistorySource { load(input: string, options: { token?: string }, signal: AbortSignal): Promise<RawHistory>; }
```

## 附录 B：视觉映射表

| 提交类型 | 叶形 | 大小 | 颜色说明 |
| --- | --- | --- | --- |
| feat | 大圆叶 | 1.0 | 作者色 |
| fix | 尖叶 | 0.7 | 作者色，边缘略深 |
| docs | 细长叶 | 0.6 | 作者色，略浅 |
| refactor | 三叶片 | 0.9 | 作者色，偏绿 |
| test / perf | 小圆叶 | 0.6 | 作者色 |
| chore / other | 小细叶 | 0.5 | 作者色，偏灰 |
| revert | 负形叶（枯黄） | 0.7 | 固定枯黄 |
| spec / hook | 紫色小花 | 0.8 | 固定紫色 |
| tag | 花 | 1.2 | 主版本标签为大花 + 果实 |

## 附录 C：评分维度追溯矩阵

| 评分维度（权重） | 对应需求 | 评委能在 3 分钟内看到什么 |
| --- | --- | --- |
| 脑洞有多大（35%） | FR-TL、FR-RD、FR-CD、FR-PR-03 | 打开即有棵树在长；季节、嫁接、落叶；纪念卡 |
| Kiro 用得有多深（35%） | FR-KR-01–07、FR-TL-07（项目自己的紫花） | spec、steering、hooks、需求迭代过程、`docs/KIRO.md` |
| 交付有多惊艳（30%） | FR-IN、FR-EX、FR-UI、FR-DL、NFR-01/09 | 在线链接不白屏、输入仓库出树、导出视频可播放 |

## 附录 D：Kiro Spec 拆分与提示词

**Spec 1 ingestion**：覆盖 FR-IN、FR-DT、FR-GM。提示词：「根据本需求文档的 2.2–2.4 节生成 requirements、design、tasks。core 必须不依赖 DOM，使用 Vitest，每个任务带单元测试，包含确定性测试。」

**Spec 2 tree-render**：覆盖 FR-TL、FR-RD、FR-UI。提示词：「根据 2.5–2.6、 2.10 节生成。layout 与 renderFrame 必须是纯函数，禁用 Math.random 和 Date.now，随机数来自种子 PRNG；先交付「输入地址→画出一根会长的主干」的竖切任务。」

**Spec 3 export-card**：覆盖 FR-EX、FR-CD、FR-PR、FR-DL。提示词：「根据 2.7–2.9、 2.12 节生成。视频导出复用 renderFrame；预置作品脚本复用 core 管线。」

**迭代原则**：需求有变化时，在 Kiro 对话中要求它更新 spec，再让它执行任务；每完成一个任务就提交，提交信息遵循 FR-KR-05。
