# GitTree 代码年轮

输入一个 GitHub 仓库地址，生成一棵**三维**的树，随提交历史生长；可拖动视角、点击叶片查看提交详情、播放/暂停/调速、导出视频与纪念卡。**选中多个项目可以长出一片森林**，每棵树独立成形、独立取名牌。打开页面不输入任何东西，也能看到演示林在自动生长。

在线体验：<https://dongfangzhizhu.github.io/gittree/>

## 功能

**三维可视化**
- three.js 实时渲染：主干沿参数曲线缓慢弯折、枝条从主干上部按黄金角散开、嫁接弧连接 merge
- **连续管状枝干**：每条 lane 由一串控制点经 CatmullRom 平滑成一条连续管道，配合平行传输标架与连续锥度，消除逐段圆柱拼接的接缝折痕
- **递归细分枝（参考 [ez-tree](https://github.com/dgreenheck/ez-tree)）**：主干与每条大枝沿枝身再分出 2–4 根细枝，细枝上再分一层；按 `start / angle / gnarliness / taper` 控制挂点、夹角、弯曲度与锥度，弯曲度与半径成反比（细枝更卷）。git lane 决定大枝走势，细枝只做植被填充，出生时刻跟随父枝
- **程序化树皮**：canvas 现场生成纵向纤维 + 皮孔裂纹 + 噪点，并由灰度梯度推导**法线贴图**，树皮真的有凹凸；UV 按「周长/弧长 ÷ 固定世界尺寸」铺开，粗树干与细枝的纹理密度一致（ez-tree 的 UV 技巧）
- **形态贴近真实**：主干用两条正弦叠加的参数曲线生成（起点严格在原点、不会长成一根笔直的杆）、底部指数衰减的根颈膨大；每条枝条是一条二次贝塞尔弧，中段上拱、梢部回落；冠幅受包络半径约束，不会横向失控
- **树冠分层**：一级枝按 fork 时间排位后均匀铺满主干 30%–93% 的高度（不会挤在低处留出一大截秃干），越高的枝越竖直（顶端优势）、层级越深越平展，冠幅/树高约 1:1.7
- **叶簇与苹果**：每个提交长出一簇叶子；叶片是 **ez-tree 式 alpha 卡片**——几何只有 12 个三角面的薄片，真实轮廓（卵形叶身、锯齿叶缘、收尖叶柄）由程序化纹理裁出来，叶脉（中脉 + 9 对侧脉）用二次贝塞尔画在贴图上再由灰度推导法线贴图，近看有起伏；每片叶子单独做色相/明度扰动、按自身法线朝向张开（而非统一躺在水平面），风动只叠一层小幅点头与自转。主干上的提交**撒到细分枝锚点上**，让树冠成为一个体积而不是一片「扇子」，出生时刻取「提交时刻」与「细枝长到该处」的较晚者——叶子绝不悬空；标签果实是带果脐与果柄的**苹果**，红/金/紫三色区分主版本/普通标签/`spec:`·`hook:` 痕迹
- **氛围层**：ACES Filmic 色调映射 + 泛光（UnrealBloomPass 后期链）、渐变天空球（含朝阳辉光）、地面年轮脉冲 Shader（随生长进度外扩的能量带）、确定性萤火虫粒子、星空、半球光/主光/轮廓光/树冠暖点光
- **自适应取景**：按相机 fov 与画布长宽比反算能装下整棵树（整片森林）的距离，四个预设视角共用同一套取景计算，不再裁切
- 视角：拖动旋转、滚轮缩放（OrbitControls），四个预设视角（全景/侧视/俯视/根颈）+ 自动旋转

**生长音乐（Web Audio 手搓 MIDI）**
- 每个提交对应一个音：五声音阶（0/2/4/7/9）、音高随枝条层级升高（主干低音、末梢高音）、力度按提交类型、merge 出低音长音、标签出三音琶音
- FM 铃音合成 + 程序生成混响 IR + 低通 pad 长音 + 压缩限幅，不引第三方音频库
- 音符与生长动画同一条时间轴：拖到哪一秒就只响那一段，不重播不遗漏
- **可导出标准 MIDI 文件**（Format 0，可拖进任意 DAW / 打谱软件），顶栏一键下载，`M` 键开关音乐

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

**性能**
- **帧率监测 + 自动降级**：连续多个统计窗口掉到 47fps 以下时自动降一档（高 → 均衡 → 流畅），切后台的大间隔帧不计入统计，避免误判；降档只降不升，防止画质抖动
- 三档画质：**高**（泛光 + 最高 2× DPR）/ **均衡**（泛光 + 1.25× DPR）/ **流畅**（关泛光 + 1× DPR + 叶片隔片抽取），顶栏按钮或 `P` 键手动切换
- `powerPreference: high-performance`、`visibilitychange` 后重对表（切回前台动画不会瞬移到结尾）
- 规模封顶：单棵树的细分枝预算 48 根（每根细枝 = 1 个 draw call）、叶片预算 12000 片（提交多的仓库自动稀释），森林 4 棵实测约 450 draw call / 87 万三角面（叶片改用 12 面卡片后三角面比旧版挤出叶形降了一个数量级）
- 雾距/天空球/星空按场景尺度自适应：森林横向铺开后不会把远处整棵树糊成黑色剪影

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
npm test            # 单元测试（vitest，118 个用例）
npm run test:e2e    # 端到端测试（Playwright + 系统 Chrome，需先启动 dev server）
npm run test:forest # 森林（多选）端到端测试：选中态/计数/生成/名牌跟随/焦点切换
npm run test:interaction # 视角/点击/缓存交互测试（--repo 可加真实仓库验证缓存）
npm run test:export # 导出功能测试（WebM/PNG 下载校验）
npm run test:music  # 生长音乐测试（乐谱/手势解锁/音符推进/快捷键/MIDI 下载）
npm run test:visual # 视觉专项：截图 + 帧率 + draw call + 画质降级
npm run perf:probe  # 森林模式帧率/渲染开销探测
npm run shot:crown  # 树冠特写截图（确认叶片/果实细节）
npm run demo:probe  # 录制探针：验证浏览器能打开线上站点并采到 WebGL 画面
npm run demo:record # 功能演示录制（1920×1080 WebM + 字幕时间轴 + ASS 字幕）
npm run demo:subtitle # 由 cues.json 生成最终 ASS 字幕
npm run doc:pdf     # 提交文档 HTML → A4 PDF
```

> 演示与文档脚本的产物写到 `.demo-work/` 与 `submission/`（均已 gitignore）；ffmpeg/ffprobe 默认从 PATH 取，可用 `FFMPEG_DIR` 指定目录。

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
│   ├── perf-monitor.ts     # 帧率监测 → 画质降级（纯逻辑，可单测）
│   └── errors.ts           # 错误码
├── layout/
│   └── prng.ts             # Mulberry32 + hash32（确定性随机源）
├── three/
│   ├── scene-types.ts      # 三维场景描述类型（纯数据，含 SceneBranch 连续管控制点）
│   ├── scene-builder.ts    # 纯函数：生长模型 → 三维几何（主干曲线/枝条贝塞尔/细分枝/叶簇/苹果/嫁接弧）
│   ├── twig-builder.ts     # 纯函数：递归细分枝（ez-tree 式 start/angle/gnarliness/taper）
│   ├── forest-builder.ts   # 纯函数：多棵树沿 X 轴排布并打 treeIndex → 一个森林场景
│   ├── branch-geometry.ts  # 纯函数：控制点 → 连续管几何（CatmullRom + 平行传输标架 + 按环索引 + 按半径归一的 UV）
│   └── three-renderer.ts   # WebGLRenderer + OrbitControls + InstancedMesh + 后期泛光 + 射线拾取
├── audio/
│   ├── music-map.ts        # 纯函数：提交历史 → 乐谱（五声音阶/层级音高/力度）
│   ├── midi-file.ts        # 纯函数：乐谱 → 标准 MIDI 文件（VLQ/元事件）
│   └── growth-music.ts     # Web Audio 合成器（FM 铃音/混响 IR/pad drone）
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
| 单元 | normalize / sampler / growth-model 结构与规则；scene-builder 确定性/等距/锥度/叶簇派生/细分枝锥度与出生窗口/填充叶；twig-builder 采样与方向扰动；forest-builder 空输入/单树等价/对称排布/treeIndex/id 唯一/确定性；branch-geometry 环数/索引连续性/可见环二分/平滑度；music-map 五声音阶/确定性/音符推进；midi-file 文件头/VLQ/Note 配平（内嵌解析器验证）；perf-monitor 降级阶梯/防抖/停顿剔除；cache 读写/校验/配额；github-source 分页与错误路径（mock fetch，不耗限额） | `npm test` |
| 端到端 | 打开页面自动出树、WebGL 像素采样、动画推进、单按钮播放/暂停切换与文案、拖动时间轴、**t=0→t=1 画面显著变化（40×23 降采样签名逐格比对）**、导出按钮可见、真实仓库加载 | `npm run test:e2e` |
| 森林 | 卡片选中态与未选中可区分（✓ 角标）、计数/按钮文案同步、多选 3 仓生成长出 3 棵树、名牌投影与视角跟随、点击第 2 棵树的叶子切换焦点 | `npm run test:forest` |
| 交互 | 视角预设与相机移动、自动旋转、**暂停状态下的视角/自动旋转/拖拽/滚轮**、**播放/暂停 × 4 视角 全矩阵点击**（8 组均需打开信息面板）、缓存命中与零请求、清除缓存 | `npm run test:interaction` |
| 导出 | WebM/PNG 下载文件的魔数与大小校验 | `npm run test:export` |
| 音乐 | 乐谱生成、默认静音（手势前不出声）、点击后 AudioContext 运行、播放中音符随生长推进、快捷键 `M`、MIDI 文件头 `MThd` 与字节数 | `npm run test:music` |
| 视觉 | 四视角截图、帧率、draw call/三角面、手动降档生效、无 JS 异常 | `npm run test:visual` |

端到端测试支持参数：`node scripts/e2e-check.mjs --url <地址> --repo <owner/repo> --out <目录>`

WebGL 画布的像素统计通过页面调试钩子 `window.__gittree.sampleCanvas()`（`gl.readPixels`）读取，浏览器需以 `--enable-unsafe-swiftshader` 之外的原生 GPU/软件 GL 环境运行。

## 部署

推送到 `main` 即由 GitHub Actions 自动构建并发布到 <https://dongfangzhizhu.github.io/gittree/>，
工作流是 `.github/workflows/deploy.yml`（`npm ci` → `npm test` → `npm run build` → `deploy-pages`，
构建时注入 `BASE_PATH=/gittree/`）。

一次性配置、本地验证生产构建、常见问题排查见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

## 已知限制

- 仅支持公开 GitHub 仓库；未登录限额 60 次/小时（单次加载最多 14 次请求）
- 超过 500 提交按等距页采样（保留首尾/merge/标签），`metadata.truncated` 标记截断
- 标签仅保留指向已取提交的（FR-IN-04），截断时部分标签丢失
- 三维包体约 700 kB（gzip 约 190 kB，主要来自 three.js + 后期处理）；未做按需分包
- 线性历史仓库（无分支）视觉上偏「幼树」形态，这是数据本身的形状；细分枝负责把树冠补成体积，但主干高度仍由提交数决定
- 泛光在集显上可能吃掉 10–20fps，掉帧触发自动降档后会关闭；也可用 `P` 键手动切到「流畅」
- 森林里树的数量越多整体越宽，相机会自动拉远，单棵树的细节相应变小；建议一次 2–4 棵
- 导出的 WebM 不含 HTML 覆盖层（视角按钮等），字幕与统计由 Canvas 合成
- 生长音乐受浏览器自动播放策略限制：必须点一下音乐按钮才出声；导出的 MIDI 与页面播放的内容一致但不含混响
- 内置快照为抓取时刻的定版数据（每仓 440+ 提交），不会自动跟随上游更新；标签数远多于上树果实数（如 React 180 个标签中 11 个落在采样提交上），卡片按「上树/总数」显示
- 本地若只监听 IPv6（`[::1]`），Playwright 用 `127.0.0.1` 会 `ERR_CONNECTION_REFUSED`，启动时加 `--host 127.0.0.1`

## License

MIT
