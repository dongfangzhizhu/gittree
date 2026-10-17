# Tasks: Git 历史摄取与生长模型

## Overview
本任务清单包含 15 个任务，分为 4 个阶段，共约 40-50 个编码小时。

## Task Dependency Graph
```
Phase 1: Project Setup
  └─ Task 1: Initialize Project Structure
     └─ Task 2: Configure TypeScript & Vite

Phase 2: Core Data Infrastructure  
  ├─ Task 3: Define Type Definitions
  ├─ Task 4: Implement GitHub Fetcher
  │  └─ Task 5: Add Rate Limit Handling
  └─ Task 6: Implement Local Git Reader

Phase 3: Data Processing Pipeline
  ├─ Task 7: Implement Data Normalizer
  ├─ Task 8: Implement Commit Sampler
  └─ Task 9: Implement Growth Model Builder

Phase 4: Rendering & UI
  ├─ Task 10: Implement Canvas Renderer
  ├─ Task 11: Implement UI Controller
  ├─ Task 12: Create HTML Interface
  ├─ Task 13: Add Error Handling & Logging
  └─ Task 14: Integration Testing
  └─ Task 15: Documentation & Demo
```

---

## Phase 1: Project Setup

### Task 1: Initialize Project Structure
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** None

**Description:**
创建项目的基础目录结构和配置文件。

**Acceptance Criteria:**
1. ✓ src/ 目录结构已创建（fetchers, core, rendering, ui, types, main.ts）
2. ✓ public/ 目录已创建（放置 index.html）
3. ✓ .gitignore 已创建（排除 node_modules, dist, .env）
4. ✓ 初始提交"Initial project structure"

**Implementation Steps:**
1. 创建 src/{fetchers,core,rendering,ui,types} 目录
2. 创建 public/ 目录
3. 创建 .gitignore（包含 node_modules, dist, .env, .env.local, *.log）
4. 在各子目录创建 index.ts 占位符
5. git add && git commit

**Notes:**
- 使用标准的 TypeScript 项目结构
- 不依赖外部库的支持

---

### Task 2: Configure TypeScript & Vite
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 1

**Description:**
配置 TypeScript 和 Vite 构建系统。

**Acceptance Criteria:**
1. ✓ tsconfig.json 已创建（设置 strict 模式、target ES2020）
2. ✓ vite.config.ts 已创建（库模式 + ES modules）
3. ✓ package.json 脚本已配置（dev, build, preview）
4. ✓ 能成功运行 `npm run build`
5. ✓ 提交"Setup TypeScript and Vite configuration"

**Implementation Steps:**
1. 创建 tsconfig.json，设置 strict: true, target: ES2020
2. 创建 vite.config.ts，配置 build 输出
3. 更新 package.json 添加 scripts: dev, build, preview
4. 验证编译通过
5. git commit

**Notes:**
- 使用 strict TypeScript 模式确保类型安全
- Vite 作为开发服务器和打包工具
- 输出为 ES modules

---

## Phase 2: Core Data Infrastructure

### Task 3: Define Type Definitions
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 2

**Description:**
定义项目所有数据类型和接口。

**Acceptance Criteria:**
1. ✓ src/types/index.ts 包含所有主要接口（Commit, Branch, Tag, Author, GrowthModel, Chapter）
2. ✓ CommitType 枚举已定义
3. ✓ 所有接口文档化（JSDoc 注释）
4. ✓ 编译通过，无类型错误
5. ✓ 提交"Define core type definitions"

**Implementation Steps:**
1. 在 src/types/index.ts 中定义 Commit, Branch, Tag, Author 接口
2. 定义 CommitType 枚举（feat, fix, docs, refactor, test, perf, chore, other）
3. 定义 GrowthModel, Chapter 接口
4. 定义 VisualizationData 类型（用于渲染）
5. 添加完整的 JSDoc 文档
6. npm run build 验证
7. git commit

