// 블록 디오라마 그리기 도구.
// 규칙은 하나다: 세상의 모든 것은 "윗면과 남쪽 옆면이 보이는 블록"이다.
// 건물, 소품, 인물이 모두 이 블록의 조합이라, 부품 목록만 늘리면 새 물건이 같은 그림체로 나온다.
import type { EnemyKind, Material } from './game/types.ts';

export type Ctx = CanvasRenderingContext2D;

/** 블록 하나의 색. 윗면, 옆면, 밝은 모서리. */
export interface Tone {
  top: string;
  side: string;
  light: string;
}

export const INK = '#2a1a10';
export const SHADOW = 'rgba(52, 30, 16, 0.3)';

export const MATERIAL: Record<Material | 'water' | 'cloth' | 'gold' | 'dark' | 'glass' | 'red' | 'straw' | 'paint', Tone> = {
  wood: { top: '#a8794a', side: '#7a5230', light: '#c79a66' },
  adobe: { top: '#dcb98e', side: '#b38c61', light: '#efd6b0' },
  stone: { top: '#a8a195', side: '#7d776d', light: '#c6c0b4' },
  metal: { top: '#737a83', side: '#4c5158', light: '#a5acb5' },
  plant: { top: '#6f9f58', side: '#48733e', light: '#8fbd76' },
  powder: { top: '#5b4636', side: '#3b2b20', light: '#7a6150' },
  brick: { top: '#b4614a', side: '#8f4332', light: '#cf7f66' },
  red: { top: '#c23a2e', side: '#861f18', light: '#e3675a' },
  straw: { top: '#dcbc5c', side: '#b29038', light: '#f0d884' },
  // 가짜 정면에 칠한 흰 회칠. 세월에 바랜 색이다.
  paint: { top: '#e6dcc6', side: '#cfc2a6', light: '#f6efdf' },
  water: { top: '#78b3c4', side: '#4d8696', light: '#a6d6e2' },
  cloth: { top: '#ecdfc4', side: '#c4b594', light: '#fbf3e0' },
  gold: { top: '#dea320', side: '#a86a00', light: '#f6d67a' },
  dark: { top: '#3a2a20', side: '#241812', light: '#5a4334' },
  glass: { top: '#ffd978', side: '#e0a93a', light: '#fff1c2' },
};

/** 지붕 재료: 나무 널(shingle), 골함석(tin), 타르를 바른 평지붕(tar). */
export const ROOF: Record<'shingle' | 'tin' | 'tar', Tone> = {
  shingle: { top: '#9a8162', side: '#6f5b43', light: '#b39a7a' },
  tin: { top: '#a3abad', side: '#757e80', light: '#c3cacc' },
  tar: { top: '#5c5149', side: '#3f3731', light: '#73675e' },
};

/**
 * 박공지붕. 용마루가 남북으로 뻗으면(ns) 서쪽 경사면은 밝고 동쪽은 어둡게, 남쪽으로 박공 벽 삼각형이 보인다.
 * 동서로 뻗으면(ew) 남쪽 경사면이 밝게 보인다. lift는 처마 높이, rise는 처마에서 용마루까지의 높이.
 */
