import { rand, randRange, shuffle } from './rng.ts';
import type { BuildingStyle, Bush, Decor, Loot, Material, ObstacleKind, Rect, Vec } from './types.ts';

// 배경: 1881년 애리조나 준주, 소노라 사막 저지대의 작은 마을 "먼지골".
// 큰길 하나를 사이에 두고 가게가 마주 선, 그 시절 개척 마을의 전형적인 배치다.

export const WORLD_W = 1600;
export const WORLD_H = 1200;
/** 한 층의 높이(화면 기준). */
export const STORY = 28;

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
  // 발파용 흑색 화약통. 그 시절 폭약은 화약통과 다이너마이트였다.
  powder: { material: 'powder', hp: 1, tall: 15 },
  trough: { material: 'wood', hp: 6, tall: 10 },
  wagon: { material: 'wood', hp: 9, tall: 14 },
  // 사와로 선인장
  cactus: { material: 'plant', hp: 3, tall: 32 },
  rock: { material: 'stone', hp: Infinity, tall: 9 },
  outhouse: { material: 'wood', hp: 5, tall: 30 },
  hay: { material: 'plant', hp: 2, tall: 14 },
  // 메스키트 나무. 줄기만 길을 막는다.
  tree: { material: 'wood', hp: Infinity, tall: 18 },
  well: { material: 'stone', hp: Infinity, tall: 10 },
  // 지하수를 퍼 올리는 풍차와 물탱크
  windmill: { material: 'wood', hp: Infinity, tall: 20 },
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

// 길 북쪽 줄은 정면이 남쪽(화면 아래)을 향해 가게 앞모습이 보이고,
// 남쪽 줄은 길을 향해 등을 돌리고 있어 건물 뒷모습과 뒷마당이 보인다.
const BUILDINGS: BuildingDef[] = [
  {
    x: 110, y: 340, w: 140, h: 120, material: 'adobe', label: '보안관',
    style: { form: 'flat', stories: 1, roof: 'tar', trade: 'jail', awning: false, chimney: false },
  },
  {
    x: 300, y: 300, w: 200, h: 170, material: 'wood', label: '술집',
    style: { form: 'falsefront', stories: 2, roof: 'shingle', trade: 'saloon', awning: true, chimney: true },
  },
  {
    x: 680, y: 250, w: 240, h: 210, material: 'brick', label: '은행',
    style: { form: 'flat', stories: 1, roof: 'tar', trade: 'bank', awning: false, chimney: false },
  },
  {
    x: 1060, y: 300, w: 200, h: 160, material: 'wood', label: '잡화점',
    style: { form: 'falsefront', stories: 1, roof: 'tin', trade: 'store', awning: true, chimney: true },
  },
  {
    x: 1330, y: 310, w: 170, h: 150, material: 'wood', label: '마구간',
    style: { form: 'barn', stories: 1, roof: 'shingle', trade: 'livery', awning: false, chimney: false },
  },
  {
    x: 250, y: 760, w: 180, h: 140, material: 'wood',
    style: { form: 'cabin', stories: 1, roof: 'shingle', trade: 'smithy', awning: false, chimney: true },
  },
  {
    x: 560, y: 780, w: 160, h: 130, material: 'wood',
    style: { form: 'falsefront', stories: 1, roof: 'tin', trade: 'shop', awning: false, chimney: true },
  },
  {
    x: 900, y: 760, w: 200, h: 150, material: 'wood',
    style: { form: 'falsefront', stories: 2, roof: 'shingle', trade: 'hotel', awning: false, chimney: true },
  },
  {
    x: 1230, y: 780, w: 160, h: 130, material: 'adobe',
    style: { form: 'flat', stories: 1, roof: 'tar', trade: 'shop', awning: false, chimney: false },
  },
];

type PropDef = [kind: Exclude<ObstacleKind, 'building'>, x: number, y: number, w: number, h: number];

/** 길가와 뒷마당의 소품. 엄폐물이면서 부서지고, 화약통은 터진다. */
const PROPS: PropDef[] = [
  ['trough', 590, 585, 80, 26],
  ['wagon', 1000, 640, 96, 40],
  ['crate', 420, 650, 34, 34],
  ['crate', 1100, 510, 34, 34],
  ['crate', 640, 490, 30, 30],
  ['crate', 1290, 560, 34, 34],
  ['barrel', 540, 494, 22, 22],
  ['barrel', 1280, 494, 22, 22],
  ['barrel', 270, 500, 22, 22],
  ['barrel', 460, 690, 22, 22],
  ['powder', 880, 486, 20, 20],
  ['powder', 1400, 600, 20, 20],
  ['powder', 500, 740, 20, 20],
  ['powder', 770, 960, 20, 20],
  // 마구간 앞의 건초 더미
  ['hay', 1510, 480, 34, 24],
  ['hay', 1530, 512, 34, 24],
  // 뒷마당의 뒷간
  ['outhouse', 300, 950, 24, 24],
  ['outhouse', 980, 960, 24, 24],
  ['outhouse', 1300, 960, 24, 24],
  // 우물, 풍차와 물탱크
  ['well', 120, 620, 30, 22],
  ['windmill', 80, 150, 34, 34],
  // 메스키트 나무
  ['tree', 600, 180, 12, 12],
  ['tree', 1010, 150, 12, 12],
  ['tree', 180, 960, 12, 12],
  ['tree', 1130, 1050, 12, 12],
];

