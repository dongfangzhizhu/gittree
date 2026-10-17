# Requirements: Git 历史摄取与生长模型

## Introduction
用户提供 GitHub 公开仓库地址或本地 Git 目录，系统读取提交历史并生成统一的“生长模型”，供渲染器使用。

## Requirements

### Requirement 1：从 GitHub 仓库地址读取历史
**User Story:** 作为用户，我想粘贴一个 GitHub 仓库地址，以便无需安装任何东西就看到它的树。

#### Acceptance Criteria
1. WHEN 用户输入合法的 github.com 仓库地址 THEN 系统 SHALL 通过 GitHub REST API 分页获取提交列表。
2. WHEN 提交总数超过 500 THEN 系统 SHALL 按时间均匀抽样至 500 条，并保留所有 merge 提交和带 tag 的提交。
3. IF API 返回限流错误 THEN 系统 SHALL 提示剩余等待时间，并允许用户填入个人 token 后重试。
4. IF 仓库不存在或为私有 THEN 系统 SHALL 显示明确的错误信息，不得崩溃。

### Requirement 2：从本地目录读取历史
**User Story:** 作为用户，我想拖入本地项目目录，以便为私有或未发布的项目生成树。

#### Acceptance Criteria
1. WHEN 用户选择包含 .git 的目录 THEN 系统 SHALL 在浏览器内读取提交、父提交、作者、时间和每次提交的改动文件数与行数。
2. IF 浏览器不支持 File System Access API THEN 系统 SHALL 提示改用 Chromium 内核浏览器或使用 GitHub 地址。
3. 系统 SHALL NOT 将本地仓库的任何内容上传到任何服务器。

### Requirement 3：统一的生长模型
**User Story:** 作为渲染器开发者，我想要与数据来源无关的统一数据结构。

#### Acceptance Criteria
1. 系统 SHALL 输出包含 commits（id、parents、author、time、type、weight）、branches、tags、authors 的 JSON。
2. WHEN 同一仓库、同一参数多次生成 THEN 输出 SHALL 完全一致（确定性）。
3. 系统 SHALL 根据提交信息前缀（feat/fix/docs/refactor 等）为每个提交标注 type。

### Requirement 4：章节划分
**User Story:** 作为观众，我想看到项目的“萌芽、扩张、重构”等阶段，以便理解故事。

#### Acceptance Criteria
1. 系统 SHALL 按提交密度和 tag 将时间线切分为 3～6 个章节，并给每个章节一个标题。
2. IF LLM 不可用 THEN 系统 SHALL 使用规则生成的标题，不得阻塞主流程。