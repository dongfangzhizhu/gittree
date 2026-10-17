/**
 * 节点信息面板
 * 点击三维树上的叶子（提交）/ 果实（标签）后展示详情，
 * 支持「定位」按钮把相机飞到该节点。
 */

import { Commit, CommitType } from "../core/types";
import { SceneLeaf, SceneFruit } from "../three/scene-types";

export interface NodeInfo {
  kind: "leaf" | "fruit";
  /** 节点 key（renderer.findNode/focusNode 用） */
  key: string;
  commitId: string;
  title: string;
  meta: Array<[string, string]>;
  /** GitHub 提交链接（数据源为 github 时可用） */
  commitUrl?: string;
  onLocate?: () => void;
}

const TYPE_LABELS: Record<CommitType, string> = {
  feat: "功能",
  fix: "修复",
  docs: "文档",
  refactor: "重构",
  test: "测试",
  perf: "性能",
  chore: "杂务",
  merge: "合并",
  revert: "回滚",
  spec: "规格",
  hook: "钩子",
  other: "其他",
};

function fmtDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "--";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** 由提交与场景节点构造面板数据 */
export function buildLeafInfo(
  leaf: SceneLeaf,
  commit: Commit,
  source: { owner?: string; repo?: string } | null
): NodeInfo {
  const url =
    source?.owner && source?.repo
      ? `https://github.com/${source.owner}/${source.repo}/commit/${commit.id}`
      : undefined;
  return {
    kind: "leaf",
    key: leaf.id,
    commitId: commit.id,
    title: commit.message || "(无消息)",
    meta: [
      ["类型", TYPE_LABELS[commit.type] || commit.type],
      ["作者", commit.author.login ? `${commit.author.name} (@${commit.author.login})` : commit.author.name],
      ["日期", fmtDate(commit.time)],
      ["SHA", commit.id.slice(0, 12)],
      ["父提交", String(commit.parents.length)],
      ...(commit.isMerge ? [["标记", "合并提交"] as [string, string]] : []),
    ],
    commitUrl: url,
  };
}

/** 果实（标签）信息 */
export function buildFruitInfo(
  fruit: SceneFruit,
  commit: Commit | undefined,
  source: { owner?: string; repo?: string } | null
): NodeInfo {
  const url =
    source?.owner && source?.repo && commit
      ? `https://github.com/${source.owner}/${source.repo}/commit/${commit.id}`
      : undefined;
  const meta: Array<[string, string]> = [
    ["标签", fruit.label],
    ["类型", fruit.kind === "major" ? "主版本" : fruit.kind === "spec" ? "Kiro 痕迹" : "版本"],
  ];
  if (commit) {
    meta.push(["日期", fmtDate(commit.time)], ["SHA", commit.id.slice(0, 12)]);
  }
  return {
    kind: "fruit",
    key: fruit.id,
    commitId: fruit.commitId,
    title: fruit.kind === "spec" ? fruit.label : `版本 ${fruit.label}`,
    meta,
    commitUrl: url,
  };
}

export interface InfoPanel {
  show(info: NodeInfo | null): void;
  isVisible(): boolean;
}

/** 创建信息面板（绑定 DOM） */
export function createInfoPanel(root: HTMLElement): InfoPanel {
  let visible = false;

  root.innerHTML = `
    <div class="panel-head">
      <span class="panel-kind"></span>
      <button class="panel-close" title="关闭">✕</button>
    </div>
    <div class="panel-title"></div>
    <dl class="panel-meta"></dl>
    <div class="panel-actions">
      <button class="panel-locate" style="display:none">🎯 定位到此处</button>
      <a class="panel-link" target="_blank" rel="noopener" style="display:none">在 GitHub 查看 ↗</a>
    </div>
  `;

  const kindEl = root.querySelector(".panel-kind") as HTMLElement;
  const titleEl = root.querySelector(".panel-title") as HTMLElement;
  const metaEl = root.querySelector(".panel-meta") as HTMLElement;
  const closeBtn = root.querySelector(".panel-close") as HTMLButtonElement;
  const locateBtn = root.querySelector(".panel-locate") as HTMLButtonElement;
  const linkEl = root.querySelector(".panel-link") as HTMLAnchorElement;

  closeBtn.addEventListener("click", () => show(null));

  function show(info: NodeInfo | null): void {
    if (!info) {
      visible = false;
      root.classList.remove("open");
      return;
    }
    visible = true;
    kindEl.textContent = info.kind === "leaf" ? "🍃 提交" : "🍑 节点";
    titleEl.textContent = info.title;
    metaEl.innerHTML = "";
    for (const [label, value] of info.meta) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      metaEl.append(dt, dd);
    }
    locateBtn.style.display = info.onLocate ? "" : "none";
    locateBtn.onclick = () => info.onLocate?.();
    if (info.commitUrl) {
      linkEl.href = info.commitUrl;
      linkEl.style.display = "";
    } else {
      linkEl.style.display = "none";
    }
    root.classList.add("open");
  }

  return {
    show,
    isVisible: () => visible,
  };
}
