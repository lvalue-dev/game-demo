// 건물 안 1인칭 장면의 규칙. 화면과 무관해서 테스트에서 그대로 돌릴 수 있다.
// 좌표는 미터. x는 오른쪽, y는 위, z는 남쪽(문 쪽)이 +. 바라보는 방향 yaw 0은 북쪽(-z)이다.
import { JOBS } from '../game/map.ts';
import type { GameEvent, Stats } from '../game/types.ts';

export type V3 = [number, number, number];
export type Mat3 = 'wood' | 'brick' | 'plaster' | 'stone' | 'metal' | 'glass' | 'powder';
/** 상자의 쓰임새. 충돌은 모두 같은 상자지만, 화면에서는 쓰임새에 맞는 모양으로 꾸민다. */
export type BlockTag =
  | 'floor' | 'ceiling' | 'wall' | 'column' | 'counter' | 'grille' | 'desk' | 'bench' | 'platform' | 'rail'
  | 'post' | 'vaultdoor' | 'crate' | 'keg' | 'lamp' | 'safe';

/** 실내를 이루는 상자 하나. 바깥의 블록 규칙과 같다. */
export interface Block {
  id: number;
  min: V3;
  max: V3;
  material: Mat3;
  tag: BlockTag;
  /** 부서지지 않으면 Infinity. */
  hp: number;
}

export interface Guard {
  id: number;
  x: number;
  /** 서 있는 바닥의 높이. 2층 난간 위의 경비원은 0이 아니다. */
  y: number;
  z: number;
  homeX: number;
  yaw: number;
  hp: number;
  alerted: boolean;
  /** 조준 중이면 발사까지 남은 시간. */
  aim: number;
  cooldown: number;
  strafe: number;
  dead: boolean;
  hitFlash: number;
}

/** 경비원이 쏜 총알. 눈에 보이게 날아와서 옆으로 피할 수 있다. */
export interface Shot {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
}

export interface Bag {
  x: number; y: number; z: number;
  value: number;
  taken: boolean;
}

export type Event3 =
  | { type: 'impact'; pos: V3; normal: V3; material: Mat3 }
  | { type: 'blood'; pos: V3 }
  | { type: 'boom'; pos: V3; radius: number }
  | { type: 'remove'; id: number }
  | { type: 'muzzle' }
  | { type: 'sound'; name: GameEvent };

export interface Interior {
  rng: number;
  time: number;
  blocks: Block[];
  guards: Guard[];
  shots: Shot[];
  bags: Bag[];
  player: {
    x: number; z: number; yaw: number; pitch: number;
    /** 지금 움직이는 속도(m/s). 가속과 감속이 있어 걸음이 매끄럽다. */
    vx: number; vz: number;
    hp: number; ammo: number; reload: number; fireCd: number; invuln: number; hurtFlash: number;
  };
  stats: Stats;
  safe: { id: number; x: number; y: number; z: number; value: number; time: number; progress: number; taken: boolean };
  loot: number;
  xp: number;
  kills: number;
  /** 총소리가 났거나 들켰는가. 밖으로 나가면 경보가 울린다. */
  alerted: boolean;
  done: 'exit' | 'dead' | null;
  events: Event3[];
}

export interface Input3 {
  /** 오른쪽 +1, 앞 +1. */
  moveX: number;
  moveZ: number;
  /** 이번 프레임에 돌린 각도(라디안). 오른쪽과 위가 +. */
  lookX: number;
  lookY: number;
  fire: boolean;
  reload: boolean;
  /** 조준점 가까이의 적에게 총알을 살짝 끌어 준다. 엄지 조준용. */
  assist: boolean;
}

export const NO_INPUT3: Input3 = { moveX: 0, moveZ: 0, lookX: 0, lookY: 0, fire: false, reload: false, assist: false };

export const EYE = 1.62;
/** 은행 홀의 크기. 가로 22m, 세로 18m, 높이 6.5m. */
export const ROOM = { halfW: 11, halfD: 9, height: 6.5, door: 1.0, mezzanine: 3.3 };
const PLAYER_R = 0.35;
const WALK_SPEED = 4.2;
const MAX_PITCH = 1.25;
const SHOT_SPEED = 20;
const KEG_RADIUS = 3.2;

