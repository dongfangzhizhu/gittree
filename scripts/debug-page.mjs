/** 调试: 检查页面初始化状态 */
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
page.on("console", (m) => console.log(`CONSOLE[${m.type()}]:`, m.text()));
page.on("requestfailed", (r) => console.log("REQFAILED:", r.url(), r.failure()?.errorText));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const state = await page.evaluate(() => ({
  status: document.getElementById("status")?.textContent,
  errorDisplay: document.getElementById("errorBox")?.style.display,
  errorText: document.getElementById("errorBox")?.textContent?.slice(0, 300),
  presetCards: document.querySelectorAll(".preset-card").length,
  canvasDisplay: window.getComputedStyle(document.getElementById("canvasContainer")).display,
  controlsDisplay: window.getComputedStyle(document.getElementById("controls")).display,
}));
console.log("STATE:", JSON.stringify(state, null, 2));

// 尝试手动点击第一个预置卡片
const card = page.locator(".preset-card").first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    status: document.getElementById("status")?.textContent,
    errorDisplay: document.getElementById("errorBox")?.style.display,
    errorText: document.getElementById("errorBox")?.textContent?.slice(0, 500),
    canvasDisplay: window.getComputedStyle(document.getElementById("canvasContainer")).display,
  }));
  console.log("AFTER CLICK:", JSON.stringify(after, null, 2));
  await page.screenshot({ path: "screenshots/debug-manual.png" });
}

await browser.close();
