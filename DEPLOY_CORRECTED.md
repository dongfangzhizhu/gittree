# GitHub Pages 部署 - 正确流程

## ⚠️ 重要: gh-pages 分支自动创建

gh-pages 分支 **不需要手动创建**，它会在 GitHub Actions 首次成功运行时自动创建。

## ✅ 正确的操作流程 (5 分钟)

### 步骤 1️⃣ : 配置 Actions 权限 (1 分钟)

**链接**: https://github.com/dongfangzhizhu/gittree/settings/actions/general

**操作**:
- 向下滚动到 'Workflow permissions'
- ⭕ 选择: Read and write permissions
- ☑ 勾选: Allow GitHub Actions to create and approve pull requests
- [Save]

### 步骤 2️⃣ : 触发 Actions (立即)

**选项 A: 本地推送** (推荐)
\\\ash
git commit --allow-empty -m 'trigger deploy'
git push
\\\

**选项 B: GitHub 上手动运行**
- 打开: https://github.com/dongfangzhizhu/gittree/actions
- 点击最新的 'Deploy to GitHub Pages' 工作流
- [Run workflow] → [Run workflow]

### 步骤 3️⃣ : 等待完成 (1-2 分钟)

监控: https://github.com/dongfangzhizhu/gittree/actions

看到绿色 ✅ 时，gh-pages 分支已自动创建！

### 步骤 4️⃣ : 现在配置 Pages (1 分钟)

**链接**: https://github.com/dongfangzhizhu/gittree/settings/pages

**操作**:
- Source: ⭕ Deploy from a branch
- Branch: **选择 gh-pages** (现在应该能看到了)
- Folder: / (root)
- [Save]

### 步骤 5️⃣ : 验证应用 (1 分钟)

访问: https://dongfangzhizhu.github.io/gittree/

应该看到:
- ✅ GitTree 应用加载
- ✅ 标题和界面显示
- ✅ 预置作品可用

## 🔍 常见问题

**Q: Actions 仍然显示失败?**
A: 检查日志:
- 可能是权限未正确设置
- 或 Node.js 版本问题
- 查看工作流的详细日志

**Q: gh-pages 分支仍未出现?**
A: 
- 确保 Actions 工作流已完成 (绿色 ✅)
- 刷新页面重新加载
- 检查 Actions 日志中是否有错误

**Q: Pages 设置保存失败?**
A: 
- 确保 gh-pages 分支已存在
- 刷新页面重试
- 检查浏览器控制台是否有错误

## 📊 工作流结构

\\\
开始
  ↓
1. Checkout 代码
  ↓
2. 安装 Node.js 18.x
  ↓
3. npm ci (安装依赖)
  ↓
4. npm run build (BASE_PATH=/gittree/)
  ↓
5. 部署到 gh-pages 分支 ← 这一步创建分支
  ↓
✅ 完成
  ↓
GitHub Pages 自动发布 gh-pages
  ↓
https://dongfangzhizhu.github.io/gittree/ 可访问
\\\

## ⏰ 时间表

| 步骤 | 耗时 |
|------|------|
| 1. Actions 权限 | 1 分钟 |
| 2. 触发工作流 | 30 秒 |
| 3. 等待完成 | 1-2 分钟 |
| 4. Pages 配置 | 1 分钟 |
| 5. 验证应用 | 1 分钟 |
| **总计** | **约 5 分钟** |

## ✨ 完成标志

看到以下情况说明全部成功:

1. ✅ Actions 工作流显示绿色 ✓
2. ✅ gh-pages 分支在分支列表中显示
3. ✅ Pages 设置显示部署地址
4. ✅ https://dongfangzhizhu.github.io/gittree/ 能访问
5. ✅ 应用功能正常
