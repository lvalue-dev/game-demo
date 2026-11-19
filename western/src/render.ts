import { WORLD_H, WORLD_W } from './game/map.ts';
import {
  DOOR_REACH, ENEMY_DEFS, ENTER_TIME, ESCAPE_TIME, HORSE_REACH, LOOT_REACH, PLAYER_R, bankDoor, heatLevel, quotaMet,
} from './game/sim.ts';
import type { Bomb, Decal, Enemy, Loot, Particle, Pickup, Rect, Vec, World } from './game/types.ts';
import type { Stick } from './input.ts';
import {
  ENEMY_KITS, INK, MATERIAL, PLAYER_KIT, SHADOW, box, cylinder, fallenFigure, figure, groundShadow,
} from './kit.ts';
import type { Ctx, Tone } from './kit.ts';
import {
  awningBaseY, buildingTop, drawAwning, drawBuilding, drawBush, drawDecor, drawProp, drawWires, hasAwning,
} from './town.ts';

// 캔버스 안의 색은 CSS 토큰과 같은 팔레트를 쓴다.
const C = {
  sand: '#e0bf84',
  sandLight: '#ead09a',
  sandDark: '#cfa969',
  street: '#edd6a6',
  rut: '#d6b77f',
  paper: '#f3e3bf',
  gold: '#d99a1c',
  goldLight: '#f6d67a',
  blood: '#b3261e',
  bloodDark: '#7a1712',
  fire: '#e8742a',
  sage: '#3f7a52',
};

const SACK: Tone = { top: '#c9a36a', side: '#a07c48', light: '#e0c08c' };
const HIDE: Tone = { top: '#8a5a36', side: '#5f3b20', light: '#a8744a' };

/** 조작부나 정보판이 덮고 있어서 게임 화면으로 쓰지 못하는 가장자리 폭. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface View {
  w: number;
  h: number;
  /** 기기 픽셀 배율. 캔버스는 이만큼 크게 잡고 그릴 때 되돌린다. */
  dpr: number;
  zoom: number;
  camX: number;
  camY: number;
  insets: Insets;
  /** 가려지지 않는 영역의 중심. 카메라는 주인공을 화면 정중앙이 아니라 여기에 둔다. */
  fx: number;
  fy: number;
}

const VIEW_SHORT_SIDE = 600;
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function makeView(w: number, h: number, dpr: number, insets: Insets = NO_INSETS): View {
  return {
    w, h, dpr, zoom: Math.min(w, h) / VIEW_SHORT_SIDE, camX: 0, camY: 0, insets,
    fx: insets.left + (w - insets.left - insets.right) / 2,
    fy: insets.top + (h - insets.top - insets.bottom) / 2,
  };
}

export function updateCamera(view: View, world: World, dt: number): void {
  const p = world.player;
  // 가려지지 않는 영역의 절반 크기(게임 좌표). 세계의 끝이 이 영역의 끝까지 오도록 카메라를 묶는다.
  const halfW = (view.w - view.insets.left - view.insets.right) / view.zoom / 2;
  const halfH = (view.h - view.insets.top - view.insets.bottom) / view.zoom / 2;
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
  return { x: (sx - view.fx) / view.zoom + view.camX, y: (sy - view.fy) / view.zoom + view.camY };
}

function toScreen(view: View, p: Vec): Vec {
  return { x: (p.x - view.camX) * view.zoom + view.fx, y: (p.y - view.camY) * view.zoom + view.fy };
}

/** 모래 바닥의 얼룩. 한 번 정해 두고 계속 쓴다. */
const GROUND_SPOTS = (() => {
  let seed = 9173;
  const r = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  return Array.from({ length: 90 }, () => ({
    x: r() * WORLD_W, y: r() * WORLD_H, rx: 30 + r() * 90, ry: 12 + r() * 30, a: r() * Math.PI, light: r() < 0.45,
  }));
})();

