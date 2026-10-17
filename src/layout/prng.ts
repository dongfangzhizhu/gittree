/**
 * 确定性伪随机数生成器（Mulberry32）
 */

export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 将字符串哈希为 32 位非负整数
 */
export function hash32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // 保持 32 位有符号整数（原 hash & hash 是空操作）
  }
  return Math.abs(hash);
}

/**
 * 基于 commit ID 的确定性随机
 */
export function seededRandom(commitId: string, index: number): number {
  const seed = hash32(commitId + index);
  const rng = mulberry32(seed);
  return rng();
}
