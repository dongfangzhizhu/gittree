# GitHub Actions + GitHub Pages 部署完成清单

## ✅ 已完成的步骤

- ✅ 项目代码完成
- ✅ GitHub Actions 工作流配置 (.github/workflows/deploy.yml)
- ✅ Vite 配置支持 BASE_PATH (/gittree/)
- ✅ 代码推送到 GitHub
- ✅ GitHub Pages 启用

## ⏳ 需要在 GitHub 上配置的 (立即操作)

### 1. 配置 Workflow 权限

**地址**: https://github.com/dongfangzhizhu/gittree/settings/actions/general

**操作**:
- [ ] 找到 "Workflow permissions" 部分
- [ ] 选择 "Read and write permissions"
- [ ] 勾选 "Allow GitHub Actions to create and approve pull requests"
- [ ] 点击 Save

### 2. 验证 Pages 设置

**地址**: https://github.com/dongfangzhizhu/gittree/settings/pages

**检查**:
- [ ] Source: "Deploy from a branch" 已选择
- [ ] Branch: "gh-pages" (如果列表为空，Actions 运行时会自动创建)
- [ ] Folder: "/ (root)" 已选择
- [ ] 点击 Save

### 3. 触发部署

**两种方式选一**:

**方式 A: 推送新提交**
`ash
git commit --allow-empty -m "trigger deploy"
git push
`

**方式 B: 重新运行现有工作流**
- 打开 Actions 标签: https://github.com/dongfangzhizhu/gittree/actions
- 点击最新的 "Deploy to GitHub Pages" 工作流
- 右上角 "Re-run jobs" → "Re-run all jobs"

### 4. 监控部署

**地址**: https://github.com/dongfangzhizhu/gittree/actions

**查看**:
- [ ] 工作流开始运行 (显示黄色 ⏳)
- [ ] 依次完成各步骤 (Install → Build → Deploy)
- [ ] 工作流完成，显示绿色 ✅

**预期耗时**: 1-2 分钟

### 5. 验证部署成功

完成后，在浏览器中访问:

`
https://dongfangzhizhu.github.io/gittree/
`

**应该看到**:
- [ ] GitTree 应用加载
- [ ] 标题: "代码年轮"
- [ ] 预置作品卡片显示
- [ ] 可以输入仓库地址
- [ ] 播放按钮响应

## 🚀 部署完成后

### 每次更新

任何时候代码更新后:

`ash
git add .
git commit -m "your message"
git push
`

这会自动触发:
- ✅ npm install (安装依赖)
- ✅ npm run build (构建项目)
- ✅ 部署到 gh-pages
- ✅ GitHub Pages 自动发布

### 分享链接

- **基础链接**: https://dongfangzhizhu.github.io/gittree/
- **指定仓库**: https://dongfangzhizhu.github.io/gittree/?repo=facebook/react
- **指定仓库**: https://dongfangzhizhu.github.io/gittree/?repo=torvalds/linux

## 📊 部署流程图

`
git push
  ↓
GitHub 接收推送
  ↓
Actions 工作流触发 (Deploy to GitHub Pages)
  ↓
├─ Checkout 代码
├─ 安装 Node.js 18.x
├─ npm ci (install dependencies)
├─ npm run build (with BASE_PATH=/gittree/)
├─ peaceiris/actions-gh-pages (deploy to gh-pages branch)
│
└─ ✅ 完成
   ↓
GitHub Pages 自动发布 gh-pages 分支
   ↓
https://dongfangzhizhu.github.io/gittree/ 更新
`

## 🔍 常见问题

### Q: 工作流失败显示红色 ❌

**A**: 
1. 点击工作流查看详细日志
2. 常见原因:
   - Workflow permissions 未配置为 "read and write"
   - Node.js 版本不兼容
   - npm run build 失败

**解决**: 检查日志中的具体错误信息

### Q: Pages 仍显示 404

**A**:
1. 等待 2-3 分钟
2. 完全刷新浏览器 (Ctrl+Shift+Delete 清除缓存后刷新)
3. 检查 Settings > Pages 是否显示发布地址
4. 确保 Actions 工作流已完成 (绿色 ✅)

### Q: gh-pages 分支不存在

**A**: 这是正常的！
- gh-pages 分支会在 Actions 首次成功运行时自动创建
- 不需要手动创建
- 如果工作流失败，分支可能不会被创建，检查工作流日志

### Q: 应用加载但功能不工作

**A**: 检查浏览器控制台是否有错误 (F12 → Console)
- 可能是 BASE_PATH 配置问题
- 或者资源文件加载路径错误

## 📞 需要帮助?

- GitHub Actions 文档: https://docs.github.com/en/actions
- GitHub Pages 文档: https://docs.github.com/en/pages
- peaceiris/actions-gh-pages: https://github.com/peaceiris/actions-gh-pages

---

**现在就去 GitHub 配置，完成部署吧！** 🚀
