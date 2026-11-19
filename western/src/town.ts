// 마을을 이루는 것들의 그림: 건물, 뒷마당 시설, 식생, 길가 시설물.
// 모양은 1880년대 애리조나 준주 개척 마을의 실제 건물 유형을 따랐다. 자세한 근거는 ART.md에 있다.
import { STORY } from './game/map.ts';
import type { Bush, Decor, Rect } from './game/types.ts';
import { INK, MATERIAL, ROOF, SHADOW, box, cylinder, gable } from './kit.ts';
import type { Ctx, Tone } from './kit.ts';

/** 박공지붕의 처마에서 용마루까지의 높이. */
const RISE = 14;
const BARN_RISE = 24;
/** 가짜 정면이 용마루 위로 더 솟는 높이. */
const PARAPET = 8;
const AWNING_DEPTH = 18;

const CHARRED: Tone = { top: '#3a302a', side: '#241d19', light: '#4d4038' };
const CANOPY: Tone = { top: '#7f9a58', side: '#58733b', light: '#9db573' };
const PEAR: Tone = { top: '#86aa72', side: '#587c4b', light: '#a3c48f' };

/** 길 북쪽 줄의 건물은 정면이 남쪽(화면 아래)을 향한다. */
export const facesSouth = (o: Rect): boolean => o.y < 500;

function lifted(ctx: Ctx, lift: number, paint: () => void): void {
  ctx.save();
  ctx.translate(0, -lift);
  paint();
  ctx.restore();
}

function wallTone(o: Rect): Tone {
  return o.material === 'brick' ? MATERIAL.brick : o.material === 'adobe' ? MATERIAL.adobe : MATERIAL.wood;
}

/** 건물 꼭대기까지의 높이. 그림자와 지붕 위 흔적의 위치에 쓴다. */
export function buildingTop(o: Rect): number {
  const form = o.style?.form;
  if (form === 'barn') return o.tall + BARN_RISE;
  if (form === 'flat') return o.tall;
  return o.tall + RISE;
}

const ink = (ctx: Ctx, width = 1.5): void => {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
};

/** 남쪽을 향한 벽면의 결: 나무는 세로 널, 벽돌은 켜, 어도비는 군데군데 금. */
function siding(ctx: Ctx, o: Rect, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (o.material === 'brick') {
    for (let row = 0, sy = y + 5; sy < y + h; sy += 5, row++) {
      ctx.moveTo(x, sy);
      ctx.lineTo(x + w, sy);
      for (let sx = x + (row % 2 ? 6 : 0); sx < x + w; sx += 12) {
        ctx.moveTo(sx, sy - 5);
        ctx.lineTo(sx, sy);
      }
    }
  } else if (o.material === 'adobe') {
    for (let i = 0; i < 4; i++) {
      const sx = x + ((i * 73 + o.id * 31) % Math.max(20, w - 20)) + 10;
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + 3, y + h - 7);
      ctx.lineTo(sx - 2, y + h - 12);
    }
  } else {
    for (let sx = x + 9; sx < x + w; sx += 9) {
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + h);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function windowPane(ctx: Ctx, x: number, y: number, w: number, h: number, arched = false): void {
  ctx.fillStyle = MATERIAL.glass.top;
  ctx.beginPath();
  if (arched) {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + w / 2);
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.closePath();
  ctx.fill();
  ink(ctx);
  ctx.stroke();
  ctx.fillStyle = MATERIAL.glass.light;
  ctx.fillRect(x + 2, y + (arched ? w / 2 : 2), Math.max(2, w * 0.3), 3);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + (arched ? 1 : 0));
  ctx.lineTo(x + w / 2, y + h);
  ctx.stroke();
}

function door(ctx: Ctx, x: number, y: number, w: number, h: number, color = MATERIAL.dark.top): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ink(ctx);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = MATERIAL.gold.top;
  ctx.fillRect(x + w - 5, y + h * 0.55, 2.5, 2.5);
}

function signBoard(ctx: Ctx, cx: number, y: number, text: string, w = 88): void {
  ctx.fillStyle = MATERIAL.paint.light;
  ctx.fillRect(cx - w / 2, y, w, 15);
  ink(ctx);
  ctx.strokeRect(cx - w / 2, y, w, 15);
  ctx.fillStyle = INK;
  ctx.font = '700 12px "IBM Plex Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + 8);
}