export function gable(
  ctx: Ctx, x: number, y: number, w: number, d: number, lift: number, rise: number,
  roof: Tone, wall: Tone, axis: 'ns' | 'ew',
): void {
  const top = y - lift;
  const poly = (points: [number, number][], fill: string): void => {
    ctx.beginPath();
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    outline(ctx);
    ctx.stroke();
  };
  ctx.save();
  if (axis === 'ns') {
    const mid = x + w / 2;
    poly([[x, top], [mid, top - rise], [mid, top + d - rise], [x, top + d]], roof.top);
    poly([[mid, top - rise], [x + w, top], [x + w, top + d], [mid, top + d - rise]], roof.side);
    poly([[x, top + d], [mid, top + d - rise], [x + w, top + d]], wall.side);
    // 지붕널 줄
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const f = i / 5;
      for (const sx of [x + (w / 2) * f, x + w - (w / 2) * f]) {
        ctx.moveTo(sx, top - rise * f);
        ctx.lineTo(sx, top + d - rise * f);
      }
    }
    ctx.stroke();
  } else {
    const ridge = top + d / 2 - rise;
    poly([[x, top], [x + w, top], [x + w, ridge], [x, ridge]], roof.side);
    poly([[x, ridge], [x + w, ridge], [x + w, top + d], [x, top + d]], roof.top);
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const sy = ridge + ((top + d - ridge) * i) / 5;
      ctx.moveTo(x, sy);
      ctx.lineTo(x + w, sy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

const outline = (ctx: Ctx, width = 1.5): void => {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
};

/**
 * 상자 블록. (x, y, w, d)는 바닥에 닿는 자리, h는 높이.
 * 윗면은 h만큼 위로 올려 그리고, 그 아래에 남쪽 옆면을 그린다.
 * seam을 주면 그 간격으로 이음매를 그어 여러 조각을 쌓은 것처럼 보이게 한다.
 */
export function box(ctx: Ctx, x: number, y: number, w: number, d: number, h: number, tone: Tone, seam = 0): void {
  outline(ctx);
  ctx.fillStyle = tone.side;
  ctx.fillRect(x, y + d - h, w, h);
  ctx.strokeRect(x, y + d - h, w, h);
  ctx.fillStyle = tone.top;
  ctx.fillRect(x, y - h, w, d);
  // 밝은 모서리: 윗면의 북쪽과 서쪽 안쪽
  ctx.fillStyle = tone.light;
  ctx.fillRect(x + 1, y - h + 1, w - 2, 2);
  ctx.fillRect(x + 1, y - h + 1, 2, d - 2);
  if (seam > 0) {
    ctx.strokeStyle = 'rgba(42, 26, 16, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let sx = x + seam; sx < x + w - 1; sx += seam) {
      ctx.moveTo(sx, y - h);
      ctx.lineTo(sx, y - h + d);
      ctx.moveTo(sx, y + d - h);
      ctx.lineTo(sx, y + d);
    }
    for (let sy = y - h + seam; sy < y - h + d - 1; sy += seam) {
      ctx.moveTo(x, sy);
      ctx.lineTo(x + w, sy);
    }
    ctx.stroke();
    outline(ctx);
  }
  ctx.strokeRect(x, y - h, w, d);
}

/** 원통 블록. (cx, cy)는 바닥 중심. */
export function cylinder(ctx: Ctx, cx: number, cy: number, r: number, h: number, tone: Tone): void {
  const ry = r * 0.62;
  outline(ctx);
  ctx.fillStyle = tone.side;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - r, cy - h);
  ctx.ellipse(cx, cy - h, r, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tone.top;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, r, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 가는 원통에는 밝은 모서리를 그릴 자리가 없다.
  if (r < 5) return;
  ctx.strokeStyle = tone.light;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, r - 2.5, ry - 2, 0, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
}

/** 바닥에 드리운 그림자. 블록마다 같은 방향(오른쪽 아래)으로 진다. */
export function groundShadow(ctx: Ctx, x: number, y: number, w: number, d: number, h: number): void {
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.moveTo(x + w, y + d);
  ctx.lineTo(x + w + h * 0.45, y + d + h * 0.25);
  ctx.lineTo(x + w + h * 0.45, y + h * 0.25);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x + h * 0.45, y + d, w, h * 0.25);
}

// ---------- 인물 ----------

/** 인물 한 명을 이루는 부품과 색. 새 인물은 이 표에 한 줄을 더하면 된다. */
export interface FigureKit {
  torso: string;
  torsoSide: string;
  legs: string;
  skin: string;
  hat: { brim: string; crown: string; band: string; size: number };
  weapon: 'revolver' | 'shotgun' | 'rifle' | 'dynamite';
  extra?: 'star' | 'poncho' | 'bandolier' | 'bigstar';
  scale: number;
}

