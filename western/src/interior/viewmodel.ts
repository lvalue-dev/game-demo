// 1인칭 화면에서 손에 쥔 싱글액션 6연발 리볼버와 손.
// 총은 실제 옆모습 윤곽을 두께만큼 밀어내 만들고, 손은 "총의 어디를 짚는가"를 좌표로 정한 뒤
// 그 점들을 따라 살을 입힌다. 그래서 손가락이 허공을 쥐거나 엉뚱한 데로 뻗지 않는다.
// 좌표는 미터. 총구가 -z, 위가 +y, 쏘는 사람의 오른쪽이 +x다.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLAYER_KIT } from '../kit.ts';
import { fitGun, loadModel, packedModels } from './models.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const ease = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

type P2 = [number, number];

/**
 * 옆모습 윤곽을 두께만큼 밀어내 부품을 만든다. 윤곽의 가로는 총구 방향, 세로는 위쪽이다.
 * 모서리를 살짝 깎아 빛을 받게 하고, 굽은 면은 매끈하게 이어 붙인다.
 */
function profile(
  points: P2[], thickness: number, material: THREE.Material,
  opts: { bevel?: number; hole?: P2[]; smooth?: boolean } = {},
): THREE.Mesh {
  const shape = new THREE.Shape();
  if (opts.smooth) {
    shape.moveTo(points[0]![0], points[0]![1]);
    shape.splineThru([...points.slice(1), points[0]!].map(([a, b]) => new THREE.Vector2(a, b)));
  } else {
    points.forEach(([a, b], i) => (i === 0 ? shape.moveTo(a, b) : shape.lineTo(a, b)));
    shape.closePath();
  }
  if (opts.hole) {
    const hole = new THREE.Path();
    opts.hole.forEach(([a, b], i) => (i === 0 ? hole.moveTo(a, b) : hole.lineTo(a, b)));
    hole.closePath();
    shape.holes.push(hole);
  }
  const bevel = opts.bevel ?? 0.001;
  const depth = Math.max(0.0005, thickness - bevel * 2);
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 20,
  });
  raw.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(toCreasedNormals(raw, 0.6), material);
  // 윤곽의 가로축이 총구 쪽(-z)을, 두께가 좌우(x)를 향하게 돌린다.
  mesh.rotation.y = Math.PI / 2;
  return mesh;
}

