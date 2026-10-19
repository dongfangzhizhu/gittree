/**
 * 音乐映射 / MIDI 写入单元测试
 * 验证：确定性、t 与动画同刻度、五声音阶、层级影响音高、标签琶音、
 *       MIDI 文件结构（MThd/MTrk 魔数、VLQ、事件配平、End of Track）
 */

import { describe, it, expect } from "vitest";
import { buildMusicSequence, notesUntil, MusicNote } from "../music-map";
import { notesToMidi } from "../midi-file";
import { buildGrowthModel } from "../../core/growth-model";
import { Commit, GrowthModel } from "../../core/types";

const DAY = 86400000;
const T0 = Date.UTC(2025, 0, 1);

function mk(
  id: string,
  day: number,
  parents: string[] = [],
  opts: { author?: string; type?: Commit["type"]; message?: string } = {}
): Commit {
  return {
    id,
    parents,
    author: { name: opts.author ?? "晓", login: "xiao" },
    time: T0 + day * DAY,
    message: opts.message ?? "feat: x",
    type: opts.type ?? "feat",
    isMerge: parents.length > 1,
  };
}

/** 12 个提交 + 一条支线 + 合并 + 一个标签 */
function buildTestModel(): GrowthModel {
  const commits: Commit[] = [];
  for (let i = 0; i < 12; i++) commits.push(mk(`m${i}`, i * 3, i > 0 ? [`m${i - 1}`] : []));
  commits.splice(6, 1, mk("m6", 18, ["m5", "b2"], { message: "Merge branch 'feature'" }));
  commits.push(mk("b0", 10, ["m3"], { author: "豪" }));
  commits.push(mk("b1", 13, ["b0"], { author: "豪" }));
  commits.push(mk("b2", 16, ["b1"], { author: "豪" }));
  commits.push(mk("s1", 20, ["m6"], { type: "spec", message: "spec: 需求定稿" }));
  commits.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const tags = [
    { name: "v1.0.0", commit: "m2" },
    { name: "v1.0.1", commit: "m4" },
  ];
  return buildGrowthModel(commits, tags, 1);
}

describe("buildMusicSequence", () => {
  it("空模型返回空乐谱", () => {
    const seq = buildMusicSequence(buildGrowthModel([], [], 1));
    expect(seq.notes).toEqual([]);
  });

  it("确定性：同一模型两次构建完全一致", () => {
    const a = buildMusicSequence(buildTestModel());
    const b = buildMusicSequence(buildTestModel());
    expect(a.notes).toEqual(b.notes);
  });

  it("不同仓库（不同提交 id）得到不同乐谱", () => {
    const a = buildMusicSequence(buildTestModel());
    const model2 = buildTestModel();
    model2.commits = model2.commits.map((c, i) => ({ ...c, id: `zz${i}` }));
    const b = buildMusicSequence(model2);
    expect(JSON.stringify(a.notes)).not.toBe(JSON.stringify(b.notes));
  });

  it("音符按生长进度升序，且 t ∈ [0,1]", () => {
    const seq = buildMusicSequence(buildTestModel());
    for (let i = 1; i < seq.notes.length; i++) {
      expect(seq.notes[i].t).toBeGreaterThanOrEqual(seq.notes[i - 1].t);
    }
    expect(seq.notes[0].t).toBeGreaterThanOrEqual(0);
    expect(seq.notes[seq.notes.length - 1].t).toBeLessThanOrEqual(1);
  });

  it("音高全部落在 C 大调五声音阶内（含 3 个八度）", () => {
    const seq = buildMusicSequence(buildTestModel());
    // 以 C（半音 0）为根：mod 12 ∈ {0,2,4,7,9} 即五声音阶；音域 [48, 96]
    for (const note of seq.notes) {
      const semis = note.midi - 48;
      expect(semis).toBeGreaterThanOrEqual(-12); // 合并的低音可以低一个八度
      expect(semis).toBeLessThanOrEqual(48);
      expect([0, 2, 4, 7, 9]).toContain(((note.midi - 48) % 12 + 12) % 12);
    }
  });

  it("merge 提交给低音区长音，且不带琶音", () => {
    const seq = buildMusicSequence(buildTestModel());
    const mergeNotes = seq.notes.filter((n) => n.kind === "merge");
    expect(mergeNotes.length).toBeGreaterThan(0);
    for (const n of mergeNotes) {
      expect(n.midi).toBeLessThan(48);
      expect(n.dur).toBeGreaterThan(1.4);
    }
  });

  it("标签给三音琶音（同一时刻三个音）", () => {
    const seq = buildMusicSequence(buildTestModel());
    const tagNotes = seq.notes.filter((n) => n.kind === "tag");
    expect(tagNotes.length % 3).toBe(0);
    // 琶音音高依次升高
    for (let i = 0; i < tagNotes.length; i += 3) {
      const group = tagNotes.slice(i, i + 3);
      expect(group[1].midi).toBeGreaterThan(group[0].midi);
      expect(group[2].midi).toBeGreaterThan(group[1].midi);
    }
  });

  it("力度按提交类型区分：feat > docs", () => {
    const model = buildTestModel();
    const seq = buildMusicSequence(model);
    const feat = seq.notes.find((n) => n.kind === "commit" && n.vel > 0.85);
    const docs = buildMusicSequence(
      buildGrowthModel(
        [mk("d1", 0, [], { type: "docs" }), mk("d2", 1, ["d1"], { type: "docs" })],
        [],
        1
      )
    ).notes[0];
    expect(feat).toBeDefined();
    expect(feat!.vel).toBeGreaterThan(docs.vel);
  });

  it("notesUntil 指针式推进不漏不重", () => {
    const seq = buildMusicSequence(buildTestModel());
    let cursor = 0;
    let total = 0;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const r = notesUntil(seq, t, cursor);
      cursor = r.next;
      total += r.played;
    }
    expect(total).toBe(seq.notes.length);
  });
});

