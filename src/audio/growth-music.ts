/**
 * 生长音乐引擎（Web Audio）
 *
 * 设计目标：**不引入任何音频库**（Tone.js 之类会再加 ~200 kB），
 * 用浏览器自带的 Web Audio 手搓一个「MIDI 合成器」：
 *
 * - 音色：FM 铃声（正弦载波 + 正弦调制器，包络指数衰减）——
 *   像音乐盒/风铃，和「一棵树慢慢长出来」的气质对得上；merge 用三角波长音垫底。
 * - 空间感：一段**程序生成的混响 IR**（噪声衰减）跑 ConvolverNode，
 *   外加一个低通滤波的 pad drone（两个失谐正弦，C2+G2），让音乐有「空气」。
 * - 总线：master gain → limiter（DynamicsCompressor）→ destination，
 *   避免多个音叠在一起削波。
 *
 * 工程约束：
 * - AudioContext **必须由用户手势创建/恢复**（浏览器自动播放策略），
 *   所以引擎是懒启动的：第一次 `ensureContext()` 一定发生在点击里。
 * - 每帧只播「新长出来的提交」对应的音：用指针推进，不重播、不扫描全量。
 * - 同一时刻最多 8 个音，超过直接丢弃（防止树上瞬间长出一片叶时炸音）。
 */

import { GrowthModel } from "../core/types";
import { MusicSequence, MusicNote, buildMusicSequence, notesUntil } from "./music-map";
import { downloadMidi, notesToMidi } from "./midi-file";

/** FM 铃声：载波/调制比、调制指数、衰减时间 */
const FM_RATIO = 3.01;
const FM_INDEX = 180;
const BELL_DECAY = 1.6;

export interface GrowthMusicOptions {
  /** 是否默认开启（仍受用户手势限制） */
  volume?: number;
}

