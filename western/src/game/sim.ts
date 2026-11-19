import { HORSE, JOBS, PLAYER_START, WORLD_H, WORLD_W, buildMap } from './map.ts';
import { rand, randRange } from './rng.ts';
import type {
  Bomb, Bush, Decal, Enemy, EnemyKind, GameEvent, Input, Loot, Mark, ParticleShape, Rect, Stats, Vec, World,
} from './types.ts';

export const PLAYER_R = 12;
export const ENEMY_R = 13;
export const LOOT_REACH = 46;
export const HORSE_REACH = 54;
export const ESCAPE_TIME = 1;
export const MAX_HEAT = 5;
export const BOMB_MAX_THROW = 320;
export const DOOR_REACH = 24;
export const ENTER_TIME = 0.7;

const PLAYER_BULLET_SPEED = 1100;
const PLAYER_BULLET_LIFE = 0.5;
const PLAYER_BOMB_DAMAGE = 4;
/** 옆으로 돌 때의 속도 비율. 너무 빠르면 정면으로 쏜 총알이 다 빗나간다. */
const STRAFE_FACTOR = 0.45;
const DASH_TIME = 0.16;
const DASH_SPEED = 640;
const HURT_INVULN = 0.6;
/** 경보가 울린 뒤 수배 등급이 저절로 1 오르는 데 걸리는 시간(초). */
const HEAT_SECONDS = 12;
const COIN_VALUE = 2;
const WHISKEY_CHANCE = 0.08;

interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  range: number;
  aimTime: number;
  /** 발사 직전 방향을 고정하는 시간. 이 틈에 방향을 틀면 피할 수 있다. */
  lockTime: number;
  bulletSpeed: number;
  bulletLife: number;
  damage: number;
  cooldown: [number, number];
  /** 플레이어의 움직임을 얼마나 앞질러 쏘는가. 1이면 등속 이동을 정확히 맞힌다. */
  lead: number;
  pellets: number;
  burst: number;
  xp: number;
  coins: number;
  radius: number;
}

const ENEMY: Record<EnemyKind, EnemyDef> = {
  deputy: {
    name: '보안관보', hp: 2, speed: 125, range: 220, aimTime: 0.42, lockTime: 0.14, bulletSpeed: 470,
    bulletLife: 1.4, damage: 1, cooldown: [1.1, 1.8], lead: 0.85, pellets: 1, burst: 1, xp: 2, coins: 1, radius: ENEMY_R,
  },
  shotgun: {
    name: '산탄총잡이', hp: 3, speed: 168, range: 105, aimTime: 0.34, lockTime: 0.12, bulletSpeed: 430,
    bulletLife: 0.42, damage: 1, cooldown: [1.3, 1.9], lead: 0.7, pellets: 3, burst: 1, xp: 3, coins: 2, radius: ENEMY_R,
  },
  rifle: {
    name: '소총수', hp: 3, speed: 95, range: 420, aimTime: 0.95, lockTime: 0.22, bulletSpeed: 950,
    bulletLife: 1.1, damage: 2, cooldown: [2.4, 3.2], lead: 0.95, pellets: 1, burst: 1, xp: 3, coins: 2, radius: ENEMY_R,
  },
  bomber: {
    name: '폭파꾼', hp: 2, speed: 110, range: 290, aimTime: 0, lockTime: 0, bulletSpeed: 0,
    bulletLife: 0, damage: 2, cooldown: [3, 4], lead: 0.6, pellets: 0, burst: 0, xp: 3, coins: 2, radius: ENEMY_R,
  },
  sheriff: {
    name: '보안관', hp: 14, speed: 108, range: 250, aimTime: 0.5, lockTime: 0.12, bulletSpeed: 520,
    bulletLife: 1.4, damage: 1, cooldown: [1.5, 2], lead: 0.9, pellets: 1, burst: 3, xp: 15, coins: 8, radius: 17,
  },
};

export const xpForLevel = (level: number): number => 6 + level * 5;

export function createWorld(
  job: number, seed: number, stats: Stats, hp: number, progress: { xp: number; level: number } = { xp: 0, level: 0 },
): World {
  const state = { rng: seed | 0 };
  const map = buildMap(job, state);
  return {
    rng: state.rng,
    job,
    phase: 'play',
    time: 0,
    player: {
      x: PLAYER_START.x, y: PLAYER_START.y, vx: 0, vy: 0, hp, ammo: stats.maxAmmo, reload: 0, fireCd: 0,
      bombCd: 0, dashCd: 0, dashTime: 0, dashX: 0, dashY: 0, invuln: 0, aimDir: -Math.PI / 4,
      hurtFlash: 0, muzzle: 0, dust: 0,
    },
    stats,
    enemies: [],
    bullets: [],
    bombs: [],
    pickups: [],
    loots: map.loots,
    corpses: [],
    blasts: [],
    texts: [],
    particles: [],
    obstacles: map.obstacles,
    bushes: map.bushes,
    decor: map.decor,
    decals: [],
    fires: [],
    horse: { ...HORSE },
    heat: 0,
    alarmed: false,
    spawnTimer: 0,
    sheriffSpawned: false,
    loot: 0,
    quota: JOBS[job]!.quota,
    xp: progress.xp,
    level: progress.level,
    pendingPerks: 0,
    escapeProgress: 0,
    enterProgress: 0,
    bankVisited: false,
    shake: 0,
    hitStop: 0,
    kills: 0,
    nextId: 1,
    events: [],
  };
}

export const heatLevel = (w: World): number => Math.min(MAX_HEAT, Math.floor(w.heat));
export const quotaMet = (w: World): boolean => w.loot >= w.quota;

