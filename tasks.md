# Tasks: Git 历史摄取与生长模型

## Overview
本任务清单包含 13 个任务，分为 4 个阶段，共约 35-40 个编码小时。

## Summary

- **总任务数**: 13
- **预计总工时**: 35-40 小时
- **关键改进**：
  - 新增 Tree Layout 层（纯函数）
  - 时间统一升序
  - 采样后父节点重连
  - 基于 hash 的确定性随机化
  - GitHub 限制 10 页
  - 本地读取降为 P2
  - 合并 Task 1/2 为单一初始化任务
  - 删除独立的错误处理/日志任务
  - Task 12 只测纯函数和确定性

## 13 Tasks Overview

### Phase 1: Project Setup
- Task 1: Initialize Project & Configure (合并原 1/2)

### Phase 2: Core Data Infrastructure
- Task 2: Define Type Definitions
- Task 3: Implement GitHub Fetcher (10 pages max)
- Task 4: Implement Local Git Reader (P2, isomorphic-git)

### Phase 3: Data Processing Pipeline
- Task 5: Implement Data Normalizer (tags 关联，升序)
- Task 6: Implement Commit Sampler + Parent Reconnection
- Task 7: Implement Growth Model Builder (确定性、升序)

### Phase 4: Rendering & UI
- Task 8: Implement Tree Layout Engine (纯函数，无 Math.random/Date.now)
- Task 9: Implement Canvas Renderer (纯函数 renderFrame)
- Task 10: Implement UI Controller
- Task 11: Create index.html & Vite App (应用模式)
- Task 12: Testing (Pure Functions & Determinism Only)
- Task 13: Documentation & Demo

## Key Requirements

### Time & Ordering
- 所有时间统一为 Unix 时间戳
- 提交时间升序排列（从最古老到最新）
- 所有输入/输出都保证时间升序

### Data Flow
GitHub/Local → Normalize (add tags) → Sample (reconnect parents) → GrowthModel → Layout (pure fn) → Render (pure fn)

### Pure Functions
- layout(model, seed): TreeGeometry - 完全确定性，无副作用
- renderFrame(ctx, geometry, t) - 纯函数，同输入 → 同输出
- seededRandom(seed, index) - 基于 hash 的伪随机，禁止 Math.random()

### GitHub Fetcher
- 最多 10 页（per_page=100）
- 支持 Link 头和 tags 获取
- 错误处理：404/403/网络错误

### Local Reader
- 使用 isomorphic-git
- 检查 showDirectoryPicker 支持
- P2 优先级（可推迟）

### Testing
- 验证 layout() 确定性：f(x) === f(x)
- 验证 renderFrame() 纯函数性
- 验证时间升序
- 验证采样后父节点重连
- 不测异步操作（GitHub API）

## Next Steps

1. 完成文档更新 ✓
2. 开始 Task 1：初始化项目
3. 按依赖关系逐个完成
4. 每个 task 完成后 git commit