**Notes:**
- 类型定义是所有其他模块的基础
- 务必注明每个字段的用途和约束

---

### Task 4: Implement GitHub Fetcher
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 3

**Description:**
实现 GitHub REST API 数据获取模块。

**Acceptance Criteria:**
1. ✓ GitHubFetcher 类已创建（src/fetchers/github-fetcher.ts）
2. ✓ fetchCommits(owner, repo, token?) 方法实现，支持分页获取
3. ✓ 能正确解析 GitHub API 响应格式
4. ✓ 错误处理：404、403、网络错误返回有意义的错误信息
5. ✓ 所有提交转换为 Commit 接口格式
6. ✓ 编译通过，类型检查正确
7. ✓ 提交"Implement GitHub API fetcher"

**Implementation Steps:**
1. 创建 src/fetchers/github-fetcher.ts
2. 定义 GitHubFetcher 类，使用 fetch API
3. 实现分页逻辑（per_page=100，循环直至无更多数据）
4. 解析响应：提取 hash, parent, author, timestamp, message
5. 错误处理：检查 response.status（404, 403, 422 等）
6. 单元测试（mock fetch）
7. git commit

**Notes:**
- GitHub API: GET /repos/{owner}/{repo}/commits
- 时间戳需转换为 Unix 毫秒
- 作者从 commit.author.name 提取

---

### Task 5: Add Rate Limit Handling
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 4

**Description:**
在 GitHub Fetcher 中添加 API 限流处理和 token 支持。

**Acceptance Criteria:**
1. ✓ detectRateLimit(response) 方法实现，检查 X-RateLimit-* 头
2. ✓ 当触发限流时，计算剩余等待时间并返回错误信息
3. ✓ 支持传入个人 token，提高限流上限（60 req/h → 5000 req/h）
4. ✓ 错误响应包含 "retryAfter" 字段供 UI 显示
5. ✓ 提交"Add GitHub API rate limit handling"

**Implementation Steps:**
1. 在 GitHubFetcher 中添加 token 参数（可选）
2. 添加 Authorization 头（Bearer token）
3. 在 fetch 后检查 X-RateLimit-Remaining 和 X-RateLimit-Reset
4. 如果剩余请求数 < 10，返回等待时间信息
5. 单元测试率限检测逻辑
6. git commit

**Notes:**
- X-RateLimit-Reset 是 Unix 时间戳（秒），需转换为可读的倒计时
- 提示用户："限流已触发，请在 X 分钟后重试，或输入个人 token 重试"

---

### Task 6: Implement Local Git Reader
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 3

**Description:**
实现浏览器内本地 Git 仓库读取（File System Access API）。

**Acceptance Criteria:**
1. ✓ LocalGitReader 类已创建（src/fetchers/local-git-reader.ts）
2. ✓ readRepository(dirHandle): Promise<Commit[]> 方法实现
3. ✓ 能读取 .git/objects/pack/ 或 loose 对象
4. ✓ 可解析 Git commit 对象，提取 hash, parent, author, time, message
5. ✓ 检查浏览器 File System Access API 支持，不支持时返回友好错误
6. ✓ 零上传政策：验证所有数据在浏览器内处理
7. ✓ 提交"Implement local Git repository reader"

**Implementation Steps:**
1. 创建 src/fetchers/local-git-reader.ts
2. 实现 checkBrowserSupport()，检查 navigator.storage?.getDirectory
3. 实现 readGitObjects(dirHandle) 递归读取 .git/objects
4. 实现 parseCommitObject(buffer) 解析 Git 对象格式
5. 构建提交树和关系
6. 单元测试（mock File System API）
7. git commit

**Notes:**
- Git 对象格式：zlib 压缩的二进制数据，需使用 pako 或 native zlib 解压
- 可能需要引入依赖：`pako` 用于解压缩
- 支持检查：`'storage' in navigator && 'getDirectory' in navigator.storage`

---

## Phase 3: Data Processing Pipeline

### Task 7: Implement Data Normalizer
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 4, Task 6

