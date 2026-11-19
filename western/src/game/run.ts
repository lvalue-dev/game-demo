import { JOBS } from './map.ts';
import { rand, shuffle } from './rng.ts';
import { createWorld } from './sim.ts';
import type { Stats, World } from './types.ts';

/** 악명이 오를 때 고르거나 상점에서 사는 능력. */
export interface Perk {
  id: string;
  name: string;
  text: string;
  price: number;
  /** 겹쳐 가질 수 있는 최대 횟수. */
  max: number;
  apply: (stats: Stats, heal: (amount: number) => void) => void;
}

export interface ShopOffer {
  id: string;
  sold: boolean;
}

export interface Run {
  rng: number;
  job: number;
  money: number;
  hp: number;
  stats: Stats;
  /** 능력별 보유 횟수. */
  owned: Record<string, number>;
  offers: ShopOffer[];
  freePicks: number;
  lastKept: number;
  xp: number;
  level: number;
}

export const SHOP_OFFERS = 3;
export const PERK_CHOICES = 3;
export const FREE_PICKS = 1;
/** 작전을 마칠 때마다 회복하는 체력. */
export const REST_HEAL = 2;

export const BASE_STATS: Stats = {
  fireInterval: 0.24,
  reloadTime: 1.15,
  maxAmmo: 6,
  speed: 215,
  damage: 1,
  pierce: 0,
  pellets: 1,
  crackSpeed: 1,
  maxHp: 5,
  bombCooldown: 7,
  bombRadius: 95,
  dashCooldown: 1.1,
  magnet: 70,
  lootMult: 1,
};

export const PERKS: Perk[] = [
  { id: 'quickdraw', name: '속사', text: '발사 간격 20% 감소', price: 40, max: 3, apply: (s) => { s.fireInterval *= 0.8; } },
  { id: 'fasthands', name: '빠른 손', text: '재장전 시간 30% 감소', price: 30, max: 2, apply: (s) => { s.reloadTime *= 0.7; } },
  { id: 'cylinder', name: '긴 탄창', text: '장탄수 +2', price: 30, max: 3, apply: (s) => { s.maxAmmo += 2; } },
  { id: 'heavy', name: '대구경 탄', text: '총알 피해 +1', price: 70, max: 1, apply: (s) => { s.damage += 1; } },
  { id: 'pierce', name: '관통탄', text: '총알이 적 1명을 더 뚫는다', price: 45, max: 2, apply: (s) => { s.pierce += 1; } },
  { id: 'shotgun', name: '산탄 개조', text: '한 번에 나가는 총알 +2 (부채꼴)', price: 60, max: 2, apply: (s) => { s.pellets += 2; } },
  { id: 'boots', name: '가벼운 부츠', text: '이동 속도 10% 증가', price: 30, max: 3, apply: (s) => { s.speed *= 1.1; } },
  { id: 'roll', name: '날랜 몸', text: '구르기 대기 시간 30% 감소', price: 30, max: 2, apply: (s) => { s.dashCooldown *= 0.7; } },
  { id: 'vest', name: '가죽 조끼', text: '최대 체력 +1, 체력 1 회복', price: 40, max: 3, apply: (s, heal) => { s.maxHp += 1; heal(1); } },
  { id: 'whiskey', name: '위스키', text: '체력 2 회복', price: 15, max: 99, apply: (_s, heal) => heal(2) },
  { id: 'bigboom', name: '굵은 다이너마이트', text: '폭발 범위 30% 증가', price: 35, max: 2, apply: (s) => { s.bombRadius *= 1.3; } },
  { id: 'fuse', name: '넉넉한 화약', text: '다이너마이트 대기 시간 30% 감소', price: 35, max: 2, apply: (s) => { s.bombCooldown *= 0.7; } },
  { id: 'crowbar', name: '금고털이 솜씨', text: '터는 속도 50% 증가', price: 35, max: 2, apply: (s) => { s.crackSpeed *= 1.5; } },
  { id: 'greed', name: '큰손', text: '돈자루와 금고에서 얻는 돈 20% 증가', price: 40, max: 2, apply: (s) => { s.lootMult += 0.2; } },
  { id: 'magnet', name: '긴 팔', text: '떨어진 돈을 더 멀리서 끌어온다', price: 25, max: 2, apply: (s) => { s.magnet *= 1.8; } },
];

