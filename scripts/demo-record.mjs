/**
 * Demo 录制脚本（成果提交用）
 * 驱动在线站点完整走一遍核心功能与使用流程，录制 1920×1080 原始视频，
 * 同时输出字幕时间轴（cues.json）与 ASS 字幕文件（demo.ass）。
 *
 * 用法:
 *   node scripts/demo-record.mjs [--url https://dongfangzhizhu.github.io/gittree/]
 *
 * 产物（.demo-work/）:
 *   raw/<uuid>.webm   录制原始视频
 *   cues.json         字幕时间轴（相对录制开始的秒数）
 *   demo.ass          ASS 字幕（含片头卡片时长偏移）
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const URL_TARGET = argOf("url", "https://dongfangzhizhu.github.io/gittree/");
const WORK = resolve(ROOT, ".demo-work");
const EXPORT_DIR = resolve(ROOT, "submission");
/** ffmpeg/ffprobe 所在目录：默认走 PATH，可用 FFMPEG_DIR 覆盖 */
const FF = argOf("ffmpeg", process.env.FFMPEG_DIR ?? "");
const FF_BIN = FF ? `${FF}/ffprobe.exe` : "ffprobe";
/** 片头卡片时长（秒）——ASS 时间轴在此基础上整体后移 */
const TITLE_SECONDS = 4.0;
/** 视频首帧相对 t0 的偏移（上下文创建 → 首帧渲染） */
const FIRST_FRAME_OFFSET = 0.7;

mkdirSync(`${WORK}/raw`, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });

let t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const cues = [];
const say = (text) => {
  cues.push({ t: now(), text });
  console.log(`[${now().toFixed(1)}s] 字幕: ${text}`);
};
const wait = (ms) => page.waitForTimeout(ms);

console.log(`== 打开 ${URL_TARGET} 并录制 ==`);

// ---- 预热：先在独立上下文里完整加载一次，让浏览器缓存热起来，
//      避免录制视频开头出现大片空白加载页 ----
{
  const warmBrowser = await chromium.launch({
    channel: "chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const wp = await warmBrowser.newPage({ viewport: { width: 1920, height: 1080 } });
  await wp.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 60000 });
  await wp.waitForFunction(() => (window.__gittree?.getState().commits ?? 0) > 0, { timeout: 30000 });
  await warmBrowser.close();
  console.log("预热完成（页面资源已缓存）");
}

// 字幕时间轴以“开录时刻”为基准：预热之后再对表
t0 = Date.now();

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: `${WORK}/raw`, size: { width: 1920, height: 1080 } },
  acceptDownloads: true,
});
const page = await context.newPage();

const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));

// ============ 第 1 幕：打开即见树 ============
say("代码年轮 GitTree —— 把 Git 提交历史，长成一棵三维的树");
await page.goto(URL_TARGET, { waitUntil: "networkidle", timeout: 60000 });
await wait(3600);
say("打开页面，不输入任何东西，演示林已经在自动生长");
await wait(4200);

// ============ 第 2 幕：输入仓库，让它生长 ============
say("粘贴任意 GitHub 仓库地址，点「让它生长」");
await page.fill("#repoInput", "dongfangzhizhu/gittree");
await wait(900);
await page.click("#loadBtn");
say("这里输入项目自己的仓库 —— 看它自己的提交历史长成什么样");
await page.waitForFunction(
  () => /已加载|未找到|限流|错误|失败/.test(document.getElementById("status")?.textContent || ""),
  { timeout: 90000 }
);
const status1 = await page.evaluate(() => document.getElementById("status")?.textContent || "");
if (!status1.includes("已加载")) throw new Error(`仓库加载失败: ${status1}`);
say("数据经 GitHub REST API 等距采样；同一仓库，永远得到同一棵树");
// 缩短时长，让生长在 10 秒内完成，便于演示
await page.selectOption("#durationSelect", "10");
await wait(5000);
say("主干、枝条、叶片与标签果实，随提交历史依次长出");
await wait(4000);

