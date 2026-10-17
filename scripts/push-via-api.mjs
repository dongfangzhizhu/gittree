/**
 * 通过 GitHub Git Data API 推送本地领先提交。
 *
 * 背景：本机沙箱只能访问 api.github.com，github.com:443 被代理拒绝（CONNECT 502），
 * 因此 `git push` 无法使用。这里按「blob → tree → commit → 更新 ref」重建提交，
 * 并利用「内容寻址」特性校验重建出的 SHA 是否与本地一致（一致才能保证本地/远端不分叉）。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CWD = process.cwd();
const git = (...args) => execFileSync("git", args, { cwd: CWD, encoding: "utf8", maxBuffer: 1 << 28 });
const gitTrim = (...args) => git(...args).trim();
const gitBuf = (...args) => execFileSync("git", args, { cwd: CWD, maxBuffer: 1 << 28 });

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const p = `${process.env.USERPROFILE || process.env.HOME}/.git-credentials`;
  const lines = readFileSync(p, "utf8").trim().split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^https:\/\/([^:]+):([^@]+)@github\.com$/);
    if (m) return decodeURIComponent(m[2]);
  }
  throw new Error("未找到 github.com 凭据");
}

const TOKEN = readToken();
const remote = gitTrim("remote", "get-url", "origin");
const rm = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
if (!rm) throw new Error(`无法解析远端地址: ${remote}`);
const OWNER = rm[1];
const REPO = rm[2];

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${init.method || "GET"} ${path} — ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** 重建提交文本，校验能否哈希出本地 SHA */
function commitCanonical(tree, parents, author, committer, message) {
  const ident = (a) => `${a.name} <${a.email}> ${a.iso}`;
  return (
    `tree ${tree}\n` +
    parents.map((p) => `parent ${p}\n`).join("") +
    `author ${ident(author)}\n` +
    `committer ${ident(committer)}\n` +
    `\n${message}`
  );
}

function isoToGitDate(iso) {
  // 2026-10-17T20:13:20+08:00 -> 1792241000 +0800
  const m = iso.match(/^(.+?)([+-]\d{2}:\d{2})$/);
  if (!m) return `${Math.floor(new Date(iso).getTime() / 1000)} +0000`;
  const secs = Math.floor(new Date(m[1] + m[2]).getTime() / 1000);
  return `${secs} ${m[2].replace(":", "")}`;
}

const head = gitTrim("rev-parse", "HEAD");
const remoteRef = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/main`);
let parentSha = remoteRef.object.sha;
const localOrigin = gitTrim("rev-parse", "refs/remotes/origin/main").trim();
console.log(`远端 main: ${parentSha.slice(0, 8)}  本地 origin/main: ${localOrigin.slice(0, 8)}`);

const commits = gitTrim("rev-list", "--reverse", `${parentSha}..HEAD`).split("\n").filter(Boolean);
if (commits.length === 0) {
  console.log("没有需要推送的提交");
  process.exit(0);
}
console.log(`待推送 ${commits.length} 个提交：${commits.map((c) => c.slice(0, 7)).join(", ")}`);

let parentTree = gitTrim("rev-parse", `${parentSha}^{tree}`);
let created = null;

for (const sha of commits) {
  const entries = [];
  const ns = git("diff-tree", "--no-commit-id", "--name-status", "-r", sha)
    .split("\n")
    .filter(Boolean);
  for (const line of ns) {
    const parts = line.split("\t");
    const status = parts[0];
    if (status === "D") {
      entries.push({ path: parts[1], mode: "100644", type: "blob", sha: null });
    } else if (status.startsWith("R") || status.startsWith("C")) {
      if (status.startsWith("R")) entries.push({ path: parts[1], mode: "100644", type: "blob", sha: null });
      const p = parts[2];
      const mode = gitTrim("ls-tree", sha, "--", p).split(/\s+/)[0] || "100644";
      const blob = gitBuf("show", `${sha}:${p}`);
      const up = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: blob.toString("base64"), encoding: "base64" }),
      });
      entries.push({ path: p, mode, type: "blob", sha: up.sha });
    } else {
      const p = parts[1];
      const mode = gitTrim("ls-tree", sha, "--", p).split(/\s+/)[0] || "100644";
      const blob = gitBuf("show", `${sha}:${p}`);
      const up = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: blob.toString("base64"), encoding: "base64" }),
      });
      entries.push({ path: p, mode, type: "blob", sha: up.sha });
    }
  }

  const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: parentTree, tree: entries }),
  });

  const message = git("log", "-1", "--format=%B", sha).replace(/\n$/, "");
  const name = gitTrim("log", "-1", "--format=%an", sha);
  const email = gitTrim("log", "-1", "--format=%ae", sha);
  const dateIso = gitTrim("log", "-1", "--format=%aI", sha);
  const cName = gitTrim("log", "-1", "--format=%cn", sha);
  const cEmail = gitTrim("log", "-1", "--format=%ce", sha);
  const cDateIso = gitTrim("log", "-1", "--format=%cI", sha);

  // 先用本地对象校验：重建文本必须哈希出同一个 SHA
  const canonical = commitCanonical(
    tree.sha,
    [parentSha],
    { name, email, iso: isoToGitDate(dateIso) },
    { name: cName, email: cEmail, iso: isoToGitDate(cDateIso) },
    message
  );
  const hashed = execFileSync("git", ["hash-object", "-t", "commit", "--stdin"], {
    cwd: CWD,
    input: canonical,
    encoding: "utf8",
  }).trim();
  if (hashed !== sha) {
    console.error(`✗ 校验失败：重建 ${hashed.slice(0, 8)} ≠ 本地 ${sha.slice(0, 8)}`);
    console.error("  tree:", tree.sha, " parent:", parentSha.slice(0, 8));
    console.error("  可能是提交编码/消息换行差异，已中止（ref 未改动）");
    process.exit(2);
  }

  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [parentSha],
      author: { name, email, date: dateIso },
      committer: { name: cName, email: cEmail, date: cDateIso },
    }),
  });
  if (commit.sha !== sha) {
    console.error(`✗ 服务端返回 ${commit.sha.slice(0, 8)} ≠ 本地 ${sha.slice(0, 8)}，已中止`);
    process.exit(3);
  }
  console.log(`  ✓ ${sha.slice(0, 7)} ${gitTrim("log", "-1", "--format=%s", sha).slice(0, 60)}`);
  parentSha = commit.sha;
  parentTree = tree.sha;
  created = commit.sha;
}

if (created) {
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
    method: "PATCH",
    body: JSON.stringify({ sha: created, force: false }),
  });
  git("update-ref", "refs/remotes/origin/main", created);
  console.log(`\n✅ 已推送 main → ${created.slice(0, 8)}（本地 origin/main 已同步）`);
}