/** 블록을 바닥에서 띄워 그린다. 다른 블록 위에 얹을 때 쓴다. */
function lifted(ctx: Ctx, lift: number, drawIt: () => void): void {
  ctx.save();
  ctx.translate(0, -lift);
  drawIt();
  ctx.restore();
}

export function draw(ctx: Ctx, view: View, world: World, sticks: Stick[], time: number): void {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = C.sand;
  ctx.fillRect(0, 0, view.w, view.h);

  const shakeX = (Math.random() - 0.5) * world.shake;
  const shakeY = (Math.random() - 0.5) * world.shake;
  ctx.save();
  ctx.translate(view.fx + shakeX, view.fy + shakeY);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.camX, -view.camY);

  drawGround(ctx, time);
  for (const d of world.decals) drawDecal(ctx, d);
  for (const c of world.corpses) fallenFigure(ctx, c.x, c.y, c.dir, ENEMY_KITS[c.kind], c.charred);
  for (const b of world.bombs) drawBombTarget(ctx, b);
  for (const e of world.enemies) drawTelegraph(ctx, e);
  drawFence(ctx, 4);

  // 서 있는 것들은 남쪽에 있는 것이 북쪽 것을 가리도록 아래쪽부터 차례로 그린다.
  const items: { y: number; paint: () => void }[] = [];
  for (const o of world.obstacles) {
    items.push({ y: o.y + o.h, paint: () => drawObstacle(ctx, o, time) });
    // 차양은 그 아래 선 사람보다 나중에 그려야 사람이 차양 밑에 들어간 것처럼 보인다.
    if (hasAwning(o)) items.push({ y: awningBaseY(o), paint: () => drawAwning(ctx, o) });
  }
  for (const d of world.decor) items.push({ y: d.y + 2, paint: () => drawDecor(ctx, d) });
  for (const b of world.bushes) items.push({ y: b.y + 5, paint: () => drawBush(ctx, b) });
  for (const l of world.loots) if (!l.taken) items.push({ y: l.y + 11, paint: () => drawLoot(ctx, l, time) });
  for (const k of world.pickups) items.push({ y: k.y, paint: () => drawPickup(ctx, k, time) });
  items.push({ y: world.horse.y + 10, paint: () => drawHorse(ctx, world, time) });
  for (const e of world.enemies) items.push({ y: e.y + 6, paint: () => drawEnemy(ctx, e, time) });
  items.push({ y: world.player.y + 6, paint: () => drawPlayer(ctx, world, time) });
  items.sort((a, b) => a.y - b.y);
  for (const item of items) item.paint();
  drawFence(ctx, WORLD_H - 4);
  drawWires(ctx, world.decor);

  drawFireGlow(ctx, world);
  drawBullets(ctx, world);
  for (const b of world.bombs) drawBomb(ctx, b, time);
  drawBlasts(ctx, world);
  for (const q of world.particles) drawParticle(ctx, q);
  ctx.globalAlpha = 1;
  drawProgress(ctx, world);
  drawTexts(ctx, world);
  ctx.restore();

  drawAtmosphere(ctx, view, world, time);
  drawArrows(ctx, view, world, time);
  drawSticks(ctx, sticks);
}

// ---------- 땅 ----------

