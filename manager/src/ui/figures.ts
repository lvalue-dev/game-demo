// 경기장 위에서 움직이는 것들: 선수, 공, 코너 깃발, 비와 바람, 골이 들어간 뒤의 그물과 관중.
// 위에서 내려다본 납작한 그림이다. 선수는 등번호가 읽히는 몸통에 머리와 발이 붙는다.

import type { Fan } from './stadium.ts';
import { light } from './stadium.ts';

export const PICK = '#ffe14a';

export interface Kit {
  body: string;
  trim: string;
  /** 0 단색, 1 반반, 2 세로 줄무늬, 3 가로 줄무늬, 4 사선 띠. */
  pattern: number;
  keeper: string;
}

export interface Figure {
  x: number;
  y: number;
  /** 몸통 반지름(px). */
  r: number;
  /** 바라보는 쪽(화면 각도). */
  ang: number;
  kit: Kit;
  /** 몸통 바탕색. 골키퍼는 유니폼이 다르다. */
  body: string;
  skin: string;
  hair: string;
  keeper: boolean;
  n: number;
  /** 걸음의 위상과 세기(0 서 있음 ~ 1 달림). */
  stride: number;
  run: number;
  hasBall: boolean;
  picked: boolean;
  /** 그림자가 떨어지는 쪽(반지름에 곱한다). */
  shade: [number, number];
  /** 야간 조명 아래에서는 그림자가 네 갈래로 옅게 진다. */
  lit: boolean;
}

const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
};

