import { WORLD_H, WORLD_W } from './game/map.ts';
import { ENEMY_DEFS, ENEMY_R, ESCAPE_TIME, HORSE_REACH, LOOT_REACH, PLAYER_R, quotaMet } from './game/sim.ts';
import type { Enemy, Rect, Vec, World } from './game/types.ts';
import type { Stick } from './input.ts';

// 캔버스 안의 색은 CSS 토큰과 같은 팔레트를 쓴다.
const C = {
  sand: '#e2c48a',
  sandDark: '#d2b072',
  street: '#ecd4a3',
  rut: '#d9bd86',
  shadow: 'rgba(58, 38, 24, 0.28)',
  ink: '#2a1a10',
  leather: '#5a3a22',
  paper: '#f3e3bf',
  gold: '#d99a1c',
  blood: '#b3261e',
  sage: '#3f7a52',
  law: '#3d5a80',
  lawDark: '#243a57',
  cactus: '#5d8a4e',
  roof: { bank: '#8c3b2a', saloon: '#7a5230', store: '#6b6a4a', house: '#8a6a45', cover: '#6e4a2c' },
};

export interface View {
  w: number;
  h: number;
  /** 기기 픽셀 배율. 캔버스는 이만큼 크게 잡고 그릴 때 되돌린다. */
  dpr: number;
  zoom: number;
  camX: number;
  camY: number;
}

const VIEW_SHORT_SIDE = 600;

export function makeView(w: number, h: number, dpr: number): View {
  return { w, h, dpr, zoom: Math.min(w, h) / VIEW_SHORT_SIDE, camX: 0, camY: 0 };
}

export function updateCamera(view: View, world: World, dt: number): void {
  const p = world.player;
  const halfW = view.w / view.zoom / 2;
  const halfH = view.h / view.zoom / 2;
  // 조준하는 쪽이 조금 더 보이게 당겨 준다.
  const tx = p.x + Math.cos(p.aimDir) * 50;
  const ty = p.y + Math.sin(p.aimDir) * 50;
  const k = Math.min(1, dt * 7);
  view.camX += (tx - view.camX) * k;
  view.camY += (ty - view.camY) * k;
  view.camX = halfW * 2 >= WORLD_W ? WORLD_W / 2 : Math.max(halfW, Math.min(WORLD_W - halfW, view.camX));
  view.camY = halfH * 2 >= WORLD_H ? WORLD_H / 2 : Math.max(halfH, Math.min(WORLD_H - halfH, view.camY));
}

export function snapCamera(view: View, world: World): void {
  view.camX = world.player.x;
  view.camY = world.player.y;
  updateCamera(view, world, 1);
}

export function screenToWorld(view: View, sx: number, sy: number): Vec {
  return { x: (sx - view.w / 2) / view.zoom + view.camX, y: (sy - view.h / 2) / view.zoom + view.camY };
}

function toScreen(view: View, p: Vec): Vec {
  return { x: (p.x - view.camX) * view.zoom + view.w / 2, y: (p.y - view.camY) * view.zoom + view.h / 2 };
}

