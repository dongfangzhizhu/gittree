/**
 * 抓取代表性 GitHub 仓库的提交快照，写入 public/snapshots/
 * 用法: node scripts/fetch-snapshots.mjs [--pages 5] [--token ghp_xxx]
 *       [--only owner/repo] [--tag-top 10] [--tag-only]
 *
 * 每个仓库消耗 1（仓库信息）+ pages（提交页）+ tags 页 + tag-top（标签提交）次 API 请求。
 * 生成 index.json 供前端列出，前端加载时无需再请求 API。
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "snapshots");
mkdirSync(OUT_DIR, { recursive: true });

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PAGES = Math.max(1, parseInt(argOf("pages", "5"), 10));
const TOKEN = argOf("token", process.env.GITHUB_TOKEN || "");
const PER_PAGE = 100;
/** 把最近多少个标签指向的提交单独取回，保证快照里出现果实 */
const TAG_TOP = Math.max(0, parseInt(argOf("tag-top", "10"), 10));
const TAG_ONLY = process.argv.includes("--tag-only");

/** 代表性仓库：覆盖合并密集、长期演进、单体大仓等不同形态 */
const REPOS = [
  {
    repo: "facebook/react",
    label: "React",
    description: "前端框架 · 合并密集",
  },
  {
    repo: "vuejs/core",
    label: "Vue 3",
    description: "渐进式框架 · 分支活跃",
  },
  {
    repo: "microsoft/TypeScript",
    label: "TypeScript",
    description: "编译器 · 十余年演进",
  },
];