// ---------- 도형 계산 ----------

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 원이 사각형과 겹치면 밖으로 밀어낸다. */
function pushOut(p: Vec, r: number, rect: Rect): boolean {
  const cx = clamp(p.x, rect.x, rect.x + rect.w);
  const cy = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.y = cy + (dy / d) * r;
    return true;
  }
  // 중심이 사각형 안에 있으면 가장 가까운 변으로 내보낸다.
  const left = p.x - rect.x;
  const right = rect.x + rect.w - p.x;
  const top = p.y - rect.y;
  const bottom = rect.y + rect.h - p.y;
  const min = Math.min(left, right, top, bottom);
  if (min === left) p.x = rect.x - r;
  else if (min === right) p.x = rect.x + rect.w + r;
  else if (min === top) p.y = rect.y - r;
  else p.y = rect.y + rect.h + r;
  return true;
}

function collide(w: World, p: Vec, r: number): void {
  for (const o of w.obstacles) pushOut(p, r, o);
  p.x = clamp(p.x, r, WORLD_W - r);
  p.y = clamp(p.y, r, WORLD_H - r);
}

/** 선분이 사각형을 지나는지(Liang–Barsky). */
export function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: [number, number][] = [
    [-dx, x1 - rect.x], [dx, rect.x + rect.w - x1],
    [-dy, y1 - rect.y], [dy, rect.y + rect.h - y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

export function hasLineOfSight(w: World, a: Vec, b: Vec): boolean {
  return !w.obstacles.some((o) => segmentHitsRect(a.x, a.y, b.x, b.y, o));
}

function segmentHitsCircle(x1: number, y1: number, x2: number, y2: number, c: Vec, r: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((c.x - x1) * dx + (c.y - y1) * dy) / len2, 0, 1);
  const px = x1 + dx * t - c.x;
  const py = y1 + dy * t - c.y;
  return px * px + py * py <= r * r;
}

// ---------- 효과 ----------

const emit = (w: World, event: GameEvent): void => {
  w.events.push(event);
};

function burst(
  w: World, x: number, y: number, color: string, count: number, speed: number, size = 3,
  shape: ParticleShape = 'dot',
): void {
  for (let i = 0; i < count; i++) {
    const a = rand(w) * Math.PI * 2;
    const s = speed * (0.3 + rand(w) * 0.7);
    const life = 0.25 + rand(w) * 0.4;
    w.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life,
      size: size * (0.6 + rand(w) * 0.9), color, shape, rot: rand(w) * Math.PI * 2, spin: (rand(w) - 0.5) * 16,
    });
  }
}

function addDecal(w: World, x: number, y: number, kind: Decal['kind'], size: number): void {
  w.decals.push({ x, y, kind, size, rot: rand(w) * Math.PI * 2 });
  if (w.decals.length > 160) w.decals.shift();
}

function floatText(w: World, x: number, y: number, text: string, color: string): void {
  w.texts.push({ x, y, text, life: 1.1, maxLife: 1.1, color });
}

export function raiseAlarm(w: World): void {
  if (w.alarmed) return;
  w.alarmed = true;
  w.heat = Math.max(w.heat, 1);
  spawnEnemy(w, 'deputy');
  spawnEnemy(w, 'deputy');
  if (w.job > 0) spawnEnemy(w, 'shotgun');
  w.spawnTimer = 2.5;
  emit(w, 'alarm');
}

function addHeat(w: World, amount: number): void {
  w.heat = Math.min(MAX_HEAT + 0.99, w.heat + amount);
}

function addXp(w: World, amount: number): void {
  w.xp += amount;
  while (w.xp >= xpForLevel(w.level)) {
    w.xp -= xpForLevel(w.level);
    w.level += 1;
    w.pendingPerks += 1;
    emit(w, 'levelup');
  }
}

/** 은행 문 앞의 자리. 여기 서 있으면 안으로 들어간다. */
export function bankDoor(w: World): Vec | null {
  const bank = w.obstacles.find((o) => o.kind === 'building' && o.style?.trade === 'bank');
  return bank ? { x: bank.x + bank.w / 2, y: bank.y + bank.h + 14 } : null;
}

/** 건물 안에서 있었던 일을 바깥 세상에 반영하고 문 앞으로 돌아온다. */
export function leaveBuilding(
  w: World, result: { loot: number; hp: number; ammo: number; xp: number; kills: number; alerted: boolean; seconds: number },
): void {
  w.phase = result.hp > 0 ? 'play' : 'dead';
  w.bankVisited = true;
  w.enterProgress = 0;
  w.loot += result.loot;
  w.kills += result.kills;
  w.player.hp = Math.max(0, result.hp);
  w.player.ammo = result.ammo;
  w.player.invuln = 1;
  const door = bankDoor(w);
  if (door) {
    w.player.x = door.x;
    w.player.y = door.y + 22;
    w.player.aimDir = Math.PI / 2;
  }
  addXp(w, result.xp);
  if (result.hp <= 0) emit(w, 'dead');
  if (!result.alerted) return;
  // 안에서 총소리가 났으면 그동안 밖에는 추격대가 모였다.
  raiseAlarm(w);
  addHeat(w, result.seconds / HEAT_SECONDS + (result.loot > 0 ? 1 : 0));
  w.spawnTimer = 0;
}

