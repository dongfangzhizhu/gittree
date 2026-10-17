# Design: Git 历史摄取与生长模型

## Architecture Overview

系统采用**模块化架构**，分为三层：

```
┌─────────────────────────────────────────┐
│        Web UI Layer (Vite + Canvas)     │
│  - 交互界面（URL 输入、文件拖入）       │
│  - Canvas 渲染引擎                      │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│      Data Processing Layer (Core)       │
│  - GitHub API 数据获取                  │
│  - File System API 读取本地仓库          │
│  - 数据转换与统一化                      │
│  - 采样与去重逻辑                        │
│  - 生长模型计算                          │
│  - 章节划分算法                          │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│      Data Models (Shared Types)         │
│  - GitCommit, Branch, Tag               │
│  - GrowthModel, Chapter                 │
│  - VisualizationData                    │
└─────────────────────────────────────────┘
```

## Core Data Structures

### 1. Commit Model
```typescript
interface Commit {
  id: string;              // commit hash
  parents: string[];       // parent commit IDs
  author: string;          // author name
  time: number;            // unix timestamp
  message: string;         // commit message
  type: CommitType;        // feat/fix/docs/refactor/chore/etc
  weight: number;          // lines changed
  filesChanged: number;    // count of files changed
}

type CommitType = 
  | 'feat'
  | 'fix'
  | 'docs'
  | 'refactor'
  | 'chore'
  | 'test'
  | 'perf'
  | 'other';
```

### 2. Growth Model
```typescript
interface GrowthModel {
  commits: Commit[];
  branches: Branch[];
  tags: Tag[];
  authors: Author[];
  chapters: Chapter[];
  metadata: {
    startDate: number;
    endDate: number;
    totalCommits: number;
    samplingRate: number;
  };
}

interface Branch {
  name: string;
  headCommitId: string;
  commits: number;
}

interface Tag {
  name: string;
  commitId: string;
  timestamp: number;
}

interface Author {
  name: string;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
}

interface Chapter {
  title: string;
  startDate: number;
  endDate: number;
  commits: Commit[];
  themes: string[];
}
```

## Module Decomposition

### 1. **GitHubDataFetcher** (`src/fetchers/github-fetcher.ts`)
- 职责：GitHub REST API 数据获取与分页处理
- 关键方法：
  - `fetchCommits(owner, repo, token?): Promise<Commit[]>`
  - `handleRateLimit(error): Promise<void>`
- 特性：
  - 自动处理 API 限流（返回剩余等待时间）
  - 支持个人 token 提高限流上限
  - 错误处理：404（不存在）、403（私有）等

### 2. **LocalGitReader** (`src/fetchers/local-git-reader.ts`)
- 职责：浏览器内本地 Git 仓库读取（File System Access API）
- 关键方法：
  - `readLocalRepository(dirHandle): Promise<Commit[]>`
  - `parseGitObjects(): Promise<void>`
- 特性：
  - 检查浏览器支持 (Chromium only)
  - 零上传政策：所有数据在本地处理
  - 读取 `.git/` 目录结构

### 3. **DataNormalizer** (`src/core/data-normalizer.ts`)
- 职责：统一两个数据源的输出格式
- 关键方法：
  - `normalizeCommits(rawData, source): Commit[]`
  - `detectCommitType(message): CommitType`
  - `deduplicateCommits(commits): Commit[]`
- 特性：
  - 基于提交信息前缀自动分类 (feat/fix/docs 等)
  - 哈希计算确保确定性
  - 按时间排序与去重

### 4. **CommitSampler** (`src/core/commit-sampler.ts`)
- 职责：提交数采样策略
- 关键方法：
  - `sample(commits, maxCount): Commit[]`
- 特性：
  - 当 commits > 500 时，均匀时间抽样至 500 条
  - 保留所有 merge 提交（通过 `parents.length > 1` 判断）
  - 保留所有带 tag 的提交
  - 始终保留最新和最旧提交

### 5. **GrowthModelBuilder** (`src/core/growth-model-builder.ts`)
- 职责：生长模型计算与章节划分
- 关键方法：
  - `build(commits, branches, tags): GrowthModel`
  - `computeChapters(commits): Chapter[]`