**Description:**
实现数据统一化模块，将 GitHub 和本地数据转换为统一格式。

**Acceptance Criteria:**
1. ✓ DataNormalizer 类已创建（src/core/data-normalizer.ts）
2. ✓ normalizeCommits(rawData, source) 方法，统一数据格式
3. ✓ detectCommitType(message): CommitType 实现，基于提交信息前缀
4. ✓ deduplicateCommits(commits) 基于 hash 去重
5. ✓ 所有提交按时间排序
6. ✓ 编译通过，无遗漏类型
7. ✓ 提交"Implement data normalizer"

**Implementation Steps:**
1. 创建 src/core/data-normalizer.ts
2. 实现 normalizeCommits，统一 Commit 对象格式
3. 实现 detectCommitType，检查消息前缀（feat/fix/docs/etc）
4. 实现 deduplicateCommits，使用 Map<id, Commit> 去重
5. 实现 sortByTime，按降序排列（最新优先）
6. 单元测试各个方法
7. git commit

**Notes:**
- 正则表达式：`/^(feat|fix|docs|refactor|test|perf|chore)(\(.+\))?:/i`
- 如果前缀无法识别，默认为 'other'
- weight 初始为 0（稍后计算）

---

### Task 8: Implement Commit Sampler
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 7

**Description:**
实现提交采样模块，将大型提交历史缩减至 500 条。

**Acceptance Criteria:**
1. ✓ CommitSampler 类已创建（src/core/commit-sampler.ts）
2. ✓ sample(commits, maxCount = 500): Commit[] 实现
3. ✓ 采样算法：均匀时间间隔采样
4. ✓ 始终保留 merge 提交（parents.length > 1）
5. ✓ 始终保留带 tag 的提交
6. ✓ 始终保留第一条和最后一条提交
7. ✓ 结果去重且按时间排序
8. ✓ 提交"Implement commit sampling"

**Implementation Steps:**
1. 创建 src/core/commit-sampler.ts
2. 实现基础采样逻辑：
   - 如果 commits.length ≤ 500，返回全部
   - 否则计算时间间隔并采样
3. 识别和保留 merge 提交
4. 识别并标记需保留的 tag 相关提交
5. 去重和排序
6. 单元测试（包括边界情况：exactly 500, 499, 501, 1000）
7. git commit

**Notes:**
- 采样率计算：`interval = commits.length / maxCount`
- Merge 提交判断：`commit.parents.length > 1`
- Tag 信息需从外部传入（稍后与 GrowthModelBuilder 集成）

---

### Task 9: Implement Growth Model Builder
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 8

**Description:**
实现生长模型构建模块，计算项目章节和分析统计数据。

**Acceptance Criteria:**
1. ✓ GrowthModelBuilder 类已创建（src/core/growth-model-builder.ts）
2. ✓ build(commits, branches, tags): GrowthModel 实现
3. ✓ 自动章节划分：基于提交密度和 tag 标记
4. ✓ 章节数量：3～6 个
5. ✓ 每个章节都有合理的标题（基于规则或 LLM）
6. ✓ 计算 authors 统计（提交数、行数统计）
7. ✓ 计算 metadata（开始日期、结束日期、总数、采样率）
8. ✓ 确定性：同一输入多次调用返回相同结果
9. ✓ 提交"Implement growth model builder"

**Implementation Steps:**
1. 创建 src/core/growth-model-builder.ts
2. 实现 build 方法，汇聚提交、分支、标签信息
3. 实现 computeChapters，分析时间线密度：
   - 按时间分段（例如 3 个月为一段）
   - 计算每段平均提交数
   - 识别密度变化点（萌芽、扩张、重构）
4. 生成章节标题（规则或 LLM 调用）
5. 计算 authors 对象（聚合提交数、行数）
6. 填充 metadata
7. 单元测试（包括不同规模的仓库）
8. git commit