function takeLoot(w: World, l: Loot): void {
  if (l.taken) return;
  l.taken = true;
  const gain = Math.round(l.value * w.stats.lootMult);
  w.loot += gain;
  raiseAlarm(w);
  addHeat(w, l.kind === 'safe' ? 1 : 0.5);
  addXp(w, l.kind === 'safe' ? 4 : 1);
  burst(w, l.x, l.y, '#d99a1c', l.kind === 'safe' ? 24 : 10, 180);
  floatText(w, l.x, l.y - 18, '+$' + gain, '#a86a00');
  emit(w, l.kind === 'safe' ? 'safe' : 'loot');
}

// ---------- 재질 반응 ----------
// 총알과 폭발이 무엇에 닿았느냐에 따라 튀는 것, 남는 흔적, 벌어지는 일이 달라진다.

function nearestOnRect(o: Rect, p: Vec): Vec {
  return { x: clamp(p.x, o.x, o.x + o.w), y: clamp(p.y, o.y, o.y + o.h) };
}

const centerOf = (o: Rect): Vec => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });

function addMark(w: World, o: Rect, at: Vec, kind: Mark['kind'], size: number): void {
  o.marks.push({ dx: at.x - o.x, dy: at.y - o.y, u: rand(w), kind, size });
  if (o.marks.length > 14) o.marks.shift();
}

/** 재질별로 튀는 조각. */
function spray(w: World, o: Rect, at: Vec, amount: number): void {
  switch (o.material) {
    case 'wood':
      burst(w, at.x, at.y, '#c79a66', 5 * amount, 170, 6, 'shard');
      emit(w, 'hitWood');
      break;
    case 'adobe':
      burst(w, at.x, at.y, '#d9b58a', 4 * amount, 130, 4, 'chunk');
      burst(w, at.x, at.y, '#e6cfa6', 3 * amount, 60, 7, 'smoke');
      emit(w, 'hitStone');
      break;
    case 'brick':
      burst(w, at.x, at.y, '#b4614a', 4 * amount, 140, 4, 'chunk');
      burst(w, at.x, at.y, '#c98a76', 3 * amount, 60, 7, 'smoke');
      emit(w, 'hitStone');
      break;
    case 'stone':
      burst(w, at.x, at.y, '#a39c90', 3 * amount, 150, 3.5, 'chunk');
      burst(w, at.x, at.y, '#fff1b8', 3 * amount, 240, 2, 'spark');
      emit(w, 'hitStone');
      break;
    case 'metal':
      burst(w, at.x, at.y, '#fff1b8', 6 * amount, 280, 2, 'spark');
      emit(w, 'hitMetal');
      break;
    case 'plant':
      burst(w, at.x, at.y, '#6a9a55', 5 * amount, 140, 5, 'leaf');
      emit(w, 'hitPlant');
      break;
    case 'powder':
      burst(w, at.x, at.y, '#fff1b8', 6 * amount, 260, 2, 'spark');
      break;
  }
}

/** 총알이 물체에 맞았다. */
function hitObstacle(w: World, o: Rect, at: Vec, damage: number): void {
  spray(w, o, at, 1);
  if (o.kind === 'trough') {
    burst(w, at.x, at.y, '#8cc4d4', 6, 150, 4, 'drop');
    emit(w, 'splash');
  }
  addMark(w, o, at, 'hole', 2.5);
  if (!Number.isFinite(o.hp)) return;
  o.hp -= damage;
  if (o.hp <= 0) destroyObstacle(w, o);
}

/** 내구도가 다한 물체를 없애고, 종류에 맞는 뒷일을 일으킨다. */
function destroyObstacle(w: World, o: Rect): void {
  const index = w.obstacles.indexOf(o);
  if (index < 0) return;
  w.obstacles.splice(index, 1);
  const c = centerOf(o);
  switch (o.kind) {
    case 'powder':
      // 화약통은 주인 없는 폭발을 일으킨다. 곁에 있으면 누구든 다치고, 옆의 통도 따라 터진다.
      w.bombs.push({
        sx: c.x, sy: c.y, tx: c.x, ty: c.y, elapsed: 0, flight: 0, fuse: 0.12, radius: 92, damage: 3, owner: 'neutral',
      });
      break;
    case 'trough':
      burst(w, c.x, c.y, '#8cc4d4', 34, 260, 5, 'drop');
      burst(w, c.x, c.y, '#c79a66', 12, 190, 7, 'shard');
      addDecal(w, c.x, c.y, 'puddle', 62);
      // 쏟아진 물이 근처의 불을 끈다.
      w.fires = w.fires.filter((f) => dist(f, c) > 95);
      emit(w, 'splash');
      emit(w, 'break');
      break;
    case 'hay':
      // 건초는 흩어지며 불이 붙는다.
      burst(w, c.x, c.y, '#dcbc5c', 22, 200, 7, 'shard');
      ignite(w, c.x, c.y, 24, 4);
      emit(w, 'break');
      break;
    case 'cactus':
      burst(w, c.x, c.y, '#6a9a55', 16, 190, 6, 'leaf');
      burst(w, c.x, c.y, '#48733e', 6, 150, 5, 'chunk');
      addDecal(w, c.x, c.y, 'stump', 9);
      emit(w, 'hitPlant');
      break;
    default:
      burst(w, c.x, c.y, '#c79a66', o.kind === 'wagon' ? 30 : 16, 230, 8, 'shard');
      burst(w, c.x, c.y, '#7a5230', 8, 150, 5, 'chunk');
      addDecal(w, c.x, c.y, 'debris', Math.max(o.w, o.h) * 0.6);
      // 상자 안에는 가끔 돈이 들어 있다.
      if (o.kind === 'crate' && rand(w) < 0.5) {
        dropPickup(w, c, 'coin');
        dropPickup(w, c, 'coin');
      }
      emit(w, 'break');
  }
}

