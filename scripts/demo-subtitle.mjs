/**
 * 字幕生成脚本：把录制时收集的字幕时间轴（cues.json）转换为最终 ASS 字幕。
 *
 * 时间基准说明：
 *  - cues.json 的 t 相对“脚本开表时刻”（t0），而录制视频的 t=0 约在 t0 之后 0.4s；
 *  - 原始视频开头约 2s 是 about:blank 白屏，需要裁掉（TRIM）；
 *  - 最终视频 = 片头卡片(4s) + 正片，本脚本输出的是【正片相对时间】的 ASS，
 *    烧录到裁剪后的正片上后再与片头拼接。
 *
 * 用法: node scripts/demo-subtitle.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = resolve(ROOT, ".demo-work");
const { duration, cues } = JSON.parse(readFileSync(resolve(WORK, "cues.json"), "utf8"));

/** 原始视频 t=0 相对 t0 的偏移（秒）：视频比开表晚约 0.4s 开始 */
const SYNC = 0.4;
/** 原始视频开头白屏裁剪量（秒） */
const TRIM = 2.0;
/** 字幕之间的间隔（秒） */
const GAP = 0.15;
/** 正片允许的最早字幕出现时间（秒） */
const MIN_START = 0.3;

const bodyDuration = duration - TRIM;
const fmt = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

const starts = cues.map((c) => Math.max(MIN_START, c.t - SYNC - TRIM));
const events = cues.map((c, i) => {
  const start = starts[i];
  const end = i + 1 < cues.length ? starts[i + 1] - GAP : bodyDuration - 0.2;
  return `Dialogue: 0,${fmt(start)},${fmt(Math.max(end, start + 0.5))},Zh,,0,0,0,,${c.text}`;
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
console.log(`ASS 已生成（正片时长 ${bodyDuration.toFixed(1)}s，${cues.length} 条字幕）`);
console.log(`首条: ${events[0]}`);
console.log(`末条: ${events[events.length - 1]}`);
