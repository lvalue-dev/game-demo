import { WORLD_H, WORLD_W } from './game/map.ts';
import { ENEMY_DEFS, ESCAPE_TIME, HORSE_REACH, LOOT_REACH, PLAYER_R, heatLevel, quotaMet } from './game/sim.ts';
import type { Bomb, Corpse, Enemy, EnemyKind, Loot, Pickup, Rect, Vec, World } from './game/types.ts';
import type { Stick } from './input.ts';

// 캔버스 안의 색은 CSS 토큰과 같은 팔레트를 쓴다.
const C = {
  sand: '#e0bf84',
  sandLight: '#ead09a',
  sandDark: '#cfa969',
  street: '#edd6a6',
  rut: '#d6b77f',
  shadow: 'rgba(52, 30, 16, 0.3)',
  ink: '#2a1a10',
  leather: '#5a3a22',
  wood: '#7a5230',
  woodLight: '#a47a4a',
  paper: '#f3e3bf',
  gold: '#d99a1c',
  goldLight: '#f6d67a',
  blood: '#b3261e',
  bloodDark: '#7a1712',
  fire: '#e8742a',
  sage: '#3f7a52',
  cactus: '#5d8a4e',
  cactusDark: '#3f6a3a',
  water: '#6fa8b8',
};

const ROOF: Record<Rect['kind'], [string, string]> = {
  bank: ['#a34a34', '#7d3526'],
  saloon: ['#8d6238', '#6c4826'],
  store: ['#7f7d55', '#5f5d3e'],
  house: ['#9a7850', '#765a3a'],
  cover: ['#7a5230', '#5a3a22'],
};

interface Look {
  coat: string;
  hat: string;
  band: string;
  barrel: number;
  thick: number;
}