export function perkDef(id: string): Perk {
  const def = PERKS.find((u) => u.id === id);
  if (!def) throw new Error('알 수 없는 능력: ' + id);
  return def;
}

export function newRun(seed: number): Run {
  return {
    rng: seed | 0,
    job: 0,
    money: 0,
    hp: BASE_STATS.maxHp,
    stats: { ...BASE_STATS },
    owned: {},
    offers: [],
    freePicks: 0,
    lastKept: 0,
    xp: 0,
    level: 0,
  };
}

export function startJob(run: Run): World {
  const seed = Math.floor(rand(run) * 0x7fffffff);
  return createWorld(run.job, seed, run.stats, run.hp, { xp: run.xp, level: run.level });
}

export const isLastJob = (run: Run): boolean => run.job >= JOBS.length - 1;

/** 아직 더 가질 수 있는 능력 가운데 무작위로 몇 개를 고른다. */
function rollPerks(run: Run, count: number, needsHeal: boolean): string[] {
  const pool = PERKS.filter((u) => (run.owned[u.id] ?? 0) < u.max)
    .filter((u) => u.id !== 'whiskey' || needsHeal)
    .map((u) => u.id);
  return shuffle(run, pool).slice(0, count);
}

/** 악명이 올랐을 때 보여 줄 선택지. */
export function perkChoices(run: Run, world: World): string[] {
  return rollPerks(run, PERK_CHOICES, world.player.hp < run.stats.maxHp);
}

/** 능력을 얻는다. 작전 중이면 world를 넘겨 체력 회복이 바로 반영되게 한다. */
export function takePerk(run: Run, id: string, world?: World): void {
  const def = perkDef(id);
  run.owned[id] = (run.owned[id] ?? 0) + 1;
  def.apply(run.stats, (amount) => {
    if (world) world.player.hp = Math.min(run.stats.maxHp, world.player.hp + amount);
    else run.hp = Math.min(run.stats.maxHp, run.hp + amount);
  });
}

/** 작전 중 악명 선택 하나를 처리한다. */
export function choosePerk(run: Run, world: World, id: string): void {
  if (world.pendingPerks <= 0) return;
  world.pendingPerks -= 1;
  takePerk(run, id, world);
}

/** 탈출에 성공한 작전을 정산한다. 마지막 작전이었으면 true. */
export function finishJob(run: Run, world: World): boolean {
  const kept = Math.max(0, world.loot - world.quota);
  run.lastKept = kept;
  run.money += kept;
  run.hp = Math.min(run.stats.maxHp, world.player.hp + REST_HEAL);
  run.xp = world.xp;
  run.level = world.level;
  if (isLastJob(run)) return true;
  run.freePicks = FREE_PICKS;
  run.offers = rollPerks(run, SHOP_OFFERS, run.hp < run.stats.maxHp).map((id) => ({ id, sold: false }));
  return false;
}

export function canBuy(run: Run, index: number): boolean {
  const offer = run.offers[index];
  if (!offer || offer.sold) return false;
  return run.freePicks > 0 || run.money >= perkDef(offer.id).price;
}

export function buy(run: Run, index: number): boolean {
  if (!canBuy(run, index)) return false;
  const offer = run.offers[index]!;
  if (run.freePicks > 0) run.freePicks -= 1;
  else run.money -= perkDef(offer.id).price;
  offer.sold = true;
  takePerk(run, offer.id);
  return true;
}

export function nextJob(run: Run): void {
  run.job += 1;
  run.offers = [];
  run.freePicks = 0;
}