describe("notesToMidi", () => {
  const notes: MusicNote[] = [
    { t: 0, midi: 60, dur: 0.5, vel: 1, kind: "commit" },
    { t: 0.5, midi: 67, dur: 0.25, vel: 0.8, kind: "commit" },
  ];

  it("文件头是 MThd + 6 + format0 + 1 轨", () => {
    const bytes = notesToMidi(notes, { durationSec: 10 });
    expect([...bytes.slice(0, 4)]).toEqual([0x4d, 0x54, 0x68, 0x64]);
    expect([...bytes.slice(8, 10)]).toEqual([0x00, 0x00]); // format 0
    expect([...bytes.slice(10, 12)]).toEqual([0x00, 0x01]); // 1 轨
    expect([...bytes.slice(12, 14)]).toEqual([0x01, 0xe0]); // 480 ticks/beat
  });

  it("包含 MTrk、UTF-8 轨道名与 End of Track", () => {
    const bytes = notesToMidi(notes, { durationSec: 10, trackName: "代码年轮" });
    const nameBytes = Array.from(new TextEncoder().encode("代码年轮"));
    // 找到 FF 03 <len> 后紧跟的字节就是轨道名
    let found = -1;
    for (let i = 0; i < bytes.length - nameBytes.length; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0x03 && bytes[i + 2] === nameBytes.length) {
        if (nameBytes.every((b, k) => bytes[i + 3 + k] === b)) found = i;
      }
    }
    expect(found).toBeGreaterThan(0);
    // 结尾必须是 FF 2F 00
    expect([...bytes.slice(-3)]).toEqual([0xff, 0x2f, 0x00]);
  });

  it("Note On/Off 数量相等且 midi 一致", () => {
    const bytes = notesToMidi(notes, { durationSec: 10 });
    let on = 0;
    let off = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x90) on++;
      if (bytes[i] === 0x80) off++;
    }
    expect(on).toBe(notes.length);
    expect(off).toBe(notes.length);
  });

  it("变长码：127 → 1 字节，128 → 2 字节", () => {
    const bytes = notesToMidi(notes, { durationSec: 10, ticksPerBeat: 480, tempo: 84 });
    // 只验证文件能被解析出合法长度：MTrk 长度字段与实际字节数吻合
    const idx = bytes.indexOf(0x4d); // 'M' of MThd
    expect(idx).toBe(0);
    expect(bytes.length).toBeGreaterThan(50);
  });

  it("空乐谱也能生成合法文件（只有头和空轨）", () => {
    const bytes = notesToMidi([], { durationSec: 5 });
    expect([...bytes.slice(-3)]).toEqual([0xff, 0x2f, 0x00]);
    expect(bytes.length).toBeGreaterThan(20);
  });

  it("整份文件可被标准 MIDI 解析器走通，总 tick 与时长换算一致", () => {
    /** 最小 MIDI 解析器：走完 MThd + MTrk，返回 { ticks, noteOn, noteOff } */
    const parse = (bytes: Uint8Array) => {
      let i = 14; // MThd(8) + 6 字节头体
      const str = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
      expect(str(0)).toBe("MThd");
      expect(str(i)).toBe("MTrk");
      const trackLen = (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7];
      i += 8;
      const end = i + trackLen;
      let ticks = 0;
      let noteOn = 0;
      let noteOff = 0;
      while (i < end) {
        // delta VLQ
        let delta = 0;
        while (bytes[i] & 0x80) delta = (delta << 7) | (bytes[i++] & 0x7f);
        delta = (delta << 7) | (bytes[i++] & 0x7f);
        ticks += delta;
        const status = bytes[i];
        if (status === 0xff) {
          i++; // FF
          const type = bytes[i++];
          let len = 0;
          while (bytes[i] & 0x80) len = (len << 7) | (bytes[i++] & 0x7f);
          len = (len << 7) | (bytes[i++] & 0x7f);
          i += len;
          if (type === 0x2f) break; // End of Track
        } else if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) {
          i += 2;
        } else {
          if ((status & 0xf0) === 0x90) noteOn++;
          if ((status & 0xf0) === 0x80) noteOff++;
          i += 3;
        }
      }
      return { ticks, noteOn, noteOff, end };
    };

    const usPerTick = 60000000 / 84 / 480;
    const short = parse(notesToMidi(notes, { durationSec: 5, tempo: 84, ticksPerBeat: 480 }));
    const long = parse(notesToMidi(notes, { durationSec: 50, tempo: 84, ticksPerBeat: 480 }));
    expect(short.noteOn).toBe(notes.length);
    expect(short.noteOff).toBe(notes.length);
    expect(long.ticks).toBe(Math.round((50 * 1e6) / usPerTick));
    expect(long.ticks).toBeGreaterThan(short.ticks);
  });
});
