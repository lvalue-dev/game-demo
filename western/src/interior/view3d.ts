// 건물 안 1인칭 장면의 3D 그리기.
// 충돌은 단순한 상자지만, 화면에서는 쓰임새에 맞게 꾸민다: 둥근 부품의 인물, 결이 있는 재질, 그림자.
// 색은 바깥과 같은 재질표(kit.ts)에서 가져와 두 장면의 그림체가 이어지게 한다.
import * as THREE from 'three';
import { ENEMY_KITS, MATERIAL, PLAYER_KIT } from '../kit.ts';
import { EYE, ROOM } from './level.ts';
import type { Block, Guard, Interior, Mat3, V3 } from './level.ts';

const BRASS = '#c9a24a';
const IRON = '#3d4147';
const PLASTER = '#e9dcc0';

/** 재질마다 튀는 조각의 색. */
const CHIP: Record<Mat3, string[]> = {
  wood: [MATERIAL.wood.light, MATERIAL.wood.side],
  brick: [MATERIAL.brick.top, '#d9a08c'],
  plaster: ['#f3ead6', '#cdbf9f'],
  stone: ['#c6c0b4', '#8f897e'],
  metal: ['#fff1b8', '#ffd35c'],
  glass: ['#fff4c9', '#ffe08a'],
  powder: ['#fff1b8', '#e8742a'],
};

interface Chip {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
}

interface Rig {
  group: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  glint: THREE.Mesh;
  skin: THREE.MeshStandardMaterial[];
  fall: number;
  lastX: number;
  stride: number;
}

// ---------- 재질 ----------

/** 작은 그림을 그려 반복해 붙이는 결. */
function pattern(paint: (g: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  paint(c.getContext('2d')!, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 얼룩과 잔결을 뿌려 밋밋한 면에 손때를 입힌다. */
function grain(g: CanvasRenderingContext2D, size: number, dark: string, light: string, count: number): void {
  let seed = 7;
  const r = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);
  for (let i = 0; i < count; i++) {
    g.fillStyle = r() < 0.5 ? dark : light;
    g.globalAlpha = 0.05 + r() * 0.1;
    g.fillRect(r() * size, r() * size, 2 + r() * 26, 1 + r() * 2);
  }
  g.globalAlpha = 1;
}

const TEXTURES = {
  // 흰 돌과 검은 돌을 엇갈려 깐 바닥
  tile: () => pattern((g, s) => {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#3d3833' : '#d9cfbb';
        g.fillRect((i * s) / 2, (j * s) / 2, s / 2, s / 2);
      }
    }
    grain(g, s, '#000000', '#ffffff', 260);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, s / 2, s / 2);
    g.strokeRect(s / 2, s / 2, s / 2, s / 2);
  }),
  plaster: () => pattern((g, s) => {
    g.fillStyle = PLASTER;
    g.fillRect(0, 0, s, s);
    grain(g, s, '#b9a988', '#fffaf0', 420);
  }),
  // 벽 아래쪽에 두른 나무 징두리판
  panel: () => pattern((g, s) => {
    g.fillStyle = '#6f4c2c';
    g.fillRect(0, 0, s, s);
    grain(g, s, '#3a2412', '#9a7146', 300);
    g.strokeStyle = '#3f2913';
    g.lineWidth = 6;
    g.strokeRect(18, 22, s - 36, s - 44);
    g.strokeStyle = '#8f6a41';
    g.lineWidth = 2;
    g.strokeRect(24, 28, s - 48, s - 56);
  }),
  plank: () => pattern((g, s) => {
    g.fillStyle = '#8a6238';
    g.fillRect(0, 0, s, s);
    grain(g, s, '#4a3018', '#b88a56', 380);
    g.strokeStyle = '#4a3018';
    g.lineWidth = 3;
    for (let x = 0; x <= s; x += s / 4) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, s);
      g.stroke();
    }
  }),
  brick: () => pattern((g, s) => {
    g.fillStyle = '#7d6a5c';
    g.fillRect(0, 0, s, s);
    const h = s / 8;
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 4; col++) {
        const x = col * (s / 4) + (row % 2 ? s / 8 : 0);
        g.fillStyle = ['#a8553f', '#9c4a36', '#b4614a'][(row * 3 + col + 4) % 3]!;
        g.fillRect(x + 2, row * h + 2, s / 4 - 4, h - 4);
      }
    }
    grain(g, s, '#3a1c12', '#d9a08c', 260);
  }),
};

function standard(color: string, map?: THREE.Texture, roughness = 0.85, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, map, roughness, metalness });
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) {
      n.castShadow = cast;
      n.receiveShadow = receive;
    }
  });
  return o;
}