/** 불을 붙인다. 이미 타고 있는 자리면 불을 되살리기만 한다. */
function ignite(w: World, x: number, y: number, r: number, life: number, lift = 0): void {
  const existing = w.fires.find((f) => Math.hypot(f.x - x, f.y - y) < 18);
  if (existing) {
    existing.life = Math.max(existing.life, life);
    return;
  }
  w.fires.push({ x, y, r, life, maxLife: life, tick: 0.35, lift });
  if (w.fires.length > 24) w.fires.shift();
  emit(w, 'burn');
}

function burnBush(w: World, b: Bush): void {
  if (b.burnt) return;
  b.burnt = true;
  burst(w, b.x, b.y, '#6a9a55', 8, 150, 5, 'leaf');
  ignite(w, b.x, b.y, 20, 2.6);
}

function updateFires(w: World, dt: number): void {
  const p = w.player;
  // 불이 덤불로 옮겨붙으면 새 불이 생기므로, 목록을 비워 두고 돌면서 다시 채운다.
  const burning = w.fires;
  w.fires = [];
  const kept = burning.filter((f) => {
    f.life -= dt;
    if (f.life <= 0) {
      if (f.lift === 0) addDecal(w, f.x, f.y, 'ash', f.r);
      return false;
    }
    // 불꽃과 연기
    if (rand(w) < dt * 26) {
      const a = rand(w) * Math.PI * 2;
      const d = rand(w) * f.r * 0.8;
      w.particles.push({
        x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d * 0.6 - f.lift, vx: (rand(w) - 0.5) * 20, vy: -50 - rand(w) * 50,
        life: 0.45, maxLife: 0.45, size: 7 + rand(w) * 6, color: rand(w) < 0.5 ? '#e8742a' : '#f6c453',
        shape: 'flame', rot: 0, spin: 0,
      });
    }
    if (rand(w) < dt * 7) {
      w.particles.push({
        x: f.x + (rand(w) - 0.5) * f.r, y: f.y - f.lift - 8, vx: (rand(w) - 0.5) * 16, vy: -36 - rand(w) * 24,
        life: 1.1, maxLife: 1.1, size: 9 + rand(w) * 8, color: '#3a2f2a', shape: 'smoke', rot: 0, spin: 0,
      });
    }
    f.tick -= dt;
    if (f.tick > 0) return true;
    f.tick = 0.5;
    // 불에 닿은 사람은 누구든 덴다.
    for (const e of w.enemies) {
      if (dist(e, f) <= f.r + ENEMY_R) damageEnemy(w, e, 1, rand(w) * Math.PI * 2, 0, true);
    }
    if (dist(p, f) <= f.r + PLAYER_R) hurtPlayer(w, 1);
    // 가까운 덤불로 옮겨붙는다.
    for (const b of w.bushes) {
      if (!b.burnt && dist(b, f) <= f.r + 30 && rand(w) < 0.4) burnBush(w, b);
    }
    return true;
  });
  w.fires = [...kept, ...w.fires];
  w.enemies = w.enemies.filter((e) => e.hp > 0);
}

// ---------- 적 ----------

export function spawnEnemy(w: World, kind: EnemyKind, at?: Vec): Enemy {
  let pos = at;
  for (let tries = 0; !pos && tries < 12; tries++) {
    const side = Math.floor(rand(w) * 4);
    const candidate =
      side === 0 ? { x: randRange(w, 40, WORLD_W - 40), y: 20 }
      : side === 1 ? { x: randRange(w, 40, WORLD_W - 40), y: WORLD_H - 20 }
      : side === 2 ? { x: 20, y: randRange(w, 40, WORLD_H - 40) }
      : { x: WORLD_W - 20, y: randRange(w, 40, WORLD_H - 40) };
    if (dist(candidate, w.player) > 460 || tries === 11) pos = candidate;
  }
  const def = ENEMY[kind];
  const hp = kind === 'sheriff' ? def.hp + 4 * w.job : def.hp;
  const enemy: Enemy = {
    id: w.nextId++, kind, x: pos!.x, y: pos!.y, vx: 0, vy: 0, hp, maxHp: hp, aim: 0, aimDir: 0,
    cooldown: randRange(w, 0.5, 1.2), burst: 0, strafe: rand(w) < 0.5 ? 1 : -1, facing: 0,
    hitFlash: 0, muzzle: 0,
  };
  w.enemies.push(enemy);
  return enemy;
}

/** 수배 등급과 작전 순서에 따라 어떤 적이 올지 고른다. */
function pickKind(w: World): EnemyKind {
  const tier = heatLevel(w) + w.job;
  const roll = rand(w);
  if (tier >= 3 && roll < 0.16) return 'rifle';
  if (tier >= 3 && roll < 0.34) return 'bomber';
  if (tier >= 2 && roll < (tier >= 3 ? 0.62 : 0.3)) return 'shotgun';
  return 'deputy';
}

function updateSpawns(w: World, dt: number): void {
  if (!w.alarmed) return;
  addHeat(w, dt / HEAT_SECONDS);
  const level = heatLevel(w);

  // 수배가 높아지면 보안관이 직접 나선다. 작전마다 한 번.
  if (!w.sheriffSpawned && level >= (w.job >= 2 ? 3 : 4)) {
    w.sheriffSpawned = true;
    spawnEnemy(w, 'sheriff');
    emit(w, 'sheriff');
  }

  w.spawnTimer -= dt;
  if (w.spawnTimer > 0) return;
  w.spawnTimer = Math.max(0.8, 3.4 - 0.5 * level - 0.2 * w.job);
  const maxAlive = 3 + 2 * level + 2 * w.job;
  const count = level >= 3 ? 2 : 1;
  for (let i = 0; i < count && w.enemies.length < maxAlive; i++) spawnEnemy(w, pickKind(w));
}

