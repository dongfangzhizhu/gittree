# GitTree 代码年轮

输入一个 GitHub 仓库地址，生成一棵**三维**的树，随提交历史生长；可拖动视角、点击叶片查看提交详情、播放/暂停/调速、导出视频与纪念卡。打开页面不输入任何东西，也能看到演示林在自动生长。

## 功能

**三维可视化**
- three.js 实时渲染：主干带确定性弯曲、支线以 25°–60° 仰角绕主干散开、嫁接弧连接 merge
- 叶（按提交类型与作者着色，8 种叶形）+ 果实（主版本金星状八面体 / 普通标签金球 / `spec:`、`hook:` 提交的紫色果实）
- 年轮地纹 + 确定性星空 + 半球光/主光/轮廓光
- 视角：拖动旋转、滚轮缩放（OrbitControls），四个预设视角（全景/侧视/俯视/根颈）+ 自动旋转

**交互**
- 点击叶片或果实 → 信息面板显示提交类型、作者、UTC 日期、SHA、父提交数、所属标签，可「定位到此处」飞向节点，数据源为 GitHub 时附提交链接
- 悬停高亮、选中节点脉冲光环

**数据缓存**
- 勾选「缓存此项目数据」后，首次拉取写入 `localStorage`；再次加载同一仓库**零 API 请求**直接命中
- 状态区显示缓存年龄与「清除」按钮；开关状态本地持久化；配额不足时明确提示（不静默失败）

**播放与导出**
- 播放/暂停、0.5×–4× 调速、10–60s 时长、拖动时间轴、空格/方向键/Home/End 快捷键
- 章节字幕（萌芽期/扩张期/重构期/沉淀期/当下……）+ UTC 日期 + 进度；风动摇曳、沉寂期落叶
- 导出 WebM 视频（30fps 1920×1080，含字幕合成层）与 PNG 纪念卡（三维画面 + 统计网格）

**工程**
- 确定性：同一仓库永远得到同一棵树（种子化 PRNG；场景构建与时间驱动均为纯函数）
- 隐私：全部计算在浏览器内完成；Token 仅存 localStorage，不上传、不入 URL
- 链接分享：`?repo=owner/repo` 打开即加载

## 快速开始

```bash
npm install
npm run dev         # 开发服务器 http://localhost:5173
npm run build       # 生产构建（tsc 类型检查 + vite build）
npm test            # 单元测试（vitest，64 个用例）
npm run test:e2e    # 端到端测试（Playwright + 系统 Chrome，需先启动 dev server）
npm run test:export # 导出功能测试（WebM/PNG 下载校验）
npm run test:interaction # 视角/点击/缓存交互测试（--repo 可加真实仓库验证缓存）
```

使用：粘贴仓库地址（`owner/repo` 或完整 URL）→ 点「让它生长」；或直接点预置卡片「演示林」。

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
│   ├── scene-types.ts      # 三维场景描述类型（纯数据）
│   ├── scene-builder.ts    # 纯函数：生长模型 → 三维几何（主干弯曲/支线方位角/叶果/嫁接弧）
│   └── three-renderer.ts   # WebGLRenderer + OrbitControls + InstancedMesh + 射线拾取
├── ui/          # Token / 错误 / 浏览器能力检测 / 节点信息面板
├── presets.ts   # 演示林（走真实数据管线生成）
└── main.ts      # 入口：加载编排 / 播放状态机 / 交互 / 导出
```

数据流：`GitHubSource（或缓存）→ normalize → sample → reconnect → buildGrowthModel → buildScene → TreeRenderer.updateTree(t)`

## 测试

| 层级 | 内容 | 命令 |
| --- | --- | --- |
| 单元 | normalize / sampler / growth-model 结构与规则；scene-builder 确定性/等距/锥度/叶果派生；cache 读写/校验/配额；github-source 分页与错误路径（mock fetch，不耗限额） | `npm test` |
| 端到端 | 打开页面自动出树、WebGL 像素采样、动画推进、播放/暂停/拖动、导出按钮可见、真实仓库加载 | `npm run test:e2e` |
| 交互 | 视角预设与相机移动、自动旋转、点击叶片/果实打开信息面板、缓存命中与零请求、清除缓存 | `npm run test:interaction` |
| 导出 | WebM/PNG 下载文件的魔数与大小校验 | `npm run test:export` |

端到端测试支持参数：`node scripts/e2e-check.mjs --url <地址> --repo <owner/repo> --out <目录>`

WebGL 画布的像素统计通过页面调试钩子 `window.__gittree.sampleCanvas()`（`gl.readPixels`）读取，浏览器需以 `--enable-unsafe-swiftshader` 之外的原生 GPU/软件 GL 环境运行。

## 已知限制

- 仅支持公开 GitHub 仓库；未登录限额 60 次/小时（单次加载最多 14 次请求）
- 超过 500 提交按等距页采样（保留首尾/merge/标签），`metadata.truncated` 标记截断
- 标签仅保留指向已取提交的（FR-IN-04），截断时部分标签丢失
- 三维包体约 620 kB（gzip 约 160 kB，主要来自 three.js）；未做按需分包
- 线性历史仓库（无分支）视觉上呈「一根主干 + 叶片」的幼树形态，这是数据本身的形状，非渲染缺陷
- 导出的 WebM 不含 HTML 覆盖层（视角按钮等），字幕与统计由 Canvas 合成

## License

MIT
