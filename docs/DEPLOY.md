# 部署说明（GitHub Pages）

本项目用一个 GitHub Actions 工作流自动构建并发布到 GitHub Pages：

- 线上地址：<https://dongfangzhizhu.github.io/gittree/>
- 工作流：`.github/workflows/deploy.yml`（`Deploy to GitHub Pages`）
- 触发条件：推送到 `main`，或在 Actions 页面手动 `Run workflow`

> 早期方案曾经用 `peaceiris/actions-gh-pages` 推 `gh-pages` 分支，本项目**已经不用了**。
> 现在走官方 `actions/deploy-pages`（构建产物直接作为 Pages 部署物），
> 所以仓库里**没有也不需要** `gh-pages` 分支。

## 一次性配置（只需做一次）

1. **Settings → Pages → Build and deployment**
   - Source 选 **GitHub Actions**（不是 "Deploy from a branch"）
2. **Settings → Actions → General → Workflow permissions**
   - 选 **Read and write permissions**
   - 勾选 **Allow GitHub Actions to create and approve pull requests**

配置完成后无需再手动操作，之后每次 `git push` 都会自动发布。

## 自动部署流程

```
push main
   ↓
Deploy to GitHub Pages
   ├─ actions/checkout
   ├─ setup-node 20 (cache: npm)
   ├─ npm ci                        ← 依赖来自 package-lock.json
   ├─ npm test --if-present         ← vitest 单元测试（118 个用例）
   ├─ npm run build                 ← tsc 类型检查 + vite build，BASE_PATH=/gittree/
   ├─ upload-pages-artifact(dist)
   └─ deploy-pages
   ↓
https://dongfangzhizhu.github.io/gittree/   ✅ 约 1–2 分钟
```

构建产物在 `dist/`，不进版本库（`.gitignore` 已忽略）。

## 手动触发

- GitHub → Actions → `Deploy to GitHub Pages` → **Run workflow**
- 或本地推一个空提交：`git commit --allow-empty -m "trigger deploy" && git push`

## 本地验证生产构建

```bash
BASE_PATH=/gittree/ npm run build     # 模拟 Pages 的子路径
npx vite preview --base /gittree/     # 本地按子路径预览 dist/
```

`vite.config.ts` 里 `base = process.env.BASE_PATH ?? "/"`：
本地开发是 `/`，Pages 上是 `/gittree/`。若线上白屏且控制台报资源 404，先确认
`BASE_PATH` 是否被正确注入（`index.html` 中的资源应是 `/gittree/assets/...`）。

## 常见问题

| 现象 | 排查方向 |
|------|----------|
| 访问 404 | Pages 的 Source 是否为 **GitHub Actions**；工作流是否成功；Pages 首次生效有 1–2 分钟延迟 |
| 构建失败 | 看 Actions 日志里 `npm ci` / `npm test` / `npm run build` 哪一步红；本地复现同一命令 |
| 页面白屏、资源 404 | `BASE_PATH` 未注入或与仓库名不一致（当前仓库名 `gittree` → `/gittree/`） |
| 改了代码线上没变 | 确认提交已推送到 `main`；Actions 里最新一次 run 的 `head_sha` 是否为该提交；必要时强刷缓存 |
| `npm ci` 报 lock 不一致 | 本地 `npm install` 后提交 `package-lock.json`，不要手改 |

## 相关文件

| 文件 | 作用 |
|------|------|
| `.github/workflows/deploy.yml` | 部署工作流定义 |
| `vite.config.ts` | `base` 由 `BASE_PATH` 注入，`outDir=dist` |
| `package-lock.json` | CI 用 `npm ci` 安装依赖，必须提交 |
| `scripts/push-via-api.mjs` | 在受限网络下通过 GitHub API 推送（沙箱里 `github.com:443` 不通时用） |
