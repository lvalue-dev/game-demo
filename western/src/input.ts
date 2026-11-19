import type { Input, Vec } from './game/types.ts';

/** 화면에 그려지는 가상 조이스틱 하나. dx, dy는 -1~1. */
export interface Stick {
  id: number;
  side: 'move' | 'aim';
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  radius: number;
}

const STICK_RADIUS = 52;
/** 조준 스틱을 이만큼 이상 밀어야 총을 쏜다. */
const AIM_DEADZONE = 0.28;

export interface Controls {
  /** 이번 프레임의 입력을 읽는다. toWorld는 화면 좌표를 게임 좌표로 바꾼다. */
  read(playerPos: Vec, toWorld: (sx: number, sy: number) => Vec, enemies: Vec[]): Input;
  sticks(): Stick[];
  usesTouch(): boolean;
}

export function attachControls(canvas: HTMLCanvasElement, dashButton: HTMLElement): Controls {
  const keys = new Set<string>();
  const sticks = new Map<number, Stick>();
  let mouse: { x: number; y: number; down: boolean } | null = null;
  let dashQueued = false;
  let reloadQueued = false;
  let touch = false;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') {
      dashQueued = true;
      e.preventDefault();
    }
    if (e.code === 'KeyR') reloadQueued = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    sticks.clear();
    if (mouse) mouse.down = false;
  });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      mouse = { x: e.offsetX, y: e.offsetY, down: e.button === 0 };
      return;
    }
    touch = true;
    const side = e.offsetX < canvas.clientWidth / 2 ? 'move' : 'aim';
    // 같은 쪽에는 스틱을 하나만 둔다.
    for (const s of sticks.values()) if (s.side === side) return;
    sticks.set(e.pointerId, {
      id: e.pointerId, side, originX: e.offsetX, originY: e.offsetY, dx: 0, dy: 0, radius: STICK_RADIUS,
    });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 포인터를 붙잡지 못해도 스틱은 그대로 쓸 수 있다.
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouse = { x: e.offsetX, y: e.offsetY, down: mouse?.down ?? false };
      return;
    }
    const s = sticks.get(e.pointerId);
    if (!s) return;
    let dx = (e.offsetX - s.originX) / s.radius;
    let dy = (e.offsetY - s.originY) / s.radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    s.dx = dx;
    s.dy = dy;
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      if (mouse) mouse.down = false;
      return;
    }
    sticks.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  dashButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    touch = true;
    dashQueued = true;
  });

  const held = (...codes: string[]): boolean => codes.some((c) => keys.has(c));

  return {
    read(playerPos, toWorld, enemies) {
      let moveX = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
      let moveY = (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0);
      let aim: number | null = null;
      let fire = false;

      for (const s of sticks.values()) {
        if (s.side === 'move') {
          moveX = s.dx;
          moveY = s.dy;
        } else if (Math.hypot(s.dx, s.dy) > AIM_DEADZONE) {
          aim = assist(Math.atan2(s.dy, s.dx), playerPos, enemies);
          fire = true;
        }
      }
      if (aim === null && mouse && !touch) {
        const target = toWorld(mouse.x, mouse.y);
        aim = Math.atan2(target.y - playerPos.y, target.x - playerPos.x);
        fire = mouse.down;
      }

      const input: Input = { moveX, moveY, aim, fire, dash: dashQueued, reload: reloadQueued };
      dashQueued = false;
      reloadQueued = false;
      return input;
    },
    sticks: () => [...sticks.values()],
    usesTouch: () => touch,
  };
}

/** 엄지로는 정밀 조준이 어려우므로, 조준 방향 가까이에 적이 있으면 그쪽으로 살짝 맞춰 준다. */
function assist(dir: number, from: Vec, enemies: Vec[]): number {
  const cone = 0.3;
  const range = 520;
  let best = dir;
  let bestDiff = cone;
  for (const e of enemies) {
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    if (Math.hypot(dx, dy) > range) continue;
    const a = Math.atan2(dy, dx);
    const diff = Math.abs(Math.atan2(Math.sin(a - dir), Math.cos(a - dir)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = a;
    }
  }
  return best;
}