**Notes:**
- 章节划分可基于：提交频率、tag 位置、时间断档
- 如果 LLM 不可用，使用规则生成标题：如"Early Stage (0-20%)"、"Growth Phase (20-80%)"等
- LLM 集成可留待后续迭代（目前使用规则）

---

## Phase 4: Rendering & UI

### Task 10: Implement Canvas Renderer
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 9

**Description:**
实现 Canvas 可视化渲染引擎。

**Acceptance Criteria:**
1. ✓ CanvasRenderer 类已创建（src/rendering/canvas-renderer.ts）
2. ✓ render(growthModel, canvasElement) 方法实现
3. ✓ 时间轴作为 X 轴，从左到右表示时间进度
4. ✓ 提交节点按 type 着色（feat=蓝、fix=红、docs=绿 等）
5. ✓ 分支渲染为平行线或分叉形式
6. ✓ Tag 在时间轴上标注
7. ✓ 支持缩放（wheel 事件）和平移（鼠标拖动）
8. ✓ 响应式适配不同屏幕大小
9. ✓ 提交"Implement Canvas visualization renderer"

**Implementation Steps:**
1. 创建 src/rendering/canvas-renderer.ts
2. 获取 canvas 上下文，设置初始样式
3. 实现 drawTimeline()：绘制时间轴、标签
4. 实现 drawCommits()：根据 type 着色，绘制圆形节点
5. 实现 drawBranches()：绘制分支线
6. 实现 drawTags()：在时间轴上标注标签
7. 实现交互处理：
   - 鼠标滚轮缩放
   - 左键拖动平移
   - 悬停显示提交详情
8. 单元测试（mock canvas API）
9. git commit

**Notes:**
- 颜色方案：可定义为配置对象
- 画布大小：动态计算（高度固定，宽度根据时间跨度）
- 交互增强可留待后续迭代

---

### Task 11: Implement UI Controller
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 10

**Description:**
实现用户交互控制器，协调各模块流程。

**Acceptance Criteria:**
1. ✓ UIController 类已创建（src/ui/controller.ts）
2. ✓ handleGitHubURL(url) 方法实现端到端流程
3. ✓ handleLocalDirectory(dirHandle) 方法实现本地文件上传流程
4. ✓ showLoading(message) 显示加载动画
5. ✓ showError(message) 显示错误提示
6. ✓ renderVisualization(model) 调用 Canvas 渲染
7. ✓ 错误处理完整，用户友好的提示信息
8. ✓ 提交"Implement UI controller"

**Implementation Steps:**
1. 创建 src/ui/controller.ts
2. 实现 handleGitHubURL：
   - 验证 URL 格式
   - 调用 GitHubFetcher → DataNormalizer → CommitSampler → GrowthModelBuilder
   - 处理每步的错误和加载状态
3. 实现 handleLocalDirectory：
   - 调用 LocalGitReader（类似流程）
4. 实现 showLoading/showError/renderVisualization，更新 DOM
5. 实现事件监听器绑定
6. 单元测试（mock 各依赖）
7. git commit

**Notes:**
- 错误处理：分阶段捕获和显示
- 加载时间预期 1-5 秒（根据仓库大小）
- 所有异步操作应显示进度反馈

---

### Task 12: Create HTML Interface
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 11

**Description:**
创建 HTML 用户界面。

**Acceptance Criteria:**
1. ✓ public/index.html 已创建
2. ✓ 包含 GitHub URL 输入框
3. ✓ 包含本地文件拖入区域（或按钮触发 File System API）
4. ✓ 包含加载指示器（隐藏状态）
5. ✓ 包含错误提示区域（隐藏状态）
6. ✓ 包含 Canvas 元素（id="visualization")
7. ✓ 基础 CSS 样式（简洁设计）
8. ✓ 响应式布局（移动设备友好）
9. ✓ 提交"Create HTML user interface"

