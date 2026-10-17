# Design: Git 历史摄取与生长模型

## Architecture Overview

系统采用**分层模块化架构**，分为四层：

```
┌─────────────────────────────────────────┐
│        Web UI Layer (Vite App)          │
│  - index.html（根目录）                 │
│  - 交互界面（URL 输入、文件拖入）       │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│      Tree Layout Layer (Pure Function)  │
│  - layout(model, seed): TreeGeometry    │
│  - renderFrame(ctx, geometry, t)        │
│  - 确定性动画（无 Math.random）         │
│  - 基于 hash 种子的随机化               │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│      Data Processing Layer              │
│  - GitHub API 数据获取（最多 10 页）    │
│  - isomorphic-git 读取本地仓库          │
│  - 数据转换与统一化                      │
│  - 采样与父节点重连                      │
│  - 生长模型计算与章节划分               │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│      Data Models (Shared Types)         │
│  - Commit, Branch, Tag, Author          │
│  - GrowthModel, Chapter                 │
│  - TreeGeometry, Frame                  │
└─────────────────────────────────────────┘
```

## Core Data Structures

### 1. Commit Model (Enhanced)
```typescript
interface Commit {
  id: string;              // commit hash
  parents: string[];       // parent commit IDs
  author: string;          // author name
  time: number;            // unix timestamp (升序排列)
  message: string;         // commit message
  type: CommitType;        // feat/fix/docs/refactor/chore/etc
  weight?: number;         // lines changed (optional)
  filesChanged?: number;   // count of files changed (optional)
  tags: string[];          // associated tag names
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

### 2. Tree Geometry (New Layer)
```typescript
interface TreeNode {
  id: string;
  x: number;               // 归一化 X 坐标 [0, 1]
  y: number;               // 归一化 Y 坐标 [0, 1]
  radius: number;          // 节点半径
  color: string;           // 根据 type 确定
  parent: TreeNode | null; // 父节点引用
  children: TreeNode[];    // 子节点
  birthTime: number;       // 动画出现时间
}

interface TreeGeometry {
  nodes: Map<string, TreeNode>;
  edges: Array<[string, string]>;  // [from, to] commit ids
  bounds: {
    width: number;
    height: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  chapters: ChapterGeometry[];
}

interface ChapterGeometry {
  title: string;
  bounds: Rect;
  commits: string[];
}

interface Frame {
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    radius: number;
    opacity: number;
    color: string;
  }>;
  edges: Array<{
    from: { x: number; y: number };
    to: { x: number; y: number };
    opacity: number;
  }>;
  labels: Array<{
    text: string;
    x: number;
    y: number;
  }>;
}
```

### 3. Growth Model (Compact)
```typescript
interface GrowthModel {
  commits: Commit[];       // 已排序（时间升序）且已重连父节点
  branches: Branch[];
  tags: Tag[];
  authors: Author[];
  chapters: Chapter[];
  metadata: {
    startTime: number;
    endTime: number;
    totalCommits: number;
    sampledCount: number;
    samplingRate: number;
  };
}

interface Branch {
  name: string;
  headCommitId: string;
}

interface Tag {
  name: string;
  commitId: string;
  time: number;
}

interface Author {
  name: string;
  commits: number;
}