async function gh(path) {
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path} — ${text.slice(0, 200)}`);
  }
  return res;
}

/** 从 Link 头解析总页数（必须匹配查询参数 page=，不能命中 per_page=） */
function extractLastPage(linkHeader) {
  const lastLink = (linkHeader || "").split(",").find((l) => l.includes('rel="last"'));
  if (!lastLink) return null;
  const m = lastLink.match(/[?&]page=(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** 等距取页（含首尾） */
function equidistantPages(total, count) {
  if (total <= count) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  for (let i = 0; i < count; i++) {
    pages.push(Math.round(1 + (i * (total - 1)) / (count - 1)));
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** 单提交 → 统一格式（标签指向的提交通常不在采样页里，只能单独取） */
async function fetchSingleCommit(owner, name, sha) {
  const res = await gh(`/repos/${owner}/${name}/commits/${sha}`);
  const c = await res.json();
  return {
    sha: c.sha,
    parents: (c.parents || []).map((p) => p.sha),
    author: { name: c.commit?.author?.name || "Unknown", login: c.author?.login },
    date: c.commit?.author?.date,
    message: (c.commit?.message || "").split("\n")[0],
  };
}

/**
 * 把最近 TAG_TOP 个标签指向的提交并入 commits，返回留下的标签。
 * 采样后的提交里往往一个标签都命中不上，树上就没有果实——这里补齐。
 */
async function augmentTagCommits(owner, name, commits, tags) {
  const have = new Set(commits.map((c) => c.sha));
  let added = 0;
  for (const t of tags.slice(0, TAG_TOP)) {
    const sha = t.commit;
    if (!sha || have.has(sha)) continue;
    try {
      commits.push(await fetchSingleCommit(owner, name, sha));
      have.add(sha);
      added++;
    } catch (error) {
      console.warn(`  ⚠ 标签 ${t.name} 的提交获取失败：${error.message}`);
      break;
    }
  }
  // 新→旧，保持与 GitHub 列表顺序一致
  commits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const keptTags = tags.filter((t) => have.has(t.commit));
  console.log(`  标签提交补齐 ${added} 条 → 可上树标签 ${keptTags.length}/${tags.length}`);
  return keptTags;
}

async function fetchRepo({ repo, label, description }) {
  console.log(`\n== ${repo} ==`);
  const [owner, name] = repo.split("/");

  // 1) 仓库信息（校验存在 + 取默认分支）
  const infoRes = await gh(`/repos/${owner}/${name}`);
  const info = await infoRes.json();
  console.log(`  默认分支: ${info.default_branch}, stars: ${info.stargazers_count}`);

  // 2) 第一页确定总页数
  const firstRes = await gh(`/repos/${owner}/${name}/commits?per_page=${PER_PAGE}&page=1`);
  const totalPages = extractLastPage(firstRes.headers.get("link")) || 1;
  const firstPage = await firstRes.json();
  const pages = equidistantPages(totalPages, PAGES);
  console.log(`  总页数 ${totalPages}，抓取页: [${pages.join(",")}]`);

  // 3) 其余页
  const rest = [];
  for (const page of pages) {
    if (page === 1) continue;
    const res = await gh(`/repos/${owner}/${name}/commits?per_page=${PER_PAGE}&page=${page}`);
    rest.push(await res.json());
  }
  const allCommits = [...firstPage, ...rest.flat()];

  // 4) 标签（最多 2 页）；失败必须显式记录，不静默降级
  const tags = [];
  let tagsError = null;
  for (let p = 1; p <= 2; p++) {
    try {
      const res = await gh(`/repos/${owner}/${name}/tags?per_page=100&page=${p}`);
      const pageTags = await res.json();
      tags.push(...pageTags);
      if (pageTags.length < 100) break;
    } catch (error) {
      tagsError = error.message;
      console.warn(`  ⚠ 标签抓取失败（第 ${p} 页）：${tagsError}`);
      break;
    }
  }

  const commits = allCommits.map((c) => ({
    sha: c.sha,
    parents: (c.parents || []).map((p) => p.sha),
    author: {
      name: c.commit?.author?.name || "Unknown",
      login: c.author?.login,
    },
    date: c.commit?.author?.date,
    message: (c.commit?.message || "").split("\n")[0],
  }));

  // 5) 补齐标签指向的提交（否则树上一个果实都没有）
  const tagRefs = tags.map((t) => ({ name: t.name, commit: t.commit?.sha }));
  const keptTags = await augmentTagCommits(owner, name, commits, tagRefs);

  const snapshot = {
    version: 1,
    repo,
    label,
    description,
    defaultBranch: info.default_branch,
    fetchedAt: Date.now(),
    meta: {
      totalPages,
      pagesFetched: pages,
      perPage: PER_PAGE,
      commitCount: commits.length,
      sampled: totalPages > PAGES,
      tagTotal: tags.length,
      tagInSample: keptTags.length,
    },
    raw: {
      commits,
      tags: keptTags,
      metadata: {
        truncated: totalPages > PAGES,
        estimatedTotal: totalPages * PER_PAGE,
        droppedTags: tags.length - keptTags.length,
      },
    },
  };

  const file = `${owner}__${name}.json`;
  writeFileSync(resolve(OUT_DIR, file), JSON.stringify(snapshot));
  console.log(`  写入 ${file}：${commits.length} 提交 / ${keptTags.length} 标签`);

  return {
    repo,
    label,
    description,
    file,
    commits: commits.length,
    tags: keptTags.length,
    tagsTotal: tags.length,
    tagsError,
    fetchedAt: snapshot.fetchedAt,
    sampled: snapshot.meta.sampled,
  };
}

/** 标签列表（最多 3 页） */
async function fetchTags(owner, name) {
  const tags = [];
  for (let p = 1; p <= 3; p++) {
    const res = await gh(`/repos/${owner}/${name}/tags?per_page=100&page=${p}`);
    const page = await res.json();
    tags.push(...page.map((t) => ({ name: t.name, commit: t.commit?.sha })));
    if (page.length < 100) break;
  }
  return tags;
}

/** --tag-only：只给已存在的快照补标签提交，不重新抓取提交页 */
async function augmentExisting(entry) {
  const file = entry.file;
  const snapshot = JSON.parse(readFileSync(resolve(OUT_DIR, file), "utf8"));
  const [owner, name] = entry.repo.split("/");
  console.log(`\n== ${entry.repo}（补标签提交） ==`);
  const commits = snapshot.raw?.commits || [];
  let tags = snapshot.raw?.tags || [];
  let tagsTotal = entry.tagsTotal ?? tags.length;

  // 上次抓取时标签接口失败/为空 → 这次补抓
  if (tags.length === 0) {
    try {
      tags = await fetchTags(owner, name);
      tagsTotal = tags.length;
      console.log(`  重新抓取标签 ${tags.length} 个`);
    } catch (error) {
      console.warn(`  ⚠ 标签依然取不到：${error.message}`);
    }
  }

  const before = commits.length;
  const keptTags = await augmentTagCommits(owner, name, commits, tags);

  snapshot.raw.commits = commits;
  snapshot.raw.tags = keptTags;
  snapshot.raw.metadata = {
    ...(snapshot.raw.metadata || {}),
    droppedTags: tags.length - keptTags.length,
  };
  snapshot.meta = {
    ...(snapshot.meta || {}),
    commitCount: commits.length,
    tagTotal: tagsTotal,
    tagInSample: keptTags.length,
  };
  snapshot.fetchedAt = Date.now();
  writeFileSync(resolve(OUT_DIR, file), JSON.stringify(snapshot));
  console.log(`  写入 ${file}：${before} → ${commits.length} 提交 / ${keptTags.length} 标签`);
  return {
    ...entry,
    commits: commits.length,
    tags: keptTags.length,
    tagsTotal,
    tagsError: keptTags.length === 0 && tagsTotal === 0 ? "标签接口未返回数据" : null,
    fetchedAt: snapshot.fetchedAt,
  };
}

const ONLY = argOf("only", "");
const index = [];
for (const entry of REPOS) {
  if (ONLY && entry.repo !== ONLY) continue;
  try {
    if (TAG_ONLY) continue; // 该模式在下面基于已有文件处理
    index.push(await fetchRepo(entry));
  } catch (error) {
    console.error(`  ✗ ${entry.repo}: ${error.message}`);
  }
}

// 单仓重跑时保留其它仓库的索引条目
let previous = [];
try {
  previous = JSON.parse(readFileSync(resolve(OUT_DIR, "index.json"), "utf8")).snapshots || [];
} catch {
  previous = [];
}

// --tag-only：只补标签提交，不动已抓好的提交页
if (TAG_ONLY) {
  for (let i = 0; i < previous.length; i++) {
    const item = previous[i];
    if (ONLY && item.repo !== ONLY) continue;
    try {
      previous[i] = await augmentExisting(item);
    } catch (error) {
      console.error(`  ✗ ${item.repo}: ${error.message}`);
    }
  }
  writeFileSync(
    resolve(OUT_DIR, "index.json"),
    JSON.stringify({ generatedAt: Date.now(), snapshots: previous }, null, 2)
  );
  console.log(`\n索引写入 index.json（${previous.length} 个快照）`);
  process.exit(0);
}

const merged = [...index];
for (const item of previous) {
  if (!merged.some((m) => m.repo === item.repo)) merged.push(item);
}

writeFileSync(
  resolve(OUT_DIR, "index.json"),
  JSON.stringify({ generatedAt: Date.now(), snapshots: merged }, null, 2)
);
console.log(`\n索引写入 index.json（${merged.length} 个快照）`);
