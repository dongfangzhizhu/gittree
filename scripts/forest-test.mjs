/**
 * 森林（多选）端到端验证
 * 用法: node scripts/forest-test.mjs [--url http://127.0.0.1:5173/] [--out screenshots]
 *
 * 验证项:
 *  1. 页面加载无 JS 错误
 *  2. 卡片点击切换选中态（.selected 类 + 计数 + 按钮可用）
 *  3. 多选 3 个内置快照 → 生成森林：trees=3、名牌 3 个
 *  4. 名牌跟随树冠（有坐标、非默认 0）
 *  5. 点击某棵树的叶子 → 焦点切到该树
 *  6. 清空选择按钮生效
 *  7. 截图存证
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_TARGET = argOf("url", "http://127.0.0.1:5173/");
const OUT_DIR = resolve(argOf("out", resolve(__dirname, "..", "screenshots")));
mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const jsErrors = [];
page.on("pageerror", (err) => jsErrors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") jsErrors.push(`console: ${msg.text()}`);
});

const state = () => page.evaluate(() => window.__gittree?.getState() ?? null);
const shot = (name) => page.screenshot({ path: resolve(OUT_DIR, name), fullPage: false });

console.log(`\n== 打开 ${URL_TARGET} ==`);
await page.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 45000 });
// 等首页自动加载预置（load 后 500ms + 渲染）
await page.waitForFunction(() => (window.__gittree?.getState().leaves ?? 0) > 0, { timeout: 30000 });
report("首屏自动加载预置", true, `${(await state()).leaves} 片叶子`);

// ---- 2. 选中态 ----
const snapshotCards = page.locator(".snapshot-card");
const snapshotCount = await snapshotCards.count();
report("内置快照卡片存在", snapshotCount >= 2, `${snapshotCount} 张`);

// 先清空（预置首卡默认选中）
await page.click("#clearSelectionBtn");
const cleared = await page.evaluate(() => ({
  keys: window.__gittree.selectionKeys().length,
  selected: document.querySelectorAll(".preset-card.selected").length,
  count: document.getElementById("forestCount").textContent.trim(),
  disabled: document.getElementById("growForestBtn").disabled,
}));
report(
  "清空选择：无选中卡片 / 计数归零 / 按钮禁用",
  cleared.keys === 0 && cleared.selected === 0 && cleared.disabled === true,
  `${cleared.count}`
);

// 选中 3 张快照卡
const picked = Math.min(3, snapshotCount);
for (let i = 0; i < picked; i++) await snapshotCards.nth(i).click();
const sel = await page.evaluate(() => ({
  keys: window.__gittree.selectionKeys().length,
  selected: document.querySelectorAll(".preset-card.selected").length,
  countText: document.getElementById("forestCount").textContent.trim(),
  label: document.getElementById("growForestBtn").textContent.trim(),
  disabled: document.getElementById("growForestBtn").disabled,
  hasCheck: getComputedStyle(
    document.querySelector(".preset-card.selected"),
    "::after"
  ).content,
}));
report(
  "多选：卡片出现选中态且与未选中可区分",
  sel.selected === picked && sel.hasCheck.includes("✓"),
  `::after = ${sel.hasCheck}`
);
report(
  "森林条计数与按钮文案同步",
  sel.keys === picked && sel.countText.includes(String(picked)) && !sel.disabled,
  `${sel.countText} / ${sel.label}`
);

await shot("forest-01-selected.png");

// ---- 3. 生成森林 ----
await page.click("#growForestBtn");
await page.waitForFunction(
  (n) => (window.__gittree?.getState().trees ?? 0) === n,
  picked,
  { timeout: 60000 }
);
await page.waitForTimeout(1200); // 让树长出来
const forest = await state();
report(
  "生成森林：树的数量正确",
  forest.trees === picked,
  `trees=${forest.trees}, leaves=${forest.leaves}, fruits=${forest.fruits}`
);
report(
  "森林里每棵树都有提交数据",
  forest.forest.length === picked && forest.forest.every((t) => t.commits > 0),
  forest.forest.map((t) => `${t.label}:${t.commits}`).join(" | ")
);

// ---- 4. 名牌 ----
const labels = await page.evaluate(() => window.__gittree.treeLabelPos());
const visibleLabels = labels.filter((l) => l.display !== "none" && l.left && l.left !== "0px");
report(
  "每棵树一个名牌且已投影定位",
  labels.length === picked && visibleLabels.length >= Math.min(2, picked),
  labels.map((l) => `${l.text}@${l.left},${l.top}`).join(" | ")
);
report(
  "焦点名牌高亮（.focused 唯一）",
  labels.filter((l) => l.focused).length === 1,
  `focused=${labels.findIndex((l) => l.focused)}`
);

await shot("forest-02-grown.png");

// 转动视角后再检查名牌跟随（不应报错、仍在画布内）
// 画布在首屏之外，必须先滚进视口，否则鼠标事件点不到画布
await page.locator(".canvas-container").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const box = await page.locator(".canvas-container").boundingBox();
const cx = Math.min(box.x + box.width / 2, 1400);
const cy = Math.min(box.y + box.height / 2, 860);
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 180, cy - 40, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(500);
const labels2 = await page.evaluate(() => window.__gittree.treeLabelPos());
report(
  "旋转视角后名牌重新投影（位置变化）",
  labels2.some((l, i) => l.left !== labels[i]?.left || l.top !== labels[i]?.top),
  `${labels.find((l) => l.focused)?.left},${labels.find((l) => l.focused)?.top} → ${labels2.find((l) => l.focused)?.left},${labels2.find((l) => l.focused)?.top}`
);

// ---- 5. 点击另一棵树的节点 → 焦点切换 ----
// 先播到 100% 保证叶/果都长出来了
await page.keyboard.press("End");
await page.waitForTimeout(800);
const switched = await page.evaluate(() => {
  const keys = window.__gittree.sampleLeafKeys(4000);
  // 找到属于第 2 棵树的叶子（key 前缀 "1-"），并挑一个落在画布内的
  const rect = document.querySelector(".canvas-container").getBoundingClientRect();
  for (const k of keys) {
    if (!k.startsWith("1-")) continue;
    const pos = window.__gittree.nodeScreenPos(k);
    if (!pos) continue;
    if (pos.x > rect.left + 20 && pos.x < rect.right - 20 && pos.y > rect.top + 20 && pos.y < rect.bottom - 20) {
      return { ok: true, key: k, pos };
    }
  }
  return { ok: false, reason: "找不到画布内的第 2 棵树叶子", total: keys.length };
});
if (switched.ok) {
  await page.mouse.click(switched.pos.x, switched.pos.y);
  await page.waitForTimeout(600);
  const after = await state();
  const info = await page.evaluate(() => document.getElementById("infoPanel")?.textContent ?? "");
  report("点击第 2 棵树的叶子 → 焦点切到该树", after.focusIndex === 1, `focusIndex=${after.focusIndex} (${switched.key})`);
  report("信息面板显示被点节点", info.trim().length > 0, info.replace(/\s+/g, " ").slice(0, 60));
  await shot("forest-03-focus.png");
} else {
  report("点击第 2 棵树的叶子 → 焦点切到该树", false, `${switched.reason}（共 ${switched.total} 个 key）`);
}

// ---- 6. 焦点切换不影响渲染数据 ----
const finalState = await state();
report(
  "焦点切换后森林数据保持完整",
  finalState.trees === picked && finalState.leaves > 0,
  `trees=${finalState.trees}, leaves=${finalState.leaves}, focus=${finalState.focusIndex}`
);

// ---- 7. 无 JS 错误 ----
report("无 JS 运行时错误", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length > 0) {
  console.log("失败项：");
  for (const f of failed) console.log(` - ${f.name}${f.detail ? `：${f.detail}` : ""}`);
  process.exit(1);
}