/** 플레이어가 지금 속도로 계속 간다고 보고, 총알이 닿을 무렵의 위치를 겨눈다. */
function leadAngle(w: World, e: Enemy, def: EnemyDef): number {
  const p = w.player;
  const d = dist(e, p);
  const t = (def.lockTime + d / def.bulletSpeed) * (def.lead + (rand(w) - 0.5) * 0.4);
  return Math.atan2(p.y + p.vy * t - e.y, p.x + p.vx * t - e.x);
}

function fireEnemy(w: World, e: Enemy, def: EnemyDef): void {
  const spread = 0.24;
  for (let i = 0; i < def.pellets; i++) {
    const offset = def.pellets === 1 ? 0 : (i / (def.pellets - 1) - 0.5) * 2 * spread;
    const a = e.aimDir + offset;
    w.bullets.push({
      x: e.x + Math.cos(a) * (def.radius + 4), y: e.y + Math.sin(a) * (def.radius + 4),
      vx: Math.cos(a) * def.bulletSpeed, vy: Math.sin(a) * def.bulletSpeed,
      life: def.bulletLife, fromPlayer: false, damage: def.damage, pierce: 0, hit: [],
    });
  }
  e.muzzle = 0.07;
  emit(w, 'enemyShot');
}

function throwEnemyBomb(w: World, e: Enemy, def: EnemyDef): void {
  const p = w.player;
  const lead = 0.75 * def.lead;
  w.bombs.push({
    sx: e.x, sy: e.y, tx: p.x + p.vx * lead, ty: p.y + p.vy * lead,
    elapsed: 0, flight: 0.75, fuse: 0.55, radius: 72, damage: def.damage, owner: 'enemy',
  });
  e.cooldown = randRange(w, def.cooldown[0], def.cooldown[1]);
  emit(w, 'throw');
}

function updateEnemy(w: World, e: Enemy, dt: number): void {
  const def = ENEMY[e.kind];
  const p = w.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const sees = hasLineOfSight(w, e, p);
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  e.muzzle = Math.max(0, e.muzzle - dt);
  e.facing = Math.atan2(dy, dx);

  // 총에 맞아 밀려나는 움직임
  if (e.vx !== 0 || e.vy !== 0) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    const damp = Math.max(0, 1 - 9 * dt);
    e.vx *= damp;
    e.vy *= damp;
    if (Math.abs(e.vx) + Math.abs(e.vy) < 4) e.vx = e.vy = 0;
    collide(w, e, def.radius);
  }

  if (e.aim > 0) {
    // 발사 직전에는 방향을 고정한다. 그래야 방향을 틀거나 굴러서 피할 수 있다.
    if (e.aim > def.lockTime) e.aimDir = leadAngle(w, e, def);
    e.aim -= dt;
    if (e.aim <= 0) {
      fireEnemy(w, e, def);
      e.burst -= 1;
      if (e.burst > 0) {
        e.aim = 0.16;
        e.aimDir = leadAngle(w, e, def);
      } else {
        e.aim = 0;
        e.cooldown = randRange(w, def.cooldown[0], def.cooldown[1]);
      }
    }
    return;
  }

  e.cooldown -= dt;
  if (e.cooldown <= 0) {
    if (e.kind === 'bomber') {
      // 다이너마이트는 건물 너머로도 던진다. 엄폐물 뒤에 숨은 상대를 몰아내는 역할이다.
      if (d < 400) throwEnemyBomb(w, e, def);
    } else if (sees && d < def.range + 190) {
      e.aim = def.aimTime;
      e.burst = def.burst;
      e.aimDir = leadAngle(w, e, def);
      return;
    }
  }

  // 사거리 밖이면 다가가고, 너무 가까우면 물러나고, 그 사이에서는 옆으로 돈다.
  let mx = 0;
  let my = 0;
  const needsSight = e.kind !== 'bomber';
  if ((needsSight && !sees) || d > def.range + 30) {
    mx = dx / d;
    my = dy / d;
  } else if (d < def.range - 60) {
    mx = -dx / d;
    my = -dy / d;
  } else {
    mx = (-dy / d) * e.strafe * STRAFE_FACTOR;
    my = (dx / d) * e.strafe * STRAFE_FACTOR;
    if (rand(w) < dt * 0.4) e.strafe *= -1;
  }
  const speed = def.speed * (1 + 0.06 * w.job);
  const before = { x: e.x, y: e.y };
  e.x += mx * speed * dt;
  e.y += my * speed * dt;
  collide(w, e, def.radius);
  // 벽에 막혀 거의 못 움직였으면 벽을 따라 옆으로 비켜 간다.
  if (Math.hypot(e.x - before.x, e.y - before.y) < speed * dt * 0.35) {
    e.x += -my * e.strafe * speed * dt;
    e.y += mx * e.strafe * speed * dt;
    collide(w, e, def.radius);
  }
}

function separateEnemies(w: World): void {
  for (let i = 0; i < w.enemies.length; i++) {
    for (let j = i + 1; j < w.enemies.length; j++) {
      const a = w.enemies[i]!;
      const b = w.enemies[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= ENEMY_R * 2 || d === 0) continue;
      const push = (ENEMY_R * 2 - d) / 2;
      a.x -= (dx / d) * push;
      a.y -= (dy / d) * push;
      b.x += (dx / d) * push;
      b.y += (dy / d) * push;
    }
  }
}

