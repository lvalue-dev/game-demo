/** 상태에 저장되는 시드 기반 난수(mulberry32). */
export function rand(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(state: { rng: number }, min: number, max: number): number {
  return min + rand(state) * (max - min);
}

export function shuffle<T>(state: { rng: number }, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
