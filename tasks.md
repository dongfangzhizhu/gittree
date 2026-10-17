# Tasks: 代码年轮（GitTree）P1 MVP 2026.10.17–10.22

快速索引：本项目分为三个 Spec，共 30 个任务。

## 项目评分维度（总分 100）
- 脑洞（35%）：树的视觉设计、交互流畅度、导出品质
- Kiro 工程化（35%）：Spec 结构、Steering 文档、Hooks 实装、需求演进过程
- 交付质量（30%）：在线链接打开即见树、实时仓库 ≤8 秒、导出稳定

## 三个 Spec 分工

### Spec 1: 数据摄取与模型 (ingestion)
**任务 T1–T9** | 核心目标：GitHub API 等距采样 10 页，提交规范化、采样与父节点重连，生长模型构建
- T1: 核心类型定义 (2h)
- T2: GitHub URL 解析 & 错误码 (3h)
- T3: GitHub API 数据源实现 (6h) ← **核心**
- T4: 提交规范化与排序 (3h)
- T5: 采样算法与父节点重连 (4h)
- T6: Lane 识别与作者统计 (3h)
- T7: 章节划分 3–6 个 (4h)
- T8: 纪念统计与元数据 (2h)
- T9: Core 单元测试与确定性验证 (3h)

**交付**：GrowthModel 完整、确定性 100% 通过、无 DOM 依赖

---

### Spec 2: 树布局与渲染 (tree-render)
**任务 T10–T22** | 核心目标：layout() 纯函数、renderFrame() 纯函数、播放控制、UI 状态机
- T10: 布局纯函数框架与 Mulberry32 PRNG (3h)
- T11: 主干曲线绘制 (3h)
- T12: 支线分枝与嫁接 (3h)
- T13: 叶、花、果生成 (3h)
- T14: 落叶与冬季时间映射 (2h)
- T15: Layout 集成测试与确定性 (2h)
- T16: Canvas renderFrame 骨架绘制 (4h)
- T17: 叶/花/落叶/风动 (4h)
- T18: 文字层 (2h)
- T19: 播放控制与状态机 (2h)
- T20: 播放器逻辑与 RAF (2h)
- T21: UI 组件与交互布局 (3h)
- T22: 集成测试与性能验证 (2h)

**交付**：可播放、拖动时间轴、500 提交 ≤200ms 布局、≥50fps 渲染

---

### Spec 3: 导出与预置 (export-card)
**任务 T23–T30** | 核心目标：WebM 导出、PNG 纪念卡、5 个预置、自动播放
- T23: WebM 导出框架 (3h)
- T24: 导出进度 & UI (2h)
- T25: PNG 纪念卡导出 (3h)
- T26: 预置脚本生成 (2h)
- T27: 预置集 UI 与自动播放 (2h)
- T28: 链接分享 & 路由 (1h)
- T29: 文案与错误处理 (2h)
- T30: 部署、README、Kiro 文档 (3h)

**交付**：在线链接可用、导出 WebM/PNG、预置可播放

---

## 时间分配（总计 ~100 小时，6 天）

| 日期 | Spec | 任务 | 目标 |
|------|------|------|------|
| 10.17–10.18 | 1 | T0, T1–T3 | 工程化 + GitHub 数据源完成 |
| 10.18–10.19 | 1 | T4–T9 | GrowthModel 完整 + 测试通过 |
| 10.19–10.20 | 2 | T10–T17 | 树形状可见，支线、叶子生成 |
| 10.20–10.21 | 2 | T18–T22 | 播放控制、输入→播放完整链路 |
| 10.21–10.22 | 3 | T23–T30 | 导出、预置、在线部署、文档 |

---

## 降级顺序（时间紧张时，从上到下砸）

1. **T28 链接分享**：降低复杂度，先简化为直接输入
2. **悬停详情、隐私开关**：这些是锦上添花
3. **片头片尾、Token UI**：删掉不影响核心
4. **预置从 5 减为 3**：本项目 + 2 个示例
5. **风动、落雪**：删掉性能有余量的装饰
6. **绝对不砸**：输入 URL → 生成树 → 播放 → 导出 → 在线 + Kiro 证据

---

## Kiro 工程化核心要求