// ============ 第 3 幕：播放控制 ============
say("播放时实时显示章节字幕与 UTC 日期");
await wait(3000);
// 此时生长已播完（isPlaying=false）：点播放 = 从头再看一遍
say("再点播放，从头再看一遍生长");
await page.click("#playPauseBtn");
await wait(4000);
await page.click("#playPauseBtn"); // 暂停
say("随时暂停、播放");
await wait(2200);
await page.click("#playPauseBtn"); // 继续
say("0.5× 到 4× 变速播放");
await page.selectOption("#speedSelect", "4");
await wait(3000);
await page.selectOption("#speedSelect", "1");
say("拖动时间轴，回看任意时刻");
await page.evaluate(() => {
  const s = document.getElementById("timeSlider");
  s.value = "30";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await wait(1600);
await page.evaluate(() => {
  const s = document.getElementById("timeSlider");
  s.value = "100";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
say("拖到末尾，整棵树完整呈现");
await wait(2200);

// ============ 第 4 幕：点击叶片看详情 ============
const st4 = await page.evaluate(() => window.__gittree.getState());
if (st4.isPlaying) await page.click("#playPauseBtn");
await wait(1200); // 等相机阻尼收敛，保证点击位置稳定
say("点击任意叶片，查看这条提交的类型、作者、日期与 SHA");
const leafKeys = await page.evaluate(() => window.__gittree.sampleLeafKeys(30));
let clicked = false;
for (const k of leafKeys) {
  const pos = await page.evaluate((key) => window.__gittree.nodeScreenPos(key), k);
  if (!pos) continue;
  // 避开左侧控制面板与顶部 HUD，选画面中右侧的叶子
  if (pos.x < 1920 * 0.42 || pos.x > 1920 * 0.94 || pos.y < 130 || pos.y > 1020) continue;
  await page.mouse.click(pos.x, pos.y);
  await wait(700);
  const open = await page.evaluate(() =>
    document.getElementById("infoPanel")?.classList.contains("open")
  );
  if (open) {
    clicked = true;
    break;
  }
}
if (!clicked) throw new Error("点击叶片后信息面板未打开");
await wait(3200);
say("点「定位到此处」，视角飞向该节点");
await page.click("#infoPanel .panel-locate");
await wait(3000);
await page.click("#infoPanel .panel-close");
await wait(600);

// ============ 第 5 幕：视角 ============
say("四个预设视角：全景、侧视、俯视、根颈");
await page.click('.view-btn[data-view="side"]');
await wait(2600);
await page.click('.view-btn[data-view="top"]');
await wait(2600);
await page.click('.view-btn[data-view="root"]');
await wait(2600);
await page.click('.view-btn[data-view="overview"]');
await wait(2200);
say("拖动旋转、滚轮缩放，或开启自动旋转");
await page.mouse.move(1400, 520);
await page.mouse.down();
await page.mouse.move(1180, 560, { steps: 30 });
await page.mouse.up();
await wait(1500);
await page.check("#autoRotate");
await wait(3200);
await page.uncheck("#autoRotate");
await wait(800);

// ============ 第 6 幕：森林（多项目） ============
say("预置卡片可多选 —— 选中多个项目，一次长出一片森林");
await page.click("#clearSelectionBtn");
await wait(600);
await page.click('.snapshot-card:has-text("React")');
await wait(500);
await page.click('.snapshot-card:has-text("Vue 3")');
await wait(500);
await page.click('.snapshot-card:has-text("TypeScript")');
await wait(800);
say("React、Vue、TypeScript 三个真实仓库快照同时生长");
await page.click("#growForestBtn");
await page.waitForFunction(() => (window.__gittree.getState().trees ?? 0) >= 3, {
  timeout: 60000,
});
say("每棵树独立成形，带一个跟随树冠的名牌");
await wait(4200);
say("点名牌切换焦点树，章节与信息面板随之切换");
// 名牌每帧跟随相机投影移动，Playwright 的“元素稳定”检查永远等不到，
// 因此用坐标直接点击；点击后校验焦点是否真的切换，不夸大效果。
const focusBefore = await page.evaluate(() => window.__gittree.getState().focusIndex);
const labelCount = await page.evaluate(() => window.__gittree.treeLabelPos().filter((l) => l.display !== "none").length);
if (labelCount > 1) {
  // 用 boundingBox 拿视口坐标（treeLabelPos 的 left/top 是容器相对值，不能直接用于 mouse.click）
  const box = await page.locator(".tree-label").nth(1).boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await wait(3600);
    const focusAfter = await page.evaluate(() => window.__gittree.getState().focusIndex);
    console.log(`名牌点击: 可见名牌 ${labelCount} 个，焦点 ${focusBefore} → ${focusAfter}`);
    if (focusAfter === focusBefore) console.log("⚠️ 焦点未切换");
  } else {
    console.log("⚠️ 名牌 boundingBox 为空，跳过焦点切换演示");
  }
} else {
  console.log("⚠️ 没有可见的名牌，跳过焦点切换演示");
}
await wait(600);

// ============ 第 7 幕：导出 ============
say("一键导出 PNG 纪念卡：三维画面加统计信息");
const [dlCard] = await Promise.all([
  page.waitForEvent("download", { timeout: 60000 }),
  page.click("[data-action=export-card]"),
]);
await dlCard.saveAs(resolve(EXPORT_DIR, "gittree-导出样例-纪念卡.png"));
await wait(1800);
say("WebM 视频导出：30fps 1080p，自带章节字幕合成层");
const [dlVideo] = await Promise.all([
  page.waitForEvent("download", { timeout: 90000 }),
  page.click("[data-action=export-video]"),
]);
await dlVideo.saveAs(resolve(EXPORT_DIR, "gittree-导出样例-视频.webm"));
await wait(1200);

// ============ 第 8 幕：收尾 ============
say("在线体验：dongfangzhizhu.github.io/gittree");
await wait(4200);
say("详细成果清单与下载路径，见随附 PDF 文档");
await wait(3800);

await context.close(); // 视频落盘
await browser.close();

// ============ 生成 ASS 字幕 ============
const rawFiles = readdirSync(`${WORK}/raw`).filter((f) => f.endsWith(".webm"));
if (rawFiles.length !== 1) throw new Error(`原始视频数量异常: ${rawFiles.length}`);
const rawPath = resolve(WORK, "raw", rawFiles[0]);
const duration = parseFloat(
  execSync(`"${FF_BIN}" -v error -show_entries format=duration -of csv=p=0 "${rawPath}"`)
    .toString()
    .trim()
);
console.log(`原始视频: ${rawPath} (${duration.toFixed(1)}s)`);

const OFFSET = TITLE_SECONDS + FIRST_FRAME_OFFSET;
const fmt = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};
const events = cues.map((c, i) => {
  const start = Math.max(0, c.t + OFFSET);
  const end = i + 1 < cues.length ? cues[i + 1].t + OFFSET - 0.15 : duration + TITLE_SECONDS - 0.2;
  return `Dialogue: 0,${fmt(start)},${fmt(end)},Zh,,0,0,0,,${c.text}`;
});

const ass = `[Script Info]
Title: 代码年轮 GitTree 功能演示字幕
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Zh,Microsoft YaHei,44,&H00FFFFFF,&H000019FF,&H00141414,&H960A0E27,-1,0,0,0,100,100,0,0,3,2,0,2,60,60,44,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
writeFileSync(resolve(WORK, "demo.ass"), ass, "utf8");
writeFileSync(resolve(WORK, "cues.json"), JSON.stringify({ duration, offset: OFFSET, cues }, null, 2), "utf8");

if (jsErrors.length > 0) {
  console.log("⚠️ 录制期间出现 JS 错误:", jsErrors.slice(0, 3));
}
console.log(`\n录制完成：${cues.length} 条字幕，视频 ${duration.toFixed(1)}s`);
console.log("ASS 已生成:", resolve(WORK, "demo.ass"));
