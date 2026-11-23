// 경기장 배경. 잔디와 선, 골대, 트랙, 관중석, 광고판, 벤치처럼 경기 내내 바뀌지 않는 것을 화면 밖 캔버스에 한 번 그려 두고,
// 매 프레임에는 그 그림을 붙이기만 한다. 구장 주인의 규모에 따라 동네 운동장부터 큰 전용 구장까지 네 등급으로 달라진다.
// 면은 모두 납작하게 칠한다. 선수와 공이 가장 먼저 읽혀야 하므로 관중석은 일부러 가라앉은 색을 쓴다.

import type { WeatherId } from '../game/types.ts';
import { dice } from './face.ts';

export const TURF = '#2f8a52';
const TURF_DARK = '#2a7f4b';
const TURF_PARK = '#39884d';
const VERGE = '#236a40';
const APRON = '#10281b';
const STAND = '#18251f';
const ROOF = '#46525a';
const ROOF_EDGE = '#96a5ad';
const CHALK = 'rgba(244,248,240,0.88)';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const light = (hex: string): boolean => {
  const [r, g, b] = rgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
};

/** 두 색을 섞는다. t가 0이면 a, 1이면 b. */
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const f = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `rgb(${f(r1, r2)},${f(g1, g2)},${f(b1, b2)})`;
}

/** 경기장 좌표(m)를 화면(px)으로 옮기는 법. 전반 기준이라 뒤집지 않는다. */
export interface Proj {
  /** 1m가 몇 px인지. */
  s: number;
  /** 경기장을 세워 그리는지. */
  up: boolean;
  X(x: number, y: number): number;
  Y(x: number, y: number): number;
}

export interface Look {
  /** 0 동네 운동장, 1 종합운동장(트랙), 2 전용 구장, 3 큰 구장. */
  tier: 0 | 1 | 2 | 3;
  /** 구장 주인의 두 색. 빈 좌석과 광고판, 깃발에 쓴다. */
  owner: [string, string];
  /** 우리 팬과 상대 팬의 옷 색. */
  fans: [[string, string], [string, string]];
  /** 오늘 입은 유니폼 바탕색(벤치에 앉은 후보와 감독). */
  kits: [string, string];
  venue: 'home' | 'away' | 'neutral';
  weather: WeatherId;
  /** 야간 경기(토너먼트). 관중석이 어둡고 그림자가 네 갈래로 진다. */
  night: boolean;
  seed: number;
}

export interface Fan {
  x: number;
  y: number;
  team: 0 | 1;
  color: string;
}

export interface Scene {
  image: HTMLCanvasElement;
  /** 골이 들어가면 뛰는 관중(표본). */
  fans: Fan[];
  /** 관중 한 명의 반지름(px). */
  dot: number;
  /** 선수 그림자가 떨어지는 쪽(선수 반지름에 곱한다). */
  shade: [number, number];
  /** 야간 조명: 그림자가 네 갈래로 진다. */
  lit: boolean;
}

type Side = 'far' | 'bench' | 'g0' | 'g1';
type Rect = [number, number, number, number];

/** 경기장 선 바깥에 두는 여백(px): [터치라인 쪽, 골라인 쪽]. 골 그물과 광고판, 관중석 앞줄이 들어갈 만큼이다. */
export const margins = (roomy: boolean): [number, number] => (roomy ? [44, 56] : [28, 46]);

const thin = <T,>(list: T[], max: number): T[] => {
  const step = Math.max(1, Math.ceil(list.length / max));
  return list.filter((_, i) => i % step === 0);
};

