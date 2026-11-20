/** 상태에 저장되는 시드 기반 난수(mulberry32). 같은 시드와 같은 선택이면 같은 커리어가 나온다. */
export interface Rng {
  rng: number;
}

export function rand(s: Rng): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** lo 이상 hi 이하의 정수. */
export const int = (s: Rng, lo: number, hi: number): number => lo + Math.floor(rand(s) * (hi - lo + 1));
export const spread = (s: Rng, lo: number, hi: number): number => lo + rand(s) * (hi - lo);
export const chance = (s: Rng, p: number): boolean => rand(s) < p;
export const pick = <T>(s: Rng, items: readonly T[]): T => items[Math.floor(rand(s) * items.length)] as T;

export function shuffle<T>(s: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

/** 평균이 lambda인 푸아송 분포. 한 경기의 골 수에 쓴다. */
export function poisson(s: Rng, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand(s);
  } while (p > limit);
  return k - 1;
}
