# GitTree 代码年轮

输入一个 GitHub 仓库地址，生成一棵**三维**的树，随提交历史生长；可拖动视角、点击叶片查看提交详情、播放/暂停/调速、导出视频与纪念卡。**选中多个项目可以长出一片森林**，每棵树独立成形、独立取名牌。打开页面不输入任何东西，也能看到演示林在自动生长。

在线体验：<https://dongfangzhizhu.github.io/gittree/>

## 功能

**三维可视化**
- three.js 实时渲染：主干沿参数曲线缓慢弯折、枝条从主干上部按黄金角散开、嫁接弧连接 merge
- **连续管状枝干**：每条 lane 由一串控制点经 CatmullRom 平滑成一条连续管道，配合平行传输标架与连续锥度，消除逐段圆柱拼接的接缝折痕
- **形态贴近真实**：主干用两条正弦叠加的参数曲线生成（起点严格在原点、不会长成一根笔直的杆）、底部指数衰减的根颈膨大；每条枝条是一条二次贝塞尔弧，中段上拱、梢部回落；冠幅受包络半径约束，不会横向失控
- **树冠分层**：一级枝按 fork 时间排位后均匀铺满主干 30%–93% 的高度（不会挤在低处留出一大截秃干），越高的枝越竖直（顶端优势）、层级越深越平展，冠幅/树高约 1:1.7
- **叶簇与苹果**：每个提交长出一簇 9 片叶子（真实叶形：贝塞尔叶缘 + 厚度 + 中脉上拱），沿枝条分布、主干上的提交挂到最近的枝条上（叶子不会悬空）；标签果实是带果脐与果柄的**苹果**，红/金/紫三色区分主版本/普通标签/`spec:`·`hook:` 痕迹
- **自适应取景**：按相机 fov 与画布长宽比反算能装下整棵树（整片森林）的距离，四个预设视角共用同一套取景计算，不再裁切
- 年轮地纹 + 确定性星空 + 半球光/主光/轮廓光
- 视角：拖动旋转、滚轮缩放（OrbitControls），四个预设视角（全景/侧视/俯视/根颈）+ 自动旋转

**森林（多项目）**
- 侧栏卡片是**多选**：点一下选中（出现勾选角标、描边高亮与浮起），再点取消；「生长这片森林」按选中集合一次生成
- 输入框可一次粘贴多个仓库（逗号/分号/顿号/换行分隔，支持完整 URL），直接长成森林
- 每棵树带一个跟随树冠的 HTML **名牌**（仓库名 + 提交数），相机旋转/缩放时实时投影跟随、越界自动隐藏；点名牌或点树上的叶子都能切换焦点树
- 焦点树的章节标题、日期、信息面板与导出内容随之切换
- 分享链接：单仓 `?repo=owner/repo`，多仓 `?repos=a/b,c/d`

**交互**
- 点击叶片或果实 → 信息面板显示提交类型、作者、UTC 日期、SHA、父提交数、所属标签，可「定位到此处」飞向节点，数据源为 GitHub 时附提交链接
- 悬停高亮、选中节点脉冲光环
- **任何状态下都可点击**：播放中与暂停中、任意视角下均可响应鼠标事件；射线未命中时按屏幕投影就近拾取（`pickNearest`），小节点也点得中
- **暂停时相机照常响应**：视角切换 / 自动旋转 / 拖拽旋转 / 滚轮缩放都由渲染器自带的空闲帧循环驱动（播放暂停不影响），阻尼能自然收敛

**内置真实仓库快照**
- 预置区按「演示林 / 精选真实仓库」分组，后者内置 facebook/react、vuejs/core、microsoft/TypeScript 的提交快照（`public/snapshots/`）
- 选中即渲染，不消耗 GitHub API 限额，离线也能看到真实仓库形态；三仓可同时选中，直接对比三种历史形态
- 快照会额外取回最近 10 个标签指向的提交，保证树上真有果实（否则采样页里一个标签都命中不上）
- 快照由 `scripts/fetch-snapshots.mjs` 抓取，可 `--only <owner/repo>` 单仓增量更新，`--tag-only` 只补标签提交

**数据缓存**
- 勾选「缓存此项目数据」后，首次拉取写入 `localStorage`；再次加载同一仓库**零 API 请求**直接命中
- 状态区显示缓存年龄与「清除」按钮；开关状态本地持久化；配额不足时明确提示（不静默失败）

**播放与导出**
- 播放/暂停合并为一个开关按钮（按钮文案随状态切换）、0.5×–4× 调速、10–60s 时长、拖动时间轴、空格/方向键/Home/End 快捷键
- 章节字幕（萌芽期/扩张期/重构期/沉淀期/当下……）+ UTC 日期 + 进度；风动摇曳、沉寂期落叶
- 导出 WebM 视频（30fps 1920×1080，含字幕合成层）与 PNG 纪念卡（三维画面 + 统计网格），入口固定在顶栏

**工程**
- 确定性：同一仓库永远得到同一棵树（种子化 PRNG；场景构建与时间驱动均为纯函数）
- 隐私：全部计算在浏览器内完成；Token 仅存 localStorage，不上传、不入 URL
- 链接分享：`?repo=owner/repo` 打开即加载

## 快速开始

```bash
npm install
npm run dev         # 开发服务器 http://localhost:5173
npm run build       # 生产构建（tsc 类型检查 + vite build）
npm test            # 单元测试（vitest，87 个用例）
npm run test:e2e    # 端到端测试（Playwright + 系统 Chrome，需先启动 dev server）
npm run test:forest # 森林（多选）端到端测试：选中态/计数/生成/名牌跟随/焦点切换
npm run test:export # 导出功能测试（WebM/PNG 下载校验）
npm run test:interaction # 视角/点击/缓存交互测试（--repo 可加真实仓库验证缓存）
```