/** 경비원의 맞는 부위. 발밑을 기준으로 한 상자다. */
const PARTS: { name: 'head' | 'torso' | 'legs'; half: number; y0: number; y1: number }[] = [
  { name: 'head', half: 0.17, y0: 1.45, y1: 1.78 },
  { name: 'torso', half: 0.3, y0: 0.8, y1: 1.45 },
  { name: 'legs', half: 0.24, y0: 0, y1: 0.8 },
];

function rand(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 바라보는 방향의 단위 벡터. */
export function forward(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** 은행 내부를 짓는다. 넓은 로비, 창구, 뒤쪽 금고실, 2층 난간이 있는 높은 홀이다. */
export function createBank(job: number, stats: Stats, hp: number, ammo: number, seed: number): Interior {
  let id = 1;
  const blocks: Block[] = [];
  const add = (min: V3, max: V3, material: Mat3, tag: BlockTag, blockHp = Infinity): Block => {
    const b: Block = { id: id++, min, max, material, tag, hp: blockHp };
    blocks.push(b);
    return b;
  };
  const { halfW: W, halfD: D, height: H, door, mezzanine: M } = ROOM;
  add([-W, -0.1, -D], [W, 0, D + 0.3], 'stone', 'floor');
  add([-W, H, -D], [W, H + 0.1, D + 0.3], 'wood', 'ceiling');
  // 회벽. 남쪽 벽 가운데에 문이 있다.
  add([-W - 0.3, 0, -D - 0.3], [W + 0.3, H, -D], 'plaster', 'wall');
  add([-W - 0.3, 0, -D - 0.3], [-W, H, D + 0.3], 'plaster', 'wall');
  add([W, 0, -D - 0.3], [W + 0.3, H, D + 0.3], 'plaster', 'wall');
  add([-W - 0.3, 0, D], [-door, H, D + 0.3], 'plaster', 'wall');
  add([door, 0, D], [W + 0.3, H, D + 0.3], 'plaster', 'wall');
  add([-door, 2.6, D], [door, H, D + 0.3], 'plaster', 'wall');

  // 로비의 기둥 네 개. 몸을 숨기기 좋다.
  for (const [x, z] of [[-5.5, 4.5], [5.5, 4.5], [-5.5, 0.6], [5.5, 0.6]] as const) {
    add([x - 0.32, 0, z - 0.32], [x + 0.32, H, z + 0.32], 'stone', 'column');
  }
  // 손님이 서류를 쓰는 높은 책상과 벽가의 긴 의자
  add([-3.4, 0, 3.2], [-1.8, 1.1, 4.0], 'wood', 'desk');
  add([1.8, 0, 3.2], [3.4, 1.1, 4.0], 'wood', 'desk');
  add([-10.7, 0, 2.0], [-10.1, 0.5, 6.5], 'wood', 'bench');
  add([10.1, 0, 2.0], [10.7, 0.5, 6.5], 'wood', 'bench');
  add([-8.6, 0, 6.2], [-7.5, 1.0, 7.3], 'wood', 'crate', 4);
  add([7.4, 0, 1.8], [8.5, 1.0, 2.9], 'wood', 'crate', 4);
  add([7.6, 1.0, 2.0], [8.3, 1.7, 2.7], 'wood', 'crate', 4);

  // 창구: 홀을 가로지르는 긴 계산대와 그 위의 놋쇠 창살. 오른쪽에 드나드는 틈이 있다.
  add([-W, 0, -2.2], [3.2, 1.1, -1.4], 'wood', 'counter');
  add([4.6, 0, -2.2], [W, 1.1, -1.4], 'wood', 'counter');
  for (const x of [-9.5, -8, -6.5, -5, -3.5, -2, -0.5, 1, 2.5, 5.5, 7, 8.5, 10]) {
    add([x - 0.04, 1.1, -1.84], [x + 0.04, 2.3, -1.76], 'metal', 'grille');
  }
  add([-W, 2.3, -1.86], [3.2, 2.4, -1.74], 'metal', 'grille');
  add([4.6, 2.3, -1.86], [W, 2.4, -1.74], 'metal', 'grille');
  // 창구 뒤 행원들의 책상
  add([-7.2, 0, -5.6], [-5.4, 0.8, -4.6], 'wood', 'desk');
  add([-1.2, 0, -5.6], [0.6, 0.8, -4.6], 'wood', 'desk');

  // 금고실: 뒤쪽 오른편의 벽돌 방과 열려 있는 철문
  add([4.9, 0, -D], [5.1, H, -4.6], 'brick', 'wall');
  add([5.1, 0, -4.6], [6.6, H, -4.4], 'brick', 'wall');
  add([8.2, 0, -4.6], [W, H, -4.4], 'brick', 'wall');
  add([6.6, 2.5, -4.6], [8.2, H, -4.4], 'brick', 'wall');
  add([8.2, 0, -4.4], [8.38, 2.5, -2.9], 'metal', 'vaultdoor');
  const safe = add([8.9, 0, -8.4], [10.0, 1.5, -7.4], 'metal', 'safe');

  // 2층 난간: 북쪽 벽을 따라 놓인 발판과 난간대, 그것을 받치는 기둥
  add([-W, M - 0.18, -D], [4.9, M, -6.6], 'wood', 'platform');
  add([-W, M + 0.95, -6.66], [4.9, M + 1.03, -6.58], 'wood', 'rail');
  for (const x of [-7.5, -3.5, 0.5, 4.5]) add([x - 0.12, 0, -6.8], [x + 0.12, M - 0.18, -6.56], 'wood', 'post');

  // 발파 화약통. 하나는 창구 뒤 책상 위에 있어 로비에서 계산대 너머로 보이고, 하나는 창구 틈 안쪽 바닥에 있다.
  add([-0.6, 0.8, -5.4], [0.0, 1.55, -4.8], 'powder', 'keg', 1);
  add([3.6, 0, -3.7], [4.2, 0.75, -3.1], 'powder', 'keg', 1);
  // 천장에 매단 샹들리에
  add([-4.4, 4.6, 3.6], [-3.6, 5.0, 4.4], 'glass', 'lamp', 1);
  add([3.6, 4.6, 3.6], [4.4, 5.0, 4.4], 'glass', 'lamp', 1);
  add([-0.4, 4.6, -3.9], [0.4, 5.0, -3.1], 'glass', 'lamp', 1);

  const guards: Guard[] = [];
  const guard = (x: number, y: number, z: number): void => {
    guards.push({
      id: id++, x, y, z, homeX: x, yaw: Math.PI, hp: 2 + (job >= 2 ? 1 : 0), alerted: false, aim: 0,
      cooldown: 0.6 + guards.length * 0.35, strafe: guards.length % 2 ? 1 : -1, dead: false, hitFlash: 0,
    });
  };
  // 경비원은 창구 뒤와 2층에 떨어져 서 있다. 문에서 11m 이상이다.
  guard(-5.75, 0, -3.6);
  guard(6.2, 0, -3.5);
  guard(-3.0, M, -7.8);
  if (job >= 1) guard(7.4, 0, -5.8);
  if (job >= 2) guard(2.4, M, -7.8);

  const mult = JOBS[job]!.lootMult * stats.lootMult;
  return {
    rng: seed | 0,
    time: 0,
    blocks,
    guards,
    shots: [],
    bags: [
      { x: -4.2, y: 1.1, z: -1.8, value: Math.round(10 * mult), taken: false },
      { x: 6.3, y: 1.1, z: -1.8, value: Math.round(10 * mult), taken: false },
    ],
    player: { x: 0, z: D - 1, yaw: 0, pitch: 0, vx: 0, vz: 0, hp, ammo, reload: 0, fireCd: 0, invuln: 0, hurtFlash: 0 },
    stats,
    safe: { id: safe.id, x: 9.45, y: 0.75, z: -7.9, value: Math.round(40 * mult), time: 2.6, progress: 0, taken: false },
    loot: 0,
    xp: 0,
    kills: 0,
    alerted: false,
    done: null,
    events: [],
  };
}

// ---------- 광선 판정 ----------

/** 광선이 상자에 닿는 거리와 맞은 면의 방향. 닿지 않으면 null. */
export function rayBox(o: V3, d: V3, min: V3, max: V3): { t: number; normal: V3 } | null {
  let tNear = 0;
  let tFar = Infinity;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) {
      if (o[i]! < min[i]! || o[i]! > max[i]!) return null;
      continue;
    }
    let t1 = (min[i]! - o[i]!) / d[i]!;
    let t2 = (max[i]! - o[i]!) / d[i]!;
    let s = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tNear) {
      tNear = t1;
      axis = i;
      sign = s;
    }
    tFar = Math.min(tFar, t2);
    if (tNear > tFar) return null;
  }
  if (axis < 0) return null; // 상자 안에서 출발한 광선은 무시한다.
  const normal: V3 = [0, 0, 0];
  normal[axis] = sign;
  return { t: tNear, normal };
}

