# 快速参考 - GitHub Actions 部署清单

## 🔗 快速链接

| 操作 | 链接 |
|------|------|
| 配置 Actions 权限 | https://github.com/dongfangzhizhu/gittree/settings/actions/general |
| 启用 GitHub Pages | https://github.com/dongfangzhizhu/gittree/settings/pages |
| 监控部署 | https://github.com/dongfangzhizhu/gittree/actions |
| 访问应用 | https://dongfangzhizhu.github.io/gittree/ |

## ✅ 操作步骤总结

### Step 1: Actions 权限 (1 分钟)
`
Settings > Actions > General
  ☑ Read and write permissions
  ☑ Allow GitHub Actions to create and approve pull requests
  [Save]
`

### Step 2: Pages 设置 (1 分钟)
`
Settings > Pages
  ⭕ Deploy from a branch
  Branch: gh-pages / (root)
  [Save]
`

### Step 3: 触发部署 (选一个)
`ash
# 方式 A: 推送空提交
git commit --allow-empty -m 'trigger deploy'
git push

# 方式 B: 在 GitHub 上 Re-run 最新工作流
`

### Step 4: 等待完成 (1-2 分钟)
- 打开 Actions 标签
- 看到绿色 ✅ 表示成功

### Step 5: 验证应用
访问: https://dongfangzhizhu.github.io/gittree/

## 🚀 自动部署后

每次代码更新自动部署:
`ash
git push  →  Actions 构建  →  Pages 发布  ✅
`

## 📞 常见问题

**Q: 工作流失败?**
A: 检查 Actions 日志，最常见是权限配置问题

**Q: Pages 显示 404?**
A: 等 2-3 分钟，清除浏览器缓存后刷新

**Q: gh-pages 分支不存在?**
A: 正常，工作流完成时会自动创建