使用：粘贴仓库地址（`owner/repo` 或完整 URL，可一次粘贴多个）→ 点「让它生长」；或点预置卡片多选后点「🌱 生长这片森林」。

## 架构

```
src/
├── core/        # 无 DOM 依赖，可 Node 复用
│   ├── types.ts            # 统一数据模型（schemaVersion=1）
│   ├── input-parser.ts     # GitHub 地址解析
│   ├── github-source.ts    # GitHub REST 数据源（等距 10 页采样）
│   ├── normalize.ts        # 规范化 / 去重 / 排序 / 类型识别
│   ├── sampler.ts          # 采样（≤500）+ 父节点重连
│   ├── growth-model.ts     # lane 识别 / 作者统计 / 章节 / 统计
│   ├── cache.ts            # localStorage 缓存（可注入存储，便于测试）
│   └── errors.ts           # 错误码
├── layout/
│   └── prng.ts             # Mulberry32 + hash32（确定性随机源）
├── three/
│   ├── scene-types.ts      # 三维场景描述类型（纯数据，含 SceneBranch 连续管控制点）
│   ├── scene-builder.ts    # 纯函数：生长模型 → 三维几何（主干曲线/枝条贝塞尔/叶簇/苹果/嫁接弧）
│   ├── forest-builder.ts   # 纯函数：多棵树沿 X 轴排布并打 treeIndex → 一个森林场景
│   ├── branch-geometry.ts  # 纯函数：控制点 → 连续管几何（CatmullRom + 平行传输标架 + 按环索引）
│   └── three-renderer.ts   # WebGLRenderer + OrbitControls + InstancedMesh + 射线拾取
├── ui/          # Token / 错误 / 浏览器能力检测 / 节点信息面板
├── presets.ts   # 演示林（走真实数据管线生成）
└── main.ts      # 入口：加载编排 / 播放状态机 / 交互 / 导出

public/snapshots/            # 内置真实仓库快照（JSON）+ index.json 索引
scripts/fetch-snapshots.mjs  # 快照抓取脚本（分页 + 标签，支持单仓增量更新）
```

数据流：`GitHubSource（或缓存）→ normalize → sample → reconnect → buildGrowthModel → buildForestScene（1..N 棵，内部调用 buildScene）→ TreeRenderer.updateTree(t)`

## 测试

| 层级 | 内容 | 命令 |
| --- | --- | --- |
| 单元 | normalize / sampler / growth-model 结构与规则；scene-builder 确定性/等距/锥度/叶簇派生；forest-builder 空输入/单树等价/对称排布/treeIndex/id 唯一/确定性；branch-geometry 环数/索引连续性/可见环二分/平滑度；cache 读写/校验/配额；github-source 分页与错误路径（mock fetch，不耗限额） | `npm test` |
| 端到端 | 打开页面自动出树、WebGL 像素采样、动画推进、单按钮播放/暂停切换与文案、拖动时间轴、导出按钮可见、真实仓库加载 | `npm run test:e2e` |
| 森林 | 卡片选中态与未选中可区分（✓ 角标）、计数/按钮文案同步、多选 3 仓生成长出 3 棵树、名牌投影与视角跟随、点击第 2 棵树的叶子切换焦点 | `npm run test:forest` |
| 交互 | 视角预设与相机移动、自动旋转、**暂停状态下的视角/自动旋转/拖拽/滚轮**、**播放/暂停 × 4 视角 全矩阵点击**（8 组均需打开信息面板）、缓存命中与零请求、清除缓存 | `npm run test:interaction` |
| 导出 | WebM/PNG 下载文件的魔数与大小校验 | `npm run test:export` |

端到端测试支持参数：`node scripts/e2e-check.mjs --url <地址> --repo <owner/repo> --out <目录>`

WebGL 画布的像素统计通过页面调试钩子 `window.__gittree.sampleCanvas()`（`gl.readPixels`）读取，浏览器需以 `--enable-unsafe-swiftshader` 之外的原生 GPU/软件 GL 环境运行。

## 已知限制

- 仅支持公开 GitHub 仓库；未登录限额 60 次/小时（单次加载最多 14 次请求）
- 超过 500 提交按等距页采样（保留首尾/merge/标签），`metadata.truncated` 标记截断
- 标签仅保留指向已取提交的（FR-IN-04），截断时部分标签丢失
- 三维包体约 620 kB（gzip 约 160 kB，主要来自 three.js）；未做按需分包
- 线性历史仓库（无分支）视觉上呈「一根主干 + 叶片」的幼树形态，这是数据本身的形状，非渲染缺陷
- 森林里树的数量越多整体越宽，相机会自动拉远，单棵树的细节相应变小；建议一次 2–4 棵
- 导出的 WebM 不含 HTML 覆盖层（视角按钮等），字幕与统计由 Canvas 合成
- 内置快照为抓取时刻的定版数据（每仓 440+ 提交），不会自动跟随上游更新；标签数远多于上树果实数（如 React 180 个标签中 11 个落在采样提交上），卡片按「上树/总数」显示
- 本地若只监听 IPv6（`[::1]`），Playwright 用 `127.0.0.1` 会 `ERR_CONNECTION_REFUSED`，启动时加 `--host 127.0.0.1`

## License

MIT
