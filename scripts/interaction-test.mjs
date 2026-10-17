/**
 * 交互功能验证：视角切换 / 节点点击拾取 / 自动旋转 / 数据缓存
 * 用法: node scripts/interaction-test.mjs [--repo owner/name]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "screenshots");
mkdirSync(OUT_DIR, { recursive: true });

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TEST_REPO = argOf("repo", ""); // 缓存测试用；缺省跳过真实仓库缓存验证

const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") jsErrors.push(m.text());
});

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3500); // 等预置自动加载

// ============ 1. 视角切换 ============
console.log("\n== 视角切换 ==");
const camBefore = await page.evaluate(() => window.__gittree.getCamera());
await page.click('[data-view="side"]');
await page.waitForTimeout(1400); // 等相机过渡动画
const camSide = await page.evaluate(() => window.__gittree.getCamera());
report(
  "侧视视角生效（相机移动）",
  JSON.stringify(camBefore.position) !== JSON.stringify(camSide.position),
  `position: ${camSide.position.map((v) => Math.round(v)).join(",")}`
);
await page.screenshot({ path: resolve(OUT_DIR, "10-view-side.png") });

await page.click('[data-view="top"]');
await page.waitForTimeout(1400);
const camTop = await page.evaluate(() => window.__gittree.getCamera());
report(
  "俯视视角生效（相机升高）",
  camTop.position[1] > camSide.position[1] + 100,
  `y: ${Math.round(camSide.position[1])} → ${Math.round(camTop.position[1])}`
);
await page.screenshot({ path: resolve(OUT_DIR, "11-view-top.png") });

await page.click('[data-view="overview"]');
await page.waitForTimeout(1400);

// ============ 2. 自动旋转 ============
console.log("\n== 自动旋转 ==");
await page.check("#autoRotate");
await page.waitForTimeout(300);
const camRot1 = await page.evaluate(() => window.__gittree.getCamera());
report("自动旋转开关生效", camRot1.autoRotate === true);
await page.waitForTimeout(1200);
const camRot2 = await page.evaluate(() => window.__gittree.getCamera());
report(
  "自动旋转使相机绕树转动",
  JSON.stringify(camRot1.position) !== JSON.stringify(camRot2.position),
  `x/z: ${camRot1.position.map((v) => Math.round(v)).slice(0, 3).join(",")} → ${camRot2.position.map((v) => Math.round(v)).slice(0, 3).join(",")}`
);
await page.uncheck("#autoRotate");

// ============ 3. 节点点击拾取 ============
console.log("\n== 节点点击 ==");
// 拖到末尾让树完整，再从上往下扫几个点找可拾取节点
await page.evaluate(() => {
  const slider = document.getElementById("timeSlider");
  slider.value = "100";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(800);

// 拖到末尾让树完整，再逐个点击已知节点的投影位置
await page.evaluate(() => {
  const slider = document.getElementById("timeSlider");
  slider.value = "100";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(800);

const leafKeys = await page.evaluate(() => window.__gittree.sampleLeafKeys(30));
const fruitKeys = await page.evaluate(() => window.__gittree.sampleFruitKeys(10));
const allKeys = [...leafKeys, ...fruitKeys];

let opened = false;
let pickedTitle = "";
let pickedMeta = "";
for (const key of allKeys) {
  const pos = await page.evaluate((k) => window.__gittree.nodeScreenPos(k), key);
  if (!pos) continue;
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(120);
  const state = await page.evaluate(() => {
    const panel = document.getElementById("infoPanel");
    return {
      open: panel.classList.contains("open"),
      title: panel.querySelector(".panel-title")?.textContent || "",
      meta: panel.querySelector(".panel-meta")?.textContent || "",
    };
  });
  if (state.open) {
    opened = true;
    pickedTitle = state.title;
    pickedMeta = state.meta;
    report("点击树叶/果实打开信息面板", true, `「${state.title}」`);
    report(
      "面板包含提交元数据",
      /类型|作者|日期|SHA|标签/.test(state.meta),
      state.meta.slice(0, 80)
    );
    break;
  }
}
if (!opened) {
  report("点击树叶/果实打开信息面板", false, `${allKeys.length} 个节点投影点击均未命中`);
}
await page.screenshot({ path: resolve(OUT_DIR, "12-node-info.png") });

// 关闭面板
await page.click(".panel-close");
await page.waitForTimeout(200);
const closed = await page.evaluate(() =>
  !document.getElementById("infoPanel").classList.contains("open")
);
report("信息面板可关闭", closed);

// ============ 4. 数据缓存 ============
if (TEST_REPO) {
  console.log(`\n== 数据缓存（${TEST_REPO}） ==`);
  // 开启缓存
  await page.check("#cacheToggle");
  await page.waitForTimeout(200);

  // 记录加载过程中的 API 请求
  let apiRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("api.github.com")) apiRequests++;
  });

  // 首次加载（应请求 API 并写入缓存）
  await page.fill("#repoInput", TEST_REPO);
  await page.click("#loadBtn");
  await page
    .waitForFunction(
      () => /已加载|错误|失败|未找到|限流/.test(document.getElementById("status")?.textContent || ""),
      { timeout: 90000 }
    )
    .catch(() => {});
  const firstStatus = await page.evaluate(() => document.getElementById("status")?.textContent || "");
  const firstRequests = apiRequests;
  report(
    `首次加载 ${TEST_REPO}`,
    firstStatus.includes("已加载"),
    `${firstStatus}（API 请求 ${firstRequests} 次）`
  );

  // 缓存状态徽标
  await page.waitForTimeout(300);
  const cacheBadge = await page.evaluate(
    () => document.getElementById("cacheStatus")?.textContent || ""
  );
  report("缓存状态显示已缓存", cacheBadge.includes("已缓存"), cacheBadge.slice(0, 40));

  // 再次加载同一仓库（应命中缓存，零 API 请求）
  apiRequests = 0;
  await page.click("#loadBtn");
  await page
    .waitForFunction(
      () => /已加载|错误|失败|未找到|限流/.test(document.getElementById("status")?.textContent || ""),
      { timeout: 30000 }
    )
    .catch(() => {});
  const secondStatus = await page.evaluate(() => document.getElementById("status")?.textContent || "");
  report(
    "二次加载命中缓存",
    secondStatus.includes("来自缓存"),
    `${secondStatus}（API 请求 ${apiRequests} 次）`
  );
  report("二次加载零 API 请求", apiRequests === 0, `实际 ${apiRequests} 次`);

  // 清除缓存
  const cleared = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("#cacheStatus button")].find((b) =>
      b.textContent?.includes("清除")
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(300);
  const afterClear = await page.evaluate(
    () => document.getElementById("cacheStatus")?.textContent || ""
  );
  report("可清除缓存", cleared && afterClear.includes("暂无缓存"), afterClear.slice(0, 40));
}

await browser.close();

console.log("\n== 汇总 ==");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log("失败项:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
if (jsErrors.length > 0) {
  console.log(`JS 错误 ${jsErrors.length} 个:`);
  for (const e of jsErrors.slice(0, 5)) console.log(`  - ${e}`);
}
process.exit(failed.length > 0 || jsErrors.length > 0 ? 1 : 0);