export interface View3D {
  build(s: Interior): void;
  resize(w: number, h: number, dpr: number): void;
  /** 이번 프레임의 사건을 화면 효과로 바꾼다. */
  react(s: Interior): void;
  render(s: Interior, dt: number): void;
}

export function createView3D(canvas: HTMLCanvasElement): View3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 80);
  camera.rotation.order = 'YXZ';
  let scene = new THREE.Scene();
  const tex = {
    tile: TEXTURES.tile(), plaster: TEXTURES.plaster(), panel: TEXTURES.panel(), plank: TEXTURES.plank(), brick: TEXTURES.brick(),
  };
  const mapped = (base: THREE.Texture, u: number, v: number): THREE.Texture => {
    const t = base.clone();
    t.needsUpdate = true;
    t.repeat.set(u, v);
    return t;
  };

  const blocks = new Map<number, THREE.Object3D>();
  const lamps = new Map<number, THREE.PointLight>();
  const rigs = new Map<number, Rig>();
  let bagMeshes: THREE.Object3D[] = [];
  let shotMeshes: THREE.Mesh[] = [];
  let chips: Chip[] = [];
  let holes: THREE.Mesh[] = [];
  let blasts: { mesh: THREE.Mesh; life: number; radius: number }[] = [];
  let gun = new THREE.Group();
  let drum = new THREE.Mesh();
  let flash = new THREE.PointLight('#ffd27a', 0, 10);
  let muzzle = new THREE.Mesh();
  let blastLight = new THREE.PointLight('#ff9a3a', 0, 20);
  let recoil = 0;
  let shake = 0;
  let walk = 0;
  let clock = 0;

  const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };
  const rod = (r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, segments = 12): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
    m.position.set(x, y, z);
    return m;
  };

  /** 상자 하나를 쓰임새에 맞는 모양으로 세운다. 위치의 기준은 상자의 중심이다. */
  function dress(b: Block): THREE.Object3D {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const g = new THREE.Group();
    g.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    const wood = standard(MATERIAL.wood.top, mapped(tex.plank, Math.max(w, d) / 1.2, h / 1.2));
    const darkWood = standard('#5a3d22', undefined, 0.7);
    const brass = standard(BRASS, undefined, 0.35, 0.8);
    const iron = standard(IRON, undefined, 0.5, 0.7);
    switch (b.tag) {
      case 'floor':
        g.add(shadowed(box(w, h, d, standard('#fff', mapped(tex.tile, w / 2, d / 2), 0.55)), false));
        break;
      case 'ceiling': {
        g.add(box(w, h, d, standard('#5a3d22', mapped(tex.plank, w / 2, d / 2))));
        // 천장을 가로지르는 들보
        for (let z = -d / 2 + 1.5; z < d / 2; z += 3) g.add(box(w, 0.28, 0.28, darkWood, 0, -0.18, z));
        break;
      }
      case 'wall': {
        if (b.material === 'brick') {
          g.add(shadowed(box(w, h, d, standard('#fff', mapped(tex.brick, Math.max(w, d) / 1.4, h / 1.4))), false));
          break;
        }
        // 회벽 아래에 나무 징두리판과 걸레받이를 두른다.
        const long = Math.max(w, d);
        g.add(shadowed(box(w, h, d, standard('#fff', mapped(tex.plaster, long / 3, h / 3))), false));
        if (b.min[1] === 0) {
          const pw = w > d ? w : d + 0.04;
          const panel = box(w > d ? pw : w + 0.04, 1.25, w > d ? d + 0.04 : pw, standard('#fff', mapped(tex.panel, long / 1.1, 1), 0.6), 0, -h / 2 + 0.625, 0);
          const cap = box(w > d ? pw : w + 0.1, 0.08, w > d ? d + 0.1 : pw, darkWood, 0, -h / 2 + 1.29, 0);
          g.add(shadowed(panel, false), cap);
        }
        break;
      }
      case 'column': {
        const stone = standard('#d8ceb8', mapped(tex.plaster, 1, 3), 0.7);
        g.add(rod(w / 2 - 0.04, h, stone, 0, 0, 0, 16));
        g.add(box(w + 0.16, 0.4, d + 0.16, stone, 0, -h / 2 + 0.2, 0), box(w + 0.2, 0.3, d + 0.2, stone, 0, h / 2 - 0.15, 0));
        g.add(rod(w / 2 + 0.03, 0.1, stone, 0, h / 2 - 0.36, 0, 16));
        shadowed(g);
        break;
      }
      case 'counter': {
        g.add(box(w, h - 0.08, d, standard('#fff', mapped(tex.panel, w / 1.1, 1), 0.6), 0, -0.04, 0));
        // 윤이 나는 상판
        g.add(box(w + 0.06, 0.08, d + 0.16, standard('#3f2913', undefined, 0.3), 0, h / 2 - 0.04, 0));
        g.add(box(w, 0.12, d + 0.04, darkWood, 0, -h / 2 + 0.06, 0));
        shadowed(g);
        break;
      }
      case 'grille':
        if (h > w) {
          g.add(rod(0.025, h, brass));
          g.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), brass).translateY(h / 2));
        } else {
          g.add(box(w, 0.06, 0.06, brass));
          // 창살 사이의 가는 살
          for (let x = -w / 2 + 0.25; x < w / 2; x += 0.25) g.add(rod(0.012, 1.2, brass, x, -0.63, 0, 6));
          g.add(box(w, 0.03, 0.03, brass, 0, -0.62, 0));
        }
        shadowed(g, true, false);
        break;
      case 'desk': {
        g.add(box(w + 0.08, 0.07, d + 0.08, standard('#4a3018', undefined, 0.4), 0, h / 2 - 0.035, 0));
        g.add(box(w - 0.1, h * 0.35, d - 0.1, wood, 0, h / 2 - 0.07 - h * 0.175, 0));
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          g.add(box(0.09, h - 0.07, 0.09, darkWood, lx * (w / 2 - 0.08), -0.035, lz * (d / 2 - 0.08)));
        }
        // 장부와 잉크병
        g.add(box(0.36, 0.05, 0.26, standard('#7a2a22'), -w * 0.2, h / 2 + 0.03, 0));
        g.add(box(0.3, 0.02, 0.22, standard('#f3ead6'), -w * 0.2, h / 2 + 0.065, 0));
        g.add(rod(0.04, 0.09, standard('#1c1c22', undefined, 0.3), w * 0.25, h / 2 + 0.045, 0.1));
        shadowed(g);
        break;
      }
      case 'bench':
        g.add(box(w, 0.08, d, wood, 0, h / 2 - 0.04, 0));
        g.add(box(0.07, 0.75, d, wood, (b.min[0] < 0 ? -1 : 1) * (w / 2 - 0.035), h / 2 + 0.33, 0));
        for (const z of [-d / 2 + 0.2, 0, d / 2 - 0.2]) g.add(box(w, h - 0.08, 0.09, darkWood, 0, -0.04, z));
        shadowed(g);
        break;
      case 'platform': {
        g.add(box(w, h, d, standard('#fff', mapped(tex.plank, w / 1.5, d / 1.5))));
        g.add(box(w, 0.3, 0.14, darkWood, 0, -0.2, d / 2 - 0.07));
        shadowed(g);
        break;
      }
      case 'rail': {
        g.add(box(w, 0.09, 0.12, standard('#3f2913', undefined, 0.35)));
        // 난간 살
        for (let x = -w / 2 + 0.3; x < w / 2; x += 0.3) g.add(rod(0.03, 1.0, darkWood, x, -0.52, 0, 8));
        shadowed(g, true, false);
        break;
      }
      case 'post':
        g.add(box(w, h, d, darkWood));
        g.add(box(0.7, 0.14, d, darkWood, 0, h / 2 - 0.25, 0));
        shadowed(g);
        break;
      case 'vaultdoor': {
        // 두꺼운 철문과 돌려 여는 손잡이 바퀴
        g.add(box(w, h, d, iron));
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 24), brass);
        wheel.rotation.y = Math.PI / 2;
        wheel.position.set(-w / 2 - 0.09, 0.1, 0);
        g.add(wheel);
        for (let i = 0; i < 3; i++) {
          const spoke = rod(0.025, 0.68, brass, -w / 2 - 0.09, 0.1, 0, 6);
          spoke.rotation.x = (i * Math.PI) / 3;
          g.add(spoke);
        }
        for (const y of [-0.7, 0.8]) g.add(box(0.1, 0.25, 0.12, brass, 0, y, d / 2));
        shadowed(g);
        break;
      }
      case 'crate': {
        g.add(box(w, h, d, wood));
        const strip = standard('#5f4226', undefined, 0.8);
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) g.add(box(0.07, h + 0.02, 0.07, strip, sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02)));
        }
        for (const y of [-h / 2 + 0.04, h / 2 - 0.04]) {
          g.add(box(w + 0.03, 0.07, 0.06, strip, 0, y, d / 2 - 0.02), box(w + 0.03, 0.07, 0.06, strip, 0, y, -d / 2 + 0.02));
          g.add(box(0.06, 0.07, d + 0.03, strip, w / 2 - 0.02, y, 0), box(0.06, 0.07, d + 0.03, strip, -w / 2 + 0.02, y, 0));
        }
        shadowed(g);
        break;
      }
      case 'keg': {
        // 가운데가 볼록한 통과 쇠테, 위험을 알리는 붉은 띠
        const r = w / 2;
        const stave = standard(MATERIAL.powder.top, mapped(tex.plank, 3, 1), 0.8);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, h, 18), stave);
        const belly = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.5, 18), stave);
        g.add(body, belly);
        for (const y of [-h * 0.36, h * 0.36]) g.add(rod(r * 0.9, 0.04, iron, 0, y, 0, 18));
        g.add(rod(r + 0.012, 0.12, standard(MATERIAL.red.top, undefined, 0.6), 0, 0, 0, 18));
        shadowed(g);
        break;
      }
      case 'lamp': {
        // 수레바퀴 샹들리에: 쇠사슬, 바퀴, 촛불
        const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.9, 0.04, 8, 24), iron);
        ring.rotation.x = Math.PI / 2;
        g.add(ring, rod(0.012, ROOM.height - b.max[1] + h / 2, iron, 0, (ROOM.height - b.max[1] + h / 2) / 2, 0, 6));
        const flame = new THREE.MeshBasicMaterial({ color: '#ffd98a' });
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          g.add(rod(0.025, 0.14, standard('#efe6d0'), Math.cos(a) * w * 0.9, 0.09, Math.sin(a) * w * 0.9, 8));
          g.add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), flame).translateX(Math.cos(a) * w * 0.9).translateY(0.2).translateZ(Math.sin(a) * w * 0.9));
          const spoke = rod(0.012, w * 1.8, iron, 0, 0, 0, 6);
          spoke.rotation.set(Math.PI / 2, 0, a);
          if (i < 3) g.add(spoke);
        }
        const light = new THREE.PointLight('#ffc978', 26, 26, 1.6);
        light.position.copy(g.position);
        scene.add(light);
        lamps.set(b.id, light);
        break;
      }
      case 'safe': {
        // 무쇠 금고: 금박 테두리, 다이얼, 손잡이, 발
        const body = standard('#23292b', undefined, 0.45, 0.6);
        g.add(box(w, h - 0.12, d, body, 0, 0.06, 0));
        for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.add(rod(0.07, 0.12, brass, fx * (w / 2 - 0.1), -h / 2 + 0.06, fz * (d / 2 - 0.1)));
        const front = d / 2 + 0.011;
        g.add(box(w - 0.14, h - 0.3, 0.02, standard('#2c3436', undefined, 0.4, 0.6), 0, 0.06, front - 0.005));
        for (const [bw, bh, bx, by] of [[w - 0.22, 0.025, 0, h / 2 - 0.2], [w - 0.22, 0.025, 0, -h / 2 + 0.32], [0.025, h - 0.5, -w / 2 + 0.11, 0.06], [0.025, h - 0.5, w / 2 - 0.11, 0.06]] as const) {
          g.add(box(bw, bh, 0.012, brass, bx, by, front + 0.01));
        }
        const dial = rod(0.11, 0.05, brass, -0.12, 0.16, front + 0.03, 20);
        dial.rotation.x = Math.PI / 2;
        const handle = box(0.3, 0.05, 0.05, brass, 0.2, 0.1, front + 0.04);
        g.add(dial, handle, box(0.05, 0.3, 0.05, brass, 0.2, 0.1, front + 0.04));
        shadowed(g);
        break;
      }
    }
    return g;
  }

  /** 방 전체의 장식: 창, 문, 깔개, 벽시계. 충돌과 무관하다. */
  function decorate(): void {
    const { halfW: W, halfD: D, door } = ROOM;
    const frame = standard('#4a3018', undefined, 0.5);
    const pane = new THREE.MeshBasicMaterial({ color: '#f7ecc8' });
    // 양쪽 벽의 높은 아치 창
    for (const side of [-1, 1]) {
      for (const z of [-0.5, 5.2]) {
        const x = side * (W - 0.02);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.6), pane);
        glass.position.set(x, 3.3, z);
        glass.rotation.y = -side * (Math.PI / 2);
        const arch = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20, 0, Math.PI), pane);
        arch.position.set(x, 4.6, z);
        arch.rotation.y = -side * (Math.PI / 2);
        scene.add(glass, arch);
        scene.add(box(0.1, 0.1, 1.8, frame, side * (W - 0.05), 1.95, z), box(0.06, 2.7, 0.06, frame, side * (W - 0.04), 3.3, z), box(0.06, 0.06, 1.5, frame, side * (W - 0.04), 3.3, z));
        const shaft = new THREE.SpotLight('#ffe9b8', 60, 22, 0.5, 0.6, 1.4);
        shaft.position.set(side * (W - 0.4), 4.2, z);
        shaft.target.position.set(side * 2, 0, z + 0.5);
        scene.add(shaft, shaft.target);
      }
    }
    // 열려 있는 문과 문틀, 밖의 햇빛
    const day = new THREE.Mesh(new THREE.PlaneGeometry(door * 2, 2.6), new THREE.MeshBasicMaterial({ color: '#f6e2b0' }));
    day.position.set(0, 1.3, D + 0.29);
    day.rotation.y = Math.PI;
    scene.add(day);
    scene.add(box(0.14, 2.7, 0.4, frame, -door - 0.07, 1.35, D + 0.1), box(0.14, 2.7, 0.4, frame, door + 0.07, 1.35, D + 0.1), box(door * 2 + 0.28, 0.14, 0.4, frame, 0, 2.67, D + 0.1));
    for (const side of [-1, 1]) {
      const leaf = box(0.06, 2.5, door, standard('#fff', mapped(tex.panel, 1, 2), 0.6), side * (door + 0.05), 1.25, D - door / 2 - 0.05);
      scene.add(shadowed(leaf));
    }
    // 로비 한가운데의 긴 깔개
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 8), standard('#7a2a22', undefined, 0.95));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.012, 3.6);
    rug.receiveShadow = true;
    const border = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 7.6), standard('#a8402f', undefined, 0.95));
    border.rotation.x = -Math.PI / 2;
    border.position.set(0, 0.016, 3.6);
    border.receiveShadow = true;
    scene.add(rug, border);
    // 북쪽 벽의 시계
    const face = rod(0.4, 0.06, standard('#f3ead6'), -8, 5.2, -D + 0.05, 24);
    face.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 24), standard(BRASS, undefined, 0.35, 0.8));
    rim.position.set(-8, 5.2, -D + 0.08);
    scene.add(face, rim, box(0.03, 0.26, 0.02, frame, -8, 5.31, -D + 0.1), box(0.2, 0.03, 0.02, frame, -7.91, 5.2, -D + 0.1));
  }

  /** 경비원. 둥근 부품을 관절에 매달아 걷고 겨누게 한다. */
  function addGuard(g: Guard): void {
    const kit = ENEMY_KITS.deputy;
    const group = new THREE.Group();
    const skinMats: THREE.MeshStandardMaterial[] = [];
    const mat = (color: string, rough = 0.85): THREE.MeshStandardMaterial => {
      const m = standard(color, undefined, rough);
      skinMats.push(m);
      return m;
    };
    const capsule = (r: number, len: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const trousers = mat('#3d3530');
    const shirt = mat(kit.torso);
    const vest = mat(kit.torsoSide);
    const skin = mat(kit.skin, 0.7);
    const leather = mat('#2a1c14', 0.6);
    // 다리: 엉덩이를 축으로 흔든다.
    const leg = (x: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.88, 0);
      capsule(0.095, 0.5, trousers, 0, -0.36, 0, pivot);
      capsule(0.1, 0.12, leather, 0, -0.78, -0.03, pivot);
      group.add(pivot);
      return pivot;
    };
    const legL = leg(-0.12);
    const legR = leg(0.12);
    // 몸통: 셔츠 위에 조끼, 허리띠와 총집
    capsule(0.2, 0.34, shirt, 0, 1.14, 0, group);
    capsule(0.215, 0.26, vest, 0, 1.12, 0.012, group).scale.set(1, 1, 0.92);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 14), leather);
    belt.position.y = 0.9;
    group.add(belt);
    capsule(0.05, 0.14, leather, 0.22, 0.82, 0, group);
    // 가슴의 별 배지
    const star = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 5), standard(MATERIAL.gold.top, undefined, 0.3, 0.8));
    star.rotation.x = Math.PI / 2;
    star.position.set(-0.1, 1.28, -0.2);
    group.add(star);
    // 목수건, 머리, 얼굴
    const scarf = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.1, 12), mat(MATERIAL.red.top));
    scarf.position.y = 1.46;
    group.add(scarf);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin);
    head.position.y = 1.62;
    head.scale.set(0.95, 1.08, 1);
    group.add(head);
    const dark = standard('#1c1410');
    group.add(box(0.035, 0.025, 0.02, dark, -0.055, 1.645, -0.14), box(0.035, 0.025, 0.02, dark, 0.055, 1.645, -0.14));
    group.add(box(0.14, 0.035, 0.03, standard('#3a2618'), 0, 1.565, -0.145), box(0.035, 0.05, 0.04, skin, 0, 1.6, -0.155));
    // 모자: 살짝 말린 넓은 챙, 위로 좁아지는 정수리, 띠
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.31, 0.03, 24), mat(kit.hat.brim, 0.9));
    brim.position.y = 1.745;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.165, 0.17, 18), mat(kit.hat.crown, 0.9));
    crown.position.y = 1.84;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.168, 0.035, 18), standard(kit.hat.band));
    band.position.y = 1.775;
    group.add(brim, crown, band);
    // 팔: 어깨를 축으로 들어 올린다. 오른손에 권총.
    const arm = (x: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.36, 0);
      capsule(0.065, 0.24, shirt, 0, -0.16, 0, pivot);
      capsule(0.055, 0.22, shirt, 0, -0.44, 0, pivot);
      capsule(0.05, 0.04, skin, 0, -0.62, 0, pivot);
      group.add(pivot);
      return pivot;
    };
    const armL = arm(-0.27);
    const armR = arm(0.27);
    const steel = standard('#5a5e66', undefined, 0.42, 0.35);
    const barrel = rod(0.018, 0.22, steel, 0, -0.66, -0.15, 8);
    barrel.rotation.x = Math.PI / 2;
    armR.add(barrel, box(0.04, 0.07, 0.1, steel, 0, -0.66, -0.02), box(0.035, 0.09, 0.04, standard(MATERIAL.wood.top), 0, -0.6, 0.02));
    // 쏘기 직전에 총구에서 붉게 빛나는 경고
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2e' }));
    glint.position.set(0, -0.66, -0.28);
    armR.add(glint);
    scene.add(shadowed(group));
    rigs.set(g.id, { group, legL, legR, armL, armR, glint, skin: skinMats, fall: 0, lastX: g.x, stride: 0 });
  }

  /** 손에 든 6연발 권총. */
  function buildGun(): void {
    gun = new THREE.Group();
    // 반사할 주변이 없는 실내라 쇠를 너무 금속답게 하면 새까맣게 보인다.
    const steel = standard('#6a6f78', undefined, 0.42, 0.35);
    const grip = standard(MATERIAL.wood.top, undefined, 0.6);
    const barrel = rod(0.014, 0.24, steel, 0, 0.022, -0.17, 12);
    barrel.rotation.x = Math.PI / 2;
    const under = rod(0.008, 0.16, steel, 0, 0, -0.13, 8);
    under.rotation.x = Math.PI / 2;
    drum = rod(0.03, 0.055, steel, 0, 0.012, -0.03, 12);
    drum.rotation.x = Math.PI / 2;
    gun.add(barrel, under, drum);
    gun.add(box(0.024, 0.05, 0.1, steel, 0, 0.012, -0.03), box(0.012, 0.03, 0.018, steel, 0, 0.05, 0.02), box(0.008, 0.018, 0.008, steel, 0, 0.042, -0.285));
    const handle = box(0.03, 0.11, 0.045, grip, 0, -0.055, 0.035);
    handle.rotation.x = 0.4;
    gun.add(handle);
    // 손과 소매
    const skin = standard(PLAYER_KIT.skin, undefined, 0.7);
    const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.04, 4, 8), skin);
    hand.position.set(0, -0.045, 0.045);
    hand.rotation.x = 0.5;
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.34, 4, 10), standard(PLAYER_KIT.torso));
    sleeve.position.set(0.012, -0.1, 0.25);
    sleeve.rotation.x = 1.2;
    gun.add(hand, sleeve);
    muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff1b8' }));
    muzzle.position.set(0, 0.022, -0.32);
    muzzle.visible = false;
    flash = new THREE.PointLight('#ffd27a', 0, 10);
    flash.position.set(0, 0.05, -0.4);
    gun.add(muzzle, flash);
    camera.add(gun);
  }

  function spray(pos: V3, normal: V3, colors: string[], count: number, speed: number, size: number, gravity: number): void {
    for (let i = 0; i < count; i++) {
      const s = size * (0.6 + Math.random() * 0.8);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(s, s, s),
        new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }),
      );
      mesh.position.set(pos[0], pos[1], pos[2]);
      const v = new THREE.Vector3(
        normal[0] + (Math.random() - 0.5) * 1.6, normal[1] + Math.random() * 1.2, normal[2] + (Math.random() - 0.5) * 1.6,
      ).multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      scene.add(mesh);
      const life = 0.35 + Math.random() * 0.4;
      chips.push({ mesh, v, life, maxLife: life, gravity });
    }
    while (chips.length > 220) scene.remove(chips.shift()!.mesh);
  }

  return {
    build(s) {
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#15100c');
      scene.fog = new THREE.Fog('#15100c', 24, 48);
      blocks.clear();
      lamps.clear();
      rigs.clear();
      chips = [];
      holes = [];
      blasts = [];
      shotMeshes = [];
      recoil = shake = 0;
      camera.clear();
      scene.add(camera);
      scene.add(new THREE.HemisphereLight('#ffeacc', '#3a2a1c', 0.75));
      // 위쪽 창에서 비스듬히 드는 빛. 가구와 사람의 그림자를 바닥에 드리운다.
      const sun = new THREE.DirectionalLight('#fff0d0', 1.5);
      sun.position.set(-6, 14, 9);
      sun.target.position.set(0, 0, -1);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const cam = sun.shadow.camera;
      cam.left = -14;
      cam.right = 14;
      cam.top = 13;
      cam.bottom = -13;
      cam.near = 1;
      cam.far = 40;
      sun.shadow.bias = -0.0015;
      scene.add(sun, sun.target);
      blastLight = new THREE.PointLight('#ff9a3a', 0, 20);
      scene.add(blastLight);
      for (const b of s.blocks) {
        const mesh = dress(b);
        scene.add(mesh);
        blocks.set(b.id, mesh);
      }
      decorate();
      for (const g of s.guards) addGuard(g);
      bagMeshes = s.bags.map((bag) => {
        const sack = new THREE.Group();
        const cloth = standard('#c9a36a', undefined, 0.95);
        sack.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), cloth).translateY(0.15));
        sack.add(rod(0.06, 0.1, cloth, 0, 0.33, 0, 10), rod(0.065, 0.025, standard('#5a3d22'), 0, 0.3, 0, 10));
        sack.position.set(bag.x, bag.y, bag.z);
        scene.add(shadowed(sack));
        return sack;
      });
      buildGun();
    },

    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // 세로로 긴 화면에서는 좌우가 좁으므로 시야각을 넓힌다.
      camera.fov = w >= h ? 62 : 84;
      camera.updateProjectionMatrix();
    },

    react(s) {
      for (const e of s.events) {
        if (e.type === 'muzzle') {
          recoil = 1;
          drum.rotation.y += Math.PI / 3;
        } else if (e.type === 'impact') {
          const fast = e.material === 'metal' || e.material === 'powder' || e.material === 'glass';
          spray(e.pos, e.normal, CHIP[e.material], fast ? 9 : 7, fast ? 4.5 : 2.6, fast ? 0.03 : 0.055, fast ? 5 : 9);
          // 총알구멍
          const hole = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), new THREE.MeshBasicMaterial({ color: '#160d08' }));
          hole.position.set(e.pos[0] + e.normal[0] * 0.01, e.pos[1] + e.normal[1] * 0.01, e.pos[2] + e.normal[2] * 0.01);
          hole.lookAt(e.pos[0] + e.normal[0], e.pos[1] + e.normal[1], e.pos[2] + e.normal[2]);
          scene.add(hole);
          holes.push(hole);
          if (holes.length > 90) scene.remove(holes.shift()!);
        } else if (e.type === 'blood') {
          spray(e.pos, [0, 0.4, 0], ['#8c1d16', '#b3261e'], 10, 2.2, 0.045, 9);
        } else if (e.type === 'remove') {
          const mesh = blocks.get(e.id);
          if (mesh) {
            const p = mesh.position;
            spray([p.x, p.y, p.z], [0, 1, 0], [MATERIAL.wood.light, MATERIAL.wood.side, '#fff1b8'], 18, 3.4, 0.09, 9);
            scene.remove(mesh);
            blocks.delete(e.id);
          }
          const light = lamps.get(e.id);
          if (light) {
            scene.remove(light);
            lamps.delete(e.id);
          }
        } else if (e.type === 'boom') {
          spray(e.pos, [0, 1, 0], ['#e8742a', '#f6c453', '#3a2f2a'], 46, 6, 0.12, 6);
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 12),
            new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.85 }),
          );
          mesh.position.set(e.pos[0], e.pos[1], e.pos[2]);
          scene.add(mesh);
          blasts.push({ mesh, life: 0.35, radius: e.radius });
          blastLight.position.copy(mesh.position);
          blastLight.intensity = 260;
          shake = 0.22;
        }
      }
    },

    render(s, dt) {
      const p = s.player;
      clock += dt;
      const moving = Math.abs(p.x - camera.position.x) + Math.abs(p.z - camera.position.z) > 0.004;
      if (moving) walk += dt * 10;
      shake = Math.max(0, shake - dt * 0.7);
      const jitter = (): number => (Math.random() - 0.5) * shake;
      camera.position.set(p.x + jitter(), EYE + Math.sin(walk) * 0.03 + jitter(), p.z + jitter());
      camera.rotation.y = p.yaw;
      camera.rotation.x = p.pitch + recoil * 0.03;

      // 손에 든 권총: 걸을 때의 흔들림, 반동, 재장전 동작
      recoil = Math.max(0, recoil - dt * 7);
      const reloading = p.reload > 0 ? Math.sin((1 - p.reload / s.stats.reloadTime) * Math.PI) : 0;
      gun.position.set(
        0.16 + Math.cos(walk * 0.5) * 0.006,
        -0.13 - reloading * 0.16 + Math.sin(walk) * 0.007,
        -0.42 + recoil * 0.05,
      );
      gun.rotation.set(recoil * 0.35 - reloading * 0.9, 0.03, reloading * 0.5);
      muzzle.visible = recoil > 0.72;
      flash.intensity = recoil > 0.72 ? 14 : 0;

      for (const g of s.guards) {
        const rig = rigs.get(g.id);
        if (!rig) continue;
        if (g.dead) {
          // 뒤로 쓰러진다.
          rig.fall = Math.min(1, rig.fall + dt * 3);
          rig.group.rotation.x = -rig.fall * (Math.PI / 2);
          rig.group.position.set(g.x, g.y + rig.fall * 0.18, g.z);
          rig.armL.rotation.x = rig.armR.rotation.x = -rig.fall * 0.6;
          rig.glint.visible = false;
          continue;
        }
        // 옆으로 걸을 때 다리를 번갈아 내딛는다.
        const speed = Math.abs(g.x - rig.lastX) / Math.max(dt, 1e-4);
        rig.lastX = g.x;
        if (speed > 0.2) rig.stride += dt * 9;
        const swing = speed > 0.2 ? Math.sin(rig.stride) * 0.5 : 0;
        rig.legL.rotation.x = swing;
        rig.legR.rotation.x = -swing;
        rig.group.position.set(g.x, g.y + Math.abs(Math.sin(rig.stride)) * 0.015, g.z);
        rig.group.rotation.set(0, g.yaw, 0);
        const aiming = g.aim > 0;
        // 겨눌 때는 권총 든 팔을 앞으로 뻗고, 평소에는 내려 두고 숨 쉬듯 흔든다.
        const idle = Math.sin(clock * 1.6 + g.id) * 0.05;
        rig.armR.rotation.x = aiming ? Math.PI / 2 : 0.12 + idle - swing * 0.6;
        rig.armL.rotation.x = aiming ? 0.5 : idle + swing * 0.6;
        rig.glint.visible = aiming;
        rig.glint.scale.setScalar(aiming ? 0.5 + (1 - g.aim / 0.55) * 1.8 : 1);
        for (const m of rig.skin) m.emissive.set(g.hitFlash > 0 ? '#aa4433' : '#000000');
      }

      s.bags.forEach((bag, i) => {
        bagMeshes[i]!.visible = !bag.taken;
      });

      // 경비원이 쏜 총알
      while (shotMeshes.length < s.shots.length) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff6a3c' }));
        scene.add(m);
        shotMeshes.push(m);
      }
      shotMeshes.forEach((m, i) => {
        const shot = s.shots[i];
        m.visible = !!shot;
        if (shot) m.position.set(shot.x, shot.y, shot.z);
      });

      chips = chips.filter((c) => {
        c.life -= dt;
        if (c.life <= 0) {
          scene.remove(c.mesh);
          return false;
        }
        c.v.y -= c.gravity * dt;
        c.mesh.position.addScaledVector(c.v, dt);
        if (c.mesh.position.y < 0.02) {
          c.mesh.position.y = 0.02;
          c.v.set(c.v.x * 0.4, 0, c.v.z * 0.4);
        }
        c.mesh.rotation.x += dt * 9;
        c.mesh.rotation.z += dt * 7;
        (c.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (c.life / c.maxLife) * 2);
        return true;
      });
      blasts = blasts.filter((b) => {
        b.life -= dt;
        if (b.life <= 0) {
          scene.remove(b.mesh);
          return false;
        }
        const k = 1 - b.life / 0.35;
        b.mesh.scale.setScalar(b.radius * (0.25 + k * 0.75));
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
        return true;
      });
      blastLight.intensity = Math.max(0, blastLight.intensity - dt * 780);

      renderer.render(scene, camera);
    },
  };
}
