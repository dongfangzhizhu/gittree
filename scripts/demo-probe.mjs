/**
 * 录制探针：验证 Playwright + 系统 Chrome 能打开在线站点并采到 WebGL 画面。
 * 用法: node scripts/demo-probe.mjs [--url https://dongfangzhizhu.github.io/gittree/]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const URL_TARGET = argOf("url", "https://dongfangzhizhu.github.io/gittree/");
const OUT = argOf("out", resolve(ROOT, ".demo-work"));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));

console.log(`== 打开 ${URL_TARGET} ==`);
await page.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(5000);

const state = await page.evaluate(() => window.__gittree?.getState() ?? null);
const stats = await page.evaluate(() => window.__gittree?.sampleCanvas() ?? null);
await page.screenshot({ path: `${OUT}/probe.png` });

console.log("jsErrors:", jsErrors.length ? jsErrors.slice(0, 3) : "无");
console.log("getState:", JSON.stringify(state));
console.log("sampleCanvas:", JSON.stringify(stats));

await browser.close();
console.log(state && stats && stats.nonBgRatio > 0.0015 ? "PROBE_OK" : "PROBE_FAIL");
