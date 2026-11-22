// 실시간으로 보는 경기. 위에서 내려다본 경기장에서 스물두 명이 움직이고, 공을 가진 선수가 틱마다 결정한다.
// 여기에는 화면이 없다. 상태(LiveState)와 한 틱을 진행하는 함수만 있고, 같은 시드면 같은 경기가 나온다.
// 전력 차이(전술 상성, 팀 지시, 개인 역할, 체력 등)는 match.ts의 ratingsNow가 계산해 edge로 넘겨준다.
// 선수들의 위치와 움직임은 전술과 지시를 눈으로 보여 주고, 판정의 확률은 edge가 정한다.
import { tuning } from './live-tuning.ts';
import { rand } from './rng.ts';
import type { Rng } from './rng.ts';
import { SPOTS } from './player.ts';
import type { Dials, Foot, LiveFlight, LiveHow, LivePlayer, LiveState, LiveTeam, Pos, RoleId, ShapeId, Spot, StyleId } from './types.ts';

/** 90분은 1800틱, 1분은 20틱이다. */
export const TICKS = 1800;
export const HALF = 900;
export const PER_MIN = 20;

const W = 105;
const H = 68;
const CY = 34;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------- 대형 ----------

export interface Slot {
  line: Pos;
  /** 자기 골문에서 상대 골문 쪽으로 잰 거리와 좌우 위치. */
  u: number;
  v: number;
  wide: boolean;
  /** 풀백이나 윙백. 오버래핑 지시를 받는다. */
  fb: boolean;
  /** 윙백. 지시가 없어도 공격에 가담한다. */
  wb: boolean;
}

const at = (line: Pos, u: number, v: number, tag: '' | 'w' | 'fb' | 'wb' = ''): Slot => ({ line, u, v, wide: tag !== '', fb: tag === 'fb' || tag === 'wb', wb: tag === 'wb' });

// 자리의 순서가 뜻이 있다. 수비수와 미드필더는 가운데 자리가 먼저, 공격수는 가운데 자리가 마지막이다.
// 선수를 실력순으로 세워 차례대로 앉히면 주전이 가운데에 선다.
export const SLOTS: Record<ShapeId, Slot[]> = {
  '442': [
    at('GK', 5, 34),
    at('DF', 22, 27), at('DF', 22, 41), at('DF', 26, 9, 'fb'), at('DF', 26, 59, 'fb'),
    at('MF', 44, 27), at('MF', 44, 41), at('MF', 48, 9, 'w'), at('MF', 48, 59, 'w'),
    at('FW', 68, 28), at('FW', 68, 40),
  ],
  '433': [
    at('GK', 5, 34),
    at('DF', 22, 27), at('DF', 22, 41), at('DF', 26, 9, 'fb'), at('DF', 26, 59, 'fb'),
    at('MF', 40, 34), at('MF', 49, 23), at('MF', 49, 45),
    at('FW', 68, 10, 'w'), at('FW', 68, 58, 'w'), at('FW', 72, 34),
  ],
  '4231': [
    at('GK', 5, 34),
    at('DF', 22, 27), at('DF', 22, 41), at('DF', 26, 9, 'fb'), at('DF', 26, 59, 'fb'),
    at('MF', 39, 27), at('MF', 39, 41), at('MF', 60, 10, 'w'), at('MF', 60, 58, 'w'), at('MF', 60, 34),
    at('FW', 74, 34),
  ],
  '352': [
    at('GK', 5, 34),
    at('DF', 20, 34), at('DF', 22, 21), at('DF', 22, 47),
    at('MF', 40, 34), at('MF', 46, 24), at('MF', 46, 44), at('MF', 42, 6, 'wb'), at('MF', 42, 62, 'wb'),
    at('FW', 68, 28), at('FW', 68, 40),
  ],
  '541': [
    at('GK', 5, 34),
    at('DF', 19, 34), at('DF', 21, 22), at('DF', 21, 46), at('DF', 26, 7, 'wb'), at('DF', 26, 61, 'wb'),
    at('MF', 46, 27), at('MF', 46, 41), at('MF', 53, 10, 'w'), at('MF', 53, 58, 'w'),
    at('FW', 70, 34),
  ],
};

const RANK: Record<Pos, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

/** 대형의 자리가 어떤 세부 포지션인지. 위쪽(v가 작은 쪽)이 공격 방향에서 왼쪽이다. */
export function slotSpot(s: Slot): Spot {
  if (s.line === 'GK') return 'GK';
  const side = s.v < 20 ? 'L' : s.v > 48 ? 'R' : 'C';
  if (s.line === 'DF') return side === 'L' ? 'LB' : side === 'R' ? 'RB' : 'CB';
  if (s.line === 'MF') return side === 'L' ? 'LM' : side === 'R' ? 'RM' : s.u <= 42 ? 'CDM' : s.u >= 55 ? 'CAM' : 'CM';
  return side === 'L' ? 'LW' : side === 'R' ? 'RW' : 'ST';
}

const DEPTH: Partial<Record<Spot, number>> = { CDM: 0, CM: 1, CAM: 2 };

/** 선수를 그 자리에 세웠을 때의 어색함. 0이면 제자리다. */
function misfit(spot: Spot, slot: Slot): number {
  const want = slotSpot(slot);
  if (spot === want) return 0;
  if ((spot === 'GK') !== (want === 'GK')) return 100;
  const a = SPOTS[spot];
  const b = SPOTS[want];
  return Math.abs(RANK[a.pos] - RANK[b.pos]) * 3 + Math.abs(a.side - b.side) * 1.5 + Math.abs((DEPTH[spot] ?? 1) - (DEPTH[want] ?? 1)) * 0.5 + 0.5;
}

/** 세부 포지션마다 관례적인 등번호. 앞 번호가 차 있으면 다음 번호를 쓴다. */
const SHIRTS: Record<Spot, number[]> = {
  GK: [1], RB: [2, 22], LB: [3, 23], CB: [4, 5, 15], CDM: [6, 16], CM: [8, 14, 18], CAM: [10, 20],
  RM: [7, 17], LM: [11, 21], RW: [7, 17], LW: [11, 21], ST: [9, 19, 10],
};