/** 정면(남쪽을 향한 면)에 가게 종류에 맞는 문, 창, 간판을 단다. (fx, fy, fw, fh)는 그 면의 화면 위 사각형. */
function front(ctx: Ctx, o: Rect, fx: number, fy: number, fw: number, fh: number): void {
  const st = o.style!;
  const cx = fx + fw / 2;
  const bottom = fy + fh;
  switch (st.trade) {
    case 'saloon': {
      // 2층 가짜 정면: 처마 돌림띠, 간판, 위층 창, 아래층 여닫이문과 큰 창
      ctx.fillStyle = MATERIAL.paint.light;
      ctx.fillRect(fx, fy, fw, 4);
      if (o.label) signBoard(ctx, cx, fy + 7, o.label, 96);
      for (const wx of [0.2, 0.5, 0.8]) windowPane(ctx, fx + fw * wx - 6, fy + 27, 12, 17);
      for (const wx of [0.2, 0.8]) windowPane(ctx, fx + fw * wx - 15, bottom - 24, 30, 15);
      ctx.fillStyle = MATERIAL.dark.side;
      ctx.fillRect(cx - 12, bottom - 25, 24, 25);
      ink(ctx);
      ctx.strokeRect(cx - 12, bottom - 25, 24, 25);
      // 허리 높이의 여닫이문 두 짝
      for (const dx of [-11, 1]) {
        ctx.fillStyle = MATERIAL.wood.light;
        ctx.fillRect(cx + dx, bottom - 17, 10, 11);
        ctx.strokeRect(cx + dx, bottom - 17, 10, 11);
      }
      break;
    }
    case 'store':
      ctx.fillStyle = MATERIAL.paint.light;
      ctx.fillRect(fx, fy, fw, 4);
      if (o.label) signBoard(ctx, cx, fy + 7, o.label, 96);
      for (const wx of [0.22, 0.78]) windowPane(ctx, fx + fw * wx - 18, bottom - 22, 36, 14);
      door(ctx, cx - 9, bottom - 23, 18, 23);
      break;
    case 'bank': {
      // 벽돌 은행: 돌 기초, 처마 돌림띠와 이빨 장식, 아치 창, 쇠창살
      ctx.fillStyle = MATERIAL.stone.top;
      ctx.fillRect(fx, bottom - 5, fw, 5);
      ctx.fillStyle = MATERIAL.stone.light;
      ctx.fillRect(fx, fy, fw, 5);
      ctx.fillStyle = MATERIAL.stone.side;
      for (let sx = fx + 3; sx < fx + fw - 4; sx += 9) ctx.fillRect(sx, fy + 5, 4, 3);
      ink(ctx);
      ctx.strokeRect(fx, fy, fw, 5);
      if (o.label) signBoard(ctx, cx, fy + 9, o.label, 70);
      for (const wx of [0.14, 0.3, 0.7, 0.86]) {
        const x = fx + fw * wx - 7;
        windowPane(ctx, x, bottom - 27, 14, 20, true);
        ink(ctx, 1);
        ctx.beginPath();
        for (const bx of [3.5, 10.5]) {
          ctx.moveTo(x + bx, bottom - 24);
          ctx.lineTo(x + bx, bottom - 7);
        }
        ctx.stroke();
      }
      door(ctx, cx - 12, bottom - 26, 24, 21, '#35513f');
      ink(ctx);
      ctx.beginPath();
      ctx.moveTo(cx, bottom - 26);
      ctx.lineTo(cx, bottom - 5);
      ctx.stroke();
      break;
    }
    case 'jail': {
      // 어도비 벽 밖으로 나온 서까래 끝, 두꺼운 문, 창살 달린 작은 창
      ctx.fillStyle = MATERIAL.dark.top;
      for (let sx = fx + 10; sx < fx + fw - 6; sx += 16) {
        ctx.beginPath();
        ctx.arc(sx, fy + 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      door(ctx, fx + fw * 0.3 - 9, bottom - 21, 18, 21, MATERIAL.wood.side);
      const wx = fx + fw * 0.72 - 9;
      ctx.fillStyle = MATERIAL.dark.side;
      ctx.fillRect(wx, bottom - 20, 18, 11);
      ink(ctx);
      ctx.strokeRect(wx, bottom - 20, 18, 11);
      ctx.beginPath();
      for (const bx of [4.5, 9, 13.5]) {
        ctx.moveTo(wx + bx, bottom - 20);
        ctx.lineTo(wx + bx, bottom - 9);
      }
      ctx.stroke();
      if (o.label) signBoard(ctx, fx + fw * 0.3, bottom - 38 < fy ? fy + 9 : bottom - 38, o.label, 56);
      break;
    }
    case 'livery': {
      // 마구간: 활짝 열린 큰 문, 박공 벽의 건초 다락문
      ctx.fillStyle = MATERIAL.dark.side;
      ctx.fillRect(cx - 28, bottom - 26, 56, 26);
      ink(ctx);
      ctx.strokeRect(cx - 28, bottom - 26, 56, 26);
      for (const dx of [-47, 29]) {
        ctx.fillStyle = MATERIAL.wood.light;
        ctx.fillRect(cx + dx, bottom - 26, 18, 26);
        ctx.strokeRect(cx + dx, bottom - 26, 18, 26);
        ctx.beginPath();
        ctx.moveTo(cx + dx, bottom - 26);
        ctx.lineTo(cx + dx + 18, bottom);
        ctx.moveTo(cx + dx + 18, bottom - 26);
        ctx.lineTo(cx + dx, bottom);
        ctx.stroke();
      }
      ctx.fillStyle = MATERIAL.dark.side;
      ctx.fillRect(cx - 9, fy - 20, 18, 13);
      ctx.strokeRect(cx - 9, fy - 20, 18, 13);
      ctx.fillStyle = MATERIAL.straw.top;
      ctx.fillRect(cx - 7, fy - 11, 14, 4);
      if (o.label) signBoard(ctx, cx, fy - 5, o.label, 66);
      break;
    }
    default:
      door(ctx, cx - 8, bottom - 22, 16, 22);
  }
}

/** 길을 등진 건물의 뒷벽: 뒷문과 작은 창. */
function rear(ctx: Ctx, o: Rect, fx: number, fy: number, fw: number, fh: number): void {
  const stories = o.style!.stories;
  const bottom = fy + fh;
  door(ctx, fx + fw * 0.28 - 7, bottom - 20, 14, 20, MATERIAL.wood.side);
  windowPane(ctx, fx + fw * 0.68 - 7, bottom - 19, 14, 11);
  if (stories === 2) {
    for (const wx of [0.22, 0.5, 0.78]) windowPane(ctx, fx + fw * wx - 6, fy + 7, 12, 14);
    // 2층으로 오르는 바깥 계단
    ink(ctx, 2);
    ctx.beginPath();
    ctx.moveTo(fx + fw - 6, bottom);
    ctx.lineTo(fx + fw * 0.78 + 8, fy + 22);
    ctx.stroke();
  }
}

export function drawBuilding(ctx: Ctx, o: Rect, time: number): void {
  const st = o.style!;
  const wall = wallTone(o);
  const roof = ROOF[st.roof];
  const south = facesSouth(o);
  const { x, y, w } = o;
  const d = o.h;
  const T = o.tall;
  const faceTop = y + d - T;
  const cx = x + w / 2;

  // 나무 보도. 진흙 길보다 한 뼘 높다.
  if (south) box(ctx, x - 5, y + d, w + 10, AWNING_DEPTH, 3, MATERIAL.wood, 14);

  box(ctx, x, y, w, d, T, wall);
  siding(ctx, o, x, faceTop, w, T);

  switch (st.form) {
    case 'flat': {
      // 난간벽을 두른 평지붕
      ctx.fillStyle = roof.top;
      ctx.fillRect(x + 6, y - T + 6, w - 12, d - 12);
      ink(ctx);
      ctx.strokeRect(x + 6, y - T + 6, w - 12, d - 12);
      ctx.fillStyle = roof.light;
      ctx.fillRect(x + 12, y - T + 14, w * 0.3, 3);
      if (south) front(ctx, o, x, faceTop, w, T);
      else rear(ctx, o, x, faceTop, w, T);
      break;
    }
    case 'falsefront': {
      const full = T + RISE + PARAPET;
      // 길을 등진 건물은 북쪽 끝에 가짜 정면의 뒷면이 솟아 있다.
      if (!south) box(ctx, x - 3, y - 2, w + 6, 5, full, wall);
      gable(ctx, x - 4, y - 3, w + 8, d + (south ? 0 : 5), T, RISE, roof, wall, 'ns');
      if (st.chimney) lifted(ctx, T + RISE * 0.45, () => cylinder(ctx, x + w * 0.74, y + d * 0.42, 3.2, 13, MATERIAL.metal));
      if (south) {
        // 가짜 정면: 얇은 널벽이 지붕을 가리고 서 있다.
        box(ctx, x - 3, y + d - 5, w + 6, 5, full, MATERIAL.paint);
        front(ctx, o, x - 3, y + d - full, w + 6, full);
      } else {
        // 가짜 정면을 뒤에서 받치는 버팀목
        ink(ctx, 2);
        ctx.beginPath();
        for (const bx of [0.25, 0.75]) {
          ctx.moveTo(x + w * bx, y - 1 - full + 4);
          ctx.lineTo(x + w * bx, y + 26 - T - RISE * 0.5);
        }
        ctx.stroke();
        rear(ctx, o, x, faceTop, w, T);
      }
      break;
    }
    case 'barn':
      gable(ctx, x - 5, y - 3, w + 10, d + 3, T, BARN_RISE, roof, wall, 'ns');
      front(ctx, o, x, faceTop, w, T);
      break;
    case 'cabin': {
      gable(ctx, x - 4, y - 4, w + 8, d + 8, T, 12, roof, wall, 'ew');
      rear(ctx, o, x, faceTop, w, T);
      if (st.chimney) {
        // 대장간 화덕 굴뚝과 연기
        lifted(ctx, T + 4, () => box(ctx, x + w * 0.2, y + d * 0.3, 18, 18, 16, MATERIAL.stone, 9));
        for (let i = 0; i < 3; i++) {
          const k = (time * 0.35 + i / 3) % 1;
          ctx.fillStyle = 'rgba(70, 60, 54, ' + 0.4 * (1 - k) + ')';
          ctx.beginPath();
          ctx.arc(x + w * 0.2 + 9 + Math.sin(time + i * 2) * 5 * k, y + d * 0.3 - T - 26 - k * 46, 6 + k * 9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
  }

  // 문 앞을 밝히는 등불
  if (south) {
    const glow = ctx.createRadialGradient(cx, y + d + 4, 0, cx, y + d + 4, 40);
    glow.addColorStop(0, 'rgba(255, 214, 110, ' + (0.34 + Math.sin(time * 9 + x) * 0.05) + ')');
    glow.addColorStop(1, 'rgba(255, 214, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 42, y + d - 38, 84, 84);
  }
}

/** 보도 위의 차양과 기둥. 2층 건물에서는 발코니가 된다. 그 아래 선 사람을 가리도록 건물과 따로 그린다. */
export function hasAwning(o: Rect): boolean {
  return o.kind === 'building' && !!o.style?.awning && facesSouth(o);
}

export function awningBaseY(o: Rect): number {
  return o.y + o.h + AWNING_DEPTH + 0.5;
}

export function drawAwning(ctx: Ctx, o: Rect): void {
  const st = o.style!;
  const lift = STORY - 2;
  const y = o.y + o.h;
  for (const px of [o.x - 3, o.x + o.w / 2 - 2, o.x + o.w - 1]) box(ctx, px, y + AWNING_DEPTH - 5, 4, 4, lift, MATERIAL.wood);
  lifted(ctx, lift, () => {
    box(ctx, o.x - 5, y + 1, o.w + 10, AWNING_DEPTH - 1, 3, ROOF[st.roof], 12);
    if (st.stories === 2) {
      // 발코니 난간
      const ry = y + AWNING_DEPTH - 3;
      ink(ctx);
      ctx.beginPath();
      ctx.moveTo(o.x - 5, ry - 13);
      ctx.lineTo(o.x + o.w + 5, ry - 13);
      for (let sx = o.x - 5; sx <= o.x + o.w + 5; sx += 9) {
        ctx.moveTo(sx, ry - 13);
        ctx.lineTo(sx, ry - 3);
      }
      ctx.stroke();
    }
  });
}

// ---------- 소품 ----------

/** 새로 더한 소품을 그린다. 그렸으면 true. */
export function drawProp(ctx: Ctx, o: Rect, time: number): boolean {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  switch (o.kind) {
    case 'powder': {
      // 발파용 흑색 화약통. 붉은 띠로 위험물임을 알린다.
      const r = o.w / 2;
      cylinder(ctx, cx, cy, r, o.tall, MATERIAL.powder);
      ctx.strokeStyle = MATERIAL.red.top;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy - o.tall * 0.5, r, r * 0.62, 0, 0.05, Math.PI - 0.05);
      ctx.stroke();
      ctx.fillStyle = MATERIAL.paint.light;
      ctx.font = '700 7px "IBM Plex Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('화약', cx, cy - o.tall * 0.2 + r * 0.45);
      return true;
    }
    case 'outhouse':
      box(ctx, o.x, o.y, o.w, o.h, o.tall, MATERIAL.wood);
      siding(ctx, o, o.x, o.y + o.h - o.tall, o.w, o.tall);
      door(ctx, cx - 6, o.y + o.h - 22, 12, 22, MATERIAL.wood.side);
      // 문에 뚫은 초승달 구멍
      ctx.fillStyle = MATERIAL.dark.side;
      ctx.beginPath();
      ctx.arc(cx, o.y + o.h - 16, 3, Math.PI * 0.6, Math.PI * 1.9);
      ctx.fill();
      gable(ctx, o.x - 3, o.y - 3, o.w + 6, o.h + 6, o.tall, 5, ROOF.shingle, MATERIAL.wood, 'ew');
      return true;
    case 'hay':
      box(ctx, o.x, o.y, o.w, o.h, o.tall, MATERIAL.straw);
      ctx.strokeStyle = MATERIAL.straw.side;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const t of [0.3, 0.7]) {
        ctx.moveTo(o.x + o.w * t, o.y - o.tall);
        ctx.lineTo(o.x + o.w * t, o.y + o.h);
      }
      ctx.stroke();
      return true;
    case 'tree': {
      // 메스키트: 굽은 줄기 위에 낮고 넓게 퍼진 가지
      ctx.fillStyle = SHADOW;
      ctx.beginPath();
      ctx.ellipse(cx + 16, cy + 8, 34, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      cylinder(ctx, cx, cy, 5, o.tall, MATERIAL.powder);
      const blobs: [number, number, number, number][] = [[-16, 4, 17, 20], [14, 2, 18, 22], [0, -8, 20, 30], [-4, 6, 15, 26]];
      for (const [bx, by, r] of blobs) {
        ctx.fillStyle = CANOPY.side;
        ctx.beginPath();
        ctx.ellipse(cx + bx, cy + by - o.tall - 4, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ink(ctx);
        ctx.stroke();
      }
      for (const [bx, by, r, lift] of blobs) {
        ctx.fillStyle = CANOPY.top;
        ctx.beginPath();
        ctx.ellipse(cx + bx, cy + by - lift - 6, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ink(ctx);
        ctx.stroke();
        ctx.fillStyle = CANOPY.light;
        ctx.beginPath();
        ctx.ellipse(cx + bx - r * 0.3, cy + by - lift - 6 - r * 0.25, r * 0.35, r * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    }
    case 'well': {
      const r = o.w / 2;
      cylinder(ctx, cx, cy, r, o.tall, MATERIAL.stone);
      ctx.fillStyle = MATERIAL.dark.side;
      ctx.beginPath();
      ctx.ellipse(cx, cy - o.tall, r - 4, (r - 4) * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      // 두레박 틀
      for (const px of [cx - r - 1, cx + r - 3]) box(ctx, px, cy - 2, 4, 4, 30, MATERIAL.wood);
      lifted(ctx, 30, () => box(ctx, cx - r - 3, cy - 2, r * 2 + 6, 4, 3, MATERIAL.wood));
      ink(ctx, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 30);
      ctx.lineTo(cx, cy - 18);
      ctx.stroke();
      lifted(ctx, 12, () => box(ctx, cx - 3, cy - 2, 6, 5, 6, MATERIAL.wood));
      return true;
    }
    case 'windmill': {
      // 물탱크: 기둥 위에 올린 나무통
      const tx = o.x + o.w + 28;
      for (const [px, py] of [[-12, -6], [8, -6], [-12, 8], [8, 8]] as const) box(ctx, tx + px, cy + py, 4, 4, 16, MATERIAL.wood);
      lifted(ctx, 16, () => {
        cylinder(ctx, tx, cy + 2, 17, 24, MATERIAL.wood);
        ctx.strokeStyle = MATERIAL.metal.side;
        ctx.lineWidth = 2;
        for (const t of [0.3, 0.75]) {
          ctx.beginPath();
          ctx.ellipse(tx, cy + 2 - 24 * t, 17, 17 * 0.62, 0, 0.05, Math.PI - 0.05);
          ctx.stroke();
        }
      });
      // 풍차 탑: 위로 갈수록 좁아지는 네 다리와 가새
      const top = o.y + o.h / 2 - 92;
      ink(ctx, 2.5);
      ctx.beginPath();
      for (const fx of [o.x, o.x + o.w]) {
        ctx.moveTo(fx, o.y + o.h);
        ctx.lineTo(cx + (fx < cx ? -4 : 4), top);
        ctx.moveTo(fx, o.y + 6);
        ctx.lineTo(cx + (fx < cx ? -3 : 3), top);
      }
      ctx.stroke();
      ink(ctx, 1.5);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const y1 = o.y + o.h - (i * 92) / 4.4;
        const y2 = o.y + o.h - ((i + 1) * 92) / 4.4;
        const w1 = (o.w / 2) * (1 - i / 4.6);
        const w2 = (o.w / 2) * (1 - (i + 1) / 4.6);
        ctx.moveTo(cx - w1, y1);
        ctx.lineTo(cx + w2, y2);
        ctx.moveTo(cx + w1, y1);
        ctx.lineTo(cx - w2, y2);
      }
      ctx.stroke();
      // 바람개비: 여러 장의 날개와 꼬리 깃
      ctx.fillStyle = MATERIAL.paint.side;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + 30, top - 8);
      ctx.lineTo(cx + 30, top + 8);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.stroke();
      ctx.save();
      ctx.translate(cx, top);
      ctx.rotate(time * 1.6);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.fillStyle = i % 2 ? MATERIAL.metal.light : MATERIAL.metal.top;
        ctx.beginPath();
        ctx.moveTo(4, -1);
        ctx.lineTo(22, -5);
        ctx.lineTo(22, 4);
        ctx.closePath();
        ctx.fill();
        ink(ctx, 1);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = MATERIAL.dark.top;
      ctx.beginPath();
      ctx.arc(cx, top, 4, 0, Math.PI * 2);
      ctx.fill();
      return true;
    }
    case 'cactus': {
      // 사와로: 굵은 기둥에 팔이 위로 굽어 오른다.
      lifted(ctx, 11, () => {
        box(ctx, cx - 13, cy - 2, 9, 4, 4, MATERIAL.plant);
        lifted(ctx, 3, () => cylinder(ctx, cx - 13, cy, 3.5, 12, MATERIAL.plant));
      });
      cylinder(ctx, cx, cy, 5.5, o.tall, MATERIAL.plant);
      ctx.strokeStyle = MATERIAL.plant.side;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const rx of [-2, 2]) {
        ctx.moveTo(cx + rx, cy + 3);
        ctx.lineTo(cx + rx, cy - o.tall + 3);
      }
      ctx.stroke();
      lifted(ctx, 16, () => {
        box(ctx, cx + 4, cy - 2, 9, 4, 4, MATERIAL.plant);
        lifted(ctx, 3, () => cylinder(ctx, cx + 13, cy, 3.5, 9, MATERIAL.plant));
      });
      return true;
    }
    default:
      return false;
  }
}

// ---------- 식생 ----------

export function drawBush(ctx: Ctx, b: Bush): void {
  const s = b.size;
  if (b.burnt) {
    box(ctx, b.x - 5 * s, b.y - 2, 5 * s, 4 * s, 3, CHARRED);
    box(ctx, b.x + 1, b.y, 4 * s, 4 * s, 4, CHARRED);
    return;
  }
  switch (b.kind) {
    case 'creosote':
      box(ctx, b.x - 10 * s, b.y - 3, 9 * s, 7 * s, 6 * s, MATERIAL.plant);
      box(ctx, b.x + 3 * s, b.y, 8 * s, 6 * s, 5 * s, MATERIAL.plant);
      box(ctx, b.x - 3 * s, b.y - 5, 11 * s, 8 * s, 9 * s, MATERIAL.plant);
      ctx.fillStyle = '#f0d24a';
      for (const [fx, fy] of [[-6, -9], [2, -13], [6, -6]] as const) ctx.fillRect(b.x + fx * s, b.y + fy * s, 2, 2);
      break;
    case 'pear': {
      // 프리클리페어: 납작한 줄기 마디가 겹쳐 자란다.
      const pads: [number, number, number][] = [[-7, 0, 0], [6, 1, 0], [-1, -3, 9], [8, -2, 11]];
      for (const [px, py, lift] of pads) {
        ctx.fillStyle = PEAR.side;
        ctx.beginPath();
        ctx.ellipse(b.x + px * s, b.y + py - lift * s - 5 * s, 6 * s, 8 * s, px * 0.05, 0, Math.PI * 2);
        ctx.fill();
        ink(ctx);
        ctx.stroke();
        ctx.fillStyle = PEAR.top;
        ctx.beginPath();
        ctx.ellipse(b.x + px * s - 1, b.y + py - lift * s - 6 * s, 4.5 * s, 6.5 * s, px * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#c0407a';
      for (const [fx, fy] of [[-1, -22], [9, -22]] as const) {
        ctx.beginPath();
        ctx.arc(b.x + fx * s, b.y + fy * s, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'grass':
      ctx.strokeStyle = '#b8984e';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = -3; i <= 3; i++) {
        ctx.moveTo(b.x + i * 1.5, b.y);
        ctx.lineTo(b.x + i * 4 * s, b.y - (11 - Math.abs(i) * 2) * s);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    case 'ocotillo':
      // 오코티요: 가시 돋은 긴 줄기가 부채꼴로 솟고 끝에 붉은 꽃이 핀다.
      ctx.lineCap = 'round';
      for (let i = -3; i <= 3; i++) {
        const tx = b.x + i * 6 * s;
        const ty = b.y - (36 - Math.abs(i) * 4) * s;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(b.x + i, b.y);
        ctx.quadraticCurveTo(b.x + i * 2 * s, b.y - 18 * s, tx, ty);
        ctx.stroke();
        ctx.strokeStyle = '#6f8a4e';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#d8482c';
        ctx.beginPath();
        ctx.arc(tx, ty, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineCap = 'butt';
      break;
  }
}

// ---------- 길가 시설물 ----------

/** 전신주 꼭대기의 높이. 전선을 걸 때 쓴다. */
const POLE_TALL = 66;

export function drawDecor(ctx: Ctx, d: Decor): void {
  switch (d.kind) {
    case 'pole':
      box(ctx, d.x - 2, d.y - 2, 4, 4, POLE_TALL, MATERIAL.powder);
      lifted(ctx, POLE_TALL - 9, () => box(ctx, d.x - 11, d.y - 1.5, 22, 3, 3, MATERIAL.powder));
      ctx.fillStyle = '#9fd0c8';
      for (const ix of [-9, 9]) ctx.fillRect(d.x + ix - 1.5, d.y - POLE_TALL - 2, 3, 4);
      break;
    case 'rail':
      // 말 매는 가로대
      for (const px of [d.x, d.x + d.size]) box(ctx, px - 2, d.y - 2, 4, 4, 13, MATERIAL.wood);
      lifted(ctx, 11, () => box(ctx, d.x - 4, d.y - 1.5, d.size + 8, 3, 2.5, MATERIAL.wood));
      break;
    case 'grave':
      ctx.fillStyle = 'rgba(160, 120, 70, 0.55)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 12, 9, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      if (d.size === 1) {
        // 둥근 머리의 나무 묘비
        box(ctx, d.x - 6, d.y - 1.5, 12, 3, 14, MATERIAL.paint);
      } else {
        box(ctx, d.x - 1.5, d.y - 1.5, 3, 3, 18, MATERIAL.wood);
        lifted(ctx, 11, () => box(ctx, d.x - 7, d.y - 1.5, 14, 3, 3, MATERIAL.wood));
      }
      break;
    case 'woodpile':
      box(ctx, d.x, d.y, 36, 10, 12, MATERIAL.wood);
      ctx.fillStyle = MATERIAL.wood.light;
      ink(ctx, 1);
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.beginPath();
          ctx.arc(d.x + 3.5 + i * 5.8, d.y + 1 + j * 5.5, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      break;
  }
}

/** 전신주 사이에 늘어진 전선. 다른 모든 것 위에 그려 높이감을 준다. */
export function drawWires(ctx: Ctx, decor: Decor[]): void {
  const poles = decor.filter((d) => d.kind === 'pole').sort((a, b) => a.x - b.x);
  ctx.strokeStyle = 'rgba(42, 26, 16, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i]!;
    const b = poles[i + 1]!;
    for (const ix of [-9, 9]) {
      ctx.moveTo(a.x + ix, a.y - POLE_TALL);
      ctx.quadraticCurveTo((a.x + b.x) / 2 + ix, a.y - POLE_TALL + 18, b.x + ix, b.y - POLE_TALL);
    }
  }
  ctx.stroke();
}