export interface Hit {
  t: number;
  pos: V3;
  normal: V3;
  block?: Block;
  guard?: Guard;
  part?: 'head' | 'torso' | 'legs';
}

/** 광선이 처음 닿는 것을 찾는다. 벽과 가구, 살아 있는 경비원의 부위를 모두 본다. */
export function raycast(s: Interior, o: V3, d: V3, maxT = 60, withGuards = true): Hit | null {
  let best: Hit | null = null;
  const consider = (hit: { t: number; normal: V3 } | null, extra: Partial<Hit>): void => {
    if (!hit || hit.t > maxT || (best && hit.t >= best.t)) return;
    best = { t: hit.t, normal: hit.normal, pos: [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t], ...extra };
  };
  for (const b of s.blocks) consider(rayBox(o, d, b.min, b.max), { block: b });
  if (withGuards) {
    for (const g of s.guards) {
      if (g.dead) continue;
      for (const p of PARTS) {
        consider(
          rayBox(o, d, [g.x - p.half, g.y + p.y0, g.z - p.half], [g.x + p.half, g.y + p.y1, g.z + p.half]),
          { guard: g, part: p.name },
        );
      }
    }
  }
  return best;
}

const eyeOf = (s: Interior): V3 => [s.player.x, EYE, s.player.z];

