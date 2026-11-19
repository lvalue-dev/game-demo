import type { Input, Vec } from './game/types.ts';

/** 화면에 그려지는 가상 조이스틱 하나. dx, dy는 -1~1. */
export interface Stick {
  side: 'move' | 'aim';
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  radius: number;
  active: boolean;
}

const STICK_RADIUS = 46;
/** 스틱 중심에서 이 배수 안쪽을 누르면 스틱을 잡은 것으로 본다. */
const STICK_GRAB = 1.7;
/** 조준 스틱을 이만큼 이상 밀어야 총을 쏜다. */
const AIM_DEADZONE = 0.2;
/** 화면 아래 모서리에서 스틱 중심까지의 거리. */
export const STICK_INSET_X = 68;
export const STICK_INSET_Y = 76;

type TouchRole =
  | { kind: 'move' }
  | { kind: 'aimStick' }
  /** 스틱 밖의 화면을 누르면 그 지점을 향해 쏜다. */
  | { kind: 'aimPoint' };

export interface Controls {
  /** 이번 프레임의 입력을 읽는다. toWorld는 화면 좌표를 게임 좌표로 바꾼다. */
  read(playerPos: Vec, toWorld: (sx: number, sy: number) => Vec, enemies: Vec[]): Input;
  /** 화면에 그릴 스틱. 터치 기기가 아니면 빈 배열. */
  sticks(): Stick[];
  usesTouch(): boolean;
  /** 화면이 바뀔 때 눌려 있던 입력을 모두 놓는다. */
  reset(): void;
}