export function draw(ctx: CanvasRenderingContext2D, view: View, world: World, sticks: Stick[], time: number): void {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = C.sand;
  ctx.fillRect(0, 0, view.w, view.h);

  const shakeX = (Math.random() - 0.5) * world.shake;
  const shakeY = (Math.random() - 0.5) * world.shake;
  ctx.save();
  ctx.translate(view.w / 2 + shakeX, view.h / 2 + shakeY);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.camX, -view.camY);

  drawGround(ctx, world);
  for (const l of world.loots) if (!l.taken) drawLoot(ctx, l, time);
  drawHorse(ctx, world, time);
  for (const o of world.obstacles) drawObstacle(ctx, o);
  for (const e of world.enemies) drawTelegraph(ctx, e);
  for (const e of world.enemies) drawEnemy(ctx, e);
  drawPlayer(ctx, world, time);
  drawBullets(ctx, world);
  for (const q of world.particles) {
    ctx.globalAlpha = Math.max(0, q.life / q.maxLife);
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  drawProgress(ctx, world);
  ctx.restore();

  drawArrows(ctx, view, world, time);
  drawSticks(ctx, sticks);
  if (world.player.hurtFlash > 0) {
    ctx.fillStyle = `rgba(179, 38, 30, ${world.player.hurtFlash * 0.9})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

function drawGround(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.fillStyle = C.sand;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // 마을을 가로지르는 큰길
  ctx.fillStyle = C.street;
  ctx.fillRect(0, 520, WORLD_W, 200);
  ctx.fillStyle = C.rut;
  for (let x = 20; x < WORLD_W; x += 90) {
    ctx.fillRect(x, 596, 46, 3);
    ctx.fillRect(x + 30, 646, 46, 3);
  }
  // 세계 끝 울타리
  ctx.strokeStyle = C.leather;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, WORLD_W - 4, WORLD_H - 4);

  for (const d of world.decor) {
    const s = d.size;
    if (d.kind === 'cactus') {
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(d.x + 4, d.y + 6, 9 * s, 4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.cactus;
      ctx.fillRect(d.x - 3 * s, d.y - 14 * s, 6 * s, 18 * s);
      ctx.fillRect(d.x - 9 * s, d.y - 8 * s, 6 * s, 4 * s);
      ctx.fillRect(d.x - 9 * s, d.y - 12 * s, 3 * s, 6 * s);
      ctx.fillRect(d.x + 3 * s, d.y - 5 * s, 6 * s, 4 * s);
      ctx.fillRect(d.x + 6 * s, d.y - 10 * s, 3 * s, 7 * s);
    } else if (d.kind === 'bush') {
      ctx.fillStyle = C.sandDark;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 7 * s, 0, Math.PI * 2);
      ctx.arc(d.x + 8 * s, d.y + 2, 5 * s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = C.rut;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 8 * s, 5 * s, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Rect): void {
  ctx.fillStyle = C.shadow;
  ctx.fillRect(o.x + 8, o.y + 10, o.w, o.h);
  ctx.fillStyle = C.roof[o.kind];
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(o.x, o.y, o.w, o.h);
  if (o.kind === 'cover') return;
  // 지붕 널판
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = o.y + 18; y < o.y + o.h; y += 18) {
    ctx.moveTo(o.x, y);
    ctx.lineTo(o.x + o.w, y);
  }
  ctx.stroke();
  if (o.label) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(o.x + o.w / 2 - 38, o.y + o.h - 30, 76, 22);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(o.x + o.w / 2 - 38, o.y + o.h - 30, 76, 22);
    ctx.fillStyle = C.ink;
    ctx.font = '700 14px "IBM Plex Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.label, o.x + o.w / 2, o.y + o.h - 18);
  }
}

function drawLoot(ctx: CanvasRenderingContext2D, l: { x: number; y: number; kind: 'bag' | 'safe' }, time: number): void {
  const bob = Math.sin(time * 3 + l.x) * 1.5;
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(l.x + 3, l.y + 9, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (l.kind === 'safe') {
    ctx.fillStyle = '#565b63';
    ctx.fillRect(l.x - 15, l.y - 15, 30, 30);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(l.x - 15, l.y - 15, 30, 30);
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(l.x + 5, l.y - 3);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#b08a4f';
    ctx.beginPath();
    ctx.arc(l.x, l.y + bob, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(l.x - 4, l.y - 13 + bob, 8, 6);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(l.x, l.y + bob, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = '700 12px "Rye", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', l.x, l.y + 1 + bob);
  }
}

function drawHorse(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const h = world.horse;
  const ready = quotaMet(world);
  if (ready) {
    const pulse = 0.5 + Math.sin(time * 5) * 0.5;
    ctx.strokeStyle = C.sage;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.35 + pulse * 0.5;
    ctx.beginPath();
    ctx.arc(h.x, h.y, HORSE_REACH + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 말뚝
  ctx.fillStyle = C.leather;
  ctx.fillRect(h.x - 34, h.y - 4, 5, 26);
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(h.x + 5, h.y + 14, 26, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 위에서 본 말: 몸통, 목과 머리, 안장
  ctx.fillStyle = '#6b4226';
  ctx.beginPath();
  ctx.ellipse(h.x, h.y, 24, 11, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(h.x + 24, h.y - 10, 10, 6, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.ellipse(h.x - 2, h.y, 8, 7, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawTelegraph(ctx: CanvasRenderingContext2D, e: Enemy): void {
  if (e.aim <= 0) return;
  const def = ENEMY_DEFS[e.kind];
  const locked = e.aim <= def.lockTime;
  const reach = e.kind === 'rifle' ? 620 : 300;
  ctx.strokeStyle = C.blood;
  ctx.globalAlpha = locked ? 0.95 : 0.4;
  ctx.lineWidth = locked ? 3 : 1.5;
  ctx.setLineDash(locked ? [] : [8, 6]);
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x + Math.cos(e.aimDir) * reach, e.y + Math.sin(e.aimDir) * reach);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawFigure(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dir: number,
  body: string, hat: string, barrel: number, flash: boolean,
): void {
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 5, r, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  // 총
  ctx.fillStyle = C.ink;
  ctx.fillRect(r - 4, -2, barrel, 4);
  // 몸통
  ctx.fillStyle = flash ? C.paper : body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 모자: 넓은 챙 위에 작은 정수리
  ctx.fillStyle = flash ? C.paper : hat;
  ctx.beginPath();
  ctx.ellipse(-1, 0, r * 0.95, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-1, 0, r * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy): void {
  const rifle = e.kind === 'rifle';
  const dir = e.aim > 0 ? e.aimDir : 0;
  drawFigure(ctx, e.x, e.y, ENEMY_R, dir, C.law, rifle ? '#1c2c42' : C.lawDark, rifle ? 24 : 13, e.hitFlash > 0);
  // 보안관 별
  ctx.fillStyle = C.gold;
  ctx.fillRect(e.x - 2, e.y - 2, 4, 4);
}

function drawPlayer(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const p = world.player;
  if (world.phase === 'dead') return;
  const blink = p.invuln > 0 && p.dashTime === 0 && Math.floor(time * 20) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.45;
  drawFigure(ctx, p.x, p.y, PLAYER_R, p.aimDir, '#8c3b2a', '#3a2618', 14, false);
  ctx.globalAlpha = 1;

  // 탄창: 발밑에 남은 탄을 점으로 보여 준다.
  const n = world.stats.maxAmmo;
  const gap = 7;
  const startX = p.x - ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, p.y + PLAYER_R + 12, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = i < p.ammo ? C.ink : 'rgba(42, 26, 16, 0.22)';
    ctx.fill();
  }
  if (p.reload > 0) {
    const t = 1 - p.reload / world.stats.reloadTime;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
    ctx.stroke();
  }
}

function drawBullets(ctx: CanvasRenderingContext2D, world: World): void {
  for (const b of world.bullets) {
    const len = b.fromPlayer ? 0.022 : 0.03;
    ctx.strokeStyle = b.fromPlayer ? C.ink : C.blood;
    ctx.lineWidth = b.fromPlayer ? 2.5 : 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * len, b.y - b.vy * len);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawProgress(ctx: CanvasRenderingContext2D, world: World): void {
  const p = world.player;
  for (const l of world.loots) {
    if (l.taken) continue;
    const near = Math.hypot(l.x - p.x, l.y - p.y) <= LOOT_REACH;
    if (l.progress <= 0 && !near) continue;
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.3)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.gold;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, l.progress / l.time));
    ctx.stroke();
  }
  if (world.escapeProgress > 0) {
    ctx.strokeStyle = C.sage;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(world.horse.x, world.horse.y, 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, world.escapeProgress / ESCAPE_TIME));
    ctx.stroke();
  }
}

/** 화면 밖에 있는 돈과 말의 방향을 가장자리 화살표로 알려 준다. */
function drawArrows(ctx: CanvasRenderingContext2D, view: View, world: World, time: number): void {
  const margin = 34;
  const arrow = (target: Vec, color: string, size: number): void => {
    const s = toScreen(view, target);
    if (s.x > margin && s.x < view.w - margin && s.y > margin + 40 && s.y < view.h - margin) return;
    const cx = view.w / 2;
    const cy = view.h / 2;
    const a = Math.atan2(s.y - cy, s.x - cx);
    const t = Math.min(
      (view.w / 2 - margin) / Math.abs(Math.cos(a) || 1e-6),
      (view.h / 2 - margin - 30) / Math.abs(Math.sin(a) || 1e-6),
    );
    ctx.save();
    ctx.translate(cx + Math.cos(a) * t, cy + 15 + Math.sin(a) * t);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.75);
    ctx.lineTo(-size * 0.7, -size * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  for (const l of world.loots) if (!l.taken) arrow(l, C.gold, l.kind === 'safe' ? 12 : 8);
  if (quotaMet(world)) arrow(world.horse, C.sage, 13 + Math.sin(time * 6) * 2);
}

function drawSticks(ctx: CanvasRenderingContext2D, sticks: Stick[]): void {
  for (const s of sticks) {
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.originX, s.originY, s.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(42, 26, 16, 0.4)';
    ctx.beginPath();
    ctx.arc(s.originX + s.dx * s.radius, s.originY + s.dy * s.radius, 20, 0, Math.PI * 2);
    ctx.fill();
  }
}