function drawGround(ctx: Ctx, time: number): void {
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

/** 세계 끝의 울타리. 말뚝 블록과 가로대. */
function drawFence(ctx: Ctx, y: number): void {
  ctx.fillStyle = MATERIAL.wood.side;
  ctx.fillRect(0, y - 9, WORLD_W, 3);
  for (let x = 6; x < WORLD_W; x += 60) box(ctx, x - 3, y - 3, 6, 6, 12, MATERIAL.wood);
}

function drawDecal(ctx: Ctx, d: Decal): void {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rot);
  switch (d.kind) {
    case 'crater':
      ctx.fillStyle = 'rgba(120, 88, 48, 0.55)';
      ctx.beginPath();
      ctx.ellipse(0, 0, d.size, d.size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(60, 40, 22, 0.55)';
      ctx.beginPath();
      ctx.ellipse(2, 2, d.size * 0.62, d.size * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240, 218, 170, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, d.size, d.size * 0.7, 0, Math.PI * 0.9, Math.PI * 1.9);
      ctx.stroke();
      break;
    case 'scorch':
    case 'ash':
      ctx.fillStyle = d.kind === 'ash' ? 'rgba(70, 62, 56, 0.5)' : 'rgba(30, 22, 18, 0.5)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(Math.cos(i * 1.7) * d.size * 0.35, Math.sin(i * 2.3) * d.size * 0.25, d.size * 0.6, d.size * 0.4, i, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'blood':
      ctx.fillStyle = 'rgba(122, 23, 18, 0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, d.size, d.size * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'puddle':
      ctx.fillStyle = 'rgba(96, 150, 170, 0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, d.size, d.size * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(d.size * 0.6, d.size * 0.2, d.size * 0.5, d.size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'debris':
      ctx.fillStyle = MATERIAL.wood.side;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.translate(Math.cos(i * 1.9) * d.size * 0.6, Math.sin(i * 2.7) * d.size * 0.5);
        ctx.rotate(i * 1.3);
        ctx.fillRect(-9, -2, 18, 4);
        ctx.strokeRect(-9, -2, 18, 4);
        ctx.restore();
      }
      break;
    case 'stump':
      ctx.fillStyle = MATERIAL.plant.side;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, d.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
  }
  ctx.restore();
}

// ---------- 건물과 소품 ----------

function drawObstacle(ctx: Ctx, o: Rect, time: number): void {
  const cx = o.x + o.w / 2;
  if (o.kind === 'building') {
    groundShadow(ctx, o.x, o.y, o.w, o.h, buildingTop(o));
    drawBuilding(ctx, o, time);
    drawMarks(ctx, o, buildingTop(o));
    return;
  }
  if (o.kind !== 'tree' && o.kind !== 'windmill') groundShadow(ctx, o.x, o.y, o.w, o.h, o.tall);
  if (drawProp(ctx, o, time)) {
    drawMarks(ctx, o, o.tall);
    return;
  }
  switch (o.kind) {
    case 'crate':
      box(ctx, o.x, o.y, o.w, o.h, o.tall, MATERIAL.wood);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y - o.tall);
      ctx.lineTo(o.x + o.w, o.y + o.h - o.tall);
      ctx.moveTo(o.x + o.w, o.y - o.tall);
      ctx.lineTo(o.x, o.y + o.h - o.tall);
      ctx.moveTo(o.x + o.w / 2, o.y + o.h - o.tall);
      ctx.lineTo(o.x + o.w / 2, o.y + o.h);
      ctx.stroke();
      break;
    case 'barrel': {
      const cy = o.y + o.h / 2;
      const r = o.w / 2;
      cylinder(ctx, cx, cy, r, o.tall, MATERIAL.wood);
      // 통을 조이는 쇠테
      ctx.strokeStyle = MATERIAL.metal.side;
      ctx.lineWidth = 2;
      for (const t of [0.3, 0.72]) {
        ctx.beginPath();
        ctx.ellipse(cx, cy - o.tall * t, r, r * 0.62, 0, 0.05, Math.PI - 0.05);
        ctx.stroke();
      }
      break;
    }
    case 'trough':
      box(ctx, o.x, o.y, o.w, o.h, o.tall, MATERIAL.wood, 20);
      ctx.fillStyle = MATERIAL.water.top;
      ctx.fillRect(o.x + 4, o.y - o.tall + 4, o.w - 8, o.h - 8);
      ctx.fillStyle = MATERIAL.water.light;
      ctx.fillRect(o.x + 8 + ((time * 12) % (o.w - 30)), o.y - o.tall + 8, 12, 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(o.x + 4, o.y - o.tall + 4, o.w - 8, o.h - 8);
      break;
    case 'wagon':
      // 바퀴, 짐칸, 천 덮개
      for (const wx of [o.x + 14, o.x + o.w - 14]) {
        cylinder(ctx, wx, o.y + o.h + 2, 9, 3, MATERIAL.dark);
        cylinder(ctx, wx, o.y + 2, 9, 3, MATERIAL.dark);
      }
      lifted(ctx, 5, () => box(ctx, o.x, o.y, o.w, o.h, o.tall - 5, MATERIAL.wood, 16));
      lifted(ctx, o.tall, () => box(ctx, o.x + 8, o.y + 4, o.w - 30, o.h - 8, 13, MATERIAL.cloth, 14));
      break;
    case 'rock':
      box(ctx, o.x, o.y, o.w, o.h, o.tall, MATERIAL.stone);
      lifted(ctx, o.tall, () => box(ctx, o.x + 4, o.y + 3, o.w - 11, o.h - 6, 5, MATERIAL.stone));
      break;
  }
  drawMarks(ctx, o, o.tall);
}

