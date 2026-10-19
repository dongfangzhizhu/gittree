import { chromium } from "playwright";

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("ERR", String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);

// 选中三张快照卡片 → 生成森林
await page.evaluate(() => {
  document.querySelectorAll(".snapshot-card").forEach((c) => c.click());
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /生长这片森林/.test(x.textContent || ""));
  b?.click();
});
await page.waitForTimeout(6000);

await page.evaluate(() => {
  const s = document.getElementById("timeSlider");
  s.value = "100";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(1500);

const measure = async (label) => {
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (n < 60) requestAnimationFrame(tick);
          else res((n / (performance.now() - t0)) * 1000);
        };
        requestAnimationFrame(tick);
      })
  );
  const info = await page.evaluate(() => window.__gittree?.drawInfo?.());
  const per = await page.evaluate(() => {
    const s = window.__gittree.getState();
    return { leaves: s.leaves, branches: s.branches, trees: s.trees };
  });
  console.log(
    `${label}: ${fps.toFixed(1)} fps | calls=${info?.calls} tris=${Math.round(info?.triangles ?? 0)} | leaves=${per.leaves} branches=${per.branches} trees=${per.trees}`
  );
  return fps;
};

await measure("森林(high)");
await page.evaluate(() => window.__gittree.setQuality("low"));
await page.waitForTimeout(500);
await measure("森林(low) ");
await page.evaluate(() => window.__gittree.setQuality("high"));
await page.waitForTimeout(500);

await browser.close();
