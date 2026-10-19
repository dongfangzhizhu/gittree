/**
 * 生长音乐映射（纯函数）
 *
 * 把提交历史映射成一段可播放、可导出的乐谱：
 * - 音符的**时间** = 该提交在生长动画中的出场时刻（与 scene-builder 的 tOf 同一套规则，
 *   所以听到的每一个音，都对应屏幕上正好长出来的那一段枝条/那一片叶子）；
 * - 音高取 **C 大调五声音阶**（半音 0/2/4/7/9，怎么弹都不难听），音域跨 3 个八度；
 * - **音高随分枝层级变化**：主干（depth 0）落在低音区，越细的末梢越高 ——
 *   树「由粗到细」的形状和音乐「由低到高」的走向因此是一致的；
 * - merge 提交给低音长音，标签给三音琶音（版本「开花结果」的和声）；
 * - 力度按提交类型区分（feat 重、chore/docs 轻）。
 *
 * 不读时钟、不用 Math.random：随机量全部来自 commit id 的哈希，
 * 所以同一个仓库永远得到同一段音乐（MIDI 文件也因此可复现）。
 */

import { GrowthModel, Commit, Lane } from "../core/types";

/** FNV-1a：确定性字符串哈希（与渲染层同一算法，保证音乐与树形态由同一份种子决定） */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface MusicNote {
  /** 生长进度 0..1（与动画 t 同刻度） */
  t: number;
  /** MIDI 音高（60 = C4） */
  midi: number;
  /** 时长（秒） */
  dur: number;
  /** 力度 0..1 */
  vel: number;
  kind: "commit" | "merge" | "tag";
}

export interface MusicSequence {
  notes: MusicNote[];
  /** 拍/分钟 */
  tempo: number;
  ticksPerBeat: number;
  /** 总时长（秒） */
  durationSec: number;
}

/** C 大调五声音阶（3 个八度，15 个音） */
const PENTATONIC = [0, 2, 4, 7, 9];
const SCALE_STEPS = 15; // PENTATONIC.length * 3
const ROOT_MIDI = 48; // C3：主干落在低音区

/** 提交类型 → 力度（feat 是「真的在干活」，docs/chore 只是走过场） */
const VELOCITY: Record<string, number> = {
  feat: 1,
  fix: 0.86,
  refactor: 0.8,
  perf: 0.9,
  spec: 0.88,
  hook: 0.82,
  chore: 0.6,
  docs: 0.55,
  test: 0.7,
};

/** 分枝层级：主干 0，一级枝 1，二级枝 2……（与 scene-builder 同一套定义） */
function depthByLane(model: GrowthModel): Map<string, number> {
  const byId = new Map(model.lanes.map((l) => [l.id, l]));
  const out = new Map<string, number>();
  for (const lane of model.lanes) {
    let depth = 0;
    let cur: Lane | undefined = lane;
    while (cur && cur.parentLane !== null && cur.parentLane !== undefined && depth < 6) {
      cur = byId.get(cur.parentLane);
      depth++;
    }
    for (const id of lane.commitIds) out.set(id, depth);
  }
  return out;
}

/** 音高：五声音阶第 d 级 + depth 决定八度（末梢更高） */
function pitchOf(seedHash: number, depth: number, kind: MusicNote["kind"]): number {
  const degree = seedHash % SCALE_STEPS;
  const octave = kind === "merge" ? 0 : Math.min(2, Math.floor(depth * 0.7 + (seedHash % 3) * 0.34));
  const semis = ROOT_MIDI + PENTATONIC[degree % 5] + Math.floor(degree / 5) * 12 + octave * 12;
  return Math.min(96, Math.max(36, semis));
}

export interface MusicOptions {
  tempo?: number;
  ticksPerBeat?: number;
}

/**
 * 构建整段生长乐谱（纯函数：同 model 必得同结果）。
 * notes 按 t 升序排列，t 落在 [0,1]，与播放进度同刻度。
 */
export function buildMusicSequence(model: GrowthModel, options: MusicOptions = {}): MusicSequence {
  const tempo = options.tempo ?? 84;
  const ticksPerBeat = options.ticksPerBeat ?? 480;
  const commits = model.commits;
  const n = commits.length;
  if (n === 0) return { notes: [], tempo, ticksPerBeat, durationSec: 0 };

  const depthById = depthByLane(model);
  const tagCommitIds = new Set(model.tags.map((t) => t.commitId));
  const notes: MusicNote[] = [];

  const push = (t: number, midi: number, dur: number, vel: number, kind: MusicNote["kind"]) => {
    // 统一夹到 [36, 96]（C2–C7）：琶音叠加的音高也要落在同一音域内
    notes.push({ t: clamp01(t), midi: Math.min(96, Math.max(36, midi)), dur, vel, kind });
  };

  commits.forEach((commit, idx) => {
    const t = n <= 1 ? 0 : idx / (n - 1);
    const h = hash32(commit.id);
    const depth = depthById.get(commit.id) ?? 0;
    const vel = VELOCITY[commit.type] ?? 0.75;

    if (commit.isMerge) {
      // 合并：低音区长音，像大提琴拉一下（同样落在五声音阶的低八度）
      push(t, 36 + PENTATONIC[h % 5], 1.6, Math.min(1, vel * 1.15), "merge");
      return;
    }

    const dur = 0.28 + (h % 7) * 0.05;
    push(t, pitchOf(h, depth, "commit"), dur, vel * 0.9, "commit");

    // 标签：三音琶音（根+五度+八度），像风铃；根压低到 72 以下，保证 +24 不越界
    if (tagCommitIds.has(commit.id)) {
      const base = Math.min(72, pitchOf(h, depth, "tag"));
      push(t, base + 12, 1.1, 0.55, "tag");
      push(t + 0.012, base + 19, 1.0, 0.45, "tag");
      push(t + 0.024, base + 24, 1.3, 0.4, "tag");
    }
  });

  notes.sort((a, b) => a.t - b.t);
  const totalSec = 0; // 由播放时的实际时长决定；导出用调用方给的时长
  return { notes, tempo, ticksPerBeat, durationSec: totalSec };
}

/** 取 [0,1] 区间内、按进度到达的所有音符下标（指针式推进，避免每帧全量扫描） */
export function notesUntil(seq: MusicSequence, t: number, from: number): { played: number; next: number } {
  let i = from;
  while (i < seq.notes.length && seq.notes[i].t <= t) i++;
  return { played: i - from, next: i };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export { SCALE_STEPS, ROOT_MIDI, PENTATONIC };