function canSee(s: Interior, from: V3, to: V3): boolean {
  const d: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return !raycast(s, from, [d[0] / len, d[1] / len, d[2] / len], len - 0.05, false);
}

// ---------- 사건 ----------

const sound = (s: Interior, name: GameEvent): void => {
  s.events.push({ type: 'sound', name });
};

function alertAll(s: Interior): void {
  s.alerted = true;
  for (const g of s.guards) g.alerted = true;
}

function hurtPlayer(s: Interior, damage: number): void {
  const p = s.player;
  if (p.invuln > 0 || s.done) return;
  p.hp -= damage;
  p.invuln = 0.5;
  p.hurtFlash = 0.35;
  if (p.hp <= 0) {
    p.hp = 0;
    s.done = 'dead';
    sound(s, 'dead');
  } else {
    sound(s, 'hurt');
  }
}

function hitGuard(s: Interior, g: Guard, damage: number, pos: V3): void {
  if (g.dead) return;
  g.hp -= damage;
  g.hitFlash = 0.12;
  s.events.push({ type: 'blood', pos });
  alertAll(s);
  if (g.hp > 0) {
    sound(s, 'hit');
    return;
  }
  g.dead = true;
  s.kills += 1;
  s.xp += 2;
  sound(s, 'kill');
}

const centerOf = (b: Block): V3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

function removeBlock(s: Interior, b: Block): void {
  const i = s.blocks.indexOf(b);
  if (i < 0) return;
  s.blocks.splice(i, 1);
  s.events.push({ type: 'remove', id: b.id });
}

/** 화약통이 터진다. 가까운 사람은 누구든 다치고, 상자는 부서지고, 옆의 통도 따라 터진다. */
function explode(s: Interior, at: V3): void {
  s.events.push({ type: 'boom', pos: at, radius: KEG_RADIUS });
  sound(s, 'boom');
  alertAll(s);
  for (const g of s.guards) {
    if (Math.hypot(g.x - at[0], g.y + 1 - at[1], g.z - at[2]) <= KEG_RADIUS) hitGuard(s, g, 3, [g.x, g.y + 1.1, g.z]);
  }
  if (Math.hypot(s.player.x - at[0], s.player.z - at[2]) <= KEG_RADIUS * 0.8) hurtPlayer(s, 2);
  for (const b of [...s.blocks]) {
    if (b.tag !== 'crate' && b.tag !== 'keg' && b.tag !== 'lamp') continue;
    const c = centerOf(b);
    if (Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]) > KEG_RADIUS) continue;
    damageBlock(s, b, 99, c, [0, 1, 0]);
  }
}

/** 총알이나 폭발이 상자에 닿았다. 재질에 맞는 조각이 튀고, 부서지는 것은 부서진다. */
function damageBlock(s: Interior, b: Block, damage: number, pos: V3, normal: V3): void {
  s.events.push({ type: 'impact', pos, normal, material: b.material });
  const stony = b.material === 'brick' || b.material === 'plaster' || b.material === 'stone';
  sound(s, b.material === 'wood' ? 'hitWood' : stony ? 'hitStone' : b.material === 'powder' ? 'hit' : 'hitMetal');
  if (!Number.isFinite(b.hp)) return;
  b.hp -= damage;
  if (b.hp > 0) return;
  removeBlock(s, b);
  if (b.tag === 'keg') explode(s, centerOf(b));
  else sound(s, 'break');
}