- 特性：
  - 基于提交密度识别"萌芽"、"扩张"、"重构"阶段
  - 使用 tag 作为关键节点
  - 3～6 个章节
  - 如果 LLM 不可用，使用规则生成章节标题

### 6. **RenderingEngine** (`src/rendering/canvas-renderer.ts`)
- 职责：Canvas 渲染可视化
- 关键方法：
  - `render(growthModel): void`
  - `drawTimeline(): void`
  - `drawCommits(): void`
  - `drawBranches(): void`
- 特性：
  - 时间轴作为主轴
  - 提交节点颜色区分 type
  - 分支渲染为平行线
  - 交互式缩放和平移

### 7. **UIController** (`src/ui/controller.ts`)
- 职责：用户交互流程控制
- 关键方法：
  - `handleGitHubURL(url): Promise<void>`
  - `handleLocalDirectoryDrop(dirHandle): Promise<void>`
  - `showLoading(message): void`
  - `showError(message): void`
  - `renderVisualization(model): void`

## Data Flow

```
用户输入 (GitHub URL / 本地目录)
        │
        ▼
┌─────────────────────────┐
│  Input Validation       │
└────────┬────────────────┘
         │
    ┌────┴────┐
    │          │
    ▼          ▼
GitHub API   File System API
    │          │
    └────┬─────┘
         │
         ▼
┌─────────────────────────┐
│ Data Normalizer         │
│ (统一格式 + 去重)       │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Commit Sampler          │
│ (采样至 500)            │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Growth Model Builder    │
│ (计算章节 + 分析)       │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Canvas Renderer         │
│ (生成可视化)            │
└─────────────────────────┘
```

## Technical Details

### 1. Commit Type Detection
```typescript
const typePatterns: Record<CommitType, RegExp> = {
  feat: /^feat(\(.+\))?:/i,
  fix: /^fix(\(.+\))?:/i,
  docs: /^docs(\(.+\))?:/i,
  refactor: /^refactor(\(.+\))?:/i,
  test: /^test(\(.+\))?:/i,
  perf: /^perf(\(.+\))?:/i,
  chore: /^chore(\(.+\))?:/i,
};
```

### 2. Sampling Algorithm
```
1. Sort commits by timestamp
2. If count ≤ 500: return all
3. Otherwise:
   a. Calculate interval = count / 500
   b. Sample at positions [0, interval, 2*interval, ...]
   c. Add all merge commits (parents.length > 1)
   d. Add all tagged commits
   e. Ensure first and last commits are included
   f. Remove duplicates and re-sort
```

### 3. Chapter Detection
- 密度阈值：计算时间窗口内平均提交数
- Tag 用于强制分割
- LLM 提示词：分析时间范围、主题、提交消息生成章节标题

## File Structure
```
src/
├── fetchers/
│   ├── github-fetcher.ts
│   └── local-git-reader.ts
├── core/
│   ├── data-normalizer.ts
│   ├── commit-sampler.ts
│   └── growth-model-builder.ts
├── rendering/
│   └── canvas-renderer.ts
├── ui/
│   ├── controller.ts
│   └── index.html
├── types/
│   └── index.ts
└── main.ts

public/
└── index.html

vite.config.ts
tsconfig.json
package.json
```

## Error Handling Strategy

| 错误类型 | 处理方式 |
|---------|---------|
| GitHub API 404 | 显示"仓库不存在" |
| GitHub API 403 | 显示"私有仓库，请提供 token" |
| GitHub API 限流 | 显示剩余等待时间，允许输入 token 重试 |
| File System API 不支持 | 提示"请使用 Chromium 或输入 GitHub URL" |
| 无效 URL | 显示"URL 格式错误" |
| 网络错误 | 显示"网络连接失败，请重试" |

## Determinism & Caching

- 所有操作基于时间戳和哈希，确保多次生成同一仓库输出一致
- 可选：缓存 API 响应（IndexedDB）以加速重复查询
- Commit hash 作为主键防止重复

## Performance Considerations

- GitHub API：分页处理，每次 100 条，采样减少 API 调用
- 本地读取：异步 File System API，防止 UI 阻塞
- Canvas 渲染：根据章节数动态调整画布大小
- 内存管理：及时释放大型对象，避免内存泄漏
