import { rand, randRange, shuffle } from './rng.ts';
import type { Decor, Loot, Rect, Vec } from './types.ts';

export const WORLD_W = 1600;
export const WORLD_H = 1200;

export interface JobDef {
  name: string;
  quota: number;
  /** 이 작전에서 돈자루와 금고에 든 돈의 배수. */
  lootMult: number;
  bags: number;
}

export const JOBS: JobDef[] = [
  { name: '먼지골 은행', quota: 60, lootMult: 1, bags: 6 },
  { name: '장날의 먼지골', quota: 95, lootMult: 1.4, bags: 7 },
  { name: '급여 수송일', quota: 140, lootMult: 1.9, bags: 8 },
];

const BUILDINGS: Rect[] = [
  { x: 300, y: 300, w: 200, h: 170, kind: 'saloon', label: '술집' },
  { x: 680, y: 250, w: 240, h: 210, kind: 'bank', label: '은행' },
  { x: 1060, y: 300, w: 200, h: 160, kind: 'store', label: '잡화점' },
  { x: 250, y: 760, w: 180, h: 140, kind: 'house' },
  { x: 560, y: 780, w: 160, h: 130, kind: 'house' },
  { x: 900, y: 760, w: 200, h: 150, kind: 'house' },
  { x: 1230, y: 780, w: 160, h: 130, kind: 'house' },
  // 길가의 엄폐물: 물통, 마차, 상자
  { x: 590, y: 585, w: 80, h: 26, kind: 'cover' },
  { x: 1000, y: 640, w: 96, h: 40, kind: 'cover' },
  { x: 420, y: 650, w: 34, h: 34, kind: 'cover' },
  { x: 960, y: 500, w: 36, h: 36, kind: 'cover' },
  { x: 1340, y: 560, w: 60, h: 30, kind: 'cover' },
  { x: 180, y: 520, w: 50, h: 30, kind: 'cover' },
];

/** 금고가 놓이는 자리. 뒤쪽 작전일수록 더 많이 열린다. */
const SAFES: { x: number; y: number; value: number; fromJob: number }[] = [
  { x: 800, y: 484, value: 40, fromJob: 0 },
  { x: 1160, y: 484, value: 25, fromJob: 0 },
  { x: 400, y: 494, value: 30, fromJob: 1 },
  { x: 1420, y: 660, value: 40, fromJob: 2 },
];

const BAG_SPOTS: Vec[] = [
  { x: 540, y: 380 }, { x: 640, y: 500 }, { x: 960, y: 380 }, { x: 1300, y: 400 },
  { x: 270, y: 560 }, { x: 760, y: 700 }, { x: 1160, y: 720 }, { x: 470, y: 840 },
  { x: 760, y: 860 }, { x: 1150, y: 860 }, { x: 1440, y: 480 }, { x: 860, y: 190 },
  { x: 220, y: 240 }, { x: 1440, y: 880 },
];

export const HORSE: Vec = { x: 110, y: 1090 };
export const PLAYER_START: Vec = { x: 150, y: 1050 };

export function buildMap(job: number, state: { rng: number }): {
  obstacles: Rect[];
  loots: Loot[];
  decor: Decor[];
} {
  const def = JOBS[job]!;
  let id = 1;
  const loots: Loot[] = [];
  for (const s of SAFES) {
    if (s.fromJob > job) continue;
    loots.push({
      id: id++, x: s.x, y: s.y, kind: 'safe', value: Math.round(s.value * def.lootMult),
      time: 2.6, progress: 0, taken: false,
    });
  }
  for (const spot of shuffle(state, [...BAG_SPOTS]).slice(0, def.bags)) {
    loots.push({
      id: id++, x: spot.x, y: spot.y, kind: 'bag', value: Math.round(10 * def.lootMult),
      time: 0.7, progress: 0, taken: false,
    });
  }

  const decor: Decor[] = [];
  const kinds: Decor['kind'][] = ['cactus', 'bush', 'stone'];
  for (let i = 0; i < 70; i++) {
    const p = { x: randRange(state, 20, WORLD_W - 20), y: randRange(state, 20, WORLD_H - 20) };
    // 길 한가운데와 건물 안에는 놓지 않는다.
    if (p.y > 520 && p.y < 720) continue;
    if (BUILDINGS.some((b) => p.x > b.x - 14 && p.x < b.x + b.w + 14 && p.y > b.y - 14 && p.y < b.y + b.h + 14)) continue;
    decor.push({ ...p, kind: kinds[Math.floor(rand(state) * kinds.length)]!, size: randRange(state, 0.8, 1.3) });
  }
  return { obstacles: BUILDINGS.map((b) => ({ ...b })), loots, decor };
}