export function attachControls(
  canvas: HTMLCanvasElement, dashButton: HTMLElement, bombButton: HTMLElement,
  /** 브라우저 좌표를 캔버스 안의 좌표로 바꾼다. 화면을 옆으로 돌린 상태도 여기서 처리한다. */
  toLocal: (clientX: number, clientY: number) => Vec,
): Controls {
  const keys = new Set<string>();
  let mouse: { x: number; y: number; down: boolean } | null = null;
  let dashQueued = false;
  let reloadQueued = false;
  let bombQueued = false;
  let touch = matchMedia('(pointer: coarse)').matches;

  // 터치 상태. 손가락마다 처음 닿은 곳으로 역할을 정하고, 매 이벤트마다 전체 목록으로 다시 계산한다.
  const roles = new Map<number, TouchRole>();
  let move = { dx: 0, dy: 0, active: false };
  let aimStick = { dx: 0, dy: 0, active: false };
  let aimPoint: { x: number; y: number } | null = null;

  const moveCenter = (): Vec => ({ x: STICK_INSET_X, y: canvas.clientHeight - STICK_INSET_Y });
  const aimCenter = (): Vec => ({ x: canvas.clientWidth - STICK_INSET_X, y: canvas.clientHeight - STICK_INSET_Y });

  function stickValue(center: Vec, x: number, y: number): { dx: number; dy: number } {
    let dx = (x - center.x) / STICK_RADIUS;
    let dy = (y - center.y) / STICK_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    return { dx, dy };
  }

  function syncTouches(e: TouchEvent): void {
    e.preventDefault();
    touch = true;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const grab = STICK_RADIUS * STICK_GRAB;

    for (const t of Array.from(e.changedTouches)) {
      if (e.type !== 'touchstart') continue;
      const { x, y } = toLocal(t.clientX, t.clientY);
      const mc = moveCenter();
      const ac = aimCenter();
      // 왼쪽 스틱 근처는 이동, 오른쪽 스틱 근처는 조준 스틱, 그 밖의 화면은 "누른 곳을 향해 쏘기".
      // 왼쪽 아래 구역 전체도 이동으로 본다. 엄지가 스틱을 조금 벗어나도 계속 움직이게 하려는 것이다.
      const inMoveZone = Math.hypot(x - mc.x, y - mc.y) <= grab || (x < width * 0.4 && y > height * 0.55);
      const role: TouchRole =
        inMoveZone ? { kind: 'move' }
        : Math.hypot(x - ac.x, y - ac.y) <= grab ? { kind: 'aimStick' }
        : { kind: 'aimPoint' };
      roles.set(t.identifier, role);
    }

    // 지금 화면에 닿아 있는 손가락만으로 상태를 새로 만든다. 놓친 이벤트가 있어도 입력이 남지 않는다.
    const live = new Set<number>();
    move = { dx: 0, dy: 0, active: false };
    aimStick = { dx: 0, dy: 0, active: false };
    aimPoint = null;
    for (const t of Array.from(e.touches)) {
      const role = roles.get(t.identifier);
      if (!role) continue;
      live.add(t.identifier);
      const { x, y } = toLocal(t.clientX, t.clientY);
      if (role.kind === 'move') move = { ...stickValue(moveCenter(), x, y), active: true };
      else if (role.kind === 'aimStick') aimStick = { ...stickValue(aimCenter(), x, y), active: true };
      else aimPoint = { x, y };
    }
    for (const id of roles.keys()) if (!live.has(id)) roles.delete(id);
  }

  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
    canvas.addEventListener(type, syncTouches, { passive: false });
  }

  // 마우스와 키보드
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') {
      dashQueued = true;
      e.preventDefault();
    }
    if (e.code === 'KeyR') reloadQueued = true;
    if (e.code === 'KeyE' || e.code === 'KeyQ') bombQueued = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => reset());

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    touch = false;
    if (e.button === 2) bombQueued = true;
    mouse = { x: e.offsetX, y: e.offsetY, down: e.button === 0 || (mouse?.down ?? false) };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mouse = { x: e.offsetX, y: e.offsetY, down: mouse?.down ?? false };
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    if (mouse && e.button === 0) mouse.down = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const press = (button: HTMLElement, action: () => void): void => {
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      action();
    });
  };
  press(dashButton, () => { dashQueued = true; });
  press(bombButton, () => { bombQueued = true; });

  function reset(): void {
    keys.clear();
    roles.clear();
    move = { dx: 0, dy: 0, active: false };
    aimStick = { dx: 0, dy: 0, active: false };
    aimPoint = null;
    if (mouse) mouse.down = false;
  }

  const held = (...codes: string[]): boolean => codes.some((c) => keys.has(c));

  return {
    read(playerPos, toWorld, enemies) {
      let moveX = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
      let moveY = (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0);
      let aim: number | null = null;
      let aimDist: number | null = null;
      let fire = false;

      if (move.active) {
        moveX = move.dx;
        moveY = move.dy;
      }
      if (aimPoint) {
        // 누른 지점을 향해 쏜다.
        const target = toWorld(aimPoint.x, aimPoint.y);
        const assisted = assist(Math.atan2(target.y - playerPos.y, target.x - playerPos.x), playerPos, enemies);
        aim = assisted.dir;
        aimDist = assisted.dist ?? Math.hypot(target.x - playerPos.x, target.y - playerPos.y);
        fire = true;
      } else if (aimStick.active && Math.hypot(aimStick.dx, aimStick.dy) > AIM_DEADZONE) {
        const assisted = assist(Math.atan2(aimStick.dy, aimStick.dx), playerPos, enemies);
        aim = assisted.dir;
        aimDist = assisted.dist;
        fire = true;
      } else if (mouse && !touch) {
        const target = toWorld(mouse.x, mouse.y);
        aim = Math.atan2(target.y - playerPos.y, target.x - playerPos.x);
        aimDist = Math.hypot(target.x - playerPos.x, target.y - playerPos.y);
        fire = mouse.down;
      }

      const input: Input = {
        moveX, moveY, aim, aimDist, fire, dash: dashQueued, reload: reloadQueued, bomb: bombQueued,
      };
      dashQueued = false;
      reloadQueued = false;
      bombQueued = false;
      return input;
    },
    sticks() {
      if (!touch) return [];
      const mc = moveCenter();
      const ac = aimCenter();
      return [
        { side: 'move', originX: mc.x, originY: mc.y, dx: move.dx, dy: move.dy, radius: STICK_RADIUS, active: move.active },
        { side: 'aim', originX: ac.x, originY: ac.y, dx: aimStick.dx, dy: aimStick.dy, radius: STICK_RADIUS, active: aimStick.active },
      ];
    },
    usesTouch: () => touch,
    reset,
  };
}

/** 엄지로는 정밀 조준이 어려우므로, 조준 방향 가까이에 적이 있으면 그쪽으로 살짝 맞춰 준다. */
function assist(dir: number, from: Vec, enemies: Vec[]): { dir: number; dist: number | null } {
  const cone = 0.22;
  const range = 520;
  let best: { dir: number; dist: number | null } = { dir, dist: null };
  let bestDiff = cone;
  for (const e of enemies) {
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d > range) continue;
    const a = Math.atan2(dy, dx);
    const diff = Math.abs(Math.atan2(Math.sin(a - dir), Math.cos(a - dir)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { dir: a, dist: d };
    }
  }
  return best;
}