export const PLAYER_KIT: FigureKit = {
  torso: '#c23a2e', torsoSide: '#861f18', legs: '#3a2a20', skin: '#e2b48a',
  hat: { brim: '#4a3323', crown: '#3a2618', band: '#dea320', size: 1 },
  weapon: 'revolver', extra: 'poncho', scale: 1,
};

export const ENEMY_KITS: Record<EnemyKind, FigureKit> = {
  deputy: {
    torso: '#44648f', torsoSide: '#2c4466', legs: '#3d3530', skin: '#e2b48a',
    hat: { brim: '#d2be94', crown: '#c2ad82', band: '#2c4466', size: 1 },
    weapon: 'revolver', extra: 'star', scale: 1,
  },
  shotgun: {
    torso: '#7a5535', torsoSide: '#573a22', legs: '#2f2620', skin: '#d9a87c',
    hat: { brim: '#2d211a', crown: '#221813', band: '#c23a2e', size: 1.05 },
    weapon: 'shotgun', scale: 1.05,
  },
  rifle: {
    torso: '#787d84', torsoSide: '#555a60', legs: '#33373c', skin: '#e2b48a',
    hat: { brim: '#484d54', crown: '#3a3f45', band: '#d2be94', size: 0.92 },
    weapon: 'rifle', scale: 1,
  },
  bomber: {
    torso: '#a8402f', torsoSide: '#762a1e', legs: '#3d3530', skin: '#d9a87c',
    hat: { brim: '#5a412c', crown: '#4a3524', band: '#f6d67a', size: 0.95 },
    weapon: 'dynamite', extra: 'bandolier', scale: 1,
  },
  sheriff: {
    torso: '#262020', torsoSide: '#141010', legs: '#1c1818', skin: '#e2b48a',
    hat: { brim: '#f4eddc', crown: '#e6dcc4', band: '#dea320', size: 1.1 },
    weapon: 'revolver', extra: 'bigstar', scale: 1.3,
  },
};

const WEAPON: Record<FigureKit['weapon'], { len: number; thick: number; color: string }> = {
  revolver: { len: 12, thick: 3.5, color: '#2b2b2f' },
  shotgun: { len: 16, thick: 6, color: '#2b2b2f' },
  rifle: { len: 25, thick: 3, color: '#3a2a20' },
  dynamite: { len: 9, thick: 5, color: '#c23a2e' },
};

export interface FigurePose {
  /** 걷는 정도. 다리가 번갈아 나온다. */
  walk: number;
  flash: boolean;
  muzzle: boolean;
}

/**
 * 블록 인물. 부품마다 "옆면을 아래로 깔고 그 위에 윗면"을 그려 높이를 낸다.
 * 부품은 바라보는 방향으로 돌지만, 높이는 항상 화면 위쪽으로 쌓인다.
 */