function damageEnemy(w: World, e: Enemy, damage: number, dir: number, force: number, charred = false): void {
  if (e.hp <= 0) return;
  e.hp -= damage;
  e.hitFlash = 0.12;
  e.vx += Math.cos(dir) * force;
  e.vy += Math.sin(dir) * force;
  burst(w, e.x, e.y, '#f3e3bf', 5, 140);
  if (e.hp > 0) {
    emit(w, 'hit');
    return;
  }
  killEnemy(w, e, dir, charred);
}

function killEnemy(w: World, e: Enemy, dir: number, charred: boolean): void {
  const def = ENEMY[e.kind];
  w.kills += 1;
  w.shake = Math.max(w.shake, e.kind === 'sheriff' ? 14 : 5);
  w.hitStop = Math.max(w.hitStop, e.kind === 'sheriff' ? 0.14 : 0.045);
  burst(w, e.x, e.y, '#8c1d16', 12, 200);
  w.corpses.push({ x: e.x, y: e.y, dir, kind: e.kind, charred });
  addDecal(w, e.x, e.y, 'blood', 18);
  if (w.corpses.length > 60) w.corpses.shift();
  addXp(w, def.xp);
  for (let i = 0; i < def.coins; i++) dropPickup(w, e, 'coin');
  if (e.kind === 'sheriff' || rand(w) < WHISKEY_CHANCE) dropPickup(w, e, 'whiskey');
  emit(w, 'kill');
}

function dropPickup(w: World, at: Vec, kind: 'coin' | 'whiskey'): void {
  const a = rand(w) * Math.PI * 2;
  const s = randRange(w, 60, 170);
  w.pickups.push({
    id: w.nextId++, x: at.x, y: at.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind,
    value: kind === 'coin' ? Math.round(COIN_VALUE * JOBS[w.job]!.lootMult) : 1, life: 14,
  });
}

// ---------- 플레이어 ----------

function updatePlayer(w: World, input: Input, dt: number): void {
  const p = w.player;
  const s = w.stats;
  const startX = p.x;
  const startY = p.y;
  p.fireCd = Math.max(0, p.fireCd - dt);
  p.bombCd = Math.max(0, p.bombCd - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  p.muzzle = Math.max(0, p.muzzle - dt);
  if (input.aim !== null) p.aimDir = input.aim;

  let mx = clamp(input.moveX, -1, 1);
  let my = clamp(input.moveY, -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }

  if (input.dash && p.dashCd === 0 && p.dashTime === 0) {
    p.dashX = len > 0.1 ? mx / len : Math.cos(p.aimDir);
    p.dashY = len > 0.1 ? my / len : Math.sin(p.aimDir);
    p.dashTime = DASH_TIME;
    p.dashCd = s.dashCooldown;
    p.invuln = Math.max(p.invuln, DASH_TIME + 0.06);
    burst(w, p.x, p.y, '#c9a565', 8, 110, 4);
    emit(w, 'dash');
  }

  if (p.dashTime > 0) {
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.x += p.dashX * DASH_SPEED * dt;
    p.y += p.dashY * DASH_SPEED * dt;
  } else {
    p.x += mx * s.speed * dt;
    p.y += my * s.speed * dt;
  }
  collide(w, p, PLAYER_R);
  p.vx = (p.x - startX) / dt;
  p.vy = (p.y - startY) / dt;

  // 달릴 때 발밑에서 먼지가 인다.
  if (Math.hypot(p.vx, p.vy) > 80) {
    p.dust -= dt;
    if (p.dust <= 0) {
      p.dust = 0.09;
      w.particles.push({
        x: p.x - p.vx * 0.03, y: p.y - p.vy * 0.03 + 6, vx: (rand(w) - 0.5) * 30, vy: (rand(w) - 0.5) * 30,
        life: 0.4, maxLife: 0.4, size: 5 + rand(w) * 4, color: '#cfae72', shape: 'smoke', rot: 0, spin: 0,
      });
    }
  }

  // 재장전
  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= 0) {
      p.reload = 0;
      p.ammo = s.maxAmmo;
    }
  } else if ((input.reload && p.ammo < s.maxAmmo) || p.ammo === 0) {
    p.reload = s.reloadTime;
    emit(w, 'reload');
  }

  // 발사
  if (input.fire && p.fireCd === 0 && p.reload === 0 && p.ammo > 0 && p.dashTime === 0) {
    p.ammo -= 1;
    p.fireCd = s.fireInterval;
    p.muzzle = 0.06;
    const spread = 0.1 + 0.03 * s.pellets;
    for (let i = 0; i < s.pellets; i++) {
      const offset = s.pellets === 1 ? 0 : (i / (s.pellets - 1) - 0.5) * 2 * spread;
      const a = p.aimDir + offset;
      w.bullets.push({
        x: p.x + Math.cos(a) * (PLAYER_R + 6), y: p.y + Math.sin(a) * (PLAYER_R + 6),
        vx: Math.cos(a) * PLAYER_BULLET_SPEED, vy: Math.sin(a) * PLAYER_BULLET_SPEED,
        life: PLAYER_BULLET_LIFE, fromPlayer: true, damage: s.damage, pierce: s.pierce, hit: [],
      });
    }
    // 탄피
    const side = p.aimDir + Math.PI / 2;
    w.particles.push({
      x: p.x, y: p.y, vx: Math.cos(side) * 90 + (rand(w) - 0.5) * 40, vy: Math.sin(side) * 90 + (rand(w) - 0.5) * 40,
      life: 0.5, maxLife: 0.5, size: 4, color: '#b8862b', shape: 'shard', rot: rand(w) * 6, spin: 20,
    });
    w.shake = Math.max(w.shake, 3);
    emit(w, 'shot');
    raiseAlarm(w);
  }

  // 다이너마이트
  if (input.bomb && p.bombCd === 0 && p.dashTime === 0) {
    const reach = clamp(input.aimDist ?? 210, 70, BOMB_MAX_THROW);
    p.bombCd = s.bombCooldown;
    w.bombs.push({
      sx: p.x, sy: p.y,
      tx: clamp(p.x + Math.cos(p.aimDir) * reach, 10, WORLD_W - 10),
      ty: clamp(p.y + Math.sin(p.aimDir) * reach, 10, WORLD_H - 10),
      elapsed: 0, flight: 0.42, fuse: 0.2, radius: s.bombRadius, damage: PLAYER_BOMB_DAMAGE, owner: 'player',
    });
    emit(w, 'throw');
    raiseAlarm(w);
  }
}

