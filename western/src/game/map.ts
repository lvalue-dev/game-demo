import { rand, randRange, shuffle } from './rng.ts';
import type { BuildingStyle, Bush, Loot, Material, ObstacleKind, Rect, Vec } from './types.ts';

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

/** 부품 종류별 기본값: 재질, 내구도, 화면 높이. 새 소품은 여기에 한 줄을 더하면 된다. */
export const PROP_KIT: Record<Exclude<ObstacleKind, 'building'>, { material: Material; hp: number; tall: number }> = {
  crate: { material: 'wood', hp: 4, tall: 16 },
  barrel: { material: 'wood', hp: 2, tall: 18 },
  tnt: { material: 'tnt', hp: 1, tall: 18 },
  trough: { material: 'wood', hp: 6, tall: 10 },
  wagon: { material: 'wood', hp: 9, tall: 14 },
  cactus: { material: 'plant', hp: 3, tall: 24 },
  rock: { material: 'stone', hp: Infinity, tall: 9 },
};

interface BuildingDef {
  x: number;
  y: number;
  w: number;
  h: number;
  material: Material;
  label?: string;
  style: BuildingStyle;
}

const BUILDINGS: BuildingDef[] = [
  { x: 300, y: 300, w: 200, h: 170, material: 'wood', label: '술집', style: { roof: 'brown', chimney: true, front: true } },
  { x: 680, y: 250, w: 240, h: 210, material: 'adobe', label: '은행', style: { roof: 'red', chimney: false, front: true } },
  { x: 1060, y: 300, w: 200, h: 160, material: 'wood', label: '잡화점', style: { roof: 'olive', chimney: true, front: true } },
  { x: 250, y: 760, w: 180, h: 140, material: 'wood', style: { roof: 'tan', chimney: true, front: false } },
  { x: 560, y: 780, w: 160, h: 130, material: 'wood', style: { roof: 'brown', chimney: false, front: false } },
  { x: 900, y: 760, w: 200, h: 150, material: 'adobe', style: { roof: 'tan', chimney: true, front: false } },
  { x: 1230, y: 780, w: 160, h: 130, material: 'wood', style: { roof: 'olive', chimney: false, front: false } },
];

type PropDef = [kind: Exclude<ObstacleKind, 'building'>, x: number, y: number, w: number, h: number];

/** 길가에 놓인 소품. 엄폐물이면서 부서지고, 화약통은 터진다. */
const PROPS: PropDef[] = [
  ['trough', 590, 585, 80, 26],
  ['wagon', 1000, 640, 96, 40],
  ['crate', 420, 650, 34, 34],
  ['crate', 1100, 500, 34, 34],
  ['crate', 640, 480, 30, 30],
  ['crate', 1340, 560, 34, 34],
  ['barrel', 540, 484, 22, 22],
  ['barrel', 1290, 484, 22, 22],
  ['barrel', 200, 520, 22, 22],
  ['barrel', 460, 690, 22, 22],
  ['tnt', 880, 476, 22, 22],
  ['tnt', 1380, 600, 22, 22],
  ['tnt', 500, 740, 22, 22],
  ['tnt', 770, 960, 22, 22],
];

/** 금고가 놓이는 자리. 뒤쪽 작전일수록 더 많이 열린다. */
const SAFES: { x: number; y: number; value: number; fromJob: number }[] = [
  { x: 800, y: 486, value: 40, fromJob: 0 },
  { x: 1160, y: 486, value: 25, fromJob: 0 },
  { x: 400, y: 496, value: 30, fromJob: 1 },
  { x: 1440, y: 660, value: 40, fromJob: 2 },
];

const BAG_SPOTS: Vec[] = [
  { x: 560, y: 380 }, { x: 700, y: 520 }, { x: 980, y: 380 }, { x: 1320, y: 400 },
  { x: 270, y: 580 }, { x: 760, y: 700 }, { x: 1180, y: 720 }, { x: 480, y: 850 },
  { x: 780, y: 870 }, { x: 1160, y: 870 }, { x: 1460, y: 480 }, { x: 860, y: 190 },
  { x: 220, y: 240 }, { x: 1460, y: 890 },
];

export const HORSE: Vec = { x: 110, y: 1090 };
export const PLAYER_START: Vec = { x: 150, y: 1050 };

export function makeObstacle(
  id: number, kind: ObstacleKind, x: number, y: number, w: number, h: number,
  extra: Partial<Pick<Rect, 'material' | 'label' | 'style'>> = {},
): Rect {
  const kit = kind === 'building' ? { material: 'wood' as Material, hp: Infinity, tall: 30 } : PROP_KIT[kind];
  return {
    id, x, y, w, h, kind, material: extra.material ?? kit.material, hp: kit.hp, maxHp: kit.hp,
    tall: kit.tall, marks: [], label: extra.label, style: extra.style,
  };
}

export function buildMap(job: number, state: { rng: number }): {
  obstacles: Rect[];
  bushes: Bush[];
  loots: Loot[];
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

  const obstacles: Rect[] = [];
  for (const b of BUILDINGS) {
    obstacles.push(makeObstacle(id++, 'building', b.x, b.y, b.w, b.h, { material: b.material, label: b.label, style: b.style }));
  }
  for (const [kind, x, y, w, h] of PROPS) obstacles.push(makeObstacle(id++, kind, x, y, w, h));

  // 들판에 흩어진 선인장, 바위, 덤불. 길과 건물, 출발 지점, 돈이 놓인 자리는 피한다.
  const blocked = (x: number, y: number, pad: number): boolean =>
    (y > 500 - pad && y < 740 + pad)
    || obstacles.some((o) => x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad)
    || Math.hypot(x - PLAYER_START.x, y - PLAYER_START.y) < 150
    || loots.some((l) => Math.hypot(x - l.x, y - l.y) < 50);
  const scatter = (count: number, pad: number, place: (x: number, y: number) => void): void => {
    for (let placed = 0, tries = 0; placed < count && tries < count * 20; tries++) {
      const x = randRange(state, 40, WORLD_W - 40);
      const y = randRange(state, 40, WORLD_H - 40);
      if (blocked(x, y, pad)) continue;
      place(x, y);
      placed += 1;
    }
  };
  scatter(14, 36, (x, y) => obstacles.push(makeObstacle(id++, 'cactus', x - 6, y - 6, 12, 12)));
  scatter(10, 30, (x, y) => obstacles.push(makeObstacle(id++, 'rock', x - 11, y - 7, 22, 14)));
  const bushes: Bush[] = [];
  scatter(30, 10, (x, y) => bushes.push({ id: id++, x, y, size: 0.8 + rand(state) * 0.5, burnt: false }));

  return { obstacles, bushes, loots };
}