export function paintStadium(image: HTMLCanvasElement, w: number, h: number, dpr: number, p: Proj, look: Look): Scene {
  image.width = Math.round(w * dpr);
  image.height = Math.round(h * dpr);
  const ctx = image.getContext('2d');
  const day = !look.night && look.weather !== 'rain';
  const shade: [number, number] = day ? [0.14, 0.3] : [0, 0.16];
  if (!ctx) return { image, fans: [], dot: 1.5, shade, lit: look.night };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const s = p.s;
  const tier = look.tier;
  const r = dice(look.seed);
  const pick = <T,>(list: T[]): T => list[Math.floor(r() * list.length)] as T;
  const lump = (a: number, b: number): number => {
    const v = Math.sin(a * 91.7 + b * 12.9898 + (look.seed % 997)) * 43758.5453;
    return v - Math.floor(v);
  };

  // 화면에서 본 경기장 사각형과, 경기장의 +x, +y가 화면에서 향하는 쪽.
  const x0 = Math.min(p.X(0, 0), p.X(105, 68));
  const y0 = Math.min(p.Y(0, 0), p.Y(105, 68));
  const pw = Math.abs(p.X(105, 68) - p.X(0, 0));
  const ph = Math.abs(p.Y(105, 68) - p.Y(0, 0));
  const ux: [number, number] = p.up ? [0, -1] : [1, 0];
  const uy: [number, number] = p.up ? [1, 0] : [0, 1];
  const A = (a: number): number => (p.up ? a - Math.PI / 2 : a);

  // 선 바깥 잔디의 너비(터치라인 쪽, 골라인 쪽), 광고판 두께, 트랙 너비.
  const vT = tier === 1 ? clamp(s * 0.7, 4, 6) : clamp(s * 1.5, 7, 13);
  const vG = Math.max(8, s * 2.2 + 3);
  const [vx, vy] = p.up ? [vT, vG] : [vG, vT];
  const ix = x0 - vx;
  const iy = y0 - vy;
  const iw = pw + vx * 2;
  const ih = ph + vy * 2;
  const hb = tier >= 1 ? clamp(s * 0.55, 3, 5) : 0;
  const tw = tier === 1 ? clamp(s * 1.5, 7, 12) : 0;
  const ri = Math.max(vx, vy) * 1.4;

  /** 경기장 좌표의 두 모서리로 화면 사각형을 얻는다. */
  const box = (ax: number, ay: number, bx: number, by: number): Rect => {
    const [x1, y1, x2, y2] = [p.X(ax, ay), p.Y(ax, ay), p.X(bx, by), p.Y(bx, by)];
    return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
  };
  /** 선 바깥의 띠. side 쪽 선을 따라 a~b(m), 선에서 바깥으로 d0~d1(px). */
  const strip = (side: Side, a: number, b: number, d0: number, d1: number): Rect => {
    const touch = side === 'far' || side === 'bench';
    const k = side === 'far' || side === 'g0' ? -1 : 1;
    const [nx, ny] = touch ? uy : ux;
    const at = (t: number, d: number): [number, number] => {
      const [u, v] = touch ? [t, side === 'bench' ? 68 : 0] : [side === 'g1' ? 105 : 0, t];
      return [p.X(u, v) + nx * k * d, p.Y(u, v) + ny * k * d];
    };
    const [x1, y1] = at(a, d0);
    const [x2, y2] = at(b, d1);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
  };
  const dot = (x: number, y: number, rad: number, fill: string): void => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // 관중의 옷: 구단 색이 많고, 평상복이 섞인다.
  const crowd: [Fan[], Fan[]] = [[], []];
  const wear = (t: 0 | 1): string => {
    const [a, b] = look.fans[t];
    return pick([a, a, a, a, b, b, '#e6e2d6', '#23272c', '#8a8d88', '#caa98b']);
  };
  /** 그 자리에 앉는 팬. 원정 팬은 본부석 맞은편 끝에 따로 앉고, 사이는 비워 둔다. -1이면 빈 구역. */
  const teamAt = (side: Side, u: number): 0 | 1 | -1 => {
    if (look.venue === 'neutral') return side === 'g0' ? 0 : side === 'g1' ? 1 : u < 52.5 ? 0 : 1;
    const home = look.venue === 'home' ? 0 : 1;
    if (side === 'far') {
      const edge = home === 0 ? 105 - u : u;
      if (edge < 19) return home === 0 ? 1 : 0;
      if (edge < 20.5) return -1;
    }
    return home;
  };

  // ----- 경기장 둘레 -----
  ctx.fillStyle = tier === 0 ? '#1d5236' : tier === 3 ? STAND : APRON;
  ctx.fillRect(0, 0, w, h);

  if (tier === 0) {
    // 동네 운동장: 풀밭 한가운데 줄만 그은 구장. 울타리 너머에 구경꾼 몇과 나무가 있다.
    for (let i = 0; i < (w * h) / 240; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.09)';
      ctx.fillRect(r() * w, r() * h, 2 + r() * 3, 1.2);
    }
    ctx.fillStyle = 'rgba(156,142,98,0.42)';
    ctx.fillRect(...strip('bench', -6, 111, vT + 3, vT + 3 + clamp(s * 1.2, 5, 9)));
    for (let i = 0; i < 60; i++) {
      const rad = 5 + r() * 5;
      const tx = r() * w;
      const ty = r() * h;
      const gap = rad + 4;
      if (tx > ix - gap && tx < ix + iw + gap && ty > iy - gap && ty < iy + ih + gap) continue;
      dot(tx + 2, ty + 3, rad, 'rgba(6,22,14,0.3)');
      dot(tx, ty, rad, '#1a4a2f');
      dot(tx - rad * 0.2, ty - rad * 0.22, rad * 0.6, '#27693f');
    }
    for (let i = 0; i < 30; i++) {
      const side: Side = r() < 0.6 ? 'bench' : 'far';
      const u = 4 + r() * 97;
      const [fx, fy] = strip(side, u, u, vT + 3.5 + r() * 5, 0);
      const team = teamAt(side, u);
      if (team === -1 || fx < 2 || fy < 2 || fx > w - 2 || fy > h - 2) continue;
      const color = wear(team);
      dot(fx + 0.8, fy + 1.2, 1.9, 'rgba(6,22,14,0.35)');
      dot(fx, fy, 1.9, mix(color, STAND, 0.15));
      crowd[team].push({ x: fx, y: fy, team, color });
    }
  }

  if (tier === 1) {
    // 종합운동장: 경기장을 육상 트랙이 두른다.
    ctx.fillStyle = '#9a513d';
    ctx.beginPath();
    ctx.roundRect(ix - tw, iy - tw, iw + tw * 2, ih + tw * 2, ri + tw);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 0.7;
    for (let k = 1; k < 4; k++) {
      const o = (tw * k) / 4;
      ctx.beginPath();
      ctx.roundRect(ix - o, iy - o, iw + o * 2, ih + o * 2, ri + o);
      ctx.stroke();
    }
  }

  // 관중석 앞줄이 시작되는 사각형, 좌석 한 줄의 깊이, 관중 한 명의 크기.
  const off = tier === 1 ? tw + 3 : hb + 2;
  const sx0 = ix - off;
  const sy0 = iy - off;
  const sx1 = ix + iw + off;
  const sy1 = iy + ih + off;
  const d = clamp(s * 0.78, 3.4, 5);
  const pr = d * 0.36;
  /** 야간에 켜지는 조명 자리. */
  const lamps: [number, number][] = [];

  if (tier >= 1) {
    // 관중석: 좌석 줄을 띠로 긋고 그 위에 사람을 점으로 찍는다. 뒤쪽은 지붕이 덮는다.
    type Edge = 'top' | 'bottom' | 'left' | 'right';
    const sideOf: Record<Edge, Side> = p.up
      ? { top: 'g1', bottom: 'g0', left: 'far', right: 'bench' }
      : { top: 'far', bottom: 'bench', left: 'g0', right: 'g1' };
    const home = look.venue === 'away' ? 1 : 0;
    const band = (b: number): string => mix(look.owner[b % 3 === 1 ? 1 : 0], STAND, 0.6);
    const person = (cx: number, cy: number, team: 0 | 1): void => {
      if (cx < 1 || cy < 1 || cx > w - 1 || cy > h - 1) return;
      const color = wear(team);
      dot(cx, cy, pr, mix(color, STAND, 0.2));
      crowd[team].push({ x: cx, y: cy, team, color });
    };
    /** 줄 수, 앞줄의 채움과 뒤로 갈수록 줄어드는 폭, 지붕이 시작되는 줄, 스탠드가 놓이는 구간과 지붕이 덮는 구간(m). */
    interface Plan { rows: number; fill: number; thin: number; roof: number; span: [number, number]; cover: [number, number] }
    const all: [number, number] = [-99, 999];
    const plan = (side: Side): Plan => {
      const touch = side === 'far' || side === 'bench';
      // 큰 구장은 지붕이 한 바퀴 두른다.
      if (tier === 3) return { rows: 80, fill: 0.95, thin: 0, roof: 8, span: all, cover: all };
      // 전용 구장: 양쪽 터치라인에 지붕 있는 스탠드, 골대 뒤는 지붕 없는 응원석.
      if (tier === 2) return touch ? { rows: 13, fill: 0.8, thin: 0.3, roof: 6, span: all, cover: all } : { rows: 10, fill: 0.84, thin: 0.2, roof: 99, span: all, cover: all };
      // 종합운동장: 본부석에만 지붕과 사람이 있고, 나머지는 거의 빈 계단식 관람석이다.
      if (side === 'far') return { rows: 9, fill: 0.56, thin: 0.3, roof: 4, span: [3, 102], cover: [27, 78] };
      if (side === 'bench') return { rows: 3, fill: 0.2, thin: 0, roof: 99, span: [10, 95], cover: all };
      return { rows: 4, fill: 0.04, thin: 0, roof: 99, span: all, cover: all };
    };
    /** 지붕이 시작되는 깊이(px). 자리가 좁으면 당겨서, 앞줄 몇 개와 지붕이 함께 보이게 한다. */
    const roofAt: Record<Edge, number> = { top: 0, bottom: 0, left: 0, right: 0 };

    for (const e of ['top', 'bottom', 'left', 'right'] as const) {
      const horiz = e === 'top' || e === 'bottom';
      const dir = e === 'top' || e === 'left' ? -1 : 1;
      const front = e === 'top' ? sy0 : e === 'bottom' ? sy1 : e === 'left' ? sx0 : sx1;
      const room = dir < 0 ? front : (horiz ? h : w) - front;
      const side = sideOf[e];
      const touch = side === 'far' || side === 'bench';
      const spec = plan(side);
      const roofed = spec.roof < spec.rows;
      const lip = roofed ? Math.min(spec.roof * d, room * 0.55) : 1e6;
      roofAt[e] = lip;
      if (room < d) continue;
      const [from, to] = horiz ? [sx0, sx1] : [sy0, sy1];
      /** 그 자리가 터치라인을 따라 몇 m 지점인지. 골대 뒤는 한가운데로 친다. */
      const metre = (a: number): number => (!touch ? 50 : p.up ? 105 - (a - y0) / s : (a - x0) / s);
      const px = (u: number): number => clamp(p.up ? y0 + (105 - u) * s : x0 + u * s, from, to);
      const [a0, a1] = touch ? [Math.min(px(spec.span[0]), px(spec.span[1])), Math.max(px(spec.span[0]), px(spec.span[1]))] : [from, to];
      const rows = Math.min(spec.rows, Math.ceil(room / d));
      const deep = Math.min(spec.rows * d, room + 2);
      /** 띠 방향 사각형: 따라가는 쪽 a~b, 앞줄에서 바깥으로 n~m(px). */
      const slab = (a: number, b: number, n: number, m: number): Rect => {
        const lo = dir < 0 ? front - m : front + n;
        return horiz ? [a, lo, b - a, m - n] : [lo, a, m - n, b - a];
      };
      ctx.fillStyle = STAND;
      ctx.fillRect(...slab(a0, a1, 0, deep));
      const count = Math.floor((a1 - a0) / d);
      const start = a0 + (a1 - a0 - count * d) / 2;
      for (let k = 0; k < rows; k++) {
        const c = front + dir * (k + 0.5) * d;
        for (let j = 0; j < count; j++) {
          // 열세 칸마다 계단.
          if (j % 13 === 12) continue;
          const a = start + (j + 0.5) * d;
          const u = metre(a);
          const block = Math.floor(j / 13);
          ctx.fillStyle = band(block);
          ctx.fillRect(...slab(a - d / 2, a + d / 2 + 0.3, k * d + 0.6, (k + 1) * d - 0.6));
          const under = roofed && u > spec.cover[0] && u < spec.cover[1] && (k + 0.5) * d > lip;
          // 벤치가 놓이는 자리에는 사람을 앉히지 않는다.
          const dugout = side === 'bench' && u > 35 && u < 70 && k < 3;
          const team = teamAt(side, u);
          if (under || dugout || team === -1) continue;
          const chance = team === home || look.venue === 'neutral' ? spec.fill - spec.thin * (k / spec.rows) : 0.9;
          if (r() < chance * (0.62 + 0.76 * lump(e.length + block, Math.floor(k / 3)))) person(horiz ? a : c, horiz ? c : a, team);
        }
      }
      if (!roofed || lip + 4 > deep) continue;
      // 지붕: 납작한 판에 안쪽 테두리와 뼈대. 낮에는 지붕 아래 앞줄에 그늘이 진다.
      const [c0, c1] = touch ? [Math.min(px(spec.cover[0]), px(spec.cover[1])), Math.max(px(spec.cover[0]), px(spec.cover[1]))] : [from, to];
      if (day) {
        ctx.fillStyle = 'rgba(4,12,10,0.3)';
        ctx.fillRect(...slab(c0, c1, lip - 2.5, lip));
      }
      ctx.fillStyle = ROOF;
      ctx.fillRect(...slab(c0, c1, lip, deep));
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      for (let a = c0 + d * 2.5; a < c1 - d; a += d * 5) ctx.fillRect(...slab(a, a + 1, lip, deep));
      ctx.fillStyle = 'rgba(8,14,18,0.22)';
      ctx.fillRect(...slab(c0, c1, lip + (deep - lip) * 0.55, lip + (deep - lip) * 0.55 + 1.2));
      ctx.fillStyle = ROOF_EDGE;
      ctx.fillRect(...slab(c0, c1, lip, lip + 1.6));
      for (let a = c0 + d * 4; a < c1 - d * 2; a += d * 9) lamps.push(horiz ? [a, front + dir * (lip + 2.6)] : [front + dir * (lip + 2.6), a]);
    }

    for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const cx = qx < 0 ? sx0 : sx1;
      const cy = qy < 0 ? sy0 : sy1;
      if (tier < 3) {
        // 모서리가 열린 구장은 그 자리에 조명탑이 선다.
        const [tx, ty] = [cx + qx * Math.min(11, (qx < 0 ? cx : w - cx) * 0.5), cy + qy * Math.min(11, (qy < 0 ? cy : h - cy) * 0.5)];
        // 기둥 하나에 경기장 쪽으로 돌려 단 등판.
        dot(tx, ty, 2.6, '#222a2e');
        ctx.save();
        ctx.translate(tx - qx * 2.2, ty - qy * 2.2);
        ctx.rotate(Math.atan2(qy, qx) + Math.PI / 2);
        ctx.fillStyle = '#c3ccd0';
        ctx.fillRect(-4.5, -1.3, 9, 2.6);
        ctx.fillStyle = '#222a2e';
        for (const k of [-1.5, 1.5]) ctx.fillRect(k - 0.3, -1.3, 0.6, 2.6);
        ctx.restore();
        lamps.push([tx - qx * 2.2, ty - qy * 2.2]);
        continue;
      }
      // 큰 구장의 모서리: 좌석 줄이 둥글게 돌아 이어진다.
      const rx = roofAt[qx < 0 ? 'left' : 'right'];
      const ry = roofAt[qy < 0 ? 'top' : 'bottom'];
      const [bx, by, bw, bh] = [qx < 0 ? 0 : cx, qy < 0 ? 0 : cy, qx < 0 ? cx : w - cx, qy < 0 ? cy : h - cy];
      if (bw < d || bh < d) continue;
      const a0 = qx < 0 ? (qy < 0 ? Math.PI : Math.PI / 2) : qy < 0 ? Math.PI * 1.5 : 0;
      const touch: Side = (p.up ? qx : qy) < 0 ? 'far' : 'bench';
      const u = (p.up ? qy < 0 : qx > 0) ? 105 : 0;
      const team = teamAt(touch, u);
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.clip();
      ctx.lineWidth = d - 1.2;
      for (let k = 0; (k + 0.5) * d < Math.hypot(bw, bh); k++) {
        const rad = (k + 0.5) * d;
        ctx.strokeStyle = band(k > 5 ? 1 : 0);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, a0, a0 + Math.PI / 2);
        ctx.stroke();
        const n = Math.max(1, Math.floor((rad * Math.PI) / 2 / d));
        for (let j = 0; j < n; j++) {
          const a = a0 + ((j + 0.5) / n) * (Math.PI / 2);
          const [fx, fy] = [Math.cos(a) * rad, Math.sin(a) * rad];
          if ((fx / rx) ** 2 + (fy / ry) ** 2 > 0.92 || team === -1) continue;
          if (r() < (team === home || look.venue === 'neutral' ? 0.9 : 0.9) * (0.62 + 0.76 * lump(qx * 3 + qy, Math.floor(k / 3)))) person(cx + fx, cy + fy, team);
        }
      }
      // 모서리 지붕: 모서리 칸에서 앞줄 쪽 타원을 뺀 나머지.
      ctx.fillStyle = ROOF;
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0 + Math.PI / 4) * rx, cy + Math.sin(a0 + Math.PI / 4) * ry);
      ctx.lineTo(cx + qx * bw, cy + qy * bh);
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = ROOF_EDGE;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 0.7, ry + 0.7, 0, a0, a0 + Math.PI / 2);
      ctx.stroke();
      ctx.restore();
      const mid = a0 + Math.PI / 4;
      lamps.push([cx + Math.cos(mid) * (rx + 2.6), cy + Math.sin(mid) * (ry + 2.6)]);
    }

    // 광고판: 진짜 글자 대신 글자처럼 보이는 짧은 막대를 넣는다.
    const ads = ['#f3f0e4', look.owner[0], '#1b2d57', '#f0c23a', '#f3f0e4', '#b8332b', look.owner[1], '#20242a', '#0f7a6b'];
    const boards = (side: Side, len: number): void => {
      const v = side === 'far' || side === 'bench' ? vT : vG;
      const n = Math.round(len / (tier === 3 ? 10.5 : 7.5));
      for (let i = 0; i < n; i++) {
        const a = (len / n) * i;
        const b = (len / n) * (i + 1);
        const bg = pick(ads);
        // 벤치 앞은 비워 둔다.
        if (side === 'bench' && b > 35 && a < 70) continue;
        const [bx, by, bw, bh] = strip(side, a, b, v, v + hb);
        const flat = bw > bh;
        ctx.fillStyle = bg;
        ctx.fillRect(flat ? bx + 0.5 : bx, flat ? by : by + 0.5, flat ? bw - 1 : bw, flat ? bh : bh - 1);
        if (hb < 4) continue;
        ctx.fillStyle = light(bg) ? 'rgba(20,24,28,0.7)' : 'rgba(255,255,255,0.8)';
        const long = flat ? bw : bh;
        const end = long * (0.72 + r() * 0.16);
        let at = long * (0.14 + r() * 0.1);
        while (at < end) {
          const run = Math.min(end - at, Math.max(1.5, long * (0.05 + r() * 0.1)));
          if (flat) ctx.fillRect(bx + at, by + 1, run, bh - 2);
          else ctx.fillRect(bx + 1, by + at, bw - 2, run);
          at += run + 1.5;
        }
      }
    };
    boards('far', 105);
    if (tier >= 2) {
      boards('bench', 105);
      boards('g0', 68);
      boards('g1', 68);
    }
  }

  // ----- 잔디 -----
  ctx.fillStyle = VERGE;
  ctx.beginPath();
  if (tier === 1) ctx.roundRect(ix, iy, iw, ih, ri);
  else ctx.rect(ix, iy, iw, ih);
  ctx.fill();
  if (tier === 0) {
    // 울타리와 기둥.
    ctx.strokeStyle = 'rgba(12,30,20,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
    ctx.save();
    ctx.setLineDash([1.5, s * 3]);
    ctx.strokeStyle = 'rgba(232,238,226,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
    ctx.restore();
  }
  // 깎은 결: 길이 방향으로 열두 줄. 큰 구장은 바둑판으로 깎고, 동네 운동장은 결이 없다.
  for (let k = 0; k < 12; k++) {
    ctx.fillStyle = tier === 0 ? TURF_PARK : k % 2 ? TURF_DARK : TURF;
    ctx.fillRect(...box((105 / 12) * k, 0, (105 / 12) * (k + 1), 68));
  }
  if (tier === 3) {
    ctx.fillStyle = 'rgba(0,24,10,0.07)';
    for (let k = 1; k < 6; k += 2) ctx.fillRect(...box(0, (68 / 6) * k, 105, (68 / 6) * (k + 1)));
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();
  const oval = (x: number, y: number, rx: number, ry: number, fill: string): void => {
    ctx.beginPath();
    ctx.ellipse(p.X(x, y), p.Y(x, y), (p.up ? ry : rx) * s, (p.up ? rx : ry) * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  if (tier <= 1) {
    // 골문 앞은 잔디가 닳아 흙이 비친다.
    const worn = `rgba(152,136,90,${tier === 0 ? 0.3 : 0.15})`;
    oval(3.5, 34, 4.5, 6.5, worn);
    oval(101.5, 34, 4.5, 6.5, worn);
  }
  if (tier === 0) {
    oval(52.5, 34, 5, 5, 'rgba(152,136,90,0.16)');
    for (let i = 0; i < 14; i++) oval(r() * 105, r() * 68, 5 + r() * 8, 4 + r() * 5, i % 2 ? 'rgba(255,255,214,0.028)' : 'rgba(0,30,10,0.045)');
  }
  // 잔디 결: 밝고 어두운 점을 흩뿌린다.
  for (let i = 0; i < (pw * ph) / 46; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,26,12,0.07)';
    ctx.fillRect(x0 + r() * pw, y0 + r() * ph, 1, 1);
  }
  ctx.restore();

  // ----- 선 -----
  const line = (ax: number, ay: number, bx: number, by: number): void => {
    ctx.beginPath();
    ctx.moveTo(p.X(ax, ay), p.Y(ax, ay));
    ctx.lineTo(p.X(bx, by), p.Y(bx, by));
    ctx.stroke();
  };
  const arc = (x: number, y: number, rad: number, a0: number, a1: number): void => {
    ctx.beginPath();
    ctx.arc(p.X(x, y), p.Y(x, y), rad * s, A(a0), A(a1));
    ctx.stroke();
  };
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = Math.max(1.2, s * 0.18);
  ctx.strokeRect(...box(0, 0, 105, 68));
  line(52.5, 0, 52.5, 68);
  arc(52.5, 34, 9.15, 0, Math.PI * 2);
  dot(p.X(52.5, 34), p.Y(52.5, 34), Math.max(1.3, s * 0.28), CHALK);
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : 105;
    const dir = side === 0 ? 1 : -1;
    ctx.strokeRect(...box(gx, 13.84, gx + dir * 16.5, 54.16));
    ctx.strokeRect(...box(gx, 24.84, gx + dir * 5.5, 43.16));
    arc(gx + dir * 11, 34, 9.15, side === 0 ? -0.93 : Math.PI - 0.93, side === 0 ? 0.93 : Math.PI + 0.93);
    dot(p.X(gx + dir * 11, 34), p.Y(gx + dir * 11, 34), Math.max(1.3, s * 0.28), CHALK);
  }
  const corners: [number, number, number][] = [[0, 0, 0], [105, 0, Math.PI / 2], [105, 68, Math.PI], [0, 68, Math.PI * 1.5]];
  for (const [x, y, a] of corners) arc(x, y, 1, a, a + Math.PI / 2);

  // ----- 골대와 그물 -----
  for (const side of ['g0', 'g1'] as const) {
    const [nx, ny, nw, nh] = strip(side, 30.34, 37.66, 0, 2.2 * s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(nx, ny, nw, nh);
    ctx.fillStyle = 'rgba(236,242,236,0.14)';
    ctx.fill();
    ctx.clip();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    const gap = Math.max(2.4, s * 0.42);
    ctx.beginPath();
    for (let q = -nh; q < nw + nh; q += gap) {
      ctx.moveTo(nx + q, ny);
      ctx.lineTo(nx + q + nh, ny + nh);
      ctx.moveTo(nx + q + nh, ny);
      ctx.lineTo(nx + q, ny + nh);
    }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = Math.max(1.2, s * 0.2);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeRect(nx, ny, nw, nh);
    const gx = side === 'g0' ? 0 : 105;
    for (const y of [30.34, 37.66]) dot(p.X(gx, y), p.Y(gx, y), Math.max(1.6, s * 0.26), '#ffffff');
  }

  // ----- 기술 지역, 벤치, 감독 -----
  const d0 = tier === 1 ? vT + tw * 0.55 : tier === 0 ? vT + 4 : vT;
  const db = tier === 0 ? 2.6 : clamp(s * 1.3, 6, 10);
  const spans: [number, number][] = [[36, 49], [56, 69]];
  spans.forEach(([a, b], t) => {
    const color = look.kits[t as 0 | 1];
    if (tier > 0) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(244,248,240,0.55)';
      ctx.strokeRect(...strip('bench', a, b, 2.5, d0 - 1.5));
      ctx.restore();
    }
    const [bx, by, bw, bh] = strip('bench', a + 1.5, b - 1.5, d0, d0 + db);
    if (tier === 0) {
      // 지붕 없는 나무 벤치.
      ctx.fillStyle = '#7b5c3c';
      ctx.fillRect(bx, by, bw, bh);
    } else {
      const flat = bw > bh;
      ctx.fillStyle = 'rgba(6,20,13,0.45)';
      ctx.fillRect(bx + 1.5, by + 2, bw, bh);
      ctx.fillStyle = '#1a2521';
      ctx.fillRect(bx, by, bw, bh);
      for (let i = 0; i < 6; i++) {
        const k = (i + 0.5) / 6;
        dot(flat ? bx + bw * k : bx + bw / 2, flat ? by + bh / 2 : by + bh * k, Math.min(bw, bh) * 0.24, color);
      }
      // 투명한 지붕과 뼈대.
      ctx.fillStyle = 'rgba(206,222,228,0.3)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(236,244,244,0.85)';
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
    // 감독: 어두운 외투에 팀 색 테두리. 우리 감독은 우리 진영 쪽에 선다.
    const mid = (a + b) / 2;
    const [mx, my] = strip('bench', mid, mid, Math.max(4, (d0 + 1) / 2), 0);
    const rad = clamp(s * 0.5, 2.8, 3.8);
    dot(mx + shade[0] * rad * 2, my + shade[1] * rad * 2, rad, 'rgba(6,22,14,0.35)');
    dot(mx, my, rad, '#1d222b');
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();
    dot(mx - uy[0] * rad * 0.55, my - uy[1] * rad * 0.55, rad * 0.5, '#d9b08c');
  });

  // ----- 빛 -----
  if (day && tier >= 1 && !(tier === 1 && p.up)) {
    // 위쪽 스탠드의 그림자가 경기장에 걸친다.
    const depth = ([0, 4, 10, 15][tier] as number) * s;
    ctx.fillStyle = look.weather === 'heat' ? 'rgba(2,24,14,0.22)' : 'rgba(2,24,14,0.16)';
    ctx.beginPath();
    ctx.moveTo(ix - hb, iy - hb);
    ctx.lineTo(ix + iw + hb, iy - hb);
    ctx.lineTo(ix + iw + hb, y0 + depth * 0.7);
    ctx.lineTo(ix - hb, y0 + depth);
    ctx.fill();
  }
  if (look.night) {
    // 조명은 잔디만 비춘다. 관중석은 어둡고, 휴대폰 불빛이 드문드문 보인다.
    ctx.fillStyle = 'rgba(3,8,20,0.36)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(ix, iy, iw, ih);
    ctx.fill('evenodd');
    ctx.fillStyle = 'rgba(4,14,34,0.15)';
    ctx.fillRect(ix, iy, iw, ih);
    for (const list of crowd) list.forEach((f, i) => {
      if (i % 41 !== 5) return;
      ctx.fillStyle = 'rgba(255,255,240,0.75)';
      ctx.fillRect(f.x - 0.5, f.y - 0.5, 1, 1);
    });
    for (const [lx, ly] of lamps) {
      dot(lx, ly, 2.6, 'rgba(255,246,200,0.22)');
      dot(lx, ly, 1.2, '#fff8d8');
    }
  } else if (look.weather === 'rain') {
    ctx.fillStyle = 'rgba(14,30,42,0.22)';
    ctx.fillRect(0, 0, w, h);
  } else if (look.weather === 'heat') {
    ctx.fillStyle = 'rgba(255,214,120,0.08)';
    ctx.fillRect(ix, iy, iw, ih);
  }

  return { image, fans: [...thin(crowd[0], 300), ...thin(crowd[1], 300)], dot: tier === 0 ? 1.9 : pr, shade, lit: look.night };
}
