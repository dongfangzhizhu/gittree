/** 加载指定仓库并转储模型摘要（验证日期映射/采样/lane） */
import { chromium } from "playwright";

const repo = process.argv[2] || "microsoft/TypeScript";
const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE-ERR:", m.text());
});
page.on("request", (r) => {
  if (r.url().includes("api.github.com")) console.log("REQ:", r.url());
});
page.on("response", (r) => {
  if (r.url().includes("api.github.com/commits")) {
    console.log("RESP:", r.status(), r.url().slice(-60));
  }
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);

const t0 = Date.now();
await page.fill("#repoInput", repo);
await page.click("#loadBtn");
// 等到状态变为仓库加载结果（"已加载 N 个提交（M% 采样）"）或出现错误
await page
  .waitForFunction(
    () => {
      const st = document.getElementById("status")?.textContent || "";
      const errShown = document.getElementById("errorBox")?.style.display !== "none";
      return /已加载 \d+ 个提交（\d+% 采样）/.test(st) || errShown;
    },
    { timeout: 120000, polling: 500 }
  )
  .catch(() => console.log("(等待超时)"));

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const ui = await page.evaluate(() => ({
  status: document.getElementById("status")?.textContent,
  error: document.getElementById("errorBox")?.style.display !== "none"
    ? document.getElementById("errorBox")?.textContent?.slice(0, 200)
    : null,
}));
console.log(`ui: ${JSON.stringify(ui)} (${elapsed}s)`);

const dump = await page.evaluate(() => window.__gittree.getState());
console.log(JSON.stringify(dump, null, 2));

await browser.close();
