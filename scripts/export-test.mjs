/**
 * 导出功能验证：WebM 视频 + PNG 纪念卡
 * 通过 Playwright download 事件捕获浏览器下载，校验文件头与大小。
 */

import { chromium } from "playwright";
import { mkdirSync, statSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "screenshots", "exports");
mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(3500); // 等预置自动加载

// 缩短时长到 10s，加快导出
await page.selectOption("#durationSelect", "10");

// ============ 1. WebM 导出 ============
console.log("\n== 导出 WebM 视频 ==");
try {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.click("[data-action=export-video]"),
  ]);
  const videoPath = resolve(OUT_DIR, "tree-export.webm");
  await download.saveAs(videoPath);

  const size = statSync(videoPath).size;
  const head = readFileSync(videoPath).subarray(0, 4).toString("hex");
  // WebM/Matroska 魔数: 1A 45 DF A3
  const isWebm = head === "1a45dfa3";
  report("WebM 文件生成", size > 1024, `${(size / 1024).toFixed(1)} KB`);
  report("WebM 魔数正确", isWebm, `head=${head}`);
} catch (err) {
  report("WebM 文件生成", false, String(err).slice(0, 200));
}

// ============ 2. PNG 纪念卡导出 ============
console.log("\n== 导出 PNG 纪念卡 ==");
try {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click("[data-action=export-card]"),
  ]);
  const cardPath = resolve(OUT_DIR, "card-export.png");
  await download.saveAs(cardPath);

  const size = statSync(cardPath).size;
  const head = readFileSync(cardPath).subarray(0, 8);
  // PNG 魔数: 89 50 4E 47 0D 0A 1A 0A
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  report("PNG 文件生成", size > 1024, `${(size / 1024).toFixed(1)} KB`);
  report("PNG 魔数正确", isPng, `head=${head.toString("hex")}`);
} catch (err) {
  report("PNG 文件生成", false, String(err).slice(0, 200));
}

await browser.close();

console.log("\n== 汇总 ==");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exit(1);