function shirt(spot: Spot, used: Set<number>): number {
  let n = SHIRTS[spot].find((x) => !used.has(x)) ?? 12;
  while (used.has(n)) n++;
  used.add(n);
  return n;
}

export interface Entrant {
  name: string;
  pos: Pos;
  ovr: number;
  /** 주전 선수면 그 선수의 id, 아니면 -1. */
  key: number;
  spot: Spot;
  foot: Foot;
  dev: number[];
  /** 정해진 등번호가 있으면 그 번호를 쓴다. */
  no?: number;
  pid?: number;
  nat?: string;
}

/** 선수들을 자리에 앉힌다. 주전부터, 잘하는 선수부터 자기 포지션에 가장 가까운 빈자리를 고른다. */
function seat<T extends { spot: Spot; ovr: number; key: number }>(list: T[], slots: Slot[], free: number[]): Map<number, T> {
  const out = new Map<number, T>();
  const order = [...list].sort((a, b) => (b.key >= 0 ? 1 : 0) - (a.key >= 0 ? 1 : 0) || b.ovr - a.ovr);
  const open = [...free];
  for (const e of order) {
    if (open.length === 0) break;
    let best = 0;
    for (let k = 1; k < open.length; k++) {
      if (misfit(e.spot, slots[open[k] as number] as Slot) < misfit(e.spot, slots[open[best] as number] as Slot)) best = k;
    }
    out.set(open[best] as number, e);
    open.splice(best, 1);
  }
  return out;
}

/** 주전 선수들을 세우고, 남은 자리는 그 자리에 맞는 후보로 채운다. 배열 순서가 곧 자리 순서다. */
export function lineup(shape: ShapeId, keys: Entrant[], filler: (pos: Pos, spot: Spot) => Entrant): LivePlayer[] {
  const slots = SLOTS[shape];
  const seated = seat(keys.slice(0, 11), slots, slots.map((_, i) => i));
  const entrants = slots.map((slot, i) => seated.get(i) ?? filler(slot.line, slotSpot(slot)));
  // 정해진 등번호를 먼저 찜하고, 나머지는 관례 번호를 준다.
  const used = new Set<number>(entrants.map((e) => e.no ?? 0).filter((n) => n > 0));
  return slots.map((slot, i) => {
    const e = entrants[i] as Entrant;
    return {
      n: e.no && e.no > 0 ? e.no : shirt(e.key >= 0 ? e.spot : slotSpot(slot), used), name: e.name, line: e.pos, slot: i, key: e.key, ovr: e.ovr,
      x: 0, y: 0, px: 0, py: 0, off: false, spot: e.spot, foot: e.foot, dev: e.dev,
      ...(e.pid !== undefined ? { pid: e.pid } : {}), ...(e.nat ? { nat: e.nat } : {}), on: 0,
    };
  });
}

/** 대형을 바꾼다. 선수는 그대로 두고 자리만 다시 나눈다. 열 명이면 공격 쪽 자리 하나를 비운다. */
export function reshape(team: LiveTeam, shape: ShapeId): void {
  const slots = SLOTS[shape];
  const on = team.players.filter((p) => !p.off);
  const free = slots.map((_, i) => i);
  while (on.length < free.length) {
    const forwards = free.filter((i) => (slots[i] as Slot).line === 'FW');
    const drop = forwards.length >= 2 ? (forwards[0] as number) : (free.filter((i) => (slots[i] as Slot).line === 'MF').pop() as number);
    free.splice(free.indexOf(drop), 1);
  }
  for (const [slot, p] of seat(on, slots, free)) p.slot = slot;
}

/** 킥오프를 하는 선수: 가장 앞에 선 선수. */
function striker(team: LiveTeam, shape: ShapeId): number {
  let best = 0;
  let u = -1;
  team.players.forEach((p, i) => {
    const s = (SLOTS[shape] as Slot[])[p.slot] as Slot;
    if (!p.off && s.u > u) {
      u = s.u;
      best = i;
    }
  });
  return best;
}

/** 선수의 능력치 개인차에 팀 안에서의 OVR 차이를 더한 값. 0이 팀 평균이다. k는 능력치 순서. */
function skill(team: LiveTeam, i: number, k: number): number {
  let sum = 0;
  let n = 0;
  for (const p of team.players) {
    if (p.off) continue;
    sum += p.ovr;
    n++;
  }
  const p = team.players[i] as LivePlayer;
  return (p.dev?.[k] ?? 0) + (p.ovr - sum / Math.max(1, n)) * 0.8;
}

// ---------- 경기 환경 ----------

export interface LiveSide {
  style: StyleId;
  shape: ShapeId;
  push: -1 | 0 | 1;
  red: boolean;
  /** 체력이 바닥나 발이 느려졌는지. */
  tired: boolean;
  dials: Dials;
  /** 선수 번호(배열 위치)별 개인 역할. 없으면 기본 역할이다. */
  roles: Record<number, RoleId>;
  /** 공격 우위: 이 팀의 공격력에서 상대 수비력을 뺀 값. */
  edge: number;
  /** 구장에 따른 기대 득점 배수(홈 1.15, 원정 0.88쯤). */
  venue: number;
}

export interface LiveEnv {
  sides: [LiveSide, LiveSide];
}

export type LiveEvent =
  | { kind: 'goal'; team: 0 | 1; by: number; how: LiveHow }
  | { kind: 'shot'; team: 0 | 1; by: number; result: 'save' | 'corner' | 'off'; xg: number }
  | { kind: 'foul'; team: 0 | 1; by: number; victim: number; pen: boolean }
  | { kind: 'offside'; team: 0 | 1; by: number }
  | { kind: 'steal'; team: 0 | 1; by: number }
  | { kind: 'corner'; team: 0 | 1 }
  | { kind: 'red'; team: 0 | 1; by: number }
  | { kind: 'half' }
  | { kind: 'full' };

// 전력 차이가 판정에 들어가는 세기. 합쳐서 "전력 1점에 기대 득점 5%"가 되도록 맞췄다(scripts/calibrate-live.ts).
const PROG = 0.01;
const FIN = 0.026;
/** 전체 득점 수준을 맞추는 배수. */
const SCALE = 1;

