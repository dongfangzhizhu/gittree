# GitTree GitHub Actions 部署 - 最终行动计划

## 🎯 关键发现

**gh-pages 分支未在下拉列表中显示 = 正常现象**

gh-pages 分支会在 GitHub Actions 首次成功运行时由 peaceiris/actions-gh-pages 自动创建。

不需要手动创建，也不需要预先存在。

## ✅ 5 分钟快速部署

### 第 1 步: 配置权限 (1 分钟)

**地址**: https://github.com/dongfangzhizhu/gittree/settings/actions/general

**操作**:
\\\
找到 "Workflow permissions"
↓
选择 ⭕ Read and write permissions
↓
☑ 勾选 "Allow GitHub Actions to create and approve pull requests"
↓
[Save]
\\\

### 第 2 步: 触发部署 (30 秒)

**选择一种方式**:

**方式 A: 本地推送** (更快)
\\\ash
git commit --allow-empty -m 'trigger deploy'
git push
\\\

**方式 B: 在 GitHub 上运行**
- 打开 https://github.com/dongfangzhizhu/gittree/actions
- 点击 [Run workflow] → [Run workflow]

### 第 3 步: 等待完成 (1-2 分钟)

打开: https://github.com/dongfangzhizhu/gittree/actions

等待工作流完成 (显示绿色 ✅)

**此时 gh-pages 分支已自动创建！**

### 第 4 步: 配置 Pages (1 分钟)

**地址**: https://github.com/dongfangzhizhu/gittree/settings/pages

**操作**:
\\\
Source: ⭕ Deploy from a branch
↓
Branch: 选择 "gh-pages" (现在应该能看到)
↓
Folder: / (root)
↓
[Save]
\\\

### 第 5 步: 验证成功 (1 分钟)

访问: https://dongfangzhizhu.github.io/gittree/

应该看到:
- ✅ GitTree 应用加载
- ✅ 标题: "代码年轮"
- ✅ 预置作品卡片
- ✅ 仓库输入框
- ✅ 播放按钮

## 🔄 工作流原理

\\\
Step 1: 配置 Actions 权限 (允许创建分支)
  ↓
Step 2: 推送触发 Actions
  ↓
Step 3: GitHub Actions 运行
  ├─ npm install
  ├─ npm run build
  └─ peaceiris/actions-gh-pages (创建并推送到 gh-pages)
        ↓
        自动创建 gh-pages 分支！
  ↓
Step 4: 配置 Pages 指向 gh-pages
  ↓
Step 5: GitHub Pages 自动发布 gh-pages 内容
  ↓
✅ 应用上线
\\\

## 🆘 如果出错

### Pages 仍显示 404

**原因**: gh-pages 分支未创建或 Pages 配置错误

**检查清单**:
- [ ] Actions 工作流是否显示绿色 ✅?
- [ ] gh-pages 分支是否存在? (仓库 Branches 标签)
- [ ] Pages 设置是否正确保存?
- [ ] 是否已等待 2-3 分钟?

### Actions 工作流失败

打开工作流日志查看详细错误:
https://github.com/dongfangzhizhu/gittree/actions

常见原因:
- Workflow permissions 未设置为 read and write
- Node.js 版本不兼容
- npm run build 命令失败

### 权限问题

确保:
- [ ] 你是仓库的 owner 或有管理员权限
- [ ] 未启用分支保护规则
- [ ] 工作流权限已设置为 "read and write"

## 📞 重要链接

| 用途 | 地址 |
|------|------|
| 配置权限 | https://github.com/dongfangzhizhu/gittree/settings/actions/general |
| 配置 Pages | https://github.com/dongfangzhizhu/gittree/settings/pages |
| 监控部署 | https://github.com/dongfangzhizhu/gittree/actions |
| 查看分支 | https://github.com/dongfangzhizhu/gittree/branches |
| 访问应用 | https://dongfangzhizhu.github.io/gittree/ |

## ✨ 完成标志

所有这些都是绿色 ✅ 时，说明部署成功:

1. ✅ Actions 工作流完成 (绿色)
2. ✅ gh-pages 分支存在
3. ✅ Pages 设置显示发布地址
4. ✅ https://dongfangzhizhu.github.io/gittree/ 可访问
5. ✅ 应用功能正常

## 🎉 之后

一旦部署完成，每次推送代码都会自动:
- 构建项目
- 部署到 gh-pages
- 更新在线应用

无需任何手动操作！

---

**现在就开始吧！按上面的 5 个步骤操作，5 分钟内完成部署。** 🚀