/** 총알구멍과 그을음. 남쪽 가장자리에 맞은 것은 옆면에, 나머지는 윗면에 그린다. */
function drawMarks(ctx: Ctx, o: Rect, topLift: number): void {
  for (const m of o.marks) {
    const onSide = m.dy >= o.h - 1;
    const x = Math.max(o.x + 3, Math.min(o.x + o.w - 3, o.x + m.dx));
    const y = onSide
      ? o.y + o.h - 2 - m.u * (o.tall - 4)
      : Math.max(o.y + 3, Math.min(o.y + o.h - 3, o.y + m.dy)) - topLift;
    if (m.kind === 'hole') {
      ctx.fillStyle = 'rgba(24, 14, 8, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, m.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(24, 16, 12, 0.5)';
      ctx.beginPath();
      ctx.ellipse(x, y, m.size, m.size * 0.7, m.u * 3, 0, Math.PI * 2);
      ctx.ellipse(x + m.size * 0.5, y - m.size * 0.3, m.size * 0.6, m.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- 돈, 말 ----------

function drawLoot(ctx: Ctx, l: Loot, time: number): void {
  if (l.kind === 'safe') {
    groundShadow(ctx, l.x - 15, l.y - 11, 30, 22, 22);
    box(ctx, l.x - 15, l.y - 11, 30, 22, 22, MATERIAL.metal);
    // 앞면의 다이얼과 손잡이
    ctx.fillStyle = MATERIAL.gold.top;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(l.x - 3, l.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(l.x - 3, l.y);
    ctx.lineTo(l.x - 3 + Math.cos(time * 2) * 5, l.y + Math.sin(time * 2) * 5);
    ctx.stroke();
    ctx.fillStyle = MATERIAL.metal.light;
    ctx.fillRect(l.x + 7, l.y - 4, 3, 8);
  } else {
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(l.x + 5, l.y + 5, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    cylinder(ctx, l.x, l.y, 10, 12, SACK);
    lifted(ctx, 12, () => box(ctx, l.x - 4, l.y - 3, 8, 6, 4, SACK));
    ctx.fillStyle = INK;
    ctx.font = '700 12px "Rye", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', l.x, l.y - 1);
  }
  // 멀리서도 눈에 띄게 반짝임
  const tw = (Math.sin(time * 4 + l.id * 1.7) + 1) / 2;
  ctx.strokeStyle = C.goldLight;
  ctx.globalAlpha = tw * 0.9;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(l.x + 13, l.y - 32);
  ctx.lineTo(l.x + 13, l.y - 22);
  ctx.moveTo(l.x + 8, l.y - 27);
  ctx.lineTo(l.x + 18, l.y - 27);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPickup(ctx: Ctx, k: Pickup, time: number): void {
  if (k.life < 3 && Math.floor(time * 10) % 2 === 0) return;
  const bob = Math.abs(Math.sin(time * 5 + k.id)) * 3;
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(k.x + 2, k.y + 3, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (k.kind === 'coin') {
    lifted(ctx, bob, () => cylinder(ctx, k.x, k.y, 5.5, 2.5, MATERIAL.gold));
  } else {
    lifted(ctx, bob, () => {
      box(ctx, k.x - 4, k.y - 3, 8, 6, 11, { top: '#c57a2a', side: '#94561a', light: '#e39a48' });
      lifted(ctx, 11, () => box(ctx, k.x - 2, k.y - 1.5, 4, 3, 5, MATERIAL.dark));
    });
  }
}

function drawHorse(ctx: Ctx, world: World, time: number): void {
  const h = world.horse;
  if (quotaMet(world)) {
    const pulse = 0.5 + Math.sin(time * 5) * 0.5;
    ctx.strokeStyle = C.sage;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.35 + pulse * 0.5;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, HORSE_REACH + pulse * 5, (HORSE_REACH + pulse * 5) * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 말뚝과 가로대
  box(ctx, h.x - 44, h.y - 14, 5, 5, 20, MATERIAL.wood);
  box(ctx, h.x - 44, h.y + 10, 5, 5, 20, MATERIAL.wood);
  lifted(ctx, 16, () => box(ctx, h.x - 44, h.y - 14, 5, 29, 3, MATERIAL.wood));
  // 블록 말: 다리 넷, 몸통, 목과 머리, 갈기, 안장, 꼬리
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(h.x + 8, h.y + 10, 30, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const lx of [h.x - 18, h.x + 12]) {
    box(ctx, lx, h.y - 7, 5, 4, 9, MATERIAL.dark);
    box(ctx, lx, h.y + 3, 5, 4, 9, MATERIAL.dark);
  }
  const sway = Math.sin(time * 3) * 2;
  lifted(ctx, 9, () => {
    box(ctx, h.x - 30 + sway * 0.3, h.y - 2, 8, 4, 8, MATERIAL.dark);
    box(ctx, h.x - 22, h.y - 8, 42, 16, 13, HIDE);
    lifted(ctx, 13, () => box(ctx, h.x - 8, h.y - 8, 16, 16, 3, MATERIAL.red));
    lifted(ctx, 5, () => {
      box(ctx, h.x + 18, h.y - 6, 15, 12, 14, HIDE);
      lifted(ctx, 14, () => box(ctx, h.x + 16, h.y - 2, 12, 4, 3, MATERIAL.dark));
    });
  });
}

// ---------- 인물 ----------

function drawEnemy(ctx: Ctx, e: Enemy, time: number): void {
  const kit = ENEMY_KITS[e.kind];
  figure(ctx, e.x, e.y, e.aim > 0 ? e.aimDir : e.facing, kit, {
    walk: e.aim > 0 ? 0 : time * 11 + e.id,
    flash: e.hitFlash > 0,
    muzzle: e.muzzle > 0,
  });
  if (e.hp < e.maxHp || e.kind === 'sheriff') {
    const w = e.kind === 'sheriff' ? 46 : 26;
    const y = e.y - 38 * kit.scale;
    ctx.fillStyle = INK;
    ctx.fillRect(e.x - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = C.blood;
    ctx.fillRect(e.x - w / 2, y, (w * e.hp) / e.maxHp, 4);
  }
}

function drawTelegraph(ctx: Ctx, e: Enemy): void {
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

function drawPlayer(ctx: Ctx, world: World, time: number): void {
  const p = world.player;
  if (world.phase === 'dead') {
    fallenFigure(ctx, p.x, p.y, p.aimDir + Math.PI, PLAYER_KIT, false);
    return;
  }
  // 조준선
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 7]);
  ctx.beginPath();
  ctx.moveTo(p.x + Math.cos(p.aimDir) * 34, p.y - 9 + Math.sin(p.aimDir) * 34);
  ctx.lineTo(p.x + Math.cos(p.aimDir) * 150, p.y - 9 + Math.sin(p.aimDir) * 150);
  ctx.stroke();
  ctx.setLineDash([]);

  const blink = p.invuln > 0 && p.dashTime === 0 && Math.floor(time * 20) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.45;
  figure(ctx, p.x, p.y, p.aimDir, PLAYER_KIT, {
    walk: Math.hypot(p.vx, p.vy) > 30 ? time * 14 : 0, flash: false, muzzle: p.muzzle > 0,
  });
  ctx.globalAlpha = 1;

  // 탄창: 발밑에 남은 탄을 점으로 보여 준다.
  const n = world.stats.maxAmmo;
  const gap = Math.min(7, 60 / n);
  const startX = p.x - ((n - 1) * gap) / 2;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, p.y + PLAYER_R + 10, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = i < p.ammo ? INK : 'rgba(42, 26, 16, 0.22)';
    ctx.fill();
  }
  if (p.reload > 0) {
    const t = 1 - p.reload / world.stats.reloadTime;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 8, PLAYER_R + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
    ctx.stroke();
  }
}

// ---------- 총알, 폭발, 불 ----------

/** 총은 바닥보다 조금 위에서 쏘므로 총알도 그만큼 띄워 그린다. */
const GUN_LIFT = 9;

function drawBullets(ctx: Ctx, world: World): void {
  ctx.lineCap = 'round';
  for (const b of world.bullets) {
    const len = b.fromPlayer ? 0.03 : 0.045;
    const y = b.y - GUN_LIFT;
    ctx.strokeStyle = b.fromPlayer ? C.fire : C.bloodDark;
    ctx.lineWidth = b.fromPlayer ? 5 : 7;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * len, y - b.vy * len);
    ctx.lineTo(b.x, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = b.fromPlayer ? '#fff4c9' : '#ff8a7a';
    ctx.lineWidth = b.fromPlayer ? 2 : 3;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * len * 0.5, y - b.vy * len * 0.5);
    ctx.lineTo(b.x, y);
    ctx.stroke();
    if (!b.fromPlayer) {
      ctx.fillStyle = C.blood;
      ctx.beginPath();
      ctx.arc(b.x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.lineCap = 'butt';
}

function drawBombTarget(ctx: Ctx, b: Bomb): void {
  if (b.owner === 'neutral') return;
  const k = Math.min(1, b.elapsed / (b.flight + b.fuse));
  if (b.owner === 'player') {
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.ellipse(b.tx, b.ty, b.radius, b.radius * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  // 적이 던진 다이너마이트는 떨어질 자리를 붉게 알려 준다.
  ctx.fillStyle = 'rgba(179, 38, 30, ' + (0.12 + k * 0.2) + ')';
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

function drawBomb(ctx: Ctx, b: Bomb, time: number): void {
  if (b.owner === 'neutral') return;
  const t = b.flight > 0 ? Math.min(1, b.elapsed / b.flight) : 1;
  const x = b.sx + (b.tx - b.sx) * t;
  const y = b.sy + (b.ty - b.sy) * t;
  const height = Math.sin(Math.PI * t) * 70;
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - height - 4);
  ctx.rotate(t < 1 ? time * 14 : 0.4);
  ctx.fillStyle = MATERIAL.red.top;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.fillRect(-9, -4, 18, 8);
  ctx.strokeRect(-9, -4, 18, 8);
  ctx.fillStyle = MATERIAL.red.side;
  ctx.fillRect(-9, 1, 18, 3);
  ctx.fillStyle = Math.floor(time * 30) % 2 === 0 ? C.goldLight : C.fire;
  ctx.beginPath();
  ctx.arc(12, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBlasts(ctx: Ctx, world: World): void {
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

function drawFireGlow(ctx: Ctx, world: World): void {
  for (const f of world.fires) {
    const k = Math.min(1, f.life / 0.6);
    const y = f.y - f.lift;
    const glow = ctx.createRadialGradient(f.x, y, 0, f.x, y, f.r * 1.9);
    glow.addColorStop(0, 'rgba(255, 150, 50, ' + 0.5 * k + ')');
    glow.addColorStop(1, 'rgba(255, 150, 50, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(f.x - f.r * 2, y - f.r * 2, f.r * 4, f.r * 4);
  }
}

/** 재질마다 다른 모양의 조각. */
function drawParticle(ctx: Ctx, q: Particle): void {
  const k = Math.max(0, q.life / q.maxLife);
  const age = 1 - k;
  ctx.fillStyle = q.color;
  switch (q.shape) {
    case 'shard':
    case 'chunk':
    case 'leaf': {
      // 나뭇조각은 길쭉하게, 돌 조각은 네모나게, 잎은 둥글게
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot + q.spin * age);
      if (q.shape === 'leaf') {
        ctx.beginPath();
        ctx.ellipse(0, 0, q.size * 0.6, q.size * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const w = q.shape === 'shard' ? q.size * 1.5 : q.size;
        const h = q.shape === 'shard' ? q.size * 0.32 : q.size;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = 'rgba(42, 26, 16, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      }
      ctx.restore();
      break;
    }
    case 'spark':
      ctx.globalAlpha = k;
      ctx.strokeStyle = q.color;
      ctx.lineWidth = q.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    case 'smoke':
      ctx.globalAlpha = k * 0.5;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (0.5 + age), 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'flame':
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (0.3 + k * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff1b8';
      ctx.beginPath();
      ctx.arc(q.x, q.y + 1, q.size * k * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'drop':
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size / 2, 0, Math.PI * 2);
      ctx.fill();
  }
}

function drawProgress(ctx: Ctx, world: World): void {
  const p = world.player;
  for (const l of world.loots) {
    if (l.taken) continue;
    const near = Math.hypot(l.x - p.x, l.y - p.y) <= LOOT_REACH;
    if (l.progress <= 0 && !near) continue;
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(l.x, l.y - 8, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.gold;
    ctx.beginPath();
    ctx.arc(l.x, l.y - 8, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, l.progress / l.time));
    ctx.stroke();
  }
  // 은행 문 앞: 서 있으면 안으로 들어간다는 표시
  const door = world.bankVisited ? null : bankDoor(world);
  if (door) {
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.ellipse(door.x, door.y, DOOR_REACH, DOOR_REACH * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (world.enterProgress > 0) {
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(door.x, door.y, DOOR_REACH, DOOR_REACH * 0.6, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, world.enterProgress / ENTER_TIME));
      ctx.stroke();
    }
  }
  if (world.escapeProgress > 0) {
    ctx.strokeStyle = C.sage;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(world.horse.x, world.horse.y - 10, 42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, world.escapeProgress / ESCAPE_TIME));
    ctx.stroke();
  }
}

function drawTexts(ctx: Ctx, world: World): void {
  ctx.font = '700 17px "Rye", "IBM Plex Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const t of world.texts) {
    ctx.globalAlpha = Math.min(1, (t.life / t.maxLife) * 2);
    ctx.strokeStyle = C.paper;
    ctx.lineWidth = 4;
    ctx.strokeText(t.text, t.x, t.y - 16);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y - 16);
  }
  ctx.globalAlpha = 1;
}

// ---------- 화면 전체 효과 ----------

function drawAtmosphere(ctx: Ctx, view: View, world: World, time: number): void {
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
    ctx.fillStyle = 'rgba(190, 60, 30, ' + level * 0.022 + ')';
    ctx.fillRect(0, 0, view.w, view.h);
  }
  const p = world.player;
  if (world.phase === 'play' && p.hp <= 2) {
    const pulse = 0.5 + Math.sin(time * 6) * 0.5;
    const danger = ctx.createRadialGradient(view.w / 2, view.h / 2, r * 0.5, view.w / 2, view.h / 2, r);
    danger.addColorStop(0, 'rgba(179, 38, 30, 0)');
    danger.addColorStop(1, 'rgba(179, 38, 30, ' + (0.25 + pulse * 0.2) + ')');
    ctx.fillStyle = danger;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (p.hurtFlash > 0) {
    ctx.fillStyle = 'rgba(179, 38, 30, ' + p.hurtFlash * 0.9 + ')';
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

/** 화면 밖에 있는 돈과 말의 방향을 가장자리 화살표로 알려 준다. */
function drawArrows(ctx: Ctx, view: View, world: World, time: number): void {
  const margin = 26;
  const halfW = (view.w - view.insets.left - view.insets.right) / 2 - margin;
  const halfH = (view.h - view.insets.top - view.insets.bottom) / 2 - margin;
  const arrow = (target: Vec, color: string, size: number): void => {
    const s = toScreen(view, target);
    if (Math.abs(s.x - view.fx) < halfW && Math.abs(s.y - view.fy) < halfH) return;
    const a = Math.atan2(s.y - view.fy, s.x - view.fx);
    const t = Math.min(halfW / Math.abs(Math.cos(a) || 1e-6), halfH / Math.abs(Math.sin(a) || 1e-6));
    ctx.save();
    ctx.translate(view.fx + Math.cos(a) * t, view.fy + Math.sin(a) * t);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
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
  const door = world.bankVisited ? null : bankDoor(world);
  if (door) arrow(door, C.gold, 14);
  for (const e of world.enemies) if (e.kind === 'sheriff') arrow(e, C.blood, 12);
  if (quotaMet(world)) arrow(world.horse, C.sage, 13 + Math.sin(time * 6) * 2);
}

/** 1인칭 장면 위에 덧그리는 것: 이동 스틱과 피격 때의 붉은 번쩍임. 나머지는 비워 3D 화면이 비치게 한다. */
export function drawOverlay(ctx: Ctx, view: View, sticks: Stick[], hurt: number, lowHp: boolean, time: number): void {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  const r = Math.hypot(view.w, view.h) / 2;
  if (lowHp) {
    const pulse = 0.5 + Math.sin(time * 6) * 0.5;
    const danger = ctx.createRadialGradient(view.w / 2, view.h / 2, r * 0.5, view.w / 2, view.h / 2, r);
    danger.addColorStop(0, 'rgba(179, 38, 30, 0)');
    danger.addColorStop(1, 'rgba(179, 38, 30, ' + (0.25 + pulse * 0.2) + ')');
    ctx.fillStyle = danger;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (hurt > 0) {
    ctx.fillStyle = 'rgba(179, 38, 30, ' + hurt * 0.9 + ')';
    ctx.fillRect(0, 0, view.w, view.h);
  }
  drawSticks(ctx, sticks);
}

function drawSticks(ctx: Ctx, sticks: Stick[]): void {
  ctx.font = '700 12px "IBM Plex Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of sticks) {
    // 손을 대지 않은 스틱은 거의 비치게 해서 화면을 덜 가린다.
    ctx.fillStyle = s.active ? 'rgba(243, 227, 191, 0.28)' : 'rgba(243, 227, 191, 0.14)';
    ctx.strokeStyle = s.active ? 'rgba(42, 26, 16, 0.6)' : 'rgba(42, 26, 16, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.originX, s.originY, s.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = s.active ? 'rgba(42, 26, 16, 0.5)' : 'rgba(42, 26, 16, 0.18)';
    ctx.beginPath();
    ctx.arc(s.originX + s.dx * s.radius, s.originY + s.dy * s.radius, 18, 0, Math.PI * 2);
    ctx.fill();
    if (!s.active) {
      ctx.fillStyle = 'rgba(42, 26, 16, 0.6)';
      ctx.fillText(s.side === 'move' ? '이동' : '조준', s.originX, s.originY);
    }
  }
}