// 전술과 대형에 따라 선수 위치가 달라지면서 저절로 생기는 득점 차이를 지우는 보정값.
// 전술의 강약은 ratingsNow의 상성표가 정하므로, 움직임에서 나오는 차이는 여기서 0으로 되돌린다.
// 행은 우리 전술(대형), 열은 상대 전술(대형). scripts/calibrate-live.ts가 계산해 live-tuning.ts에 적는다.
const STYLE_ORDER: StyleId[] = ['press', 'possess', 'counter', 'direct', 'wide', 'park'];
const SHAPE_ORDER: ShapeId[] = ['442', '433', '4231', '352', '541'];
/** 한 팀에 걸려 있는 지시들의 이름. 보정표(tuning.extra)의 열쇠다. */
export function settings(side: LiveSide): string[] {
  const d = side.dials;
  const keys: string[] = [];
  if (d.line) keys.push(`line${d.line}`);
  if (d.width) keys.push(`width${d.width}`);
  if (d.tempo) keys.push(`tempo${d.tempo}`);
  if (d.overlap) keys.push('overlap');
  if (side.push) keys.push(`push${side.push}`);
  for (const i in side.roles) if (side.roles[i] !== 'base') keys.push(side.roles[i] as string);
  return keys;
}

/**
 * 보정표의 배수. 절반(제곱근)은 슈팅을 시도하려는 마음에, 나머지 절반은 결정력에 건다.
 * 결정력에만 걸면 슈팅 수는 4개인데 골은 남들만큼 넣는 어색한 경기가 나온다.
 */
function compensation(env: LiveEnv, t: 0 | 1): number {
  const a = env.sides[t];
  const b = env.sides[1 - t] as LiveSide;
  const style = (tuning.style[STYLE_ORDER.indexOf(a.style)] as number[])[STYLE_ORDER.indexOf(b.style)] as number;
  const shape = (tuning.shape[SHAPE_ORDER.indexOf(a.shape)] as number[])[SHAPE_ORDER.indexOf(b.shape)] as number;
  let extra = 1;
  for (const key of settings(a)) extra *= tuning.extra[key]?.[0] ?? 1;
  for (const key of settings(b)) extra *= tuning.extra[key]?.[1] ?? 1;
  return Math.sqrt(style * shape * extra);
}

function finishing(L: LiveState, env: LiveEnv, t: 0 | 1): number {
  const a = env.sides[t];
  const minute = L.tick / PER_MIN;
  // 마지막 15분에는 골이 더 많이 난다. 첫 15분은 탐색전이다.
  const time = minute >= 75 ? 1.12 : minute < 15 ? 0.92 : 1;
  return SCALE * Math.exp(FIN * a.edge) * a.venue * time * compensation(env, t);
}

// ---------- 좌표 ----------

// 팀 0은 오른쪽으로, 팀 1은 왼쪽으로 공격한다. u는 "우리 골문에서 상대 골문 쪽으로 잰 거리"다.
const ux = (t: number, u: number): number => (t === 0 ? u : W - u);
const vy = (t: number, v: number): number => (t === 0 ? v : H - v);

const slotOf = (env: LiveEnv, t: number, p: LivePlayer): Slot => (SLOTS[(env.sides[t] as LiveSide).shape] as Slot[])[p.slot] as Slot;
const keeper = (team: LiveTeam): number => Math.max(0, team.players.findIndex((p) => p.line === 'GK' && !p.off));

function holder(L: LiveState): 0 | 1 {
  return L.owner ? L.owner.team : L.flight ? L.flight.side : L.next ? L.next.team : 0;
}

/** t팀이 볼 때 오프사이드 선. 상대의 가장 뒤에 있는 필드 선수 위치다. */
function offsideLine(L: LiveState, t: 0 | 1): number {
  let line = W / 2;
  for (const p of (L.teams[1 - t] as LiveTeam).players) {
    if (p.off || p.line === 'GK') continue;
    line = Math.max(line, ux(t, p.x));
  }
  return line;
}