export class GrowthMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;

  private seq: MusicSequence | null = null;
  private model: GrowthModel | null = null;
  private cursor = 0;
  private active = 0;
  /** 默认静音：必须等用户点过音乐按钮才出声（自动播放策略 + 不打扰用户） */
  private muted = true;
  private volume: number;
  /** 已触发音符数（调试/测试用） */
  private playedCount = 0;

  constructor(options: GrowthMusicOptions = {}) {
    this.volume = options.volume ?? 0.5;
  }

  /** 懒创建音频图；必须在用户手势里调用，否则浏览器会拦 */
  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor({ latencyHint: "interactive" });
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;

    // 限幅：多个音叠加时防削波（比 compressor 更省 CPU）
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    master.connect(limiter);
    limiter.connect(ctx.destination);

    // 混响：程序生成 IR（噪声 × 指数衰减，2.6s）
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulseResponse(ctx, 2.6);
    const send = ctx.createGain();
    send.gain.value = 0.32;
    send.connect(convolver);
    convolver.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.reverb = convolver;
    this.reverbSend = send;
    return ctx;
  }

  /** 换一首「乐谱」：重置指针，重新生成映射 */
  setModel(model: GrowthModel, durationSec: number): void {
    this.model = model;
    this.seq = buildMusicSequence(model);
    this.cursor = 0;
    this.active = 0;
    this.playedCount = 0;
    this.durationSec = Math.max(1, durationSec);
    // 只有已经拿到 AudioContext（= 用户已手势）时才起 drone，
    // 否则在自动播放策略下提前创建上下文会被浏览器拦下并打警告
    if (this.ctx) this.startDrone();
  }

  /** 播放时长变化（时长下拉框）时同步，MIDI 导出的绝对时间才会对 */
  setDuration(durationSec: number): void {
    this.durationSec = Math.max(1, durationSec);
  }

  private durationSec = 30;

  /** 每帧调用：把进度 t 之前「新出现」的音符播出去 */
  update(t: number): void {
    if (!this.seq || this.muted) return;
    // 没有上下文说明用户还没手势：不在这里创建（否则 Chrome 会打
    // 「AudioContext 未获允许启动」的警告，且上下文会被挂起）
    if (!this.ctx || this.ctx.state !== "running") return;

    const { next } = notesUntil(this.seq, Math.max(0, Math.min(1, t)), this.cursor);
    for (let i = this.cursor; i < next; i++) {
      this.play(this.seq.notes[i], i);
    }
    this.cursor = next;
  }

  /** 播一个音符（commit 走 FM 铃音，merge 走三角长音，tag 走更亮的铃） */
  private play(note: MusicNote, index: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (this.active >= 8) return; // 同屏音数上限：瞬间长叶时保护 CPU 与听感

    const now = ctx.currentTime;
    const isLong = note.kind === "merge";
    const isBell = note.kind === "tag";

    const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(note.vel * (isLong ? 0.5 : 0.32), now + 0.008);
    const decay = isLong ? note.dur : Math.min(note.dur, BELL_DECAY);
    amp.gain.exponentialRampToValueAtTime(0.0008, now + decay + 0.25);

    amp.connect(master);
    if (this.reverbSend) {
      const sendAmt = isLong ? 0.5 : 0.75;
      const send = ctx.createGain();
      send.gain.value = sendAmt;
      amp.connect(send);
      send.connect(this.reverbSend);
    }

    if (isLong) {
      // 三角波 + 轻微失谐：像远处的大提琴
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const detune = ctx.createOscillator();
      detune.type = "triangle";
      detune.frequency.value = freq * 1.005;
      osc.connect(amp);
      detune.connect(amp);
      osc.start(now);
      detune.start(now);
      osc.stop(now + decay + 0.3);
      detune.stop(now + decay + 0.3);
    } else {
      // FM 铃声：载波 + 调制器（调制器包络跟着音量一起衰减，音色才「亮」
      const carrier = ctx.createOscillator();
      carrier.type = "sine";
      carrier.frequency.value = freq;
      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.value = freq * FM_RATIO;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(FM_INDEX, now);
      modGain.gain.exponentialRampToValueAtTime(1, now + decay * 0.6);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(amp);
      carrier.start(now);
      mod.start(now);
      carrier.stop(now + decay + 0.3);
      mod.stop(now + decay + 0.3);
      if (isBell) {
        // 标签音再加一个高八度泛音，像风铃的余韵
        const harm = ctx.createOscillator();
        harm.type = "sine";
        harm.frequency.value = freq * 2;
        const hg = ctx.createGain();
        hg.gain.value = 0.18;
        harm.connect(hg);
        hg.connect(amp);
        harm.start(now);
        harm.stop(now + decay + 0.3);
      }
    }

    this.active++;
    this.playedCount++;
    // 音结束后释放并发计数（用定时器最省事，浏览器会合并空闲定时器）
    window.setTimeout(() => {
      this.active = Math.max(0, this.active - 1);
    }, (decay + 0.4) * 1000);
  }

  /** pad drone：低音长鸣，给整段生长打底；音量很小，几乎察觉不到但「撑」着音乐 */
  startDrone(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.stopDrone();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2.5);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    gain.connect(filter);
    filter.connect(this.master);
    const freqs = [65.41, 98.0, 130.81]; // C2 / G2 / C3
    const osc = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.detune.value = (i - 1) * 4;
      o.connect(gain);
      o.start();
      return o;
    });
    this.drone = { osc, gain };
  }

  stopDrone(): void {
    if (!this.drone || !this.ctx) return;
    const { osc, gain } = this.drone;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.4);
    for (const o of osc) o.stop(now + 0.5);
    this.drone = null;
  }

  /** 从暂停处继续（用户手势里调用） */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx && ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        /* 用户还没手势：静默等下一次点击 */
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : this.volume, now + 0.12);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 当前是否真的有声音（用于 UI 状态） */
  isRunning(): boolean {
    return !!this.ctx && this.ctx.state === "running" && !this.muted;
  }

  /** 导出当前乐谱为 MIDI 文件（整段，不只是已播放的部分） */
  exportMidi(): void {
    if (!this.model) return;
    const seq = this.seq ?? buildMusicSequence(this.model);
    const data = notesToMidi(seq.notes, {
      durationSec: this.durationSec,
      tempo: seq.tempo,
      ticksPerBeat: seq.ticksPerBeat,
      trackName: "代码年轮",
    });
    const repo = this.model.source.repo ?? "gittree";
    downloadMidi(data, `gittree-${repo}.mid`);
  }

  /** 已触发音符数（测试钩子） */
  stats(): { played: number; cursor: number; total: number } {
    return {
      played: this.playedCount,
      cursor: this.cursor,
      total: this.seq?.notes.length ?? 0,
    };
  }

  /** 彻底销毁：切换仓库/卸载页面时调用 */
  dispose(): void {
    this.stopDrone();
    this.seq = null;
    this.model = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.master = null;
    this.reverb = null;
    this.reverbSend = null;
  }
}

/** 程序生成混响脉冲响应：噪声 × 指数衰减（无需任何音频文件） */
function makeImpulseResponse(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // 前期给一点预延迟，后期衰减更慢，听起来更像大厅
      const decay = Math.pow(1 - t, 2.6) * Math.exp(-t * 3.2);
      data[i] = (Math.random() * 2 - 1) * decay * (i < rate * 0.01 ? i / (rate * 0.01) : 1);
    }
  }
  return buf;
}