**Implementation Steps:**
1. 创建 public/index.html
2. 编写结构：
   - 顶部标题和说明
   - 两列输入方式（GitHub URL 和本地文件）
   - Canvas 容器
   - 加载指示器
   - 错误提示面板
3. 编写基础 CSS：布局、颜色、响应式
4. 引入 src/main.ts 为入口点
5. 测试渲染
6. git commit

**Notes:**
- 使用 HTML5 语义元素
- CSS 可使用 Vite 的样式导入
- 交互细节可在后续迭代改进

---

### Task 13: Add Error Handling & Logging
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 12

**Description:**
完善错误处理和日志系统。

**Acceptance Criteria:**
1. ✓ 全局错误处理（try-catch）覆盖所有异步操作
2. ✓ 错误消息规范：用户友好的提示而非技术细节
3. ✓ 日志系统实现（console、可选本地存储）
4. ✓ 异常类型定义（AppError, NetworkError, ValidationError 等）
5. ✓ 所有可能的错误场景都有处理（网络、权限、超时等）
6. ✓ 提交"Add comprehensive error handling and logging"

**Implementation Steps:**
1. 创建 src/core/errors.ts，定义异常类
2. 在各模块添加错误处理
3. 实现 Logger 类，支持不同日志等级
4. 在 UIController 中集中处理错误显示
5. 测试各种错误场景
6. git commit

**Notes:**
- 错误消息示例：
  - "仓库不存在。请检查 URL 是否正确。"
  - "该仓库为私有，请提供个人 token。"
  - "API 限流已触发，请在 X 分钟后重试。"
  - "浏览器不支持 File System Access API，请使用 Chromium 或输入 GitHub URL。"

---

### Task 14: Integration Testing
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 13

**Description:**
端到端集成测试。

**Acceptance Criteria:**
1. ✓ 编写测试用例覆盖核心流程
2. ✓ 测试 GitHub 公开仓库读取
3. ✓ 测试提交采样正确性
4. ✓ 测试生长模型生成
5. ✓ 测试错误场景处理
6. ✓ 所有测试通过
7. ✓ 提交"Add integration tests"

**Implementation Steps:**
1. 设置测试框架（Vitest 或 Jest）
2. 编写集成测试用例（使用 mock 数据）
3. 测试关键流程和错误路径
4. 运行测试并验证覆盖率
5. git commit

**Notes:**
- 使用 mock 数据避免依赖真实 API
- 重点测试数据转换、采样、生长模型逻辑
- 可留待迭代中继续扩展测试

---

### Task 15: Documentation & Demo
**Status:** Ready  
**Assignee:** Developer  
**Depends on:** Task 14

**Description:**
项目文档和演示。

**Acceptance Criteria:**
1. ✓ README.md 已创建，包含项目说明、使用说明、技术栈
2. ✓ API 文档（JSDoc 完整）
3. ✓ 开发指南（如何运行、调试）
4. ✓ 演示说明（推荐的 GitHub 仓库用于演示）
5. ✓ 最终提交"Add documentation and demo"

**Implementation Steps:**
1. 创建 README.md
2. 添加项目概述、功能、使用说明
3. 添加开发指南：npm run dev, npm run build
4. 推荐演示仓库（linux, react, vuejs 等著名项目）
5. 添加贡献指南
6. 最终 git commit

**Notes:**
- 文档应清晰易懂
- 包含屏幕截图或演示 GIF（如可能）
- 提供快速开始指南

---

## Summary

- **总任务数**: 15
- **预计总工时**: 40-50 小时
- **关键里程碑**:
  1. Task 2 完成：开发环境可用
  2. Task 6 完成：数据获取模块完成
  3. Task 9 完成：数据处理管道完成
  4. Task 12 完成：UI 可交互
  5. Task 15 完成：项目可发布

## Next Steps

1. ✅ 已完成：需求文档、设计文档、任务清单
2. 👉 **立即开始**：Task 1 - Initialize Project Structure
3. 后续：按依赖关系逐个完成任务
4. 每完成一个任务，执行 git commit