// ---------- 진행 ----------

function movePlayer(s: Interior, input: Input3, dt: number): void {
  const p = s.player;
  p.yaw -= input.lookX;
  p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch + input.lookY));
  let mx = Math.max(-1, Math.min(1, input.moveX));
  let mz = Math.max(-1, Math.min(1, input.moveZ));
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const speed = WALK_SPEED * (s.stats.speed / 215);
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // 앞은 (-sin, -cos), 오른쪽은 (cos, -sin). 원하는 속도까지 서서히 붙고 서서히 멎는다.
  const wantX = (-sin * mz + cos * mx) * speed;
  const wantZ = (-cos * mz - sin * mx) * speed;
  const grip = 1 - Math.exp(-(len > 0.05 ? 11 : 14) * dt);
  p.vx += (wantX - p.vx) * grip;
  p.vz += (wantZ - p.vz) * grip;
  const fromX = p.x;
  const fromZ = p.z;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  for (const b of s.blocks) {
    if (b.tag === 'floor' || b.tag === 'ceiling' || b.max[1] < 0.2 || b.min[1] > 1.7) continue;
    const cx = Math.max(b.min[0], Math.min(b.max[0], p.x));
    const cz = Math.max(b.min[2], Math.min(b.max[2], p.z));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= PLAYER_R || d < 1e-6) continue;
    p.x = cx + (dx / d) * PLAYER_R;
    p.z = cz + (dz / d) * PLAYER_R;
  }
  // 벽에 막힌 만큼은 속도도 잃는다.
  if (dt > 0) {
    p.vx = (p.x - fromX) / dt;
    p.vz = (p.z - fromZ) / dt;
  }
}

/** 조준점 가까이에 보이는 적이 있으면 그 부위를 향하도록 총알 방향을 살짝 고친다. */
function assisted(s: Interior, dir: V3): V3 {
  const eye = eyeOf(s);
  let best = dir;
  let bestDot = Math.cos(0.07);
  for (const g of s.guards) {
    if (g.dead) continue;
    for (const y of [1.6, 1.15]) {
      const to: V3 = [g.x - eye[0], g.y + y - eye[1], g.z - eye[2]];
      const len = Math.hypot(to[0], to[1], to[2]) || 1;
      const unit: V3 = [to[0] / len, to[1] / len, to[2] / len];
      const dot = unit[0] * dir[0] + unit[1] * dir[1] + unit[2] * dir[2];
      if (dot > bestDot && canSee(s, eye, [g.x, g.y + y, g.z])) {
        bestDot = dot;
        best = unit;
      }
    }
  }
  return best;
}

function shoot(s: Interior, input: Input3): void {
  const p = s.player;
  p.ammo -= 1;
  p.fireCd = s.stats.fireInterval;
  s.events.push({ type: 'muzzle' });
  sound(s, 'shot');
  alertAll(s);
  let dir = forward(p.yaw, p.pitch);
  if (input.assist) dir = assisted(s, dir);
  const hit = raycast(s, eyeOf(s), dir);
  if (!hit) return;
  if (hit.guard) {
    // 머리는 두 배로 아프다.
    hitGuard(s, hit.guard, s.stats.damage * (hit.part === 'head' ? 2 : 1), hit.pos);
  } else if (hit.block) {
    damageBlock(s, hit.block, s.stats.damage, hit.pos, hit.normal);
  }
}