const LOOKS: Record<EnemyKind, Look> = {
  deputy: { coat: '#3d5a80', hat: '#c9b48a', band: '#243a57', barrel: 13, thick: 4 },
  shotgun: { coat: '#6b4a2f', hat: '#241a14', band: '#b3261e', barrel: 15, thick: 7 },
  rifle: { coat: '#6d7278', hat: '#3c4046', band: '#c9b48a', barrel: 26, thick: 3.5 },
  bomber: { coat: '#9c3327', hat: '#4a3524', band: '#f6d67a', barrel: 0, thick: 0 },
  sheriff: { coat: '#1e1a1a', hat: '#f1ead8', band: '#d99a1c', barrel: 17, thick: 5 },
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

/** 모래 바닥의 얼룩. 한 번 정해 두고 계속 쓴다. */
const GROUND_SPOTS = (() => {
  let seed = 9173;
  const r = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  return Array.from({ length: 90 }, () => ({
    x: r() * WORLD_W, y: r() * WORLD_H, rx: 30 + r() * 90, ry: 12 + r() * 30, a: r() * Math.PI, light: r() < 0.45,
  }));
})();

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

  drawGround(ctx, world, time);
  for (const c of world.corpses) drawCorpse(ctx, c);
  for (const b of world.bombs) drawBombTarget(ctx, b);
  for (const l of world.loots) if (!l.taken) drawLoot(ctx, l, time);
  for (const k of world.pickups) drawPickup(ctx, k, time);
  drawHorse(ctx, world, time);
  for (const o of world.obstacles) drawObstacle(ctx, o, time);
  for (const e of world.enemies) drawTelegraph(ctx, e);
  for (const e of world.enemies) drawEnemy(ctx, e, time);
  drawPlayer(ctx, world, time);
  drawBullets(ctx, world);
  for (const b of world.bombs) drawBomb(ctx, b, time);
  drawBlasts(ctx, world);
  for (const q of world.particles) {
    ctx.globalAlpha = Math.max(0, q.life / q.maxLife);
    ctx.fillStyle = q.color;
    ctx.beginPath();
    ctx.arc(q.x, q.y, q.size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawProgress(ctx, world);
  drawTexts(ctx, world);
  ctx.restore();

  drawAtmosphere(ctx, view, world, time);
  drawArrows(ctx, view, world, time);
  drawSticks(ctx, sticks);
}

// ---------- 땅과 건물 ----------

function drawGround(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  ctx.fillStyle = C.sand;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  for (const s of GROUND_SPOTS) {
    ctx.fillStyle = s.light ? C.sandLight : C.sandDark;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.rx, s.ry, s.a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 마을을 가로지르는 큰길과 수레바퀴 자국
  ctx.fillStyle = C.street;
  ctx.fillRect(0, 520, WORLD_W, 200);
  ctx.strokeStyle = C.rut;
  ctx.lineWidth = 5;
  for (const y of [590, 650]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= WORLD_W; x += 80) ctx.lineTo(x, y + Math.sin(x * 0.011 + y) * 7);
    ctx.stroke();
  }
  ctx.fillStyle = C.rut;
  for (let x = 30; x < WORLD_W; x += 70) {
    ctx.beginPath();
    ctx.ellipse(x, 620 + Math.sin(x) * 10, 5, 3, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 세계 끝의 나무 울타리
  ctx.strokeStyle = C.leather;
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, WORLD_W - 6, WORLD_H - 6);
  ctx.fillStyle = C.leather;
  for (let x = 3; x < WORLD_W; x += 60) {
    ctx.fillRect(x - 3, 0, 7, 9);
    ctx.fillRect(x - 3, WORLD_H - 9, 7, 9);
  }

  for (const d of world.decor) {
    const s = d.size;
    if (d.kind === 'cactus') {
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(d.x + 8 * s, d.y + 6, 12 * s, 4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.cactus;
      ctx.strokeStyle = C.cactusDark;
      ctx.lineWidth = 1.5;
      const part = (x: number, y: number, w: number, h: number): void => {
        ctx.beginPath();
        ctx.roundRect(d.x + x * s, d.y + y * s, w * s, h * s, 3 * s);
        ctx.fill();
        ctx.stroke();
      };
      part(-4, -18, 8, 24);
      part(-11, -10, 5, 9);
      part(6, -14, 5, 10);
    } else if (d.kind === 'bush') {
      ctx.fillStyle = '#b89a5e';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 7 * s, 0, Math.PI * 2);
      ctx.arc(d.x + 8 * s, d.y + 2, 5 * s, 0, Math.PI * 2);
      ctx.arc(d.x + 3 * s, d.y - 5 * s, 4 * s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(d.x + 3, d.y + 3, 9 * s, 5 * s, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b9a07a';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, 8 * s, 5 * s, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 길 위를 굴러다니는 회전초
  for (let i = 0; i < 4; i++) {
    const speed = 46 + i * 17;
    const x = ((i * 430 + time * speed) % (WORLD_W + 120)) - 60;
    const y = 545 + i * 44 + Math.sin(time * 1.3 + i) * 10;
    ctx.save();
    ctx.translate(x, y + Math.abs(Math.sin(time * 5 + i)) * -5);
    ctx.rotate(time * (speed / 14));
    ctx.strokeStyle = '#9a7a45';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 5 + k * 1.3, (k * Math.PI) / 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Rect, time: number): void {
  if (o.kind === 'cover') {
    drawCover(ctx, o);
    return;
  }
  const [light, dark] = ROOF[o.kind];
  // 길 쪽을 향한 나무 보도와 기둥
  const facesSouth = o.y < 520;
  const porchY = facesSouth ? o.y + o.h : o.y - 18;
  ctx.fillStyle = C.shadow;
  ctx.fillRect(o.x + 12, o.y + 16, o.w, o.h + (facesSouth ? 18 : 0));
  ctx.fillStyle = C.woodLight;
  ctx.fillRect(o.x + 6, porchY, o.w - 12, 18);
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = o.x + 6; x <= o.x + o.w - 6; x += 14) {
    ctx.moveTo(x, porchY);
    ctx.lineTo(x, porchY + 18);
  }
  ctx.stroke();
  ctx.fillStyle = C.leather;
  for (const x of [o.x + 8, o.x + o.w / 2 - 3, o.x + o.w - 14]) ctx.fillRect(x, facesSouth ? porchY + 12 : porchY, 6, 6);

  // 지붕: 용마루를 경계로 밝은 면과 어두운 면
  ctx.fillStyle = light;
  ctx.fillRect(o.x, o.y, o.w, o.h / 2);
  ctx.fillStyle = dark;
  ctx.fillRect(o.x, o.y + o.h / 2, o.w, o.h / 2);
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = o.y + 13; y < o.y + o.h; y += 13) {
    ctx.moveTo(o.x, y);
    ctx.lineTo(o.x + o.w, y);
  }
  for (let x = o.x + 40; x < o.x + o.w; x += 40) {
    ctx.moveTo(x, o.y);
    ctx.lineTo(x, o.y + o.h);
  }
  ctx.stroke();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(o.x, o.y, o.w, o.h);
  ctx.beginPath();
  ctx.moveTo(o.x, o.y + o.h / 2);
  ctx.lineTo(o.x + o.w, o.y + o.h / 2);
  ctx.stroke();

  // 굴뚝
  ctx.fillStyle = '#4a3a30';
  ctx.fillRect(o.x + o.w - 40, o.y + 16, 18, 18);
  ctx.fillStyle = C.ink;
  ctx.fillRect(o.x + o.w - 36, o.y + 20, 10, 10);

  // 문 앞 등불
  const doorX = o.x + o.w / 2;
  const doorY = facesSouth ? o.y + o.h + 9 : o.y - 9;
  const glow = ctx.createRadialGradient(doorX, doorY, 0, doorX, doorY, 34);
  glow.addColorStop(0, `rgba(255, 214, 110, ${0.5 + Math.sin(time * 9 + o.x) * 0.06})`);
  glow.addColorStop(1, 'rgba(255, 214, 110, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(doorX - 36, doorY - 36, 72, 72);
  ctx.fillStyle = C.ink;
  ctx.fillRect(doorX - 11, facesSouth ? o.y + o.h - 3 : o.y - 3, 22, 6);

  if (o.label) {
    const sy = facesSouth ? o.y + o.h - 36 : o.y + 12;
    ctx.fillStyle = C.paper;
    ctx.fillRect(doorX - 44, sy, 88, 24);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(doorX - 44, sy, 88, 24);
    ctx.fillStyle = C.ink;
    ctx.font = '700 15px "IBM Plex Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.label, doorX, sy + 13);
  }
}

function drawCover(ctx: CanvasRenderingContext2D, o: Rect): void {
  ctx.fillStyle = C.shadow;
  ctx.fillRect(o.x + 6, o.y + 8, o.w, o.h);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2;
  if (o.w >= 70 && o.h < 34) {
    // 말 물통
    ctx.fillStyle = C.wood;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = C.water;
    ctx.fillRect(o.x + 5, o.y + 5, o.w - 10, o.h - 10);
    ctx.strokeRect(o.x, o.y, o.w, o.h);
  } else if (o.w >= 80) {
    // 짐마차
    ctx.fillStyle = C.ink;
    for (const [wx, wy] of [[0.15, -4], [0.85, -4], [0.15, o.h + 4], [0.85, o.h + 4]] as const) {
      ctx.beginPath();
      ctx.ellipse(o.x + o.w * wx, o.y + wy, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = C.woodLight;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#e9dcc0';
    ctx.beginPath();
    ctx.roundRect(o.x + 10, o.y + 4, o.w - 34, o.h - 8, 8);
    ctx.fill();
    ctx.stroke();
  } else {
    // 나무 상자
    ctx.fillStyle = C.wood;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(o.x + o.w, o.y + o.h);
    ctx.moveTo(o.x + o.w, o.y);
    ctx.lineTo(o.x, o.y + o.h);
    ctx.stroke();
  }
}

// ---------- 돈, 말 ----------

function drawLoot(ctx: CanvasRenderingContext2D, l: Loot, time: number): void {
  const bob = Math.sin(time * 3 + l.x) * 1.5;
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(l.x + 4, l.y + 11, 15, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2;
  if (l.kind === 'safe') {
    ctx.fillStyle = '#4f555e';
    ctx.beginPath();
    ctx.roundRect(l.x - 17, l.y - 17, 34, 34, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6d747e';
    ctx.fillRect(l.x - 12, l.y - 12, 24, 24);
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(l.x + Math.cos(time * 2) * 5, l.y + Math.sin(time * 2) * 5);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#b08a4f';
    ctx.beginPath();
    ctx.arc(l.x, l.y + bob, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(l.x - 5, l.y - 9 + bob);
    ctx.lineTo(l.x - 7, l.y - 16 + bob);
    ctx.lineTo(l.x + 7, l.y - 16 + bob);
    ctx.lineTo(l.x + 5, l.y - 9 + bob);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = '700 13px "Rye", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', l.x, l.y + 1 + bob);
  }
  // 멀리서도 눈에 띄게 반짝임
  const tw = (Math.sin(time * 4 + l.id * 1.7) + 1) / 2;
  ctx.strokeStyle = C.goldLight;
  ctx.globalAlpha = tw * 0.9;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(l.x + 12, l.y - 20);
  ctx.lineTo(l.x + 12, l.y - 10);
  ctx.moveTo(l.x + 7, l.y - 15);
  ctx.lineTo(l.x + 17, l.y - 15);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPickup(ctx: CanvasRenderingContext2D, k: Pickup, time: number): void {
  if (k.life < 3 && Math.floor(time * 10) % 2 === 0) return;
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(k.x + 2, k.y + 5, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  if (k.kind === 'coin') {
    const squash = Math.abs(Math.cos(time * 6 + k.id));
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.ellipse(k.x, k.y, 2 + 4 * squash, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.goldLight;
    ctx.fillRect(k.x - 1, k.y - 3, 2, 3);
  } else {
    ctx.fillStyle = '#b5651d';
    ctx.beginPath();
    ctx.roundRect(k.x - 5, k.y - 5, 10, 13, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(k.x - 2, k.y - 10, 4, 6);
    ctx.strokeRect(k.x - 2, k.y - 10, 4, 6);
    ctx.fillStyle = C.paper;
    ctx.fillRect(k.x - 4, k.y - 1, 8, 5);
  }
}

function drawHorse(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const h = world.horse;
  if (quotaMet(world)) {
    const pulse = 0.5 + Math.sin(time * 5) * 0.5;
    ctx.strokeStyle = C.sage;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.35 + pulse * 0.5;
    ctx.beginPath();
    ctx.arc(h.x, h.y, HORSE_REACH + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = C.leather;
  ctx.fillRect(h.x - 36, h.y - 6, 6, 28);
  ctx.fillRect(h.x - 44, h.y - 2, 22, 4);
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(h.x + 7, h.y + 15, 28, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 위에서 본 말: 몸통, 목과 머리, 갈기, 꼬리, 안장
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.fillStyle = '#6b4226';
  ctx.beginPath();
  ctx.ellipse(h.x, h.y, 25, 12, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(h.x + 25, h.y - 11, 11, 6, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(h.x + 12, h.y - 8);
  ctx.lineTo(h.x + 22, h.y - 13);
  ctx.moveTo(h.x - 23, h.y + 7);
  ctx.lineTo(h.x - 33, h.y + 12 + Math.sin(time * 3) * 3);
  ctx.stroke();
  ctx.fillStyle = C.blood;
  ctx.beginPath();
  ctx.ellipse(h.x - 2, h.y, 9, 8, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ---------- 인물 ----------

function drawFigure(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dir: number, look: Look,
  opts: { walk: number; flash: boolean; muzzle: boolean; star?: boolean; poncho?: boolean },
): void {
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(x + 5, y + 7, r * 1.05, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;

  // 걷는 다리
  const stride = Math.sin(opts.walk) * r * 0.55;
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.ellipse(stride, -r * 0.42, r * 0.36, r * 0.24, 0, 0, Math.PI * 2);
  ctx.ellipse(-stride, r * 0.42, r * 0.36, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  // 총과 팔
  if (look.barrel > 0) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(r * 0.5, -look.thick / 2 + r * 0.25, look.barrel + r * 0.4, look.thick);
    if (opts.muzzle) {
      const tip = r * 0.9 + look.barrel;
      ctx.fillStyle = C.goldLight;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const len = i % 2 === 0 ? 15 : 6;
        ctx.lineTo(tip + Math.cos(a) * len, r * 0.25 + Math.sin(a) * len * 0.7);
      }
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // 손에 든 다이너마이트
    ctx.fillStyle = C.blood;
    ctx.fillRect(r * 0.5, r * 0.1, r * 0.9, 5);
    ctx.strokeRect(r * 0.5, r * 0.1, r * 0.9, 5);
  }

  // 어깨와 외투
  ctx.fillStyle = opts.flash ? C.paper : look.coat;
  ctx.beginPath();
  if (opts.poncho) {
    ctx.moveTo(r * 0.95, 0);
    ctx.lineTo(0, r * 1.25);
    ctx.lineTo(-r * 1.05, 0);
    ctx.lineTo(0, -r * 1.25);
    ctx.closePath();
  } else {
    ctx.ellipse(0, 0, r * 0.8, r * 1.1, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  if (opts.poncho && !opts.flash) {
    ctx.strokeStyle = C.goldLight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.5);
    ctx.lineTo(-r * 0.5, r * 0.5);
    ctx.stroke();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
  }
  if (opts.star) {
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5;
      const len = i % 2 === 0 ? r * 0.36 : r * 0.15;
      ctx.lineTo(r * 0.15 + Math.cos(a) * len, r * 0.6 + Math.sin(a) * len);
    }
    ctx.closePath();
    ctx.fill();
  }

  // 모자: 넓은 챙, 정수리, 띠
  ctx.fillStyle = opts.flash ? C.paper : look.hat;
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, 0, r * 0.82, r * 0.74, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, 0, r * 0.42, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = opts.flash ? C.ink : look.band;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const def = ENEMY_DEFS[e.kind];
  const dir = e.aim > 0 ? e.aimDir : e.facing;
  drawFigure(ctx, e.x, e.y, def.radius, dir, LOOKS[e.kind], {
    walk: e.aim > 0 ? 0 : time * 11 + e.id,
    flash: e.hitFlash > 0,
    muzzle: e.muzzle > 0,
    star: e.kind === 'deputy' || e.kind === 'sheriff',
  });
  if (e.hp < e.maxHp || e.kind === 'sheriff') {
    const w = e.kind === 'sheriff' ? 46 : 26;
    const y = e.y - def.radius - 14;
    ctx.fillStyle = C.ink;
    ctx.fillRect(e.x - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = C.blood;
    ctx.fillRect(e.x - w / 2, y, (w * e.hp) / e.maxHp, 4);
  }
}

function drawTelegraph(ctx: CanvasRenderingContext2D, e: Enemy): void {
  if (e.aim <= 0) return;
  const def = ENEMY_DEFS[e.kind];
  const locked = e.aim <= def.lockTime;
  const reach = def.bulletSpeed * def.bulletLife * (e.kind === 'rifle' ? 0.65 : 0.5);
  ctx.strokeStyle = C.blood;
  ctx.globalAlpha = locked ? 0.95 : 0.35;
  ctx.lineWidth = locked ? 3 : 1.5;
  ctx.setLineDash(locked ? [] : [8, 6]);
  const spread = def.pellets > 1 ? 0.24 : 0;
  for (let i = 0; i < def.pellets; i++) {
    const a = e.aimDir + (def.pellets === 1 ? 0 : (i / (def.pellets - 1) - 0.5) * 2 * spread);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x + Math.cos(a) * reach, e.y + Math.sin(a) * reach);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

const CORPSE_COAT: Record<EnemyKind, string> = {
  deputy: '#2f4664', shotgun: '#54391f', rifle: '#585c61', bomber: '#7a271e', sheriff: '#161313',
};

function drawCorpse(ctx: CanvasRenderingContext2D, c: Corpse): void {
  ctx.fillStyle = 'rgba(122, 23, 18, 0.45)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 17, 11, c.dir, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.dir);
  ctx.fillStyle = CORPSE_COAT[c.kind];
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 벗겨진 모자
  ctx.fillStyle = LOOKS[c.kind].hat;
  ctx.beginPath();
  ctx.ellipse(22, 7, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  const p = world.player;
  if (world.phase === 'dead') {
    drawCorpse(ctx, { x: p.x, y: p.y, dir: p.aimDir + Math.PI, kind: 'bomber' });
    return;
  }
  // 조준선
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 7]);
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(p.aimDir) * 34, p.y + Math.sin(p.aimDir) * 34);
  ctx.lineTo(p.x + Math.cos(p.aimDir) * 150, p.y + Math.sin(p.aimDir) * 150);
  ctx.stroke();
  ctx.setLineDash([]);

  const blink = p.invuln > 0 && p.dashTime === 0 && Math.floor(time * 20) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.45;
  const moving = Math.hypot(p.vx, p.vy) > 30;
  drawFigure(ctx, p.x, p.y, PLAYER_R, p.aimDir, { coat: '#b3261e', hat: '#3a2618', band: '#d99a1c', barrel: 14, thick: 4 }, {
    walk: moving ? time * 14 : 0, flash: false, muzzle: p.muzzle > 0, poncho: true,
  });
  ctx.globalAlpha = 1;

  // 탄창: 발밑에 남은 탄을 점으로 보여 준다.
  const n = world.stats.maxAmmo;
  const gap = Math.min(7, 60 / n);
  const startX = p.x - ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, p.y + PLAYER_R + 14, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = i < p.ammo ? C.ink : 'rgba(42, 26, 16, 0.22)';
    ctx.fill();
  }
  if (p.reload > 0) {
    const t = 1 - p.reload / world.stats.reloadTime;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
    ctx.stroke();
  }
}

// ---------- 총알, 폭발 ----------

function drawBullets(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.lineCap = 'round';
  for (const b of world.bullets) {
    const len = b.fromPlayer ? 0.03 : 0.045;
    const tx = b.x - b.vx * len;
    const ty = b.y - b.vy * len;
    ctx.strokeStyle = b.fromPlayer ? C.fire : C.bloodDark;
    ctx.lineWidth = b.fromPlayer ? 5 : 7;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = b.fromPlayer ? '#fff4c9' : '#ff8a7a';
    ctx.lineWidth = b.fromPlayer ? 2 : 3;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * len * 0.5, b.y - b.vy * len * 0.5);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (!b.fromPlayer) {
      ctx.fillStyle = C.blood;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.lineCap = 'butt';
}

function drawBombTarget(ctx: CanvasRenderingContext2D, b: Bomb): void {
  const k = Math.min(1, b.elapsed / (b.flight + b.fuse));
  if (b.fromPlayer) {
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(b.tx, b.ty, b.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  // 적이 던진 다이너마이트는 떨어질 자리를 붉게 알려 준다.
  ctx.fillStyle = `rgba(179, 38, 30, ${0.12 + k * 0.2})`;
  ctx.beginPath();
  ctx.arc(b.tx, b.ty, b.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.blood;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.tx, b.ty, b.radius * k, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBomb(ctx: CanvasRenderingContext2D, b: Bomb, time: number): void {
  const t = Math.min(1, b.elapsed / b.flight);
  const x = b.sx + (b.tx - b.sx) * t;
  const y = b.sy + (b.ty - b.sy) * t;
  const height = Math.sin(Math.PI * t) * 70;
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - height);
  ctx.rotate(t < 1 ? time * 14 : 0.4);
  ctx.fillStyle = C.blood;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-9, -4, 18, 8, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = Math.floor(time * 30) % 2 === 0 ? C.goldLight : C.fire;
  ctx.beginPath();
  ctx.arc(12, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBlasts(ctx: CanvasRenderingContext2D, world: World): void {
  for (const b of world.blasts) {
    const k = b.life / b.maxLife;
    ctx.globalAlpha = k;
    ctx.fillStyle = '#fff4c9';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * (0.55 + (1 - k) * 0.45), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.fire;
    ctx.lineWidth = 10 * k + 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius * (0.7 + (1 - k) * 0.5), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawProgress(ctx: CanvasRenderingContext2D, world: World): void {
  const p = world.player;
  for (const l of world.loots) {
    if (l.taken) continue;
    const near = Math.hypot(l.x - p.x, l.y - p.y) <= LOOT_REACH;
    if (l.progress <= 0 && !near) continue;
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 27, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.gold;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 27, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, l.progress / l.time));
    ctx.stroke();
  }
  if (world.escapeProgress > 0) {
    ctx.strokeStyle = C.sage;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(world.horse.x, world.horse.y, 38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, world.escapeProgress / ESCAPE_TIME));
    ctx.stroke();
  }
}

function drawTexts(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.font = '700 17px "Rye", "IBM Plex Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const t of world.texts) {
    ctx.globalAlpha = Math.min(1, (t.life / t.maxLife) * 2);
    ctx.strokeStyle = C.paper;
    ctx.lineWidth = 4;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- 화면 전체 효과 ----------

function drawAtmosphere(ctx: CanvasRenderingContext2D, view: View, world: World, time: number): void {
  // 해 질 녘의 가장자리 어둠
  const r = Math.hypot(view.w, view.h) / 2;
  const vignette = ctx.createRadialGradient(view.w / 2, view.h / 2, r * 0.45, view.w / 2, view.h / 2, r);
  vignette.addColorStop(0, 'rgba(60, 28, 12, 0)');
  vignette.addColorStop(1, 'rgba(60, 28, 12, 0.42)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, view.w, view.h);

  // 수배가 오를수록 하늘빛이 붉어진다.
  const level = heatLevel(world);
  if (level > 0) {
    ctx.fillStyle = `rgba(190, 60, 30, ${level * 0.022})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  const p = world.player;
  if (world.phase === 'play' && p.hp <= 2) {
    const pulse = 0.5 + Math.sin(time * 6) * 0.5;
    const danger = ctx.createRadialGradient(view.w / 2, view.h / 2, r * 0.5, view.w / 2, view.h / 2, r);
    danger.addColorStop(0, 'rgba(179, 38, 30, 0)');
    danger.addColorStop(1, `rgba(179, 38, 30, ${0.25 + pulse * 0.2})`);
    ctx.fillStyle = danger;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (p.hurtFlash > 0) {
    ctx.fillStyle = `rgba(179, 38, 30, ${p.hurtFlash * 0.9})`;
    ctx.fillRect(0, 0, view.w, view.h);
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
  for (const e of world.enemies) if (e.kind === 'sheriff') arrow(e, C.blood, 12);
  if (quotaMet(world)) arrow(world.horse, C.sage, 13 + Math.sin(time * 6) * 2);
}

function drawSticks(ctx: CanvasRenderingContext2D, sticks: Stick[]): void {
  ctx.font = '700 13px "IBM Plex Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of sticks) {
    ctx.fillStyle = 'rgba(243, 227, 191, 0.35)';
    ctx.strokeStyle = s.active ? 'rgba(42, 26, 16, 0.75)' : 'rgba(42, 26, 16, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(s.originX, s.originY, s.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = s.active ? 'rgba(42, 26, 16, 0.6)' : 'rgba(42, 26, 16, 0.3)';
    ctx.beginPath();
    ctx.arc(s.originX + s.dx * s.radius, s.originY + s.dy * s.radius, 22, 0, Math.PI * 2);
    ctx.fill();
    if (!s.active) {
      ctx.fillStyle = 'rgba(42, 26, 16, 0.8)';
      ctx.fillText(s.side === 'move' ? '이동' : '조준', s.originX, s.originY);
    }
  }
}
