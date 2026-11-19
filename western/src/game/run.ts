import { JOBS } from './map.ts';
import { rand, shuffle } from './rng.ts';
import { createWorld } from './sim.ts';
import type { Stats, World } from './types.ts';

export interface Upgrade {
  id: string;
  name: string;
  text: string;
  price: number;
  /** 여러 번 살 수 있는가. */
  repeat?: boolean;
  apply: (run: Run) => void;
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
  owned: string[];
  offers: ShopOffer[];
  freePicks: number;
  lastKept: number;
}

export const SHOP_OFFERS = 3;
export const FREE_PICKS = 1;
/** 작전을 마칠 때마다 회복하는 체력. */
export const REST_HEAL = 2;

export const BASE_STATS: Stats = {
  fireInterval: 0.24,
  reloadTime: 1.15,
  maxAmmo: 6,
  speed: 215,
  pierce: 0,
  pellets: 1,
  crackSpeed: 1,
  maxHp: 5,
};

export const UPGRADES: Upgrade[] = [
  { id: 'quickdraw', name: '속사', text: '발사 간격 25% 감소', price: 40, apply: (r) => { r.stats.fireInterval *= 0.75; } },
  { id: 'fasthands', name: '빠른 손', text: '재장전 시간 35% 감소', price: 30, apply: (r) => { r.stats.reloadTime *= 0.65; } },
  { id: 'cylinder', name: '8연발 탄창', text: '장탄수 +2', price: 30, apply: (r) => { r.stats.maxAmmo += 2; } },
  { id: 'pierce', name: '관통탄', text: '총알이 적 1명을 뚫고 지나간다', price: 45, apply: (r) => { r.stats.pierce += 1; } },
  { id: 'shotgun', name: '산탄 개조', text: '한 번에 총알 3발이 부채꼴로 나간다', price: 60, apply: (r) => { r.stats.pellets = 3; } },
  { id: 'boots', name: '가벼운 부츠', text: '이동 속도 12% 증가', price: 30, apply: (r) => { r.stats.speed *= 1.12; } },
  { id: 'crowbar', name: '금고털이 솜씨', text: '터는 속도 50% 증가', price: 35, apply: (r) => { r.stats.crackSpeed *= 1.5; } },
  { id: 'vest', name: '가죽 조끼', text: '최대 체력 +1, 체력 1 회복', price: 40, apply: (r) => { r.stats.maxHp += 1; r.hp = Math.min(r.stats.maxHp, r.hp + 1); } },
  { id: 'whiskey', name: '위스키', text: '체력 2 회복', price: 15, repeat: true, apply: (r) => { r.hp = Math.min(r.stats.maxHp, r.hp + 2); } },
];

export function upgradeDef(id: string): Upgrade {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) throw new Error(`알 수 없는 업그레이드: ${id}`);
  return def;
}

export function newRun(seed: number): Run {
  return {
    rng: seed | 0,
    job: 0,
    money: 0,
    hp: BASE_STATS.maxHp,
    stats: { ...BASE_STATS },
    owned: [],
    offers: [],
    freePicks: 0,
    lastKept: 0,
  };
}

export function startJob(run: Run): World {
  const seed = Math.floor(rand(run) * 0x7fffffff);
  return createWorld(run.job, seed, run.stats, run.hp);
}

export const isLastJob = (run: Run): boolean => run.job >= JOBS.length - 1;

/** 탈출에 성공한 작전을 정산한다. 마지막 작전이었으면 true. */
export function finishJob(run: Run, world: World): boolean {
  const kept = Math.max(0, world.loot - world.quota);
  run.lastKept = kept;
  run.money += kept;
  run.hp = Math.min(run.stats.maxHp, world.player.hp + REST_HEAL);
  if (isLastJob(run)) return true;
  run.freePicks = FREE_PICKS;
  rollOffers(run);
  return false;
}

function rollOffers(run: Run): void {
  const pool = UPGRADES.filter((u) => u.repeat || !run.owned.includes(u.id)).map((u) => u.id);
  run.offers = shuffle(run, pool).slice(0, SHOP_OFFERS).map((id) => ({ id, sold: false }));
}

export function canBuy(run: Run, index: number): boolean {
  const offer = run.offers[index];
  if (!offer || offer.sold) return false;
  return run.freePicks > 0 || run.money >= upgradeDef(offer.id).price;
}

export function buy(run: Run, index: number): boolean {
  if (!canBuy(run, index)) return false;
  const offer = run.offers[index]!;
  const def = upgradeDef(offer.id);
  if (run.freePicks > 0) run.freePicks -= 1;
  else run.money -= def.price;
  offer.sold = true;
  if (!def.repeat) run.owned.push(def.id);
  def.apply(run);
  return true;
}

export function nextJob(run: Run): void {
  run.job += 1;
  run.offers = [];
  run.freePicks = 0;
}