/** 유니폼 무늬를 원 안에 그린다. */
function shirt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: Kit, body: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  if (body === k.body && k.pattern) {
    ctx.clip();
    ctx.fillStyle = k.trim;
    if (k.pattern === 1) ctx.fillRect(x, y - r, r, r * 2);
    else if (k.pattern === 2) for (let i = -2; i <= 2; i += 2) ctx.fillRect(x + (i - 0.5) * r * 0.4, y - r, r * 0.4, r * 2);
    else if (k.pattern === 3) for (let i = -2; i <= 2; i += 2) ctx.fillRect(x - r, y + (i - 0.5) * r * 0.4, r * 2, r * 0.4);
    else if (k.pattern === 4) {
      ctx.beginPath();
      ctx.moveTo(x - r, y + r * 0.2);
      ctx.lineTo(x + r * 0.2, y - r);
      ctx.lineTo(x + r * 0.75, y - r);
      ctx.lineTo(x - r, y + r * 0.75);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 선수 한 명. 발과 손은 달릴 때만 몸통 밖으로 나온다. */
export function drawFigure(ctx: CanvasRenderingContext2D, o: Figure): void {
  const { x, y, r } = o;
  const c = Math.cos(o.ang);
  const s = Math.sin(o.ang);
  /** 몸 기준 좌표(앞, 옆)를 화면으로. */
  const at = (a: number, b: number): [number, number] => [x + (c * a - s * b) * r, y + (s * a + c * b) * r];
  const step = Math.sin(o.stride) * o.run;

  if (o.lit) {
    for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ctx.beginPath();
      ctx.ellipse(x + qx * r * 0.5, y + qy * r * 0.5, r * 0.95, r * 0.55, Math.atan2(qy, qx), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(4,14,12,0.15)';
      ctx.fill();
    }
  } else dot(ctx, x + o.shade[0] * r + 0.6, y + o.shade[1] * r + 0.8, r * 1.02, 'rgba(6,22,14,0.34)');

  for (const k of [-1, 1]) {
    const [fx, fy] = at(0.12 + k * step * 1.05, k * 0.4);
    ctx.beginPath();
    ctx.ellipse(fx, fy, r * 0.36, r * 0.21, o.ang, 0, Math.PI * 2);
    ctx.fillStyle = '#16181a';
    ctx.fill();
    const [hx, hy] = at(0.05 - k * step * 0.5, k * 0.98);
    dot(ctx, hx, hy, r * (o.keeper ? 0.27 : 0.2), o.keeper ? '#f4f4ee' : o.skin);
  }

  shirt(ctx, x, y, r, o.kit, o.body);
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  ctx.strokeStyle = o.hasBall ? PICK : 'rgba(10,22,16,0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  // 머리: 살색 원 위에 머리카락을 뒤로 조금 물려 얹으면 이마가 앞쪽에 남는다.
  const [px, py] = at(0.74, 0);
  dot(ctx, px, py, r * 0.46, o.skin);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(10,22,16,0.8)';
  ctx.stroke();
  const [qx, qy] = at(0.57, 0);
  dot(ctx, qx, qy, r * 0.35, o.hair);

  if (o.picked) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
    ctx.strokeStyle = PICK;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // 등번호: 머리에 가리지 않게 뒤로 조금 물린다. 바탕이 밝으면 검게, 무늬가 있으면 테두리를 둘러 읽히게 한다.
  const nx = x - c * r * 0.18;
  const ny = y - s * r * 0.18 + 0.5;
  ctx.font = `700 ${Math.round(r * 1.14)}px 'Barlow Condensed', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ink = light(o.body) ? '#111' : '#fff';
  if (!o.keeper && o.kit.pattern) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = ink === '#111' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)';
    ctx.strokeText(String(o.n), nx, ny);
  }
  ctx.fillStyle = ink;
  ctx.fillText(String(o.n), nx, ny);
}

/** 공. 구르는 만큼 무늬가 돈다. */
export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, roll: number): void {
  dot(ctx, x, y, r, '#ffffff');
  if (r >= 3.4) {
    for (let k = 0; k < 3; k++) {
      const a = roll + (k * Math.PI * 2) / 3;
      dot(ctx, x + Math.cos(a) * r * 0.46, y + Math.sin(a) * r * 0.46, r * 0.27, '#1d2226');
    }
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#111';
  ctx.stroke();
}

/** 코너 깃발. 바람(wind 0~1)이 셀수록 길게 눕고 세게 펄럭인다. */
export function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, t: number, wind: number): void {
  const sway = Math.sin(t * (3 + wind * 5) + x * 0.05) * (0.12 + wind * 0.22);
  const len = size * (1.5 + wind * 0.4);
  const a = 0.5 + sway;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(a - 0.34) * len, y + Math.sin(a - 0.34) * len);
  ctx.lineTo(x + Math.cos(a + 0.34) * len * 0.92, y + Math.sin(a + 0.34) * len * 0.92);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(10,22,16,0.6)';
  ctx.stroke();
  dot(ctx, x, y, Math.max(1.3, size * 0.3), '#f4f4ee');
}

const hash = (i: number, k: number): number => {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** 비: 화면 전체에 비스듬히 떨어지는 짧은 줄기. */
export function drawRain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(214,232,240,0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 80; i++) {
    const fall = 260 + hash(i, 1) * 160;
    const y = ((hash(i, 2) * (h + 40) + t * fall) % (h + 40)) - 20;
    const x = ((hash(i, 3) * (w + 60) - (t * fall * 0.22)) % (w + 60) + (w + 60)) % (w + 60) - 20;
    const len = 7 + hash(i, 4) * 6;
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.22, y + len);
  }
  ctx.stroke();
  ctx.restore();
}

/** 강풍: 잔디 위를 가로질러 날리는 검불. */
export function drawWind(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 12; i++) {
    const pace = 90 + hash(i, 5) * 110;
    const x = ((hash(i, 6) * (w + 80) + t * pace) % (w + 80)) - 40;
    const y = hash(i, 7) * h + Math.sin(t * 2.4 + i) * 7;
    const len = 9 + hash(i, 8) * 14;
    ctx.strokeStyle = `rgba(240,246,232,${0.14 + hash(i, 9) * 0.16})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y - 2.5, x + len, y + Math.sin(t * 5 + i) * 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** 골이 들어간 뒤: 넣은 팀 관중이 뛰고, 관중석에서 종이가 날린다. */
export interface Party {
  start: number;
  until: number;
  fans: Fan[];
  /** 관중 한 명의 반지름(px). */
  size: number;
  bits: { x: number; y: number; vx: number; vy: number; color: string; life: number; spin: number }[];
}

export function startParty(now: number, fans: Fan[], size: number, colors: [string, string], w: number, h: number): Party {
  const bits: Party['bits'] = [];
  const count = Math.min(70, fans.length);
  for (let i = 0; i < count; i++) {
    const f = fans[Math.floor(hash(i, now % 97) * fans.length)] as Fan;
    // 경기장 가운데 쪽으로 던진다.
    const dx = w / 2 - f.x;
    const dy = h / 2 - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const pace = 26 + hash(i, 11) * 44;
    bits.push({
      x: f.x, y: f.y, vx: (dx / d) * pace + (hash(i, 12) - 0.5) * 30, vy: (dy / d) * pace + (hash(i, 13) - 0.5) * 30,
      color: hash(i, 14) < 0.3 || (i % 2 === 1 && !light(colors[1])) ? '#f6f4ea' : (colors[i % 2] as string), life: 1.1 + hash(i, 15) * 1.3, spin: hash(i, 16) * 6,
    });
  }
  return { start: now, until: now + 2600, fans, size, bits };
}

export function drawParty(ctx: CanvasRenderingContext2D, party: Party, now: number, still: boolean): void {
  const t = (now - party.start) / 1000;
  const fade = Math.min(1, (party.until - now) / 500);
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  party.fans.forEach((f, i) => {
    const hop = still ? 1.5 : Math.abs(Math.sin(t * 8.5 + i * 1.7)) * (party.size + 1.4);
    dot(ctx, f.x, f.y - hop, party.size + 0.3, f.color);
  });
  if (!still) {
    for (const b of party.bits) {
      if (t > b.life) continue;
      const k = t / b.life;
      // 던져진 종이는 곧 느려지며 내려앉는다.
      const ease = 1 - (1 - k) * (1 - k);
      const x = b.x + b.vx * b.life * ease;
      const y = b.y + b.vy * b.life * ease + Math.sin(t * 7 + b.spin) * 2;
      ctx.globalAlpha = fade * (1 - k * k);
      ctx.fillStyle = b.color;
      const wide = Math.abs(Math.cos(t * 9 + b.spin)) * 2.4 + 0.8;
      ctx.fillRect(x - wide / 2, y - 1, wide, 2);
    }
  }
  ctx.restore();
}

/** 골망이 출렁인다. rect는 그물 자리, out은 골라인에서 바깥쪽, k는 1에서 0으로 줄어든다. */
export function drawNetHit(ctx: CanvasRenderingContext2D, rect: [number, number, number, number], out: [number, number], k: number, t: number): void {
  const [x, y, w, h] = rect;
  const bulge = Math.max(0, k) * Math.min(w, h) * 0.5 * (0.6 + 0.4 * Math.cos(t * 26));
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${0.34 * k})`;
  ctx.fillRect(x, y, w, h);
  // 뒤쪽 그물 선이 바깥으로 부푼다.
  const flat = Math.abs(out[1]) > 0.5;
  const [ax, ay] = flat ? [x, out[1] > 0 ? y + h : y] : [out[0] > 0 ? x + w : x, y];
  const [bx, by] = flat ? [x + w, ay] : [ax, y + h];
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo((ax + bx) / 2 + out[0] * bulge * 2, (ay + by) / 2 + out[1] * bulge * 2, bx, by);
  ctx.closePath();
  ctx.fillStyle = `rgba(255,255,255,${0.3 * k})`;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = `rgba(255,255,255,${0.9 * k})`;
  ctx.stroke();
  ctx.restore();
}