/** 총에 비칠 주변. 밝은 창과 어두운 실내를 두어 강철에 뚜렷한 광택이 생기게 한다. */
function studio(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1611');
  const panel = (w: number, h: number, color: [number, number, number], x: number, y: number, z: number, ry: number, rx = 0): void => {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    mat.color.setRGB(...color);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  panel(6, 6, [5, 4.4, 3.4], 6, 2, 0, -Math.PI / 2);
  panel(4, 5, [1.9, 2.1, 2.5], -6, 1, 1, Math.PI / 2);
  panel(8, 3, [3.4, 3, 2.4], 0, 6, 0, 0, Math.PI / 2);
  panel(8, 8, [0.5, 0.36, 0.24], 0, -5, 0, 0, -Math.PI / 2);
  panel(3, 2, [2.6, 2.4, 2], 0, 2, 7, Math.PI);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return texture;
}

function canvasTexture(size: number, repeat: number, paint: (g: CanvasRenderingContext2D, r: () => number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  let seed = 11;
  paint(c.getContext('2d')!, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 호두나무 결 */
const walnutTexture = (): THREE.CanvasTexture => canvasTexture(128, 18, (g, r) => {
  g.fillStyle = '#5a3520';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = r() < 0.5 ? 'rgba(30, 14, 6, 0.35)' : 'rgba(150, 96, 56, 0.25)';
    g.lineWidth = 0.6 + r() * 1.6;
    const y = r() * 128;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(40, y + (r() - 0.5) * 14, 90, y + (r() - 0.5) * 14, 128, y + (r() - 0.5) * 8);
    g.stroke();
  }
});

/** 담금질한 쇠의 얼룩무늬: 잿빛 바탕에 푸른빛, 짚빛, 보랏빛이 구름처럼 번진다. */
const caseTexture = (repeat: number): THREE.CanvasTexture => canvasTexture(256, repeat, (g, r) => {
  g.fillStyle = '#676c73';
  g.fillRect(0, 0, 256, 256);
  const tones: [number, number, number, number][] = [
    [52, 78, 128, 0.55], [168, 132, 74, 0.5], [98, 74, 96, 0.45], [170, 176, 184, 0.4], [40, 52, 78, 0.5],
  ];
  for (let i = 0; i < 60; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rad = 14 + r() * 40;
    const [cr, cg, cb, ca] = tones[Math.floor(r() * tones.length)]!;
    // 이음매가 보이지 않도록 가장자리를 넘는 얼룩은 반대편에도 찍는다.
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${ca})`);
      grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
      g.fillStyle = grad;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
});

// ---------- 살을 입히는 도구 ----------

/** 뼈대를 따라 놓이는 타원 단면 하나. */
interface Ring {
  c: THREE.Vector3;
  /** 가로 반지름과 두께 반지름. */
  rw: number;
  rh: number;
  /** 마디처럼 살짝 붉고 어두운 정도(0~1). */
  tint?: number;
}

interface Loft {
  mesh: THREE.Mesh;
  set(rings: Ring[], hint: THREE.Vector3): void;
  /** i번째 단면에서 angle 방향의 겉면 위 점. lift만큼 바깥으로 띄운다. */
  surface(i: number, angle: number, lift: number, out: THREE.Vector3): THREE.Vector3;
  /** i번째 단면의 두께 방향. */
  thick(i: number): THREE.Vector3;
}

/** 단면들을 이어 매끈한 살을 만든다. hint는 단면의 가로 방향이다. */
function loft(rings: Ring[], hint: THREE.Vector3, material: THREE.Material, segs = 14): Loft {
  const n = rings.length;
  const count = n * segs + 2;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      index.push(a, b, a + segs, b, b + segs, a + segs);
    }
  }
  const first = n * segs;
  const last = first + 1;
  for (let j = 0; j < segs; j++) {
    index.push(first, (j + 1) % segs, j);
    index.push(last, (n - 1) * segs + j, (n - 1) * segs + ((j + 1) % segs));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  const t = V(0, 0, 0);
  const p = V(0, 0, 0);
  const ws = rings.map(() => V(0, 0, 0));
  const hs = rings.map(() => V(0, 0, 0));
  let current = rings;
  const put = (k: number, at: THREE.Vector3, tint: number): void => {
    pos[k * 3] = at.x;
    pos[k * 3 + 1] = at.y;
    pos[k * 3 + 2] = at.z;
    col[k * 3] = 1 - tint * 0.1;
    col[k * 3 + 1] = 1 - tint * 0.27;
    col[k * 3 + 2] = 1 - tint * 0.3;
  };
  const set = (rs: Ring[], hintAxis: THREE.Vector3): void => {
    current = rs;
    for (let i = 0; i < n; i++) {
      const ring = rs[i]!;
      const w = ws[i]!;
      const h = hs[i]!;
      t.copy(rs[Math.min(n - 1, i + 1)]!.c).sub(rs[Math.max(0, i - 1)]!.c).normalize();
      w.copy(hintAxis).addScaledVector(t, -hintAxis.dot(t)).normalize();
      h.crossVectors(t, w);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        p.copy(ring.c).addScaledVector(w, Math.cos(a) * ring.rw).addScaledVector(h, Math.sin(a) * ring.rh);
        put(i * segs + j, p, ring.tint ?? 0);
      }
    }
    put(first, rs[0]!.c, rs[0]!.tint ?? 0);
    put(last, rs[n - 1]!.c, rs[n - 1]!.tint ?? 0);
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.color!.needsUpdate = true;
    geo.computeVertexNormals();
  };
  set(rings, hint);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return {
    mesh, set,
    surface(i, angle, lift, out) {
      const ring = current[i]!;
      return out.copy(ring.c)
        .addScaledVector(ws[i]!, Math.cos(angle) * (ring.rw + lift))
        .addScaledVector(hs[i]!, Math.sin(angle) * (ring.rh + lift));
    },
    thick: (i) => hs[i]!,
  };
}

/**
 * 손가락 하나의 단면들. pts는 손바닥 쪽부터 손끝까지의 관절 점이고, radii는 각 점에서의 굵기다.
 * 뼈는 곧게, 관절은 둥글게 꺾이고, creases에 적힌 관절에는 접힌 주름이 지며, 끝은 둥글게 닫힌다.
 */
function fingerRings(pts: THREE.Vector3[], radii: number[], creases: number[]): Ring[] {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.42);
  const segments = pts.length - 1;
  const lastLength = pts[segments - 1]!.distanceTo(pts[segments]!);
  const tip = radii[segments]!;
  const rings: Ring[] = [];
  for (let k = 0; k < segments; k++) {
    // 끝마디는 단면을 촘촘히 두어 손끝이 둥글게 닫히게 한다.
    const stops = k === segments - 1 ? [0, 0.12, 0.3, 0.48, 0.64, 0.77, 0.87, 0.94, 0.98, 1] : [0, 0.12, 0.3, 0.5, 0.7, 0.88];
    for (const f of stops) {
      const s = k + f;
      let r = mix(radii[k]!, radii[k + 1]!, f);
      let tint = k === segments - 1 && f > 0.6 ? 0.3 : 0;
      const near = Math.round(s);
      const off = Math.abs(s - near);
      if (creases.includes(near)) {
        if (off < 0.01) {
          r *= 0.95;
          tint = 1;
        } else if (off < 0.15) {
          r *= 1.05;
          tint = 0.3;
        }
      }
      const left = (segments - s) * lastLength;
      const dome = tip * 1.15;
      if (left < dome) r *= Math.sqrt(Math.max(0.0004, 1 - (1 - left / dome) ** 2));
      rings.push({ c: curve.getPoint(s / segments), rw: r, rh: r * 0.9, tint });
    }
  }
  return rings;
}

/** 손가락이 굽는 면에 수직인 축. 단면의 가로 방향으로 쓴다. */
function bendAxis(pts: THREE.Vector3[], fallback: THREE.Vector3): THREE.Vector3 {
  const axis = V(0, 0, 0);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i]!.clone().sub(pts[i - 1]!);
    const b = pts[i + 1]!.clone().sub(pts[i]!);
    axis.add(a.cross(b));
  }
  return axis.lengthSq() < 1e-10 ? fallback.clone().normalize() : axis.normalize();
}

interface Digit {
  flesh: Loft;
  nail: THREE.Mesh;
  set(pts: THREE.Vector3[]): void;
}

/** 손끝 마디에서 손톱이 놓이는 단면들(끝마디의 단면 번호)과 각 줄의 너비. */
const NAIL_ROWS = [3, 4, 5, 6, 7];
const NAIL_WIDTH = [0.62, 0.92, 1, 0.98, 0.8];
const NAIL_COLS = 7;

/**
 * 손가락 하나. 손톱은 손가락 겉면을 그대로 떠내 살짝 띄운 얇은 판이라 살에 파묻히거나 들뜨지 않는다.
 * back은 굽은 데가 없을 때 손등 쪽으로 볼 방향이다.
 */
function digit(
  joints: THREE.Vector3[], radii: number[], creases: number[], back: THREE.Vector3, skin: THREE.Material, nailMat: THREE.Material,
): Digit {
  const flesh = loft(fingerRings(joints, radii, creases), bendAxis(joints, V(0, 1, 0)), skin, 16);
  const rows = NAIL_ROWS.length;
  const pos = new Float32Array(rows * NAIL_COLS * 3);
  const index: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < NAIL_COLS - 1; j++) {
      const a = i * NAIL_COLS + j;
      index.push(a, a + 1, a + NAIL_COLS, a + 1, a + NAIL_COLS + 1, a + NAIL_COLS);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  const nail = new THREE.Mesh(geo, nailMat);
  nail.frustumCulled = false;
  const p = V(0, 0, 0);
  const d: Digit = {
    flesh, nail,
    set(q) {
      flesh.set(fingerRings(q, radii, creases), bendAxis(q, V(0, 1, 0)));
      // 굽는 방향의 반대편이 손등이다.
      const n = q.length;
      const along = q[n - 1]!.clone().sub(q[n - 2]!).normalize();
      const bend = along.clone().sub(q[n - 2]!.clone().sub(q[n - 3]!).normalize());
      bend.addScaledVector(along, -bend.dot(along));
      const dorsal = bend.lengthSq() > 1e-4 ? bend.normalize().negate() : back;
      const base = (n - 2) * 6;
      for (let i = 0; i < rows; i++) {
        const ring = base + NAIL_ROWS[i]!;
        const centre = flesh.thick(ring).dot(dorsal) > 0 ? Math.PI / 2 : -Math.PI / 2;
        for (let j = 0; j < NAIL_COLS; j++) {
          const a = centre + (j / (NAIL_COLS - 1) - 0.5) * 1.9 * NAIL_WIDTH[i]!;
          flesh.surface(ring, a, 0.00035, p);
          pos.set([p.x, p.y, p.z], (i * NAIL_COLS + j) * 3);
        }
      }
      geo.attributes.position!.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
  d.set(joints);
  return d;
}

/** 손 하나의 자세. 모든 점은 총을 기준으로 한 좌표다. */
interface HandSpec {
  wrist: THREE.Vector3;
  /** 손목에서 팔꿈치로 가는 방향. */
  elbow: THREE.Vector3;
  /** 손등이 바라보는 쪽. */
  back: THREE.Vector3;
  /** 검지·중지·약지·새끼의 관절 네 점씩. */
  fingers: THREE.Vector3[][];
  thumb: THREE.Vector3[];
  /** 엄지와 검지 사이의 살. */
  web: { at: THREE.Vector3; size: [number, number, number] };
  sleeve: string;
}

const blob = (r: number, at: THREE.Vector3, material: THREE.Material): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), material);
  m.position.copy(at);
  return m;
};

interface HandRig {
  group: THREE.Group;
  index: Digit;
  thumb: Digit;
}

const FINGER_RADII = [
  [0.0098, 0.0088, 0.0079, 0.0071],
  [0.0101, 0.0091, 0.0082, 0.0073],
  [0.0096, 0.0086, 0.0077, 0.0069],
  [0.0086, 0.0077, 0.0069, 0.0062],
];
const THUMB_RADII = [0.0158, 0.0118, 0.0102, 0.0088];

function buildHand(spec: HandSpec, skin: THREE.Material, plain: THREE.Material, nailMat: THREE.Material): HandRig {
  const group = new THREE.Group();
  const knuckles = spec.fingers.map((f) => f[0]!);
  const centre = knuckles.reduce((sum, k) => sum.add(k), V(0, 0, 0)).multiplyScalar(1 / knuckles.length);
  const across = knuckles[3]!.clone().sub(knuckles[0]!).normalize();
  const at = (t: number): THREE.Vector3 => spec.wrist.clone().lerp(centre, t);
  // 팔뚝에서 손목을 지나 손마디 줄까지 이어지는 몸통
  const body: Ring[] = [
    { c: spec.wrist.clone().addScaledVector(spec.elbow, 0.12), rw: 0.034, rh: 0.028 },
    { c: spec.wrist.clone().addScaledVector(spec.elbow, 0.05), rw: 0.0295, rh: 0.0225 },
    { c: spec.wrist.clone(), rw: 0.0285, rh: 0.0195 },
    { c: at(0.28), rw: 0.0345, rh: 0.0205 },
    { c: at(0.62), rw: 0.0405, rh: 0.019 },
    { c: at(0.9), rw: 0.0405, rh: 0.0155, tint: 0.15 },
    { c: at(1.02), rw: 0.0385, rh: 0.0125, tint: 0.3 },
    { c: at(1.1), rw: 0.031, rh: 0.007, tint: 0.3 },
  ];
  group.add(loft(body, across, skin, 28).mesh);
  // 손가락이 손등에서 갈라져 나오는 자리의 둥근 손마디
  knuckles.forEach((k, i) => group.add(blob(FINGER_RADII[i]![0]! * 0.92, k.clone().addScaledVector(spec.back, 0.0045), plain)));
  const digits = spec.fingers.map((pts, i) => digit(pts, FINGER_RADII[i]!, [1, 2], spec.back, skin, nailMat));
  const thumb = digit(spec.thumb, THUMB_RADII, [2], spec.back, skin, nailMat);
  for (const d of [...digits, thumb]) group.add(d.flesh.mesh, d.nail);
  const web = blob(1, spec.web.at, plain);
  web.scale.set(...spec.web.size);
  group.add(web);

  // 소매: 셔츠 소매 끝과 그 위를 덮은 겉옷. 손목에서 팔꿈치 쪽으로 이어진다.
  const arm = new THREE.Group();
  const down = spec.elbow.clone().normalize();
  const wide = across.clone().addScaledVector(down, -across.dot(down)).normalize();
  const up = down.clone().negate();
  arm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wide, up, wide.clone().cross(up)));
  arm.position.copy(spec.wrist);
  const cloth = new THREE.MeshStandardMaterial({ color: '#e6dcc6', roughness: 0.95, envMapIntensity: 0.2 });
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.037, 0.05, 22), cloth);
  cuff.scale.set(1, 1, 0.84);
  cuff.position.y = -0.082;
  const cuffEdge = new THREE.Mesh(new THREE.TorusGeometry(0.0335, 0.0022, 8, 24), cloth);
  cuffEdge.rotation.x = Math.PI / 2;
  cuffEdge.scale.set(1, 0.84, 1);
  cuffEdge.position.y = -0.057;
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 8), new THREE.MeshStandardMaterial({ color: '#8a6a40', roughness: 0.5 }));
  button.scale.set(1, 1, 0.5);
  button.position.set(0, -0.078, 0.03);
  const wool = new THREE.MeshStandardMaterial({ color: spec.sleeve, roughness: 1, envMapIntensity: 0.15 });
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.064, 0.34, 22), wool);
  sleeve.scale.set(1, 1, 0.88);
  sleeve.position.y = -0.268;
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.0425, 0.0055, 8, 24), wool);
  hem.rotation.x = Math.PI / 2;
  hem.scale.set(1, 0.88, 1);
  hem.position.y = -0.1;
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0462, 0.0478, 0.018, 22),
    new THREE.MeshStandardMaterial({ color: '#f6d67a', roughness: 1, envMapIntensity: 0.15 }),
  );
  stripe.scale.set(1, 1, 0.88);
  stripe.position.y = -0.145;
  arm.add(cuff, cuffEdge, button, sleeve, hem, stripe);
  group.add(arm);
  return { group, index: digits[0]!, thumb };
}

export interface ViewmodelPose {
  dt: number;
  clock: number;
  /** 걸음의 위상과 걷는 정도(0~1). */
  walk: number;
  speed: number;
  /** 시점을 돌릴 때 총이 늦게 따라오는 정도. */
  sway: number;
  lift: number;
  roll: number;
  /** 반동으로 튄 정도. */
  kick: number;
  sinceShot: number;
  /** 지금까지 쏜 발수. 탄창이 그만큼 돌아가 있다. */
  turns: number;
  /** 재장전 진행도. 재장전 중이 아니면 -1. */
  reload: number;
}

export interface Viewmodel {
  root: THREE.Group;
  /** 총구의 세계 좌표. 연기가 나는 자리다. */
  muzzlePoint(): THREE.Vector3;
  update(pose: ViewmodelPose): void;
}

// 손잡이는 뒤로 기울어 있다. 이 틀 안에서는 손잡이가 곧게 아래로 뻗으므로 쥐는 자리를 잡기 쉽다.
// 가로(x), 손잡이를 따라 위아래(u), 앞뒤(v, 뒤가 +).
const GRIP_ORIGIN = V(0, -0.018, 0.026);
const GRIP_TILT = new THREE.Euler(-0.34, 0, 0);
const grip = (x: number, u: number, v: number): THREE.Vector3 => V(x, u, v).applyEuler(GRIP_TILT).add(GRIP_ORIGIN);

/** 공이치기가 젖혀지는 각도. */
const COCK = 0.6;

export function createViewmodel(renderer: THREE.WebGLRenderer): Viewmodel {
  const root = new THREE.Group();
  const env = studio(renderer);
  // 푸른빛이 도는 청색 처리 강철, 담금질 무늬가 남은 몸통, 호두나무, 놋쇠
  const blued = new THREE.MeshStandardMaterial({ color: '#2b3340', metalness: 0.94, roughness: 0.23, envMap: env, envMapIntensity: 1.5 });
  const cased = new THREE.MeshStandardMaterial({ map: caseTexture(11), metalness: 0.84, roughness: 0.34, envMap: env, envMapIntensity: 0.95 });
  // 돌려 깎은 부품은 무늬가 한 바퀴에 몇 번만 돌게 한다.
  const casedRound = new THREE.MeshStandardMaterial({ map: caseTexture(2), metalness: 0.84, roughness: 0.34, envMap: env, envMapIntensity: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: '#111317', metalness: 0.6, roughness: 0.6, envMap: env, envMapIntensity: 0.5 });
  const walnut = new THREE.MeshPhysicalMaterial({
    map: walnutTexture(), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, envMap: env, envMapIntensity: 0.5,
  });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.9, roughness: 0.3, envMap: env, envMapIntensity: 1.3 });
  const hole = new THREE.MeshBasicMaterial({ color: '#050505' });
  const lay = (m: THREE.Mesh): THREE.Mesh => {
    m.rotation.x = Math.PI / 2;
    return m;
  };
  const tube = (rBack: number, rFront: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 24): THREE.Mesh => {
    const m = lay(new THREE.Mesh(new THREE.CylinderGeometry(rBack, rFront, len, seg), mat));
    m.position.set(x, y, z);
    return m;
  };
  const stud = (r: number, mat: THREE.Material, x: number, y: number, z: number, len = 0.001): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  };

  const gun = new THREE.Group();
  root.add(gun);
  // 코드로 깎은 총. 밖에서 만든 모델이 있으면 이것 대신 그 모델을 보여 준다.
  const parts = new THREE.Group();
  gun.add(parts);

  // 몸통: 얇은 윗띠, 탄창이 들어가는 창, 앞으로 둥글게 말린 아래턱, 뒤로 흘러내리는 등
  parts.add(profile(
    [
      [0.048, 0.0355], [-0.01, 0.0358], [-0.017, 0.035], [-0.023, 0.032], [-0.028, 0.027], [-0.032, 0.02], [-0.0345, 0.01],
      [-0.036, 0], [-0.0365, -0.011], [-0.018, -0.022], [0.034, -0.022], [0.04, -0.0205], [0.0445, -0.017], [0.047, -0.011], [0.048, -0.004],
    ],
    0.0162, cased, { hole: [[-0.008, -0.0125], [0.0365, -0.0125], [0.0365, 0.0305], [-0.008, 0.0305]], bevel: 0.002 },
  ));
  // 탄창 뒤를 막는 둥근 방패판. 오른쪽 절반은 장전구 덮개이고 엄지로 여는 턱이 달려 있다.
  const shieldShape: P2[] = [[0, 0], [0.0198, 0], [0.0205, 0.0008], [0.0205, 0.0065], [0.0188, 0.0102], [0.0145, 0.012], [0, 0.012]];
  const shield = lay(new THREE.Mesh(new THREE.LatheGeometry(shieldShape.map(([r, y]) => new THREE.Vector2(r, y)), 40), casedRound));
  shield.position.set(0, 0.009, 0.008);
  const gateNub = new THREE.Mesh(new THREE.SphereGeometry(0.003, 10, 8), cased);
  gateNub.scale.set(0.8, 1.6, 1);
  gateNub.position.set(0.0205, 0.012, 0.014);
  parts.add(shield, gateNub);

  // 총열: 총구로 갈수록 살짝 가늘다. 끝에 총구 구멍과 둥글린 테두리.
  parts.add(tube(0.008, 0.0069, 0.142, blued, 0, 0.021, -0.119, 32));
  parts.add(tube(0.0092, 0.0086, 0.006, blued, 0, 0.021, -0.05, 32));
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.0047, 20), hole);
  bore.position.set(0, 0.021, -0.1903);
  bore.rotation.y = Math.PI;
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.0058, 0.0011, 8, 24), blued);
  crown.position.set(0, 0.021, -0.19);
  parts.add(bore, crown);
  // 가늠쇠와 윗띠를 따라 판 가늠자 홈
  parts.add(profile([[0.17, 0.0272], [0.187, 0.0272], [0.1855, 0.0345], [0.181, 0.0372], [0.177, 0.0372]], 0.0022, blued, { bevel: 0.0004 }));
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.0026, 0.0016, 0.05), dark);
  notch.position.set(0, 0.0352, -0.014);
  parts.add(notch);
  // 총열 오른쪽 아래의 탄피 밀대 집과 손잡이, 탄창 축의 머리
  parts.add(tube(0.0046, 0.0046, 0.098, blued, 0.0088, 0.0098, -0.097, 18));
  const rodTip = new THREE.Mesh(new THREE.SphereGeometry(0.0046, 12, 10), blued);
  rodTip.position.set(0.0088, 0.0098, -0.146);
  const rodHead = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 14, 10), blued);
  rodHead.scale.set(0.45, 1, 1.25);
  rodHead.position.set(0.0138, 0.0098, -0.128);
  parts.add(rodTip, rodHead);
  parts.add(tube(0.0031, 0.0031, 0.014, blued, 0, 0.009, -0.052, 14));
  const pinHead = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 12, 10), blued);
  pinHead.position.set(0, 0.009, -0.06);
  parts.add(pinHead);
  // 몸통의 나사
  for (const [y, z] of [[-0.013, -0.03], [-0.004, 0.026], [-0.015, 0.004], [0.004, -0.043]] as const) {
    parts.add(stud(0.0021, blued, -0.0081, y, z), stud(0.0021, blued, 0.0081, y, z));
  }

  // 탄창: 앞쪽 절반에 홈 여섯 줄이 파여 있고, 앞면에 약실 구멍, 뒷면에 탄피 바닥이 보인다.
  const cylinder = new THREE.Group();
  cylinder.position.set(0, 0.009, -0.014);
  const R = 0.0205;
  const fluted = (depth: number, zFront: number, zBack: number): THREE.Mesh => {
    const shape = new THREE.Shape();
    const steps = 180;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const off = Math.abs(((a + Math.PI / 6) % (Math.PI / 3)) - Math.PI / 6) / 0.19;
      const r = R - (off < 1 ? depth * Math.cos((off * Math.PI) / 2) ** 2 : 0);
      if (i === 0) shape.moveTo(r, 0);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const raw = new THREE.ExtrudeGeometry(shape, { depth: zBack - zFront, bevelEnabled: false, curveSegments: 4 });
    raw.translate(0, 0, zFront);
    return new THREE.Mesh(toCreasedNormals(raw, 0.7), blued);
  };
  cylinder.add(fluted(0.0028, -0.0205, -0.006), fluted(0.0023, -0.006, -0.0042), fluted(0.0015, -0.0042, -0.0026), fluted(0.0006, -0.0026, -0.0012));
  cylinder.add(tube(R, R, 0.0222, blued, 0, 0, 0.0099, 60));
  for (let i = 0; i < 6; i++) {
    const b = (i * Math.PI) / 3 + Math.PI / 6;
    const cx = Math.cos(b) * 0.0122;
    const cy = Math.sin(b) * 0.0122;
    const chamber = new THREE.Mesh(new THREE.CircleGeometry(0.0053, 16), hole);
    chamber.position.set(cx, cy, -0.0207);
    chamber.rotation.y = Math.PI;
    // 탄창을 멈춰 세우는 걸쇠 홈
    const stop = new THREE.Mesh(new THREE.BoxGeometry(0.0024, 0.0009, 0.004), dark);
    stop.position.set(Math.cos(b) * (R - 0.0003), Math.sin(b) * (R - 0.0003), 0.013);
    stop.rotation.z = b - Math.PI / 2;
    cylinder.add(chamber, tube(0.0059, 0.0059, 0.0012, brass, cx, cy, 0.0214, 16), tube(0.0022, 0.0022, 0.0014, cased, cx, cy, 0.0215, 10), stop);
  }
  parts.add(cylinder);

  // 공이치기: 아래의 축을 중심으로 뒤로 젖혀진다. 엄지가 걸리는 돌기에는 미끄럼 방지 홈이 있다.
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.004, 0.03);
  hammer.add(profile(
    [
      [0.005, -0.003], [0.007, 0.012], [0.0072, 0.026], [0.0045, 0.033], [-0.002, 0.0375], [-0.009, 0.042], [-0.0165, 0.0455],
      [-0.0195, 0.0445], [-0.0185, 0.0415], [-0.011, 0.038], [-0.0065, 0.032], [-0.0055, 0.018], [-0.0055, -0.003],
    ],
    0.0074, cased, { bevel: 0.0009 },
  ));
  for (let i = 0; i < 4; i++) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.0078, 0.0005, 0.001), dark);
    groove.position.set(0, 0.0435 + i * 0.00093, 0.0115 + i * 0.002);
    groove.rotation.x = -0.437;
    hammer.add(groove);
  }
  parts.add(hammer);

  // 방아쇠울(넓적한 띠)과 방아쇠
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.0019, 10, 30, Math.PI), blued);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.scale.set(1.12, 0.95, 2.9);
  guard.position.set(0, -0.022, 0.003);
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.021, 0.006);
  trigger.add(profile([[0.002, 0], [0.0046, -0.006], [0.0038, -0.0125], [0.0012, -0.0135], [0.0018, -0.006], [-0.001, 0]], 0.0046, blued, { bevel: 0.0006 }));
  parts.add(guard, trigger);

  // 손잡이: 쇠 뼈대 양옆에 호두나무 판을 댄다. 아래로 갈수록 뒤로 휜다.
  const gripOutline: P2[] = [
    [-0.016, -0.022], [-0.036, -0.011], [-0.047, -0.03], [-0.06, -0.06], [-0.074, -0.092],
    [-0.06, -0.105], [-0.04, -0.104], [-0.03, -0.08], [-0.022, -0.05],
  ];
  parts.add(profile(gripOutline, 0.0135, blued, { smooth: true, bevel: 0.0012 }));
  const inset = gripOutline.map(([a, b]): P2 => [-0.043 + (a + 0.043) * 0.86, -0.064 + (b + 0.064) * 0.88]);
  parts.add(profile(inset, 0.0275, walnut, { smooth: true, bevel: 0.0048 }));
  for (const x of [-0.0142, 0.0142]) {
    parts.add(stud(0.0034, brass, x, -0.035, 0.04), stud(0.0022, blued, x, -0.064, 0.05));
  }

  // ---------- 손 ----------
  const skinV = new THREE.MeshStandardMaterial({ color: '#b98360', roughness: 0.68, envMapIntensity: 0.25, vertexColors: true });
  const skin = new THREE.MeshStandardMaterial({ color: '#b98360', roughness: 0.68, envMapIntensity: 0.25 });
  const nail = new THREE.MeshStandardMaterial({ color: '#e2bfa9', roughness: 0.3, envMapIntensity: 0.5, side: THREE.DoubleSide });

  // 오른손: 손바닥이 오른쪽 판과 등쪽을 감싸고, 세 손가락이 앞을 돌아 왼쪽 판을 누르고,
  // 검지는 방아쇠에, 엄지는 등을 넘어 왼쪽으로 내려가 있다.
  // u는 손잡이의 어느 높이를 쥐는지, reach는 손가락이 얼마나 길게 감기는지다.
  const wrap = (u: number, reach: number): THREE.Vector3[] => [
    grip(0.021 + 0.007 * reach, u, -0.014 + (1 - reach) * 0.01),
    grip(-0.014 * reach, u - 0.001, -0.0235),
    grip(-0.0214, u + 0.0005, 0.003 - (1 - reach) * 0.037),
    grip(-0.0185, u + 0.002, 0.019 - (1 - reach) * 0.03),
  ];
  const triggerRest = [V(0.028, -0.025, 0.02), V(0.026, -0.03, -0.02), V(0.0035, -0.03, -0.0105), V(-0.0155, -0.0295, -0.003)];
  const triggerPulled = [V(0.028, -0.025, 0.02), V(0.026, -0.03, -0.017), V(0.004, -0.03, -0.0065), V(-0.0155, -0.0295, 0.002)];
  const thumbRest = [V(0.012, -0.016, 0.09), V(-0.011, -0.019, 0.058), V(-0.0205, -0.019, 0.029), V(-0.0175, -0.027, 0.006)];
  // 엄지가 공이치기 돌기에 올라간 자세. 공이치기가 내려가 있을 때와 다 젖혀졌을 때.
  const thumbOnSpur = [V(0.012, -0.016, 0.09), V(-0.009, -0.013, 0.061), V(-0.008, 0.019, 0.068), V(-0.001, 0.045, 0.058)];
  const thumbCocked = [V(0.012, -0.016, 0.09), V(-0.01, -0.014, 0.061), V(-0.011, 0.011, 0.081), V(-0.002, 0.034, 0.084)];
  const right = buildHand({
    wrist: V(0.014, -0.025, 0.105),
    elbow: V(0.17, -0.27, 0.9).normalize(),
    back: V(1, 0, 0),
    fingers: [triggerRest, wrap(-0.022, 1), wrap(-0.042, 0.96), wrap(-0.06, 0.7)],
    thumb: thumbRest,
    web: { at: V(0.005, -0.022, 0.057), size: [0.02, 0.011, 0.012] },
    sleeve: PLAYER_KIT.torso,
  }, skinV, skin, nail);
  gun.add(right.group);

  // 왼손: 재장전 때 아래에서 올라와 총열 밑동을 받친다. 엄지는 총열 왼쪽에 얹힌다.
  const cradle = (z: number, k: number): THREE.Vector3[] => [
    V(-0.03 * k, 0.012 * k, z), V(0.007 * k, -0.004, z + 0.001), V(0.0235 * k + 0.002, 0.016 * k, z + 0.002), V(0.016, 0.034 * k + 0.004, z + 0.003),
  ];
  const left = buildHand({
    wrist: V(-0.098, -0.0375, -0.0425),
    elbow: V(-0.3, -0.55, 0.78).normalize(),
    back: V(-0.5, -0.86, 0),
    fingers: [cradle(-0.098, 1), cradle(-0.08, 1), cradle(-0.062, 0.97), cradle(-0.045, 0.85)],
    thumb: [V(-0.086, -0.033, -0.065), V(-0.056, -0.01, -0.088), V(-0.036, 0.01, -0.105), V(-0.019, 0.022, -0.12)],
    web: { at: V(-0.05, -0.008, -0.095), size: [0.018, 0.012, 0.014] },
    sleeve: PLAYER_KIT.torso,
  }, skinV, skin, nail);
  gun.add(left.group);

  // 총구 화염: 밝게 번지는 빛 한 장과 순간의 조명
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g2 = c.getContext('2d')!;
  const glow = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255, 250, 220, 1)');
  glow.addColorStop(0.25, 'rgba(255, 210, 110, 0.9)');
  glow.addColorStop(0.6, 'rgba(240, 120, 40, 0.35)');
  glow.addColorStop(1, 'rgba(240, 120, 40, 0)');
  g2.fillStyle = glow;
  g2.fillRect(0, 0, 128, 128);
  g2.strokeStyle = 'rgba(255, 240, 190, 0.9)';
  g2.lineWidth = 5;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + 0.3;
    g2.beginPath();
    g2.moveTo(64, 64);
    g2.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    g2.stroke();
  }
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  muzzle.position.set(0, 0.021, -0.218);
  muzzle.visible = false;
  const flash = new THREE.PointLight('#ffd27a', 0, 10);
  flash.position.set(0, 0.04, -0.3);
  gun.add(muzzle, flash);

  root.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) n.castShadow = false;
  });

  // 밖에서 만든 모델로 갈아 끼운다. hold는 팔과 손이 총을 쥔 채로 한 덩어리인 모델이고,
  // revolver는 총만 있는 모델이다. 총구 끝과 윗면을 코드로 깎은 총의 자리에 맞춘다.
  // 모델을 풀지 못하면 코드로 깎은 총이 그대로 남는다.
  const models = packedModels();
  const FRONT = -0.19;
  const TOP = 0.037;
  if (models.hold) {
    const packed = models.hold;
    void loadModel(packed, null).then((model) => {
      parts.visible = false;
      right.group.visible = false;
      gun.add(fitGun(model, { ...packed, fit: 'manual' }, FRONT, TOP));
    }).catch(() => undefined);
  } else if (models.revolver) {
    const packed = models.revolver;
    void loadModel(packed, env).then((model) => {
      parts.visible = false;
      gun.add(fitGun(model, packed, FRONT, TOP));
    }).catch(() => undefined);
  }

  const blend = (a: THREE.Vector3[], b: THREE.Vector3[], t: number): THREE.Vector3[] => a.map((p, i) => p.clone().lerp(b[i]!, t));
  let lastIndex = -1;
  let lastThumb = -1;

  return {
    root,
    muzzlePoint: () => muzzle.getWorldPosition(new THREE.Vector3()),
    update(p) {
      const reloading = p.reload >= 0;
      const q = reloading ? p.reload : 0;
      // 재장전: 총을 내려 기울이고, 한 발씩 넣는 동안 작게 흔들리다가, 다시 올린다.
      const down = reloading ? ease(Math.min(1, q / 0.18)) * ease(Math.min(1, (1 - q) / 0.15)) : 0;
      const tick = Math.sin(q * Math.PI * 12) * 0.005 * down;
      const breath = Math.sin(p.clock * 1.5);
      // 자동 점검 때는 자세를 고정해 여러 각도에서 살펴볼 수 있게 한다.
      if (!root.userData.frozen) {
        root.position.set(
          0.135 + Math.cos(p.walk) * 0.009 * p.speed + p.sway * 0.04 - down * 0.06,
          -0.135 - Math.abs(Math.sin(p.walk)) * 0.012 * p.speed + breath * 0.0025 - p.lift * 0.04 - down * 0.06 + p.kick * 0.03 + tick,
          -0.5 + p.kick * 0.12 + p.speed * 0.01 + down * 0.04,
        );
        root.rotation.set(
          p.kick * 1.1 + p.lift * 0.5 + breath * 0.004 + down * 0.7,
          0.15 - p.sway * 0.9 + down * 0.3,
          p.roll * 2.2 - p.sway * 0.5 - down * 0.85,
        );
      }

      // 싱글액션: 쏘면 공이치기가 떨어지고, 엄지가 다시 당기는 동안 탄창이 한 칸 돈다.
      const cocking = clamp((p.sinceShot - 0.07) / 0.15, 0, 1);
      const cocked = ease(cocking);
      hammer.rotation.x = COCK * cocked;
      cylinder.rotation.z = (reloading ? Math.floor(q * 6) + ease((q * 6) % 1) : p.turns - 1 + cocked) * (Math.PI / 3);
      const pull = p.sinceShot < 0.1 ? 1 - p.sinceShot / 0.1 : 0;
      trigger.rotation.x = 0.32 * pull;
      // 검지는 방아쇠를 당겼다 놓는다. 자세가 바뀔 때만 살을 다시 입힌다.
      if (pull !== lastIndex) {
        right.index.set(blend(triggerRest, triggerPulled, pull));
        lastIndex = pull;
      }
      // 엄지는 돌기로 올라가 공이치기를 끝까지 젖힌 뒤 제자리로 내려온다.
      const up = ease(clamp(p.sinceShot / 0.07, 0, 1)) * (1 - ease(clamp((p.sinceShot - 0.22) / 0.14, 0, 1)));
      const key = up * 10 + cocked;
      if (key !== lastThumb) {
        right.thumb.set(blend(thumbRest, blend(thumbOnSpur, thumbCocked, cocked), up));
        lastThumb = key;
      }

      // 왼손: 재장전 동안만 올라와 총열 밑동을 받치고, 한 발 넣을 때마다 까딱인다.
      left.group.visible = down > 0.02;
      left.group.position.set(-0.05 * (1 - down), -0.16 * (1 - down) - tick * 0.6, 0.05 * (1 - down));

      const firing = p.sinceShot < 0.05;
      muzzle.visible = firing;
      if (firing) {
        muzzle.material.rotation = p.turns * 1.7;
        muzzle.scale.setScalar(0.15 + ((p.turns * 37) % 10) * 0.006);
      }
      flash.intensity = firing ? 14 : 0;
    },
  };
}