function updateGuards(s: Interior, dt: number): void {
  const eye = eyeOf(s);
  for (const g of s.guards) {
    if (g.dead) continue;
    g.hitFlash = Math.max(0, g.hitFlash - dt);
    const head: V3 = [g.x, g.y + 1.6, g.z];
    const sees = canSee(s, head, eye);
    if (!g.alerted) {
      // 가까이 다가가기 전에는 알아채지 못한다. 그 전에 자리를 잡을 수 있다.
      if (sees && Math.hypot(g.x - eye[0], g.z - eye[2]) < 8.5) alertAll(s);
      continue;
    }
    // 고개를 홱 돌리지 않고 부드럽게 돌아본다.
    const want = Math.atan2(-(eye[0] - g.x), -(eye[2] - g.z));
    const turn = Math.atan2(Math.sin(want - g.yaw), Math.cos(want - g.yaw));
    g.yaw += turn * (1 - Math.exp(-7 * dt));
    if (g.aim > 0) {
      g.aim -= dt;
      if (g.aim > 0) continue;
      g.aim = 0;
      g.cooldown = 1.3 + rand(s) * 0.9;
      // 가슴 높이를 겨냥해 눈에 보이는 총알을 쏜다.
      const from: V3 = [g.x, g.y + 1.35, g.z];
      const to: V3 = [eye[0] + (rand(s) - 0.5) * 0.5, 1.15 + (rand(s) - 0.5) * 0.4, eye[2] + (rand(s) - 0.5) * 0.5];
      const d: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      s.shots.push({
        x: from[0], y: from[1], z: from[2],
        vx: (d[0] / len) * SHOT_SPEED, vy: (d[1] / len) * SHOT_SPEED, vz: (d[2] / len) * SHOT_SPEED, life: 2,
      });
      sound(s, 'enemyShot');
      continue;
    }
    g.cooldown -= dt;
    if (g.cooldown <= 0 && sees) {
      g.aim = 0.55;
      continue;
    }
    // 제자리 근처에서 좌우로 움직여 맞히기 어렵게 한다.
    g.x += g.strafe * 1.1 * dt;
    if (Math.abs(g.x - g.homeX) > 0.9) {
      g.x = g.homeX + Math.sign(g.x - g.homeX) * 0.9;
      g.strafe *= -1;
    }
  }
}

function updateShots(s: Interior, dt: number): void {
  const p = s.player;
  s.shots = s.shots.filter((b) => {
    const from: V3 = [b.x, b.y, b.z];
    const step = SHOT_SPEED * dt;
    const dir: V3 = [b.vx / SHOT_SPEED, b.vy / SHOT_SPEED, b.vz / SHOT_SPEED];
    const wall = raycast(s, from, dir, step, false);
    if (wall?.block) {
      damageBlock(s, wall.block, 1, wall.pos, wall.normal);
      return false;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.life -= dt;
    if (b.life <= 0) return false;
    if (Math.hypot(b.x - p.x, b.z - p.z) < 0.42 && b.y > 0.2 && b.y < 1.85) {
      hurtPlayer(s, 1);
      return false;
    }
    return true;
  });
}

function updateLoot(s: Interior, dt: number): void {
  const p = s.player;
  for (const bag of s.bags) {
    if (bag.taken || Math.hypot(bag.x - p.x, bag.z - p.z) > 1.5) continue;
    bag.taken = true;
    s.loot += bag.value;
    s.xp += 1;
    sound(s, 'loot');
  }
  const safe = s.safe;
  if (safe.taken) return;
  const to: V3 = [safe.x - p.x, safe.y - EYE, safe.z - p.z];
  const dist = Math.hypot(to[0], to[2]);
  const f = forward(p.yaw, p.pitch);
  const len = Math.hypot(to[0], to[1], to[2]) || 1;
  const facing = (to[0] * f[0] + to[1] * f[1] + to[2] * f[2]) / len;
  // 금고 앞에 서서 금고를 바라보고 있어야 턴다.
  if (dist > 1.9 || facing < 0.75) return;
  safe.progress += dt * s.stats.crackSpeed;
  if (safe.progress < safe.time) return;
  safe.taken = true;
  s.loot += safe.value;
  s.xp += 4;
  alertAll(s);
  sound(s, 'safe');
}

/** 실내 장면을 dt초만큼 진행한다. */
export function stepInterior(s: Interior, input: Input3, dt: number): void {
  if (s.done) return;
  const p = s.player;
  s.time += dt;
  p.fireCd = Math.max(0, p.fireCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  movePlayer(s, input, dt);

  if (p.reload > 0) {
    p.reload -= dt;
    if (p.reload <= 0) {
      p.reload = 0;
      p.ammo = s.stats.maxAmmo;
    }
  } else if ((input.reload && p.ammo < s.stats.maxAmmo) || p.ammo === 0) {
    p.reload = s.stats.reloadTime;
    sound(s, 'reload');
  }
  if (input.fire && p.fireCd === 0 && p.reload === 0 && p.ammo > 0) shoot(s, input);

  updateGuards(s, dt);
  updateShots(s, dt);
  updateLoot(s, dt);
  // 문턱을 넘으면 밖으로 나간다.
  if (!s.done && p.z > ROOM.halfD + 0.1) s.done = 'exit';
}
