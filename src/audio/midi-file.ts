/**
 * MIDI 文件写入（纯函数，无 DOM/Web Audio 依赖）
 *
 * 生成**标准 MIDI 文件（Format 0，单轨）**字节流，可以直接双击播放、
 * 也可以拖进任何 DAW / 打谱软件。协议只有几件事：
 *   1. MThd 头：格式 + 轨数 + 每拍 tick 数
 *   2. MTrk 轨：一串 delta-time 事件，最后以 End-of-Track 收尾
 *   3. 变长码（VLQ）：delta-time 每 7 位一组、高位在前
 *
 * 参考：MIDI Association《Standard MIDI-File Format 1.0》§1–§3。
 * 这里只写我们需要的两类事件：Note On(0x90) / Note Off(0x80)，外加
 * Program Change(0xC0, 取 0 = Acoustic Grand) 与 Set Tempo(FF 51 03)。
 */

import { MusicNote } from "./music-map";

export interface MidiWriteOptions {
  /** 全曲时长（秒）：把 [0,1] 的生长进度换算成绝对时间 */
  durationSec: number;
  tempo?: number;
  ticksPerBeat?: number;
  /** 轨道名（meta 事件 0x03，方便在 DAW 里认出来） */
  trackName?: string;
}

/** 变长码：VLQ（7 位一组，高位在前，最高位置 1 表示后续还有字节） */
function writeVLQ(value: number): number[] {
  const v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  let rest = v >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function u32(v: number): number[] {
  return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function u16(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}

/** 微秒/拍 ← 拍/分钟：tempo 60 → 1e6，120 → 5e5 */
function microsPerBeat(tempo: number): number {
  return Math.round(60000000 / Math.max(20, tempo));
}

/**
 * 音符列表 → 标准 MIDI 文件字节。
 * notes 必须按时间升序（buildMusicSequence 已保证）。
 */
export function notesToMidi(notes: MusicNote[], options: MidiWriteOptions): Uint8Array {
  const durationSec = Math.max(1, options.durationSec);
  const tempo = options.tempo ?? 84;
  const ticksPerBeat = options.ticksPerBeat ?? 480;
  const usPerTick = microsPerBeat(tempo) / ticksPerBeat;
  /** 秒 → tick（注意单位：usPerTick 是微秒，先把秒换成微秒） */
  const secToTick = (sec: number) => Math.round((sec * 1e6) / usPerTick);

  const bytes: number[] = [];
  // ---- MThd ----
  bytes.push(0x4d, 0x54, 0x68, 0x64); // "MThd"
  bytes.push(...u32(6)); // 头长度固定 6
  bytes.push(...u16(0)); // format 0（单轨）
  bytes.push(...u16(1)); // 1 条轨
  bytes.push(...u16(ticksPerBeat)); // 分辨率

  // ---- MTrk：先拼事件，再回填长度 ----
  const track: number[] = [];
  let lastTick = 0;

  // 轨道名 + 音色（文本用 UTF-8 字节写，长度按字节数计，DAW 才能正确识别中文）
  const nameBytes = Array.from(new TextEncoder().encode(options.trackName ?? "GitTree Rings"));
  track.push(...writeVLQ(0), 0xff, 0x03, nameBytes.length & 0x7f, ...nameBytes);
  track.push(...writeVLQ(0), 0xff, 0x51, 0x03);
  const us = microsPerBeat(tempo);
  track.push((us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
  track.push(...writeVLQ(0), 0xc0, 0x00); // Program Change: Acoustic Grand

  type Ev = { tick: number; bytes: number[] };
  const events: Ev[] = [];
  const NOTE_ON = 0x90;
  const NOTE_OFF = 0x80;
  const CHANNEL = 0;

  for (const note of notes) {
    const startSec = note.t * durationSec;
    const endSec = Math.min(durationSec, startSec + note.dur);
    const start = secToTick(startSec);
    const end = Math.max(start + 1, secToTick(endSec));
    const velocity = Math.max(1, Math.min(127, Math.round(note.vel * 127)));
    events.push({ tick: start, bytes: [NOTE_ON | CHANNEL, note.midi & 0x7f, velocity] });
    events.push({ tick: end, bytes: [NOTE_OFF | CHANNEL, note.midi & 0x7f, 0] });
  }
  // 同一时刻的事件顺序无关紧要，但必须按 tick 稳定排序，保证文件可复现
  events.sort((a, b) => a.tick - b.tick);

  for (const ev of events) {
    track.push(...writeVLQ(ev.tick - lastTick));
    track.push(...ev.bytes);
    lastTick = ev.tick;
  }

  // End of Track
  track.push(...writeVLQ(secToTick(durationSec) - lastTick), 0xff, 0x2f, 0x00);

  bytes.push(0x4d, 0x54, 0x72, 0x6b); // "MTrk"
  bytes.push(...u32(track.length));
  bytes.push(...track);

  return new Uint8Array(bytes);
}

/** 浏览器下载（保持纯文件写入与 DOM 解耦：这里只做最后一跳） */
export function downloadMidi(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