### Steering 文档（.kiro/steering/）
- \`product.md\`：产品目标、赛道定位、产品原则
- \`tech.md\`：TypeScript strict、Vite、禁用规则区域 (core 无 DOM)
- \`structure.md\`：目录边界、数据流

### Three Specs
- \`.kiro/specs/ingestion/\` → requirements.md, design.md, tasks.md
- \`.kiro/specs/tree-render/\` → requirements.md, design.md, tasks.md
- \`.kiro/specs/export-card/\` → requirements.md, design.md, tasks.md

### Hooks（≥ 2 个）
- \`PostFileSave\` → \`tsc --noEmit && vitest run\`
- \`PreCommit\`（可选）→ README 功能清单检查

### Commits 规范
- \`feat(core): ...\`、\`feat(layout): ...\`、\`feat(rendering): ...\`
- \`spec(ingestion): ...\`（需求变更）
- \`hook: ...\`（钩子配置）
- 使得项目自己的树带有紫色小花

### 证据文档 (docs/KIRO.md)
- 三个 spec 的演进过程（一句话需求 → 需求 → 设计 → 任务）
- Hooks 的触发与效果记录
- 哪些模块由 Kiro agent 生成（逐个列）
- 关键截图（树的演进、导出、播放）
- 遇到的问题与 spec 调整

---

## 成功定义（全部满足才可提交）

1. ✓ 公开链接打开，不输入任何东西就看到一棵树在自动生长
2. ✓ 粘贴 GitHub 地址，几秒内看到它的树
3. ✓ 能播放、暂停、调速、拖动时间轴，显示章节和日期
4. ✓ 能导出 WebM 视频和 PNG 纪念卡
5. ✓ 布局 + renderFrame 确定性测试全部通过
6. ✓ Steering + 3 Specs + 2 Hooks + docs/KIRO.md 完整
7. ✓ README、200 字说明、演示视频完成
8. ✓ 仓库公开、MIT 许可、.kiro 目录保留、提交历史完整

---

## 快速开始

### 今日任务（10.17）
1. \`npm run build\` 验证环境
2. 创建 .kiro 目录和三个 spec 骨架
3. 配置 Hook：PostFileSave
4. 完成 T0 初始提交（tag: v0.1-kickoff）

### 技术栈确认
- **框架**：Vite (app mode), TypeScript strict
- **UI**：原生 Canvas + Vanilla JS（或 Preact 极简）
- **测试**：Vitest（core 和 layout 覆盖 ≥ 80%）
- **部署**：静态托管（Vercel/GitHub Pages/Netlify）
- **依赖**：≤ 3 个运行时依赖，gzip ≤ 200 KB

---

## 附录：高层流程图

\`\`\`
User Input (GitHub URL or Preset)
  ↓
  [Spec 1: Data Pipeline]
    └─ GitHubSource → Normalize → Sample → GrowthModel
  ↓
  [Spec 2: Tree Render]
    ├─ layout(model, seed) → TreeGeometry (pure fn)
    ├─ renderFrame(ctx, geometry, t) → Canvas (pure fn)
    └─ Player: play/pause/seek
  ↓
  [Spec 3: Export & Presets]
    ├─ exportVideo() → WebM
    ├─ exportCard() → PNG
    └─ Presets: auto-play, share link
  ↓
  Output: Online link, downloadable video/card, Kiro documentation
\`\`\`

---

## 文件树（最终）

\`\`\`
src/
├── core/                    # 无 DOM，可 Node.js 复用
│   ├── types.ts
│   ├── input-parser.ts
│   ├── history-source.ts
│   ├── github-source.ts
│   ├── normalize.ts
│   ├── sampler.ts
│   ├── growth-model.ts
│   ├── errors.ts
│   └── __tests__/
├── layout/
│   ├── types.ts
│   ├── prng.ts
│   ├── tree-layout.ts
│   ├── trunk-curve.ts
│   ├── branch.ts
│   ├── leaves.ts
│   ├── time-map.ts
│   └── __tests__/
├── rendering/
│   ├── canvas-renderer.ts
│   ├── text-renderer.ts
│   └── __tests__/
├── ui/
│   ├── state-machine.ts
│   ├── player.ts
│   ├── app.tsx
│   ├── export-video.ts
│   ├── export-card.ts
│   ├── strings.zh.ts
│   └── styles.css
├── presets/
│   └── presets.ts
└── main.ts

public/
├── index.html
└── presets/
    ├── index.json
    └── *.json (×5)

.kiro/
├── steering/
│   ├── product.md
│   ├── tech.md
│   └── structure.md
├── specs/
│   ├── ingestion/
│   ├── tree-render/
│   └── export-card/
└── hooks/
    └── *.json

scripts/
└── build-presets.ts

docs/
└── KIRO.md

.gitignore, package.json, tsconfig.json, vite.config.ts, README.md
\`\`\`

---

**Ready to start? Begin with T0 and T1–T3 on Day 1. Each spec can work in parallel after the core types are defined.**
