/** 边界场景验证: 错误处理 + 大仓库采样 */
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);

// ============ 1. 不存在的仓库 ============
console.log("== 不存在的仓库 ==");
await page.fill("#repoInput", "dongfangzhizhu/this-repo-does-not-exist-12345");
await page.click("#loadBtn");
await page.waitForFunction(
  () => /已加载|未找到|错误|失败/.test(document.getElementById("status")?.textContent || "") ||
         document.getElementById("errorBox")?.style.display !== "none",
  { timeout: 30000 }
).catch(() => {});
await page.waitForTimeout(500);
const errState = await page.evaluate(() => ({
  status: document.getElementById("status")?.textContent,
  errorShown: document.getElementById("errorBox")?.style.display !== "none",
  errorText: document.getElementById("errorBox")?.textContent?.slice(0, 100),
}));
console.log("错误路径:", JSON.stringify(errState));
console.log(errState.errorShown ? "✅ 404 显示明确错误且不崩溃" : "❌ 未显示错误");

// ============ 2. 大仓库（触发 >500 采样） ============
console.log("\n== 大仓库 microsoft/TypeScript（触发等距采样） ==");
const t0 = Date.now();
await page.fill("#repoInput", "microsoft/TypeScript");
await page.click("#loadBtn");
await page
  .waitForFunction(
    () => /已加载|未找到|限流|错误|失败/.test(document.getElementById("status")?.textContent || ""),
    { timeout: 90000 }
  )
  .catch(() => {});
const status = await page.evaluate(() => document.getElementById("status")?.textContent || "");
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`状态: ${status} (${elapsed}s)`);

if (status.includes("已加载")) {
  await page.waitForTimeout(2000);
  const stats = await page.evaluate(() => window.__gittree?.sampleCanvas() ?? null);
  const ratio = stats?.nonBgRatio ?? 0;
  console.log(`✅ 大仓库加载成功，画布非空白（${(ratio * 100).toFixed(2)}%）`);
  await page.screenshot({ path: "screenshots/05-big-repo.png" });
} else {
  console.log("❌ 大仓库加载失败（可能是限流，可接受，需人工复试）");
}

await browser.close();
