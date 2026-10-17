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

// ============ 3. 暂停状态下的相机交互 ============
// 需求：无论暂停还是播放、无论哪个视角，鼠标事件都要响应
console.log("\n== 暂停状态下的相机交互 ==");
await seek(60); // 拖时间轴会自动暂停
const pausedNow = await page.evaluate(() => window.__gittree.getState().isPlaying);
report("拖时间轴后进入暂停状态", pausedNow === false);

const camPaused0 = await page.evaluate(() => window.__gittree.getCamera());
await page.click('[data-view="side"]');
await page.waitForTimeout(1300);
const camPaused1 = await page.evaluate(() => window.__gittree.getCamera());
report(
  "暂停状态下切换视角生效",
  JSON.stringify(camPaused0.position) !== JSON.stringify(camPaused1.position),
  `position: ${camPaused1.position.map((v) => Math.round(v)).join(",")}`
);

await page.check("#autoRotate");
await page.waitForTimeout(1300);
const camPaused2 = await page.evaluate(() => window.__gittree.getCamera());
report(
  "暂停状态下自动旋转生效",
  JSON.stringify(camPaused1.position) !== JSON.stringify(camPaused2.position)
);
await page.uncheck("#autoRotate");
await page.waitForTimeout(400);

// 拖拽旋转
await page.evaluate(() => document.querySelector(".stage").scrollIntoView({ block: "center" }));
await page.waitForTimeout(300);
const canvasBox = await page.evaluate(() => {
  const r = document.getElementById("canvas").getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.28), y: Math.round(r.top + 120) };
});
const camDrag0 = await page.evaluate(() => window.__gittree.getCamera());
await page.mouse.move(canvasBox.x, canvasBox.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(canvasBox.x + i * 16, canvasBox.y + i * 3);
await page.mouse.up();
await page.waitForTimeout(600);
const camDrag1 = await page.evaluate(() => window.__gittree.getCamera());
report(
  "暂停状态下拖拽旋转生效",
  JSON.stringify(camDrag0.position) !== JSON.stringify(camDrag1.position)
);

// 滚轮缩放
const distToTarget = (c) =>
  Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
const dBefore = distToTarget(camDrag1);
await page.mouse.move(canvasBox.x, canvasBox.y);
await page.mouse.wheel(0, -320);
await page.waitForTimeout(600);
const camZoom = await page.evaluate(() => window.__gittree.getCamera());
const dAfter = distToTarget(camZoom);
report(
  "暂停状态下滚轮缩放生效",
  dAfter < dBefore * 0.98,
  `距离 ${Math.round(dBefore)} → ${Math.round(dAfter)}`
);

await page.click('[data-view="overview"]');
await page.waitForTimeout(1300);

// ============ 4. 节点点击拾取：播放/暂停 × 4 视角 全矩阵 ============
console.log("\n== 节点点击矩阵（播放/暂停 × 4 视角） ==");

const VIEWS = [
  { key: "overview", name: "全景" },
  { key: "side", name: "侧视" },
  { key: "top", name: "俯视" },
  { key: "root", name: "根颈" },
];

/** 拖动时间轴到指定百分比 */
/** 等相机过渡真正停下（固定 sleep 在长距离切换时会不够） */
async function waitCameraSettled(timeout = 4000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    const cam = await page.evaluate(() => window.__gittree.getCamera());
    const key = cam ? cam.position.map((v) => Math.round(v)).join(",") : "";
    if (last === key) return true;
    last = key;
    await page.waitForTimeout(160);
  }
  return false;
}

async function seek(pct) {
  await page.evaluate((v) => {
    const slider = document.getElementById("timeSlider");
    slider.value = String(v);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, pct);
  await page.waitForTimeout(150);
}

/** 幂等地把播放状态切到指定值 */
async function setPlaying(playing) {
  await page.evaluate((want) => {
    const cur = window.__gittree.getState().isPlaying;
    if (cur !== want) document.getElementById("playPauseBtn").click();
  }, playing);
  await page.waitForTimeout(200);
}

/** 依次点击候选节点的屏幕投影，命中即关闭面板并返回结果 */
async function tryClickAnyNode() {
  const keys = [
    ...(await page.evaluate(() => window.__gittree.sampleLeafKeys(140))),
    ...(await page.evaluate(() => window.__gittree.sampleFruitKeys(24))),
  ];
  let tried = 0;
  // 画布可能在首屏之下：先把画布滚进视口，再按实际视口范围过滤候选点
  await page.locator(".canvas-container").scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const vp = page.viewportSize();
  for (const key of keys) {
    const pos = await page.evaluate((k) => window.__gittree.nodeScreenPos(k), key);
    if (!pos) continue;
    const x = Math.round(pos.x);
    const y = Math.round(pos.y);
    if (x < 4 || y < 4 || x > vp.width - 4 || y > vp.height - 4) continue;
    tried++;
    await page.mouse.click(x, y);
    await page.waitForTimeout(110);
    const st = await page.evaluate(() => {
      const panel = document.getElementById("infoPanel");
      return {
        open: panel.classList.contains("open"),
        title: panel.querySelector(".panel-title")?.textContent || "",
        meta: panel.querySelector(".panel-meta")?.textContent || "",
      };
    });
    if (st.open) {
      await page.click(".panel-close");
      await page.waitForTimeout(130);
      const closed = await page.evaluate(
        () => !document.getElementById("infoPanel").classList.contains("open")
      );
      return { ...st, tried, closed };
    }
  }
  return { open: false, tried, closed: false, title: "", meta: "" };
}

// 时长拉到 60s：树基本长成（90%）后仍留 6s 播放窗口供点击
await page.selectOption("#durationSelect", "60");
await page.waitForTimeout(200);

let closeOk = false;
for (const playing of [false, true]) {
  for (const view of VIEWS) {
    await setPlaying(false);
    await page.click(`[data-view="${view.key}"]`);
    await waitCameraSettled();
    await seek(90);
    await setPlaying(playing);

    const r = await tryClickAnyNode();
    const label = `${view.name}·${playing ? "播放中" : "暂停中"}`;
    report(
      `点击节点打开信息面板（${label}）`,
      r.open,
      r.open ? `「${r.title}」，尝试 ${r.tried} 个` : `${r.tried} 个节点投影均未命中`
    );
    if (r.open) {
      report(
        `面板含提交元数据（${label}）`,
        /类型|作者|日期|SHA|标签/.test(r.meta),
        r.meta.slice(0, 60)
      );
      closeOk = closeOk || r.closed;
    }
    await page.screenshot({
      path: resolve(OUT_DIR, `13-node-${view.key}-${playing ? "playing" : "paused"}.png`),
    });
  }
}
report("信息面板可关闭", closeOk);
await setPlaying(false);

// ============ 5. 数据缓存 ============
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
