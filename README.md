# GitTree 代码年轮

输入一个 GitHub 仓库地址，生成一棵随提交历史生长的树；可播放、可拖动时间轴，可导出视频和成长纪念卡。打开页面不输入任何东西，也能看到演示林在自动生长。

## 功能

- **树形可视化**：主干 + 支线分枝 + 叶（按提交类型与作者着色）+ 版本花（主版本为金星）+ `spec:`/`hook:` 提交的紫色 Kiro 小花
- **生长动画**：按提交序号推进的时间轴，风动摇曳、沉寂期落叶（FR-TL-08）
- **播放控制**：播放/暂停、0.5×–4× 调速、10–60s 时长、拖动时间轴、空格/方向键/Home/End 快捷键
- **章节字幕**：3–6 个章节（萌芽期/扩张期/重构期/沉淀期/当下……）+ UTC 日期 + 进度
- **导出**：WebM 视频（30fps 1920×1080）与 PNG 纪念卡（树 + 统计网格）
- **链接分享**：`?repo=owner/repo` 打开即加载对应仓库
- **确定性**：同一仓库永远得到同一棵树（种子化 PRNG，`layout`/`renderFrame` 为纯函数）
- **隐私**：全部计算在浏览器内完成；Token 仅存 localStorage，不上传、不入 URL

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 生产构建（tsc 类型检查 + vite build）
npm test           # 单元测试（vitest，61 个用例）
npm run test:e2e   # 端到端测试（Playwright + 系统 Chrome，需先启动 dev server）
npm run test:export # 导出功能测试（WebM/PNG 下载校验）
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
│   └── errors.ts           # 错误码
├── layout/      # 纯函数布局（1920×1080 逻辑画布）
│   ├── prng.ts             # Mulberry32 + hash32
│   └── tree-layout.ts      # 主干偏摆 / 支线分叉 / 管道粗细 / 叶花果
├── rendering/
│   └── canvas-renderer.ts  # 纯函数渲染（DPR / 风动 / 落叶 / 字幕）
├── ui/          # Token / 错误 / 浏览器能力检测
├── presets.ts   # 演示林（走真实数据管线生成）
└── main.ts      # 入口与播放状态机
```

数据流：`GitHubSource → normalize → sample → reconnect → buildGrowthModel → layout → renderFrame`

## 测试

| 层级 | 内容 | 命令 |
| --- | --- | --- |
| 单元 | normalize / sampler / growth-model / layout / renderer 确定性与结构，github-source 分页与错误路径（mock fetch，不耗限额） | `npm test` |
| 端到端 | 打开页面自动出树、动画推进、播放/暂停/拖动、导出按钮可见、真实仓库加载（Playwright，含像素采样） | `npm run test:e2e` |
| 导出 | WebM/PNG 下载文件的魔数与大小校验 | `npm run test:export` |

端到端测试支持参数：`node scripts/e2e-check.mjs --url <地址> --repo <owner/repo> --out <目录>`

## 已知限制

- 仅支持公开 GitHub 仓库；未登录限额 60 次/小时（单次加载最多 14 次请求）
- 超过 500 提交按等距页采样（保留首尾/merge/标签），`metadata.truncated` 标记截断
- 标签仅保留指向已取提交的（FR-IN-04），截断时部分标签丢失

## License

MIT
