/**
 * 浏览器端到端验证脚本（Playwright + 系统 Chrome）
 * 用法: node scripts/e2e-check.mjs [--url http://127.0.0.1:5173/] [--out screenshots]
 *
 * 验证项:
 *  1. 页面加载无 JS 错误（pageerror / console.error）
 *  2. 画布容器可见（修复 display:none 回落 bug 的回归测试）
 *  3. 自动播放: t 随时间推进（像素变化证明动画在跑）
 *  4. 画布非空白（像素采样证明树被绘制）
 *  5. 播放/暂停/拖动时间轴
 *  6. 导出按钮可见
 *  7. GitHub 仓库加载（可选, 需网络）
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
const TEST_REPO = argOf("repo", ""); // 例如 dongfangzhizhu/AudioCpp.NET

mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** 读取画布像素统计（WebGL 画布经页面调试钩子 sampleCanvas 读取） */
async function canvasStats(page) {
  return page.evaluate(() => window.__gittree?.sampleCanvas() ?? null);
}

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const jsErrors = [];
const consoleErrors = [];
page.on("pageerror", (err) => jsErrors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

console.log(`\n== 打开 ${URL_TARGET} ==`);
await page.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 30000 });

// 等待自动加载预置（load 事件后 500ms）
await page.waitForTimeout(3500);

// 1. JS 错误
report("页面无 JS 异常", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));
report("控制台无 error", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

// 2. 画布容器可见
const canvasVisible = await page.evaluate(() => {
  const el = document.getElementById("canvasContainer");
  if (!el) return { ok: false, reason: "element missing" };
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    ok: style.display !== "none" && rect.width > 100 && rect.height > 100,
    reason: `display=${style.display} rect=${Math.round(rect.width)}x${Math.round(rect.height)}`,
  };
});
report("画布容器可见且有尺寸", canvasVisible.ok, canvasVisible.reason);

// 3. 自动播放: 连续两帧画面不同
const frameA = await page.evaluate(() => document.getElementById("timeDisplay")?.textContent);
const statsA = await canvasStats(page);
await page.waitForTimeout(2500);
const frameB = await page.evaluate(() => document.getElementById("timeDisplay")?.textContent);
const statsB = await canvasStats(page);
report("动画随时间推进", frameA !== frameB, `timeDisplay: ${frameA} → ${frameB}`);
report(
  "画布非空白（树已绘制）",
  statsA && statsA.nonBgRatio > 0.0015,
  statsA ? `非背景像素占比 ${(statsA.nonBgRatio * 100).toFixed(2)}%, 颜色数 ${statsA.distinctColors}` : "no canvas"
);
report(
  "动画帧之间有像素变化",
  statsA && statsB && statsA.nonBgRatio !== statsB.nonBgRatio,
  `${(statsA?.nonBgRatio ?? 0).toFixed(4)} → ${(statsB?.nonBgRatio ?? 0).toFixed(4)}`
);

await page.screenshot({ path: resolve(OUT_DIR, "01-auto-play.png") });

// 4. 播放/暂停（合并为单按钮）
const labelPlaying = await page.evaluate(
  () => document.getElementById("playPauseBtn")?.textContent?.trim() || ""
);
report("播放中按钮显示「暂停」", labelPlaying.includes("暂停"), labelPlaying);

await page.click("#playPauseBtn");
const tPaused1 = await page.evaluate(() => document.getElementById("timeDisplay")?.textContent);
await page.waitForTimeout(1200);
const tPaused2 = await page.evaluate(() => document.getElementById("timeDisplay")?.textContent);
const labelPaused = await page.evaluate(
  () => document.getElementById("playPauseBtn")?.textContent?.trim() || ""
);
report("暂停后时间停止", tPaused1 === tPaused2, `${tPaused1} → ${tPaused2}`);
report("暂停后按钮显示「播放」", labelPaused.includes("播放"), labelPaused);
await page.screenshot({ path: resolve(OUT_DIR, "02-paused.png") });

await page.click("#playPauseBtn");
await page.waitForTimeout(1200);
const tResumed = await page.evaluate(() => document.getElementById("timeDisplay")?.textContent);
report("恢复播放后时间推进", tResumed !== tPaused2, `${tPaused2} → ${tResumed}`);

// 5. 拖动时间轴到末尾
await page.evaluate(() => {
  const slider = document.getElementById("timeSlider");
  slider.value = "100";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(600);
const statsEnd = await canvasStats(page);
report(
  "拖到末尾后树完整（像素更多）",
  statsEnd && statsEnd.nonBgRatio >= statsA.nonBgRatio,
  `t=0 时 ${(statsA.nonBgRatio * 100).toFixed(2)}% → t=1 时 ${(statsEnd.nonBgRatio * 100).toFixed(2)}%`
);
await page.screenshot({ path: resolve(OUT_DIR, "03-full-tree.png") });

// 6. 导出按钮可见
const exportVisible = await page.evaluate(() => {
  const el = document.getElementById("exportArea");
  const style = window.getComputedStyle(el);
  return style.display !== "none";
});
report("导出按钮可见", exportVisible);

// 7. GitHub 仓库加载（真实数据）
if (TEST_REPO) {
  console.log(`\n== 加载真实仓库 ${TEST_REPO} ==`);
  const t0 = Date.now();
  await page.fill("#repoInput", TEST_REPO);
  await page.click("#loadBtn");
  // 等待状态文本变为"已加载"（最多 60s）
  await page
    .waitForFunction(
      () => /已加载|未找到|限流|错误|失败/.test(document.getElementById("status")?.textContent || ""),
      { timeout: 60000 }
    )
    .catch(() => {});
  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent || "");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const loaded = statusText.includes("已加载");
  report(`真实仓库 ${TEST_REPO} 加载`, loaded, `${elapsed}s — ${statusText}`);
  if (loaded) {
    await page.waitForTimeout(2500);
    const repoStats = await canvasStats(page);
    report(
      "真实仓库画布非空白",
      repoStats && repoStats.nonBgRatio > 0.0015,
      repoStats ? `非背景像素占比 ${(repoStats.nonBgRatio * 100).toFixed(2)}%` : "no canvas"
    );
    await page.screenshot({ path: resolve(OUT_DIR, "04-real-repo.png") });
    // URL 分享参数
    const url = page.url();
    report("URL 更新 repo 参数", url.includes(`repo=${encodeURIComponent(TEST_REPO)}`), url);
  } else {
    const errText = await page.evaluate(() => document.getElementById("errorBox")?.textContent || "");
    report(`真实仓库 ${TEST_REPO} 加载`, false, `status="${statusText}" error="${errText.slice(0, 120)}"`);
  }
}

await browser.close();

console.log("\n== 汇总 ==");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log("失败项:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