function hurtPlayer(w: World, damage: number): void {
  const p = w.player;
  if (p.invuln > 0 || w.phase !== 'play') return;
  p.hp -= damage;
  p.invuln = HURT_INVULN;
  p.hurtFlash = 0.35;
  w.shake = Math.max(w.shake, 10);
  w.hitStop = Math.max(w.hitStop, 0.07);
  burst(w, p.x, p.y, '#b3261e', 12, 170);
  if (p.hp <= 0) {
    p.hp = 0;
    w.phase = 'dead';
    emit(w, 'dead');
  } else {
    emit(w, 'hurt');
  }
}

function updateLoot(w: World, dt: number): void {
  const p = w.player;
  for (const l of w.loots) {
    if (l.taken || dist(l, p) > LOOT_REACH) continue;
    if (l.kind === 'safe') raiseAlarm(w);
    l.progress += dt * w.stats.crackSpeed;
    if (l.progress >= l.time) takeLoot(w, l);
  }

  // 은행 문 앞에 잠깐 서 있으면 안으로 들어간다.
  const door = w.bankVisited ? null : bankDoor(w);
  if (door && dist(door, p) <= DOOR_REACH) {
    w.enterProgress += dt;
    if (w.enterProgress >= ENTER_TIME) w.phase = 'inside';
  } else {
    w.enterProgress = 0;
  }

  if (quotaMet(w) && dist(w.horse, p) <= HORSE_REACH) {
    w.escapeProgress += dt;
    if (w.escapeProgress >= ESCAPE_TIME) {
      w.phase = 'escaped';
      emit(w, 'escape');
    }
  } else {
    w.escapeProgress = 0;
  }
}

function updatePickups(w: World, dt: number): void {
  const p = w.player;
  w.pickups = w.pickups.filter((k) => {
    k.life -= dt;
    if (k.life <= 0) return false;
    const d = dist(k, p);
    if (d < w.stats.magnet) {
      // 가까이 가면 끌려온다.
      const pull = 520;
      k.vx = ((p.x - k.x) / (d || 1)) * pull;
      k.vy = ((p.y - k.y) / (d || 1)) * pull;
    } else {
      const damp = Math.max(0, 1 - 5 * dt);
      k.vx *= damp;
      k.vy *= damp;
    }
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    if (d > PLAYER_R + 8) return true;
    if (k.kind === 'coin') {
      w.loot += k.value;
      emit(w, 'coin');
    } else {
      if (p.hp < w.stats.maxHp) p.hp += 1;
      floatText(w, p.x, p.y - 24, '체력 +1', '#2f6b45');
      emit(w, 'heal');
    }
    return false;
  });
}

function explode(w: World, b: Bomb): void {
  const at = { x: b.tx, y: b.ty };
  w.blasts.push({ x: at.x, y: at.y, radius: b.radius, life: 0.4, maxLife: 0.4 });
  w.shake = Math.max(w.shake, 16);
  // 모래 바닥: 구덩이가 파이고 흙먼지가 인다.
  addDecal(w, at.x, at.y, 'crater', b.radius * 0.5);
  burst(w, at.x, at.y, '#e8742a', 22, 320, 7, 'flame');
  burst(w, at.x, at.y, '#d9bd86', 18, 240, 12, 'smoke');
  burst(w, at.x, at.y, '#3a2f2a', 10, 150, 14, 'smoke');
  burst(w, at.x, at.y, '#fff1b8', 12, 380, 2, 'spark');
  emit(w, 'boom');

  // 사람: 날아가고 그을린다.
  if (b.owner !== 'enemy') {
    for (const e of w.enemies) {
      if (dist(at, e) > b.radius + ENEMY_R) continue;
      damageEnemy(w, e, b.damage, Math.atan2(e.y - at.y, e.x - at.x), 340, true);
    }
  }
  if (b.owner !== 'player' && dist(at, w.player) <= b.radius + PLAYER_R) hurtPlayer(w, b.damage);

  // 물체: 재질과 종류에 따라 그을리거나, 불이 붙거나, 부서진다.
  for (const o of [...w.obstacles]) {
    const near = nearestOnRect(o, at);
    if (dist(near, at) > b.radius) continue;
    spray(w, o, near, 2);
    if (o.kind === 'building') {
      addMark(w, o, near, 'scorch', 16);
      // 나무 건물은 불이 붙고, 흙벽은 그을리기만 한다.
      if (o.material === 'wood') ignite(w, near.x, near.y, 30, 6, o.tall * 0.5);
    } else if (Number.isFinite(o.hp)) {
      o.hp -= 6;
      if (o.hp <= 0) destroyObstacle(w, o);
      else addMark(w, o, near, 'scorch', 8);
    } else if (o.kind === 'tree') {
      // 나무는 쓰러지지 않지만 잎에 불이 붙는다.
      burst(w, near.x, near.y - 20, '#6a9a55', 10, 160, 5, 'leaf');
      ignite(w, near.x, near.y, 24, 4, 24);
    }
  }
  // 식물: 덤불은 불타 재가 된다.
  for (const bush of w.bushes) {
    if (dist(bush, at) <= b.radius + 8) burnBush(w, bush);
  }
  if (b.owner === 'enemy') return;
  // 폭발에 휘말린 금고와 돈자루는 그 자리에서 열린다. 대신 요란해서 수배가 더 오른다.
  let opened = 0;
  for (const l of w.loots) {
    if (l.taken || dist(at, l) > b.radius + 10) continue;
    takeLoot(w, l);
    opened += 1;
  }
  if (opened > 0) addHeat(w, 0.5);
}

