/** 画布元素特写截图 */
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);

// 暂停后拖到 100% 看完整树
await page.click("#pauseBtn");
await page.waitForTimeout(300);
await page.evaluate(() => {
  const slider = document.getElementById("timeSlider");
  slider.value = "100";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(800);

const canvas = page.locator("#canvas");
await canvas.screenshot({ path: "screenshots/canvas-full.png" });

// 输出几何统计, 验证分支/叶/花数量
const stats = await page.evaluate(() => "geometry stats 需在页面内打印");
console.log(stats);

await browser.close();
