/**
 * 生长音乐端到端验证（Playwright）
 * 用法: node scripts/music-test.mjs [--url http://127.0.0.1:5173/]
 *
 * 验证项:
 *  1. 乐谱已生成（音符数 > 0）但默认不出声（未手势）
 *  2. 点音乐按钮 → AudioContext 恢复 → 播放中音符数随时间增长
 *  3. 再点一次 → 静音
 *  4. 快捷键 M 也能切换
 *  5. 导出 MIDI：下载文件头是 "MThd"，文件名带仓库名
 */

import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL_TARGET = (() => {
  const i = process.argv.indexOf("--url");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "http://127.0.0.1:5173/";
})();
const OUT_DIR = resolve(__dirname, "..", "screenshots", "music");
mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const report = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));

await page.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForFunction(() => (window.__gittree?.getState().leaves ?? 0) > 0, { timeout: 30000 });
await page.waitForTimeout(400);

const m0 = await page.evaluate(() => window.__gittree.music());
report("乐谱已生成（音符与提交对应）", m0.total > 0, `total=${m0.total}`);
report("默认静音（未手势前不出声）", m0.running === false && m0.muted === true, `running=${m0.running} muted=${m0.muted}`);

// 2. 开启音乐
await page.click("#musicBtn");
await page.waitForTimeout(1500);
const m1 = await page.evaluate(() => window.__gittree.music());
report("点击后 AudioContext 恢复运行", m1.running === true, `running=${m1.running} muted=${m1.muted}`);
report("按钮文案切换为「音乐开」", (await page.textContent("#musicBtn")).includes("音乐开"));

// 播放 2 秒，音符应该真的被触发
const before = (await page.evaluate(() => window.__gittree.music())).played;
await page.waitForTimeout(2200);
const m2 = await page.evaluate(() => window.__gittree.music());
report("播放过程中音符随生长触发", m2.played > before, `played ${before} → ${m2.played} / ${m2.total}`);

// 3. 再点一次静音
await page.click("#musicBtn");
await page.waitForTimeout(400);
const m3 = await page.evaluate(() => window.__gittree.music());
report("再次点击 → 静音", m3.muted === true, `muted=${m3.muted}`);

// 4. 快捷键 M
await page.keyboard.press("m");
await page.waitForTimeout(600);
const m4 = await page.evaluate(() => window.__gittree.music());
report("快捷键 M 可切换音乐", m4.muted === false, `muted=${m4.muted}`);

// 5. 导出 MIDI（先挂下载监听再点击，否则事件可能在 click 返回前就触发而漏掉）
const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
await page.click("#midiBtn");
const download = await downloadPromise;
const suggested = download.suggestedFilename();
const file = resolve(OUT_DIR, suggested);
await download.saveAs(file);
const bytes = readFileSync(file);
const magic = Array.from(bytes.slice(0, 4))
  .map((b) => String.fromCharCode(b))
  .join("");
report("导出 MIDI 文件头正确（MThd）", magic === "MThd", `${suggested} · ${bytes.length} 字节`);
rmSync(file, { force: true });

report("无 JS 运行时错误", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) {
  for (const f of failed) console.log(` - ${f.name}${f.detail ? `：${f.detail}` : ""}`);
  process.exit(1);
}
