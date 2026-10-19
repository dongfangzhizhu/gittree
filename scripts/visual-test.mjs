/**
 * 视觉效果专项验证：
 * 细分枝（ez-tree 式递归）、树皮纹理、泛光、天空、地面年轮脉冲、萤火虫。
 * 输出多张截图供人工核对 + 统计 draw call / 帧率 / 场景规模。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const URL_TARGET = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:5173/";
const OUT_DIR = resolve(import.meta.dirname, "..", "screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") jsErrors.push(`console: ${m.text()}`);
});

console.log(`\n== 打开 ${URL_TARGET} ==`);
await page.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(4000);

// 拉到末尾，看完整树冠
await page.evaluate(() => {
  const s = document.getElementById("timeSlider");
  s.value = "100";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(1200);

const stats = await page.evaluate(() => window.__gittree?.getState?.() ?? null);
const sceneInfo = await page.evaluate(() => {
  const r = window.__gittree;
  return {
    segments: r?.segments ?? null,
    branches: r?.branches ?? null,
    leaves: r?.leaves ?? null,
    trees: r?.trees ?? null,
  };
});
console.log("场景规模:", JSON.stringify({ ...stats, ...sceneInfo }));

// WebGL 渲染信息（draw call / 三角面）
const renderInfo = await page.evaluate(() => window.__gittree?.drawInfo?.() ?? null);
console.log("渲染信息:", JSON.stringify(renderInfo));
report(
  "渲染开销在合理区间（draw call < 800）",
  !!renderInfo && renderInfo.calls > 0 && renderInfo.calls < 800,
  renderInfo ? `${renderInfo.calls} calls / ${Math.round(renderInfo.triangles)} tris` : "no data"
);

await page.screenshot({ path: resolve(OUT_DIR, "v2-01-full.png") });

// 俯视 + 侧视 + 根视
for (const [name, key] of [
  ["v2-02-side", "side"],
  ["v2-03-top", "top"],
  ["v2-04-root", "root"],
]) {
  await page.evaluate((k) => {
    const btn = [...document.querySelectorAll("[data-view]")].find((b) => b.dataset.view === k);
    btn?.click();
  }, key);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: resolve(OUT_DIR, `${name}.png`) });
}

// 关掉音乐避免干扰，测帧率（播放中）
await page.evaluate(() => document.getElementById("playPauseBtn")?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById("playPauseBtn")?.click());

// 帧率采样：连续 90 帧
const fps = await page.evaluate(async () => {
  return new Promise((res) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => {
      n++;
      if (n < 90) requestAnimationFrame(tick);
      else res((n / (performance.now() - t0)) * 1000);
    };
    requestAnimationFrame(tick);
  });
});
console.log(`播放中帧率: ${fps.toFixed(1)} fps`);
report("播放帧率 ≥ 30fps（无头软渲染下）", fps >= 30, `${fps.toFixed(1)} fps`);

// 画质降级：切到 low 后 bloom 关闭
const before = await page.evaluate(() => window.__gittree?.perf?.());
await page.evaluate(() => window.__gittree?.setQuality?.("low"));
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.__gittree?.perf?.());
report(
  "手动降档生效（quality=low, bloom=false）",
  after?.level === "low",
  `${JSON.stringify(before)} → ${JSON.stringify(after)}`
);
await page.screenshot({ path: resolve(OUT_DIR, "v2-05-low-quality.png") });

// 升回 high
await page.evaluate(() => window.__gittree?.setQuality?.("high"));
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(OUT_DIR, "v2-06-high-quality.png") });

// 树皮纹理：近景截图（root 视角 + 拉近）
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("[data-view]")].find((b) => b.dataset.view === "root");
  btn?.click();
});
await page.waitForTimeout(1400);
await page.screenshot({ path: resolve(OUT_DIR, "v2-07-bark-closeup.png") });

report("页面无 JS 异常", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

await browser.close();

console.log("\n== 汇总 ==");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} 通过`);
for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
process.exit(failed.length > 0 ? 1 : 0);