interface Chapter {
  title: string;
  startTime: number;
  endTime: number;
  commitIds: string[];
}
```

## Module Decomposition

### 1. **GitHubFetcher** (`src/fetchers/github-fetcher.ts`)
- 职责：GitHub REST API 数据获取
- 关键方法：
  - `fetch(owner, repo, token?): Promise<{ commits: RawCommit[], tags: RawTag[] }>`
- 特性：
  - **最多获取 10 页**（每页 100 条 = 1000 条提交）
  - 支持 Link 头获取最后一页
  - 同时获取 tags（GET /repos/{owner}/{repo}/tags）
  - 错误处理：404、403、网络错误

**实现细节：**
```typescript
// 分页逻辑：
// per_page=100, pages 1-10
// 检查 Link 头中的 rel="last"
// 如果总数 > 1000，提取最后一页的分页信息并补充获取
```

### 2. **LocalGitReader** (`src/fetchers/local-git-reader.ts`) - P2 降级
- 职责：使用 isomorphic-git 读取本地仓库
- 关键方法：
  - `read(dir): Promise<{ commits: RawCommit[], tags: RawTag[] }>`
- 特性：
  - 使用 isomorphic-git 库（跨平台，在 worker 中运行）
  - 检查浏览器支持：`'showDirectoryPicker' in window`
  - 降为 P2（优先级低于 GitHub 获取）
  - 错误时提示用户使用 GitHub URL

### 3. **DataNormalizer** (`src/core/data-normalizer.ts`)
- 职责：统一数据格式
- 关键方法：
  - `normalize(raw, tags): Commit[]`
  - `detectCommitType(message): CommitType`
- 特性：
  - 统一时间为 Unix 时间戳（升序排列）
  - 关联 tags 信息
  - type 检测基于消息前缀

### 4. **CommitSampler** (`src/core/commit-sampler.ts`)
- 职责：采样与父节点重连
- 关键方法：
  - `sample(commits, maxCount): Commit[]`
  - `reconnectParents(commits): Commit[]`
- 特性：
  - 采样保留 merge 提交和 tag 提交
  - **采样后重新连接父节点**（以原始数据为参考）
  - 保留第一条和最后一条提交
  - 添加 tags 字段

### 5. **GrowthModelBuilder** (`src/core/growth-model-builder.ts`)
- 职责：生长模型计算
- 关键方法：
  - `build(commits, branches, tags): GrowthModel`
- 特性：
  - 章节划分基于时间和提交密度
  - 统一为升序时间排列
  - 确定性输出

### 6. **TreeLayoutEngine** (`src/layout/tree-layout.ts`) - 新增纯函数层
- 职责：生成树的几何布局
- 关键方法：
  - `layout(model, seed): TreeGeometry` **（纯函数，无副作用）**
  - `seededRandom(seed, index): number` **（基于哈希的伪随机）**
- 特性：
  - **禁止使用 Math.random()，使用 commit hash 做种子**
  - **禁止使用 Date.now()，时间来自参数**
  - 确定性：同一输入多次调用返回相同结果
  - 输出包含 birthTime（用于动画）

**伪随机实现示例：**
```typescript
function seededRandom(seed: string, index: number): number {
  // 使用 commit hash 的 charCode 和 index 生成伪随机
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  hash = Math.abs((hash ^ (index * 73856093)) % 1000000);
  return hash / 1000000;
}
```

### 7. **CanvasRenderer** (`src/rendering/canvas-renderer.ts`)
- 职责：Canvas 渲染
- 关键方法：
  - `renderFrame(ctx, geometry, t): void` **（纯函数）**
  - `animate(startTime): void`
- 特性：
  - **纯函数渲染**：给定 t 时间戳，输出确定的画面
  - 无状态，支持暂停/恢复
  - 支持交互（缩放、平移）

### 8. **UIController** (`src/ui/controller.ts`)
- 职责：用户交互流程控制
- 关键方法：
  - `handleGitHubURL(url): Promise<void>`
  - `handleLocalDirectory(): Promise<void>` (P2)
  - `render(model): void`

## Data Flow (Deterministic)

```
用户输入 (GitHub URL / 本地目录 P2)
        │
        ▼
┌─────────────────────────┐
│  Input Validation       │
└────────┬────────────────┘
         │
    ┌────┴────┐
    │          │
    ▼          ▼
GitHub API   isomorphic-git
(max 10p)    (P2, 降级)
    │          │
    └────┬─────┘
         │
         ▼
┌─────────────────────────┐
│ Data Normalizer         │
│ + tags 关联             │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Commit Sampler          │
│ + 父节点重连            │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Growth Model Builder    │
│ (升序排列)              │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Tree Layout Engine      │
│ (纯函数，基于 seed)     │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ renderFrame(ctx, geo, t)│
│ (纯函数，确定性渲染)    │
└─────────────────────────┘
```

## Implementation Details

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

### 2. Sampling + Parent Reconnection
```
原始提交树：C1 ← C2 ← C3 ← C4 ← C5 (示例)
采样后：C1, C3, C5
父节点重连：
  - 采样前构建原始父子关系映射
  - 对每个采样提交，查找其最近的祖先在样本中
  - 更新 parents 指向采样后的提交
```

### 3. Seeded Random for Layout
```typescript
// 不使用 Math.random()，改用基于 commit hash 的伪随机
const randomValue = seededRandom(commitId, nodeIndex);
// 范围 [0, 1)，用于计算节点位置偏移
```

### 4. Pure Function Rendering
```typescript
function renderFrame(ctx: CanvasRenderingContext2D, 
                     geometry: TreeGeometry, 
                     t: number): void {
  // t: 当前动画时间（毫秒）
  // 根据 t 和 geometry.birthTime 计算 opacity
  // 完全确定性：同一 (geometry, t) → 相同输出
}
```

## File Structure
```
src/
├── fetchers/
│   ├── github-fetcher.ts
│   └── local-git-reader.ts (isomorphic-git)
├── core/
│   ├── data-normalizer.ts
│   ├── commit-sampler.ts
│   └── growth-model-builder.ts
├── layout/
│   └── tree-layout.ts (纯函数)
├── rendering/
│   └── canvas-renderer.ts (纯函数)
├── ui/
│   └── controller.ts
├── types/
│   └── index.ts
└── main.ts

index.html (根目录)
vite.config.ts
tsconfig.json
package.json
```

## Performance & Determinism

- **确定性**：同一输入（commits, seed）多次调用返回相同布局和渲染
- **无副作用**：layout() 和 renderFrame() 为纯函数
- **无外部依赖时间**：所有时间参数显式传递
- **采样效率**：最多 1000 条提交 → 无需更多采样

## Dependencies

新增：
- `isomorphic-git`：Node.js/浏览器跨平台 Git 操作
- 可选：`pako` 或内置 zlib（如需 ZIP 解压）

移除：
- 不再需要 File System Access API 直接访问（使用 isomorphic-git）
