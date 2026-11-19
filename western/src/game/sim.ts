import { HORSE, JOBS, PLAYER_START, WORLD_H, WORLD_W, buildMap } from './map.ts';
import { rand, randRange } from './rng.ts';
import type { Enemy, EnemyKind, Input, Rect, Stats, Vec, World } from './types.ts';

export const PLAYER_R = 12;
export const ENEMY_R = 13;
export const LOOT_REACH = 46;
export const HORSE_REACH = 54;
export const ESCAPE_TIME = 1;
export const MAX_HEAT = 5;

const PLAYER_BULLET_SPEED = 1100;
const PLAYER_BULLET_LIFE = 0.5;
/** 옆으로 돌 때의 속도 비율. 너무 빠르면 정면으로 쏜 총알이 다 빗나간다. */
const STRAFE_FACTOR = 0.45;
const DASH_TIME = 0.16;
const DASH_SPEED = 640;
const DASH_COOLDOWN = 1.1;
const HURT_INVULN = 0.6;
/** 경보가 울린 뒤 수배 등급이 저절로 1 오르는 데 걸리는 시간(초). */
const HEAT_SECONDS = 14;

const ENEMY: Record<EnemyKind, {
  hp: number; speed: number; range: number; aimTime: number; lockTime: number;
  bulletSpeed: number; damage: number; cooldown: [number, number];
}> = {
  deputy: { hp: 2, speed: 118, range: 230, aimTime: 0.55, lockTime: 0.2, bulletSpeed: 330, damage: 1, cooldown: [1.5, 2.4] },
  rifle: { hp: 3, speed: 92, range: 400, aimTime: 1.05, lockTime: 0.3, bulletSpeed: 700, damage: 2, cooldown: [2.6, 3.4] },
};

export function createWorld(job: number, seed: number, stats: Stats, hp: number): World {
  const state = { rng: seed | 0 };
  const map = buildMap(job, state);
  return {
    rng: state.rng,
    job,
    phase: 'play',
    time: 0,
    player: {
      x: PLAYER_START.x, y: PLAYER_START.y, hp, ammo: stats.maxAmmo, reload: 0, fireCd: 0,
      dashCd: 0, dashTime: 0, dashX: 0, dashY: 0, invuln: 0, aimDir: -Math.PI / 4, hurtFlash: 0,
    },
    stats,
    enemies: [],
    bullets: [],
    loots: map.loots,
    particles: [],
    obstacles: map.obstacles,
    decor: map.decor,
    horse: { ...HORSE },
    heat: 0,
    alarmed: false,
    spawnTimer: 0,
    loot: 0,
    quota: JOBS[job]!.quota,
    escapeProgress: 0,
    shake: 0,
    kills: 0,
    nextId: 1,
  };
}

export const heatLevel = (w: World): number => Math.min(MAX_HEAT, Math.floor(w.heat));
export const quotaMet = (w: World): boolean => w.loot >= w.quota;

// ---------- 도형 계산 ----------

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

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

const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- 효과 ----------

function burst(w: World, x: number, y: number, color: string, count: number, speed: number): void {
  for (let i = 0; i < count; i++) {
    const a = rand(w) * Math.PI * 2;
    const s = speed * (0.3 + rand(w) * 0.7);
    const life = 0.25 + rand(w) * 0.35;
    w.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life,
      size: 2 + rand(w) * 3, color,
    });
  }
}

function raiseAlarm(w: World): void {
  if (w.alarmed) return;
  w.alarmed = true;
  w.heat = Math.max(w.heat, 1);
  spawnEnemy(w, 'deputy');
  spawnEnemy(w, 'deputy');
  w.spawnTimer = 3;
}

function addHeat(w: World, amount: number): void {
  w.heat = Math.min(MAX_HEAT + 0.99, w.heat + amount);
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
  const enemy: Enemy = {
    id: w.nextId++, kind, x: pos!.x, y: pos!.y, hp: ENEMY[kind].hp, aim: 0, aimDir: 0,
    cooldown: randRange(w, 0.6, 1.4), strafe: rand(w) < 0.5 ? 1 : -1, hitFlash: 0,
  };
  w.enemies.push(enemy);
  return enemy;
}