export function figure(ctx: Ctx, x: number, y: number, dir: number, kit: FigureKit, pose: FigurePose): void {
  const r = 12 * kit.scale;
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(x + 5, y + 5, r * 1.05, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  const flash = pose.flash ? '#fbf3e0' : null;
  /** 부품 하나: 바닥에서 lift만큼 떠 있고 두께가 thick인 조각. */
  const part = (path: () => void, lift: number, thick: number, top: string, side: string, line = 1.5): void => {
    for (const [offset, color] of [[thick, side], [thick / 2, side], [0, top]] as const) {
      ctx.save();
      ctx.translate(x, y - lift * kit.scale + offset * kit.scale);
      ctx.rotate(dir);
      ctx.beginPath();
      path();
      ctx.fillStyle = flash ?? color;
      ctx.fill();
      if (line > 0) {
        outline(ctx, line);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  // 다리
  const stride = Math.sin(pose.walk) * r * 0.5;
  part(() => ctx.roundRect(stride - r * 0.3, -r * 0.62, r * 0.62, r * 0.46, 2), 3, 3, kit.legs, '#1c1410');
  part(() => ctx.roundRect(-stride - r * 0.3, r * 0.16, r * 0.62, r * 0.46, 2), 3, 3, kit.legs, '#1c1410');

  // 무기
  const weapon = WEAPON[kit.weapon];
  part(() => ctx.rect(r * 0.55, r * 0.34 - weapon.thick / 2, weapon.len, weapon.thick), 9, 2, weapon.color, '#141416');
  if (pose.muzzle) {
    ctx.save();
    ctx.translate(x, y - 9 * kit.scale);
    ctx.rotate(dir);
    const tip = r * 0.55 + weapon.len;
    ctx.fillStyle = '#fff4c9';
    ctx.strokeStyle = '#e8742a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const len = i % 2 === 0 ? 17 : 6;
      ctx.lineTo(tip + 4 + Math.cos(a) * len, r * 0.34 + Math.sin(a) * len * 0.7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 몸통과 팔
  part(() => ctx.roundRect(-r * 0.5, -r * 0.92, r * 1.0, r * 1.84, 3), 10, 7, kit.torso, kit.torsoSide);
  part(() => ctx.roundRect(r * 0.05, r * 0.5, r * 0.95, r * 0.38, 2), 10, 3, kit.torso, kit.torsoSide);
  part(() => ctx.roundRect(r * 0.05, -r * 0.88, r * 0.6, r * 0.38, 2), 10, 3, kit.torso, kit.torsoSide);

  // 몸통 위의 장식
  if (!flash && kit.extra) {
    ctx.save();
    ctx.translate(x, y - 10 * kit.scale);
    ctx.rotate(dir);
    if (kit.extra === 'poncho') {
      ctx.fillStyle = '#f6d67a';
      ctx.fillRect(-r * 0.3, -r * 0.92, r * 0.22, r * 1.84);
      ctx.fillStyle = '#3a2618';
      ctx.fillRect(r * 0.12, -r * 0.92, r * 0.12, r * 1.84);
    } else if (kit.extra === 'bandolier') {
      ctx.strokeStyle = '#3a2a20';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, -r * 0.8);
      ctx.lineTo(r * 0.45, r * 0.8);
      ctx.stroke();
    } else {
      const big = kit.extra === 'bigstar';
      ctx.fillStyle = '#f6d67a';
      outline(ctx, 1);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        const len = (i % 2 === 0 ? 0.36 : 0.16) * r * (big ? 1.2 : 1);
        ctx.lineTo(r * 0.12 + Math.cos(a) * len, r * 0.55 + Math.sin(a) * len);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 머리와 모자
  const hs = kit.hat.size;
  part(() => ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2), 16, 5, kit.skin, '#b98a62');
  part(() => ctx.ellipse(-r * 0.04, 0, r * 0.86 * hs, r * 0.8 * hs, 0, 0, Math.PI * 2), 18, 1.5, kit.hat.brim, '#1c1410');
  part(() => ctx.arc(-r * 0.04, 0, r * 0.44 * hs, 0, Math.PI * 2), 23, 4.5, kit.hat.crown, kit.hat.band);
}

/** 쓰러진 인물. 같은 부품을 바닥에 눕혀 놓는다. */
export function fallenFigure(ctx: Ctx, x: number, y: number, dir: number, kit: FigureKit, charred: boolean): void {
  const r = 12 * kit.scale;
  const paint = (color: string): string => (charred ? '#2b2420' : color);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  outline(ctx, 1.5);
  ctx.fillStyle = paint(kit.legs);
  ctx.beginPath();
  ctx.roundRect(-r * 1.9, -r * 0.5, r * 0.9, r * 0.42, 2);
  ctx.roundRect(-r * 1.9, r * 0.08, r * 0.9, r * 0.42, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = paint(kit.torsoSide);
  ctx.beginPath();
  ctx.roundRect(-r * 1.05, -r * 0.8, r * 1.5, r * 1.6, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = paint(kit.skin);
  ctx.beginPath();
  ctx.arc(r * 0.85, 0, r * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 벗겨진 모자
  ctx.fillStyle = paint(kit.hat.brim);
  ctx.beginPath();
  ctx.ellipse(r * 1.7, r * 0.9, r * 0.8, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = paint(kit.hat.crown);
  ctx.beginPath();
  ctx.arc(r * 1.7, r * 0.9, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
