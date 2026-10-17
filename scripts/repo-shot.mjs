/** 截图：加载指定仓库后拍全景/侧视/根颈三张 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const repo = process.argv[2] || "dongfangzhizhu/AudioCpp.NET";

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.fill("#repoInput", repo);
await page.click("#loadBtn");
await page
  .waitForFunction(
    () => /已加载|错误|失败|限流/.test(document.getElementById("status")?.textContent || ""),
    { timeout: 90000 }
  )
  .catch(() => {});
await page.waitForTimeout(1500);

// 拖到完整形态
await page.evaluate(() => {
  const slider = document.getElementById("timeSlider");
  slider.value = "100";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(1200);

const stats = await page.evaluate(() => window.__gittree.getState());
console.log("state:", JSON.stringify({ commits: stats.commits, lanes: stats.lanes, segments: stats.segments, leaves: stats.leaves, fruits: stats.fruits }));

await page.screenshot({ path: resolve(OUT_DIR, "20-repo-overview.png") });
await page.click('[data-view="side"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(OUT_DIR, "21-repo-side.png") });
await page.click('[data-view="root"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(OUT_DIR, "22-repo-root.png") });

await browser.close();
console.log("done");