function nearestFoe(L: LiveState, t: 0 | 1, x: number, y: number, outfield = false): { i: number; d: number } {
  let best = -1;
  let dist = 1e9;
  (L.teams[1 - t] as LiveTeam).players.forEach((p, i) => {
    if (p.off || (outfield && p.line === 'GK')) return;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return { i: best, d: dist };
}

// ---------- 시작 ----------

const emptyTeam = (players: LivePlayer[]): LiveTeam => ({ players, shots: 0, onTarget: 0, xg: 0, passes: 0, passesOk: 0, possession: 0 });

function kickoffSpots(L: LiveState, shapes: [ShapeId, ShapeId], kicker: 0 | 1): void {
  for (const t of [0, 1] as const) {
    const team = L.teams[t];
    const last = striker(team, shapes[t]);
    team.players.forEach((p, i) => {
      const s = (SLOTS[shapes[t]] as Slot[])[p.slot] as Slot;
      let u = Math.min(s.u * 0.8, 49);
      let v = s.v;
      if (t === kicker && i === last) {
        u = 52;
        v = CY;
      }
      p.x = p.px = ux(t, u);
      p.y = p.py = vy(t, v);
    });
  }
}


export function createLive(mine: LivePlayer[], theirs: LivePlayer[], shapes: [ShapeId, ShapeId]): LiveState {
  const L: LiveState = {
    tick: 0, teams: [emptyTeam(mine), emptyTeam(theirs)], ball: { x: W / 2, y: CY, px: W / 2, py: CY },
    owner: null, flight: null, held: 0, sinceWin: 99, winU: 50, wait: 3, restart: 'kick', next: null, set: 0, lastKind: 'pass',
    calls: [], halfTimeDone: false, talked: false, confusedUntil: 0, over: false,
  };
  kickoffSpots(L, shapes, 0);
  L.next = { team: 0, i: striker(L.teams[0], shapes[0]), x: W / 2, y: CY };
  return L;
}

// ---------- 움직임 ----------

interface Aim {
  x: number;
  y: number;
  speed: number;
}

/** 한 팀 선수들이 지금 가려는 곳. 대형, 공의 위치, 전술, 팀 지시, 개인 역할이 여기서 자리가 된다. */
function desire(L: LiveState, env: LiveEnv, t: 0 | 1): (Aim | null)[] {
  const team = L.teams[t];
  const foes = L.teams[1 - t] as LiveTeam;
  const side = env.sides[t];
  const d = side.dials;
  const st = side.style;
  const bu = ux(t, L.ball.x);
  const bv = vy(t, L.ball.y);
  const has = holder(L) === t;
  const offU = offsideLine(L, t);
  const dead = L.wait > 0;
  const shot = L.flight?.kind === 'shot';

  // 공 쪽으로 달려드는 선수들. 전방 압박은 셋, 밀집 수비는 하나다.
  const chase = new Map<number, number>();
  if (!has && !dead && !shot) {
    const fx = L.flight ? L.flight.toX : L.ball.x;
    const fy = L.flight ? L.flight.toY : L.ball.y;
    const count = Math.max(st === 'press' ? 3 : st === 'park' ? 1 : 2, ux(t, fx) < 35 ? 2 : 0);
    team.players
      .map((p, i) => ({ i, dist: p.off || p.line === 'GK' ? 1e9 : Math.hypot(p.x - fx, p.y - fy) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, count)
      .forEach((e, order) => chase.set(e.i, order));
  }
  // 대인 마크가 따라다닐 상대 에이스.
  let ace: LivePlayer | null = null;
  for (const p of foes.players) if (!p.off && p.line === 'FW' && (!ace || p.ovr > ace.ovr)) ace = p;

  return team.players.map((p, i): Aim | null => {
    if (p.off) return null;
    const s = slotOf(env, t, p);
    const role = side.roles[i] ?? 'base';
    const pace = side.tired ? 0.88 : 1;
    let u: number;
    let v: number;
    let speed = 3;

    if (L.next && L.next.team === t && L.next.i === i) return { x: L.next.x, y: L.next.y, speed: 8 };
    if (L.restart === 'kick') return { x: ux(t, Math.min(s.u * 0.8, 49)), y: vy(t, s.v), speed: 6 };
    if (L.flight && !shot && L.flight.team === t && L.flight.to === i) return { x: L.flight.toX, y: L.flight.toY, speed: 4.6 };

    if (s.line === 'GK') {
      if (shot && L.flight && L.flight.side !== t) return { x: p.x, y: clamp(L.flight.toY, CY - 4, CY + 4), speed: 2.5 };
      u = role === 'sweeper' ? 5 + clamp((bu - 30) * 0.25, 0, 18) : 4 + clamp((bu - 45) * 0.1, 0, 7);
      v = CY + (bv - CY) * 0.14;
      return { x: ux(t, u), y: vy(t, v), speed: 2.2 * pace };
    }

    if (L.owner && L.owner.team === t && L.owner.i === i) {
      // 공을 몰고 간다. 앞을 막는 수비는 옆으로 비켜 간다.
      const cu = ux(t, p.x);
      const cv = vy(t, p.y);
      u = Math.min(cu + 5, 100);
      v = s.wide ? (cu > 84 ? cv + Math.sign(CY - cv) * 3 : cv) : cv + (CY - cv) * 0.12;
      const block = nearestFoe(L, t, p.x, p.y, true);
      if (block.i >= 0 && block.d < 6) {
        const f = foes.players[block.i] as LivePlayer;
        if (ux(t, f.x) > cu) v += cv >= vy(t, f.y) ? 3 : -3;
      }
      return { x: ux(t, u), y: vy(t, clamp(v, 2, 66)), speed: 2.6 * pace };
    }

    const k = RANK[s.line] - 1;
    if (has) {
      u = s.u + (bu - 50) * ([0.62, 0.6, 0.5][k] as number) + ([4, 7, 8][k] as number);
      if (st === 'possess' || st === 'press') u += 2;
      else if (st === 'park') u -= k === 2 ? 2 : 6;
      else if (st === 'counter') u += k === 2 ? 4 : -3;
      else if (st === 'direct') u += k === 2 ? 3 : 0;
      u += side.push * 5 + (k < 2 ? d.line * 3 : 0);
      const w = 1.08 + (st === 'wide' ? 0.12 : st === 'park' ? -0.1 : 0) + d.width * 0.14;
      v = CY + (s.v - CY) * w;
      if (s.wide && !s.fb) {
        // 측면 선수는 공격에 가담하고, 공이 문전에 가까워지면 반대편 선수가 안으로 좁혀 들어온다.
        if (k === 1) u += 6;
        if (bu > 62) v = CY + (v - CY) * ((v < CY) === (bv < CY) ? 0.9 : 0.55);
      }
      // 풀백이 올라간다. 측면 공격은 지시가 없어도 조금 올라간다.
      if (s.wb) u += 8;
      if (s.fb && bu > 40 && (d.overlap || st === 'wide')) u += d.overlap ? (s.wb ? 9 : 15) : 7;
      if (role === 'link') u -= 10;
      else if (role === 'drift') v += v < CY || (v === CY && bv < CY) ? -14 : 14;
      else if (role === 'target') u = Math.max(u, offU - 4);
      else if (role === 'hold') u = Math.min(u - 7, bu - 6);
      else if (role === 'maker') {
        u -= 2;
        v += (bv - v) * 0.35;
      } else if (role === 'runner') u += bu > 55 ? 10 : 0;
      else if (k === 2 && !s.wide && bu > 38) u = Math.max(u, offU - 2);
      // 오프사이드에 걸리지 않게 선다.
      u = clamp(u, k === 0 ? 14 : 18, Math.max(offU - 0.5, bu));
      u = Math.min(u, 101);
      v = clamp(v, 2, 66);
    } else {
      u = s.u + (bu - 50) * ([0.7, 0.66, 0.5][k] as number) - ([3, 4, 3][k] as number);
      const block = st === 'press' ? 7 : st === 'possess' ? 3 : st === 'counter' ? -7 : st === 'park' ? -13 : 0;
      u += k === 2 && block < 0 ? block * 0.4 : block;
      u += d.line * ([7, 4, 1][k] as number) + side.push * 6;
      const w = 0.8 + (st === 'park' ? -0.1 : st === 'press' ? 0.05 : 0) + d.width * 0.08;
      v = CY + (s.v - CY) * w + (bv - CY) * 0.3;
      if (role === 'stopper' && Math.hypot(p.x - L.ball.x, p.y - L.ball.y) < 24) u += 5;
      else if (role === 'hold') u -= 5;
      else if (role === 'link') u -= 6;
      u = clamp(u, [8, 13, 22][k] as number, [62, 80, 95][k] as number);
      v = clamp(v, 3, 65);
      if (role === 'mark' && ace) {
        u = Math.max(8, ux(t, ace.x) - 1.5);
        v = vy(t, ace.y);
        speed = 3.3;
      }
      const order = chase.get(i);
      if (order !== undefined) {
        const fx = L.flight ? L.flight.toX : L.ball.x;
        const fy = L.flight ? L.flight.toY : L.ball.y;
        // 첫째는 공으로, 둘째는 골문 쪽을 막고, 셋째는 안쪽 패스 길을 막는다.
        const cu = ux(t, fx) - (order === 1 ? 3 : 0);
        const cv = vy(t, fy) + (order === 2 ? Math.sign(CY - vy(t, fy)) * 3 : 0);
        return { x: ux(t, cu), y: vy(t, cv), speed: 3.3 * pace };
      }
    }
    return { x: ux(t, u), y: vy(t, v), speed: (dead ? 3.6 : speed) * pace };
  });
}

function move(L: LiveState, env: LiveEnv): void {
  // 두 팀의 목표를 먼저 정한 뒤 한꺼번에 움직인다. 순서대로 움직이면 나중에 움직이는 팀이 유리해진다.
  const aims = [desire(L, env, 0), desire(L, env, 1)];
  for (const t of [0, 1] as const) {
    L.teams[t].players.forEach((p, i) => {
      p.px = p.x;
      p.py = p.y;
      const a = (aims[t] as (Aim | null)[])[i];
      if (!a) return;
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.01) return;
      const pace = p.line === 'GK' ? 1 : 1 + (p.dev?.[0] ?? 0) * 0.006;
      const step = Math.min(dist, a.speed * pace);
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    });
  }
}

// ---------- 공 ----------

/** 이번 틱의 사건을 모으는 곳. stepLive가 틱마다 새로 건다. */
let emit: LiveEvent[] = [];

/** 공의 주인이 바뀐다. 상대에게 넘어갔으면 "되찾은 자리"를 적어 둔다. */
function gain(L: LiveState, team: 0 | 1, i: number): void {
  const changed = holder(L) !== team || (L.flight !== null && L.flight.side !== team);
  L.owner = { team, i };
  L.flight = null;
  L.held = 0;
  if (changed) {
    L.sinceWin = 0;
    L.winU = ux(team, (L.teams[team].players[i] as LivePlayer).x);
    L.set = 0;
    L.lastKind = 'pass';
  }
}

function stop(L: LiveState, kind: NonNullable<LiveState['restart']>, team: 0 | 1, i: number, x: number, y: number, wait: number, set: LiveState['set']): void {
  L.owner = null;
  L.flight = null;
  L.wait = wait;
  L.restart = kind;
  L.next = { team, i, x, y };
  L.set = set;
  L.ball.x = x;
  L.ball.y = y;
}

function launch(L: LiveState, f: Omit<LiveFlight, 'start' | 'end' | 'fromX' | 'fromY' | 'how'> & { speed: number; how?: LiveHow }): void {
  const dist = Math.hypot(f.toX - L.ball.x, f.toY - L.ball.y);
  L.flight = {
    fromX: L.ball.x, fromY: L.ball.y, toX: f.toX, toY: f.toY, start: L.tick, end: L.tick + Math.max(1, Math.round(dist / f.speed)),
    kind: f.kind, side: f.side, by: f.by, team: f.team, to: f.to, result: f.result, how: f.how ?? 'pass',
  };
  L.owner = null;
}

function describe(L: LiveState): LiveHow {
  if (L.set === 3) return 'pen';
  if (L.set) return 'set';
  if (L.winU > 66 && L.sinceWin < 7) return 'press';
  if (L.winU < 48 && L.sinceWin < 16) return 'counter';
  return L.lastKind;
}

/** 슛. 골인지 아닌지는 차는 순간 정해지고, 공이 날아간 뒤에 드러난다. */
function shoot(L: LiveState, env: LiveEnv, r: Rng, t: 0 | 1, i: number, fixed: number | null, how?: LiveHow): void {
  const team = L.teams[t];
  const p = team.players[i] as LivePlayer;
  const u = ux(t, p.x);
  const v = vy(t, p.y);
  const dist = Math.hypot(W - u, CY - v);
  let xg: number;
  if (fixed !== null) xg = fixed;
  else {
    xg = 0.5 * Math.exp(-dist / 8.5);
    // 각도가 좁을수록, 수비가 붙을수록 어렵다. 수비 라인을 넘어선 일대일은 쉽다.
    xg /= 1 + (Math.abs(v - CY) / Math.max(1, W - u)) * 0.6;
    if (nearestFoe(L, t, p.x, p.y, true).d < 2.4) xg *= 0.7;
    if (u > offsideLine(L, t) + 1) xg *= 1.6;
  }
  const way = how ?? describe(L);
  // 슈팅 능력치가 좋은 선수는 더 잘 넣고, 반응속도가 좋은 골키퍼는 더 잘 막는다.
  const other = (1 - t) as 0 | 1;
  const touch = Math.exp(0.02 * skill(team, i, 1) - 0.015 * skill(L.teams[other], keeper(L.teams[other]), 3));
  xg = clamp(xg * touch * (way === 'pen' ? 1 : finishing(L, env, t)), 0.004, 0.9);
  let result: LiveFlight['result'];
  if (rand(r) < xg) result = 'goal';
  else {
    const q = rand(r);
    result = way === 'pen' ? (q < 0.7 ? 'save' : 'off') : q < 0.32 ? 'save' : q < 0.45 ? 'corner' : 'off';
  }
  team.shots++;
  team.xg += xg;
  if (result === 'goal' || result === 'save') team.onTarget++;
  const far = v < CY ? 1 : -1;
  const gy = result === 'goal' ? CY + (rand(r) - 0.5) * 6 : result === 'save' ? CY + (rand(r) - 0.5) * 4 : result === 'corner' ? CY + far * (4.5 + rand(r) * 3) : CY + far * (5 + rand(r) * 9);
  const gu = result === 'save' ? W - 2.5 : W + (result === 'goal' ? 1.2 : 2.5);
  L.ball.x = p.x;
  L.ball.y = p.y;
  launch(L, { toX: ux(t, gu), toY: vy(t, gy), kind: 'shot', side: t, by: i, team: (1 - t) as 0 | 1, to: keeper(L.teams[1 - t] as LiveTeam), result, speed: 16, how: way, xg });
}

/** 측면에서 문전으로 올린다. 박스 안의 공격수와 수비수 숫자가 승부를 가른다. */
function cross(L: LiveState, env: LiveEnv, r: Rng, t: 0 | 1, i: number): void {
  const team = L.teams[t];
  const foes = L.teams[1 - t] as LiveTeam;
  const side = env.sides[t];
  const inBox = (x: number, y: number): boolean => ux(t, x) > 83 && Math.abs(vy(t, y) - CY) < 17;
  const attackers: number[] = [];
  team.players.forEach((p, j) => {
    if (j !== i && !p.off && p.line !== 'GK' && inBox(p.x, p.y)) attackers.push(j);
  });
  const defenders = foes.players.filter((p) => !p.off && p.line !== 'GK' && inBox(p.x, p.y)).length;
  const tall = attackers.find((j) => side.roles[j] === 'target');
  let win = attackers.length === 0 ? 0 : clamp(0.24 + 0.05 * attackers.length - 0.025 * defenders, 0.1, 0.42) + (tall !== undefined ? 0.07 : 0) + (L.set ? 0.06 : 0);
  win *= Math.exp(PROG * side.edge + 0.015 * skill(team, i, 2));
  const tu = 94 + rand(r) * 5;
  const tv = CY + (rand(r) - 0.5) * 12;
  const toX = ux(t, tu);
  const toY = vy(t, tv);
  team.passes++;
  L.lastKind = 'cross';
  const base = { toX, toY, kind: 'cross' as const, side: t, by: i, speed: 12 };
  if (rand(r) < win) {
    team.passesOk++;
    const to = tall !== undefined && rand(r) < 0.6 ? tall : (attackers[Math.floor(rand(r) * attackers.length)] as number);
    launch(L, { ...base, team: t, to, result: null });
    return;
  }
  const q = rand(r);
  const other = (1 - t) as 0 | 1;
  if (q < 0.55) launch(L, { ...base, team: other, to: nearestFoe(L, t, toX, toY, true).i, result: null });
  else if (q < 0.78) launch(L, { ...base, team: other, to: keeper(foes), result: null });
  else launch(L, { ...base, team: other, to: keeper(foes), result: q < 0.9 ? 'corner' : 'off' });
}

/** 패스할 곳을 고르고 찬다. 줄 곳이 없으면 false. far면 되도록 멀리 앞으로 찬다. */
function pass(L: LiveState, env: LiveEnv, r: Rng, t: 0 | 1, i: number, pressed: boolean, far: boolean): boolean {
  const team = L.teams[t];
  const side = env.sides[t];
  const foe = env.sides[1 - t] as LiveSide;
  const p = team.players[i] as LivePlayer;
  const u = ux(t, p.x);
  const offU = offsideLine(L, t);
  const st = side.style;
  const fast = st === 'counter' && L.sinceWin < 12;
  // 앞으로 보내려는 마음의 크기. 점유는 옆으로 돌리고, 롱볼과 역습은 앞을 본다.
  let forward = st === 'possess' ? 0.25 : st === 'direct' ? 0.8 : st === 'park' ? 0.5 : fast ? 0.9 : 0.4;
  forward += side.dials.tempo * 0.1;
  if (far) forward = 1.2;

  let best = -1;
  let bestScore = -1e9;
  let bestOpen = 0;
  team.players.forEach((c, j) => {
    if (j === i || c.off) return;
    const cu = ux(t, c.x);
    const dist = Math.hypot(c.x - p.x, c.y - p.y);
    if (c.line === 'GK' && !(pressed && u < 40)) return;
    const open = Math.min(10, nearestFoe(L, t, c.x, c.y, true).d);
    let score = (cu - u) * forward + open * 1.2 - Math.abs(dist - 16) * 0.25 + rand(r) * 8;
    if (dist > 38) score -= st === 'direct' || fast || far ? 4 : 14;
    if (dist < 5) score -= 10;
    if (c.line === 'GK') score -= 8;
    const s = slotOf(env, t, c);
    if (st === 'wide' && s.wide) score += 6;
    const role = side.roles[j];
    if (role === 'maker') score += 3.5;
    if (role === 'target' && dist > 25) score += 6;
    score += (c.ovr - p.ovr) * 0.15;
    // 오프사이드 자리에 있는 선수에게는 거의 주지 않는다.
    if (cu > offU + 0.3 && cu > u) {
      if (rand(r) < 0.85) return;
      score -= 5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = j;
      bestOpen = open;
    }
  });
  if (best < 0) return false;

  const c = team.players[best] as LivePlayer;
  const cu = ux(t, c.x);
  const dist = Math.hypot(c.x - p.x, c.y - p.y);
  const other = (1 - t) as 0 | 1;
  if (cu > offU + 0.3 && cu > u) {
    // 오프사이드. 상대 수비가 그 자리에서 다시 시작한다.
    const taker = nearestFoe(L, t, c.x, c.y, true).i;
    emit.push({ kind: 'offside', team: t, by: best });
    stop(L, 'free', other, taker, c.x, c.y, 3, 0);
    return true;
  }
  const long = dist > 30;
  let q: number;
  if (long) q = 0.62 - (dist - 30) * 0.006 + (side.roles[best] === 'target' ? 0.08 : 0) + (st === 'direct' ? 0.06 : 0);
  else q = 0.94 - dist * 0.004 - (pressed ? 0.07 : 0) - (bestOpen < 3 ? 0.08 : bestOpen < 6 ? 0.03 : 0) - (cu > 70 ? 0.05 : 0) + (st === 'possess' ? 0.02 : 0) - side.dials.tempo * 0.018;

  // 수비 뒷공간으로 찔러 주는 패스. 상대 라인이 높을수록 뛸 공간이 넓다.
  let toX = c.x;
  let toY = c.y;
  const space = W - offU;
  const acting = slotOf(env, t, c).line;
  if ((acting === 'FW' || side.roles[best] === 'runner') && space > 16 && offU - cu < 8 && cu > u && side.roles[best] !== 'link') {
    const lead = Math.min(10, space * 0.4);
    toX = ux(t, Math.min(cu + lead, 99));
    toY = c.y + (H / 2 - c.y) * 0.15;
    q -= 0.1;
  }
  let fail = (1 - q) * Math.exp(-PROG * side.edge - 0.02 * skill(team, i, 2));
  if (foe.style === 'press' && u < 60) fail *= 1.1;
  if (foe.style === 'park' && cu > 70) fail *= 1.2;
  team.passes++;
  L.lastKind = long ? 'long' : 'pass';
  const kind = long ? 'long' : 'pass';
  const speed = long ? 13 : 11;
  if (rand(r) >= clamp(fail, 0.01, 0.9)) {
    team.passesOk++;
    launch(L, { toX, toY, kind, side: t, by: i, team: t, to: best, result: null, speed });
    return true;
  }
  // 끊겼다. 받는 자리에서 가장 가까운 상대가, 패스 길 위에서 공을 가로챈다.
  const thief = nearestFoe(L, t, toX, toY, ux(t, toX) < 89);
  const f = (L.teams[other] as LiveTeam).players[thief.i] as LivePlayer;
  const dx = toX - p.x;
  const dy = toY - p.y;
  const along = clamp(((f.x - p.x) * dx + (f.y - p.y) * dy) / Math.max(1, dx * dx + dy * dy), 0.4, 1);
  launch(L, { toX: p.x + dx * along, toY: p.y + dy * along, kind, side: t, by: i, team: other, to: thief.i, result: null, speed });
  return true;
}

/** 공을 가진 선수의 한 틱. 뺏기거나, 쏘거나, 올리거나, 주거나, 몰고 간다. */
function act(L: LiveState, env: LiveEnv, r: Rng, events: LiveEvent[]): void {
  const { team: t, i } = L.owner as { team: 0 | 1; i: number };
  const other = (1 - t) as 0 | 1;
  const side = env.sides[t];
  const foe = env.sides[other];
  const team = L.teams[t];
  const p = team.players[i] as LivePlayer;
  const s = slotOf(env, t, p);
  const u = ux(t, p.x);
  const v = vy(t, p.y);
  const dist = Math.hypot(W - u, CY - v);
  const near = nearestFoe(L, t, p.x, p.y);
  L.held++;

  // 세트피스: 코너킥은 올리고, 프리킥은 가까우면 직접 찬다.
  if (L.set && L.held === 1) {
    if (L.set === 3) return shoot(L, env, r, t, i, 0.76, 'pen');
    if (L.set === 1) return cross(L, env, r, t, i);
    if (dist < 30 && Math.abs(v - CY) < 18 && rand(r) < 0.5) return shoot(L, env, r, t, i, 0.08, 'set');
    if (u > 62) return cross(L, env, r, t, i);
    L.set = 0;
  }

  if (s.line === 'GK') {
    if (L.held < 2) return;
    const far = side.style === 'direct' || (foe.style === 'press' && rand(r) < 0.5) || rand(r) < 0.15;
    pass(L, env, r, t, i, false, far);
    return;
  }

  // 태클. 붙은 수비가 공을 뺏거나 반칙을 한다.
  if (near.d < 2.4) {
    let lose = 0.3 * Math.exp(-PROG * side.edge - 0.02 * skill(team, i, 3) + 0.02 * skill(L.teams[other] as LiveTeam, near.i, 4)) * (foe.style === 'press' ? 1.08 : 1) * (side.style === 'possess' ? 0.9 : 1) * (1 + side.dials.tempo * 0.06);
    if (L.held <= 1) lose *= 0.5;
    if (rand(r) < lose) {
      const box = u > 88.5 && Math.abs(v - CY) < 20;
      if (rand(r) < (box ? 0.05 : 0.2)) {
        if (!foe.red && rand(r) < (foe.style === 'press' ? 0.01 : 0.006)) {
          const fouler = (L.teams[other] as LiveTeam).players[near.i] as LivePlayer;
          if (fouler.line !== 'GK') {
            fouler.off = true;
            events.push({ kind: 'red', team: other, by: near.i });
          }
        }
        emit.push({ kind: 'foul', team: other, by: near.i, victim: i, pen: box });
        if (box) stop(L, 'free', t, i, ux(t, 94), vy(t, CY), 8, 3);
        else stop(L, 'free', t, i, p.x, p.y, 3, u > 62 ? 2 : 0);
        return;
      }
      gain(L, other, near.i);
      if (L.winU > 64) emit.push({ kind: 'steal', team: other, by: near.i });
      return;
    }
  }

  // 슛. 가까울수록 망설이지 않는다.
  if (dist < 30) {
    let want = dist < 9 ? 0.75 : dist < 14 ? 0.45 : dist < 20 ? 0.2 : dist < 26 ? 0.07 : 0.02;
    if (u > 88 && Math.abs(v - CY) > 16) want *= 0.3;
    if (rand(r) < Math.min(0.95, want * compensation(env, t))) return shoot(L, env, r, t, i, null);
  }
  if (u > 80 && Math.abs(v - CY) > 14) {
    // 박스 안에 받을 선수가 있어야 올린다.
    const waiting = team.players.some((c, j) => j !== i && !c.off && ux(t, c.x) > 83 && Math.abs(vy(t, c.y) - CY) < 17);
    if (rand(r) < (waiting ? (side.style === 'wide' ? 0.6 : 0.45) : 0.08)) return cross(L, env, r, t, i);
  }

  const pressed = near.d < 5;
  // 우리 문전에서 몰리면 멀리 걷어 낸다.
  if (u < 22 && pressed && rand(r) < 0.6 && pass(L, env, r, t, i, true, true)) return;
  let want = 0.38 + side.dials.tempo * 0.07 + (pressed ? 0.3 : 0) + Math.min(L.held, 4) * 0.05;
  if (side.style === 'possess') want += 0.08;
  else if (side.style === 'direct') want += 0.05;
  else if (side.style === 'counter' && L.sinceWin < 10) want += 0.15;
  if (rand(r) < want) pass(L, env, r, t, i, pressed, false);
}

function arrive(L: LiveState, env: LiveEnv, r: Rng, events: LiveEvent[]): void {
  const f = L.flight as LiveFlight;
  const t = f.side;
  const other = (1 - t) as 0 | 1;
  L.ball.x = f.toX;
  L.ball.y = f.toY;
  if (f.result === 'goal') {
    events.push({ kind: 'goal', team: t, by: f.by, how: f.how });
    stop(L, 'kick', other, striker(L.teams[other], env.sides[other].shape), W / 2, CY, 14, 0);
    return;
  }
  if (f.kind === 'shot' && f.result !== null) emit.push({ kind: 'shot', team: t, by: f.by, result: f.result as 'save' | 'corner' | 'off', xg: f.xg ?? 0 });
  if (f.result === 'corner') {
    emit.push({ kind: 'corner', team: t });
    // 코너킥은 측면 미드필더가, 없으면 아무 미드필더나 찬다.
    const team = L.teams[t];
    let taker = team.players.findIndex((p) => !p.off && p.line === 'MF' && slotOf(env, t, p).wide);
    if (taker < 0) taker = team.players.findIndex((p) => !p.off && p.line === 'MF');
    if (taker < 0) taker = striker(team, env.sides[t].shape);
    stop(L, 'corner', t, taker, ux(t, 104.5), vy(t, vy(t, f.toY) < CY ? 0.5 : 67.5), 6, 1);
    return;
  }
  if (f.result === 'off') {
    stop(L, 'goalkick', other, keeper(L.teams[other]), ux(other, 5.5), CY + (rand(r) < 0.5 ? -5 : 5), 5, 0);
    return;
  }
  if (f.result === 'save') {
    gain(L, other, keeper(L.teams[other]));
    return;
  }
  const p = L.teams[f.team].players[f.to] as LivePlayer;
  if (f.kind === 'cross' && f.team === t) {
    // 크로스를 따냈다. 그 자리에서 바로 머리를 댄다.
    p.x = f.toX;
    p.y = f.toY;
    L.owner = { team: t, i: f.to };
    shoot(L, env, r, t, f.to, 0.13, L.set ? 'set' : 'cross');
    return;
  }
  // 받는 선수가 조금 못 미쳤으면 공 쪽으로 당겨 준다.
  const gap = Math.hypot(f.toX - p.x, f.toY - p.y);
  if (gap > 0.01) {
    const pull = Math.min(1, 4 / gap);
    p.x += (f.toX - p.x) * pull;
    p.y += (f.toY - p.y) * pull;
  }
  const kept = f.team === t;
  const kind = L.lastKind;
  gain(L, f.team, f.to);
  if (kept) L.lastKind = kind;
}

/** 한 틱을 진행한다. 골, 슈팅, 파울, 퇴장, 전반 종료, 경기 종료 같은 사건을 돌려준다. */
export function stepLive(L: LiveState, env: LiveEnv, r: Rng): LiveEvent[] {
  const events: LiveEvent[] = [];
  emit = events;
  if (L.over) return events;
  L.tick++;
  L.ball.px = L.ball.x;
  L.ball.py = L.ball.y;
  L.sinceWin++;
  L.teams[holder(L)].possession++;

  if (L.wait > 0) {
    L.wait--;
    move(L, env);
    if (L.wait === 0 && L.next) {
      const n = L.next;
      const p = L.teams[n.team].players[n.i] as LivePlayer;
      p.x = n.x;
      p.y = n.y;
      // 골킥은 공을 되찾은 것으로 치고, 나머지 재개는 흐름이 끊긴 것으로 친다.
      const goalkick = L.restart === 'goalkick';
      L.restart = null;
      L.next = null;
      L.owner = { team: n.team, i: n.i };
      L.held = 0;
      L.sinceWin = goalkick ? 0 : 99;
      L.winU = goalkick ? 5 : 50;
      L.lastKind = 'pass';
    }
  } else if (L.flight) {
    const f = L.flight;
    const done = L.tick >= f.end;
    const frac = done ? 1 : (L.tick - f.start) / (f.end - f.start);
    L.ball.x = f.fromX + (f.toX - f.fromX) * frac;
    L.ball.y = f.fromY + (f.toY - f.fromY) * frac;
    move(L, env);
    if (done) arrive(L, env, r, events);
  } else if (L.owner) {
    act(L, env, r, events);
    move(L, env);
  }
  if (L.owner) {
    // 공은 가진 선수의 발 앞에 있다.
    const p = L.teams[L.owner.team].players[L.owner.i] as LivePlayer;
    L.ball.x = p.x + (L.owner.team === 0 ? 0.8 : -0.8);
    L.ball.y = p.y;
  }

  const shot = L.flight?.kind === 'shot';
  if (L.tick >= HALF && !L.halfTimeDone && !shot) {
    L.halfTimeDone = true;
    events.push({ kind: 'half' });
    // 후반은 상대의 킥오프로 시작한다.
    kickoffSpots(L, [env.sides[0].shape, env.sides[1].shape], 1);
    L.flight = null;
    stop(L, 'kick', 1, striker(L.teams[1], env.sides[1].shape), W / 2, CY, 3, 0);
    L.ball.px = L.ball.x;
    L.ball.py = L.ball.y;
  } else if (L.tick >= TICKS && !shot) {
    L.over = true;
    events.push({ kind: 'full' });
  }
  return events;
}