/** 길을 막지 않는 시설물: 전신주, 말 매는 가로대, 묘지의 나무 묘비, 장작더미. */
const DECOR: Decor[] = [
  ...[40, 560, 990, 1290, 1570].map((x): Decor => ({ kind: 'pole', x, y: 506, size: 0 })),
  { kind: 'rail', x: 330, y: 506, size: 70 },
  { kind: 'rail', x: 1090, y: 504, size: 70 },
  { kind: 'rail', x: 1350, y: 500, size: 60 },
  { kind: 'woodpile', x: 470, y: 920, size: 1 },
  { kind: 'woodpile', x: 760, y: 925, size: 1 },
  ...[0, 1, 2, 3, 4, 5, 6].map((i): Decor => ({
    kind: 'grave', x: 1440 + (i % 4) * 34, y: 1040 + Math.floor(i / 4) * 46, size: i % 3,
  })),
];

/** 금고가 놓이는 자리. 뒤쪽 작전일수록 더 많이 열린다. */
const SAFES: { x: number; y: number; value: number; fromJob: number }[] = [
  { x: 800, y: 492, value: 40, fromJob: 0 },
  { x: 1160, y: 492, value: 25, fromJob: 0 },
  { x: 400, y: 504, value: 30, fromJob: 1 },
  { x: 1440, y: 660, value: 40, fromJob: 2 },
];

const BAG_SPOTS: Vec[] = [
  { x: 560, y: 380 }, { x: 720, y: 530 }, { x: 980, y: 380 }, { x: 1290, y: 250 },
  { x: 200, y: 580 }, { x: 760, y: 700 }, { x: 1180, y: 720 }, { x: 480, y: 850 },
  { x: 800, y: 870 }, { x: 1160, y: 870 }, { x: 1560, y: 600 }, { x: 860, y: 190 },
  { x: 220, y: 260 }, { x: 1380, y: 990 },
];

export const HORSE: Vec = { x: 110, y: 1090 };
export const PLAYER_START: Vec = { x: 150, y: 1050 };

export function makeObstacle(
  id: number, kind: ObstacleKind, x: number, y: number, w: number, h: number,
  extra: Partial<Pick<Rect, 'material' | 'label' | 'style'>> = {},
): Rect {
  const kit = kind === 'building'
    ? { material: 'wood' as Material, hp: Infinity, tall: STORY * (extra.style?.stories ?? 1) + (extra.style?.trade === 'bank' ? 18 : 0) }
    : PROP_KIT[kind];
  return {
    id, x, y, w, h, kind, material: extra.material ?? kit.material, hp: kit.hp, maxHp: kit.hp,
    tall: kit.tall, marks: [], label: extra.label, style: extra.style,
  };
}

export function buildMap(job: number, state: { rng: number }): {
  obstacles: Rect[];
  bushes: Bush[];
  decor: Decor[];
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

  // 들판의 식생. 소노라 사막 저지대에 실제로 함께 자라는 것들이다.
  // 길과 건물, 출발 지점, 돈이 놓인 자리, 묘지는 피한다.
  const blocked = (x: number, y: number, pad: number): boolean =>
    (y > 490 - pad && y < 740 + pad)
    || obstacles.some((o) => x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad - 30 && y < o.y + o.h + pad)
    || Math.hypot(x - PLAYER_START.x, y - PLAYER_START.y) < 150
    || loots.some((l) => Math.hypot(x - l.x, y - l.y) < 50)
    || DECOR.some((d) => Math.hypot(x - d.x, y - d.y) < 40);
  const scatter = (count: number, pad: number, place: (x: number, y: number) => void): void => {
    for (let placed = 0, tries = 0; placed < count && tries < count * 20; tries++) {
      const x = randRange(state, 40, WORLD_W - 40);
      const y = randRange(state, 40, WORLD_H - 40);
      if (blocked(x, y, pad)) continue;
      place(x, y);
      placed += 1;
    }
  };
  scatter(10, 36, (x, y) => obstacles.push(makeObstacle(id++, 'cactus', x - 6, y - 6, 12, 12)));
  scatter(9, 30, (x, y) => obstacles.push(makeObstacle(id++, 'rock', x - 11, y - 7, 22, 14)));
  const bushes: Bush[] = [];
  const plant = (kind: Bush['kind'], count: number): void =>
    scatter(count, 10, (x, y) => bushes.push({ id: id++, kind, x, y, size: 0.8 + rand(state) * 0.5, burnt: false }));
  plant('creosote', 16);
  plant('pear', 10);
  plant('ocotillo', 6);
  plant('grass', 30);

  return { obstacles, bushes, decor: DECOR.map((d) => ({ ...d })), loots };
}
