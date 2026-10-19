/**
 * 树冠特写：只截 canvas 元素，放大看细分枝/树皮/叶片细节
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const URL_TARGET = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:5173/";
const OUT_DIR = resolve(import.meta.dirname, "..", "screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));

await page.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(4000);

// 拉到末尾
await page.evaluate(() => {
  const s = document.getElementById("timeSlider");
  s.value = "100";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(1000);

// 把画布滚到视口中央
await page.evaluate(() => {
  document.getElementById("canvasContainer")?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(600);

const views = ["overview", "side", "top", "root"];
for (const v of views) {
  await page.evaluate((k) => {
    const btn = [...document.querySelectorAll("[data-view]")].find((b) => b.dataset.view === k);
    btn?.click();
  }, v);
  await page.waitForTimeout(1600);
  const el = await page.$("#glCanvas, canvas");
  if (el) await el.screenshot({ path: resolve(OUT_DIR, `crown-${v}.png`) });
  console.log(`shot crown-${v}.png`);
}

// 渲染诊断
const info = await page.evaluate(() => {
  const g = window.__gittree;
  const r = g?.renderer;
  if (!r) return { error: "no renderer on hook" };
  const i = r.renderer?.info;
  return {
    calls: i?.render?.calls,
    triangles: i?.render?.triangles,
    geometries: i?.memory?.geometries,
    textures: i?.memory?.textures,
    stats: r.stats?.(),
  };
});
console.log("渲染诊断:", JSON.stringify(info));

await browser.close();