function updateBombs(w: World, dt: number): void {
  // 폭발이 화약통을 터뜨리면 새 폭탄이 생기므로, 목록을 비워 두고 돌면서 다시 채운다.
  const pending = w.bombs;
  w.bombs = [];
  const live: Bomb[] = [];
  for (const b of pending) {
    b.elapsed += dt;
    if (b.elapsed < b.flight + b.fuse) live.push(b);
    else explode(w, b);
  }
  w.bombs = [...live, ...w.bombs];
  w.enemies = w.enemies.filter((e) => e.hp > 0);
}

function updateBullets(w: World, dt: number): void {
  const p = w.player;
  w.bullets = w.bullets.filter((b) => {
    const px = b.x;
    const py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.x < 0 || b.y < 0 || b.x > WORLD_W || b.y > WORLD_H) return false;
    if (b.life <= 0) {
      // 아무것도 못 맞히고 땅에 박히면 모래 먼지가 인다.
      burst(w, b.x, b.y, '#d9bd86', 2, 50, 6, 'smoke');
      return false;
    }
    const struck = w.obstacles.find((o) => segmentHitsRect(px, py, b.x, b.y, o));
    if (struck) {
      hitObstacle(w, struck, nearestOnRect(struck, { x: px, y: py }), b.damage);
      return false;
    }
    // 덤불은 뚫고 지나가며 잎을 날린다.
    for (const bush of w.bushes) {
      if (bush.burnt || b.hit.includes(-bush.id)) continue;
      if (!segmentHitsCircle(px, py, b.x, b.y, bush, 10)) continue;
      b.hit.push(-bush.id);
      burst(w, bush.x, bush.y, '#6a9a55', 4, 120, 5, 'leaf');
      emit(w, 'hitPlant');
    }
    if (b.fromPlayer) {
      for (const e of w.enemies) {
        if (e.hp <= 0 || b.hit.includes(e.id)) continue;
        if (!segmentHitsCircle(px, py, b.x, b.y, e, ENEMY[e.kind].radius + 3)) continue;
        b.hit.push(e.id);
        damageEnemy(w, e, b.damage, Math.atan2(b.vy, b.vx), e.kind === 'sheriff' ? 50 : 150);
        if (b.pierce <= 0) return false;
        b.pierce -= 1;
      }
      return true;
    }
    if (segmentHitsCircle(px, py, b.x, b.y, p, PLAYER_R + 2)) {
      if (p.invuln > 0) return true;
      hurtPlayer(w, b.damage);
      return false;
    }
    return true;
  });
  w.enemies = w.enemies.filter((e) => e.hp > 0);
}

function updateEffects(w: World, dt: number): void {
  w.particles = w.particles.filter((q) => {
    q.life -= dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vx *= 1 - 3.5 * dt;
    q.vy *= 1 - 3.5 * dt;
    return q.life > 0;
  });
  if (w.particles.length > 500) w.particles.splice(0, w.particles.length - 500);
  w.blasts = w.blasts.filter((b) => (b.life -= dt) > 0);
  w.texts = w.texts.filter((t) => {
    t.life -= dt;
    t.y -= 26 * dt;
    return t.life > 0;
  });
  w.shake = Math.max(0, w.shake - 34 * dt);
}

/** 게임을 dt초만큼 진행한다. 화면과 무관하므로 테스트에서 그대로 돌릴 수 있다. */
export function step(w: World, input: Input, dt: number): void {
  if (w.phase !== 'play') {
    updateEffects(w, dt);
    return;
  }
  // 타격 순간의 짧은 멈춤. 연출만 흐르고 게임은 잠깐 선다.
  if (w.hitStop > 0) {
    w.hitStop = Math.max(0, w.hitStop - dt);
    updateEffects(w, dt * 0.3);
    return;
  }
  w.time += dt;
  updatePlayer(w, input, dt);
  updateLoot(w, dt);
  updateSpawns(w, dt);
  for (const e of w.enemies) updateEnemy(w, e, dt);
  separateEnemies(w);
  updateBombs(w, dt);
  updateBullets(w, dt);
  updateFires(w, dt);
  updatePickups(w, dt);
  updateEffects(w, dt);
}

export const NO_INPUT: Input = {
  moveX: 0, moveY: 0, aim: null, aimDist: null, fire: false, dash: false, reload: false, bomb: false,
};
export { ENEMY as ENEMY_DEFS };
export type { EnemyDef };