function updateSpawns(w: World, dt: number): void {
  if (!w.alarmed) return;
  addHeat(w, dt / HEAT_SECONDS);
  const level = heatLevel(w);
  w.spawnTimer -= dt;
  if (w.spawnTimer > 0) return;
  w.spawnTimer = Math.max(1.1, 4.2 - 0.6 * level);
  const maxAlive = 2 + 2 * level + w.job;
  const count = level >= 4 ? 2 : 1;
  for (let i = 0; i < count && w.enemies.length < maxAlive; i++) {
    const rifleChance = level >= 2 ? Math.min(0.45, 0.12 * (level - 1)) : 0;
    spawnEnemy(w, rand(w) < rifleChance ? 'rifle' : 'deputy');
  }
}

function updateEnemy(w: World, e: Enemy, dt: number): void {
  const def = ENEMY[e.kind];
  const p = w.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const toPlayer = Math.atan2(dy, dx);
  const sees = hasLineOfSight(w, e, p);
  e.hitFlash = Math.max(0, e.hitFlash - dt);

  if (e.aim > 0) {
    // 발사 직전에는 방향을 고정한다. 그래야 구르기로 피할 수 있다.
    if (e.aim > def.lockTime) e.aimDir = toPlayer;
    e.aim -= dt;
    if (e.aim <= 0) {
      e.aim = 0;
      e.cooldown = randRange(w, def.cooldown[0], def.cooldown[1]);
      w.bullets.push({
        x: e.x + Math.cos(e.aimDir) * (ENEMY_R + 4), y: e.y + Math.sin(e.aimDir) * (ENEMY_R + 4),
        vx: Math.cos(e.aimDir) * def.bulletSpeed, vy: Math.sin(e.aimDir) * def.bulletSpeed,
        life: 1.6, fromPlayer: false, damage: def.damage, pierce: 0, hit: [],
      });
    }
    return;
  }

  e.cooldown -= dt;
  if (e.cooldown <= 0 && sees && d < def.range + 190) {
    e.aim = def.aimTime;
    e.aimDir = toPlayer;
    return;
  }

  // 사거리 밖이면 다가가고, 너무 가까우면 물러나고, 그 사이에서는 옆으로 돈다.
  let mx = 0;
  let my = 0;
  if (!sees || d > def.range + 30) {
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
  collide(w, e, ENEMY_R);
  // 벽에 막혀 거의 못 움직였으면 벽을 따라 옆으로 비켜 간다.
  if (Math.hypot(e.x - before.x, e.y - before.y) < speed * dt * 0.35) {
    e.x += -my * e.strafe * speed * dt;
    e.y += mx * e.strafe * speed * dt;
    collide(w, e, ENEMY_R);
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

// ---------- 플레이어 ----------

function updatePlayer(w: World, input: Input, dt: number): void {
  const p = w.player;
  const s = w.stats;
  p.fireCd = Math.max(0, p.fireCd - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  if (input.aim !== null) p.aimDir = input.aim;

  let mx = clamp(input.moveX, -1, 1);
  let my = clamp(input.moveY, -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }

  if (input.dash && p.dashCd === 0 && p.dashTime === 0) {
    const dirLen = len > 0.1 ? len : 1;
    p.dashX = len > 0.1 ? mx / dirLen : Math.cos(p.aimDir);
    p.dashY = len > 0.1 ? my / dirLen : Math.sin(p.aimDir);
    p.dashTime = DASH_TIME;
    p.dashCd = DASH_COOLDOWN;
    p.invuln = Math.max(p.invuln, DASH_TIME + 0.06);
    burst(w, p.x, p.y, '#c9a565', 6, 90);
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

  // 재장전
  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= 0) {
      p.reload = 0;
      p.ammo = s.maxAmmo;
    }
  } else if ((input.reload && p.ammo < s.maxAmmo) || p.ammo === 0) {
    p.reload = s.reloadTime;
  }

  // 발사
  if (input.fire && p.fireCd === 0 && p.reload === 0 && p.ammo > 0 && p.dashTime === 0) {
    p.ammo -= 1;
    p.fireCd = s.fireInterval;
    const spread = 0.16;
    for (let i = 0; i < s.pellets; i++) {
      const offset = s.pellets === 1 ? 0 : (i / (s.pellets - 1) - 0.5) * 2 * spread;
      const a = p.aimDir + offset;
      w.bullets.push({
        x: p.x + Math.cos(a) * (PLAYER_R + 6), y: p.y + Math.sin(a) * (PLAYER_R + 6),
        vx: Math.cos(a) * PLAYER_BULLET_SPEED, vy: Math.sin(a) * PLAYER_BULLET_SPEED,
        life: PLAYER_BULLET_LIFE, fromPlayer: true, damage: 1, pierce: s.pierce, hit: [],
      });
    }
    w.shake = Math.max(w.shake, 2.5);
    raiseAlarm(w);
  }
}

function hurtPlayer(w: World, damage: number): void {
  const p = w.player;
  if (p.invuln > 0 || w.phase !== 'play') return;
  p.hp -= damage;
  p.invuln = HURT_INVULN;
  p.hurtFlash = 0.35;
  w.shake = Math.max(w.shake, 9);
  burst(w, p.x, p.y, '#b3261e', 10, 160);
  if (p.hp <= 0) {
    p.hp = 0;
    w.phase = 'dead';
  }
}

function updateLoot(w: World, dt: number): void {
  const p = w.player;
  for (const l of w.loots) {
    if (l.taken || dist(l, p) > LOOT_REACH) continue;
    if (l.kind === 'safe') raiseAlarm(w);
    l.progress += dt * w.stats.crackSpeed;
    if (l.progress < l.time) continue;
    l.taken = true;
    w.loot += l.value;
    raiseAlarm(w);
    addHeat(w, l.kind === 'safe' ? 1 : 0.5);
    burst(w, l.x, l.y, '#d99a1c', l.kind === 'safe' ? 22 : 10, 170);
  }

  if (quotaMet(w) && dist(w.horse, p) <= HORSE_REACH) {
    w.escapeProgress += dt;
    if (w.escapeProgress >= ESCAPE_TIME) w.phase = 'escaped';
  } else {
    w.escapeProgress = 0;
  }
}

function updateBullets(w: World, dt: number): void {
  const p = w.player;
  w.bullets = w.bullets.filter((b) => {
    const px = b.x;
    const py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WORLD_W || b.y > WORLD_H) return false;
    if (w.obstacles.some((o) => segmentHitsRect(px, py, b.x, b.y, o))) {
      burst(w, b.x, b.y, '#8a6a3a', 4, 80);
      return false;
    }
    if (b.fromPlayer) {
      for (const e of w.enemies) {
        if (e.hp <= 0 || b.hit.includes(e.id)) continue;
        if (!segmentHitsCircle(px, py, b.x, b.y, e, ENEMY_R + 3)) continue;
        e.hp -= b.damage;
        e.hitFlash = 0.12;
        b.hit.push(e.id);
        burst(w, e.x, e.y, '#f3e3bf', 5, 130);
        if (e.hp <= 0) {
          w.kills += 1;
          w.shake = Math.max(w.shake, 5);
          burst(w, e.x, e.y, '#3d5a80', 14, 190);
        }
        if (b.pierce <= 0) return false;
        b.pierce -= 1;
      }
      return true;
    }
    if (segmentHitsCircle(px, py, b.x, b.y, p, PLAYER_R + 3)) {
      if (p.invuln > 0) return true;
      hurtPlayer(w, b.damage);
      return false;
    }
    return true;
  });
  w.enemies = w.enemies.filter((e) => e.hp > 0);
}

function updateParticles(w: World, dt: number): void {
  w.particles = w.particles.filter((q) => {
    q.life -= dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vx *= 1 - 3.5 * dt;
    q.vy *= 1 - 3.5 * dt;
    return q.life > 0;
  });
  if (w.particles.length > 400) w.particles.splice(0, w.particles.length - 400);
  w.shake = Math.max(0, w.shake - 30 * dt);
}

/** 게임을 dt초만큼 진행한다. 화면과 무관하므로 테스트에서 그대로 돌릴 수 있다. */
export function step(w: World, input: Input, dt: number): void {
  if (w.phase !== 'play') {
    updateParticles(w, dt);
    return;
  }
  w.time += dt;
  updatePlayer(w, input, dt);
  updateLoot(w, dt);
  updateSpawns(w, dt);
  for (const e of w.enemies) updateEnemy(w, e, dt);
  separateEnemies(w);
  updateBullets(w, dt);
  updateParticles(w, dt);
}

export const NO_INPUT: Input = { moveX: 0, moveY: 0, aim: null, fire: false, dash: false, reload: false };
export { ENEMY as ENEMY_DEFS };
