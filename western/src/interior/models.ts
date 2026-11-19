// 밖에서 만든 3D 모델(AI 생성물이나 에셋)을 게임에 들인다.
// 빌드할 때 `assets/` 폴더의 GLB를 줄여 페이지에 실어 두면(`scripts/models.mjs`),
// 여기서 그것을 풀어 질감을 입히고, 크기와 방향을 게임의 좌표에 맞춘다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface PackedTexture {
  material: string;
  slot: 'map' | 'normalMap' | 'roughMetalMap' | 'aoMap' | 'emissiveMap';
  mime: string;
  data: string;
}

export interface PackedModel {
  glb: string;
  textures: PackedTexture[];
  /** auto면 생김새를 보고 방향을 맞추고, manual이면 turn과 shift만 따른다. */
  fit: 'auto' | 'manual';
  /** 가장 긴 쪽의 길이(미터). */
  size: number;
  /** 맞춘 뒤 더 돌릴 각도(도)와 옮길 거리(미터). */
  turn: [number, number, number];
  shift: [number, number, number];
}

/** 이 페이지에 실린 모델들. 없으면 빈 묶음이다. */
export function packedModels(): Record<string, PackedModel | undefined> {
  return (globalThis as { __MODELS?: Record<string, PackedModel> }).__MODELS ?? {};
}

function bytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 실어 둔 모델을 풀어 장면에 넣을 수 있는 묶음으로 만든다. */
export async function loadModel(packed: PackedModel, env: THREE.Texture | null): Promise<THREE.Group> {
  const data = bytes(packed.glb);
  const gltf = await new GLTFLoader().parseAsync(data.buffer as ArrayBuffer, '');
  const images = await Promise.all(packed.textures.map(async (t) => {
    const bitmap = await createImageBitmap(new Blob([bytes(t.data) as BlobPart], { type: t.mime }));
    const texture = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = t.slot === 'map' || t.slot === 'emissiveMap' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return { ...t, texture };
  }));
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const m = material as THREE.MeshStandardMaterial;
      for (const image of images) {
        if (image.material !== m.name) continue;
        if (image.slot === 'roughMetalMap') {
          m.roughnessMap = image.texture;
          m.metalnessMap = image.texture;
        } else {
          m[image.slot] = image.texture;
        }
      }
      if (env) {
        m.envMap = env;
        m.envMapIntensity = 1;
      }
      m.needsUpdate = true;
    }
  });
  return gltf.scene;
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/** 모델의 꼭짓점들을 지금 놓인 자세 그대로 모은다. 많으면 솎아 낸다. */
function points(model: THREE.Object3D): THREE.Vector3[] {
  model.updateWorldMatrix(true, true);
  const out: THREE.Vector3[] = [];
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

/** 꼭짓점들이 가장 넓게 퍼진 두 방향(서로 수직). 권총이라면 옆모습이 놓인 평면을 이룬다. */
function spread(cloud: THREE.Vector3[]): [THREE.Vector3, THREE.Vector3] {
  const centre = cloud.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / cloud.length);
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of cloud) {
    const d = [p.x - centre.x, p.y - centre.y, p.z - centre.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i * 3 + j]! += d[i]! * d[j]!;
  }
  const strongest = (m: number[]): { axis: THREE.Vector3; power: number } => {
    const v = new THREE.Vector3(0.61, 0.53, 0.59);
    let power = 0;
    for (let k = 0; k < 80; k++) {
      v.set(
        m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
        m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
        m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
      );
      power = v.length();
      v.multiplyScalar(1 / (power || 1));
    }
    return { axis: v, power };
  };
  const one = strongest(c);
  const a = one.axis.toArray();
  const rest = c.map((value, k) => value - one.power * a[Math.floor(k / 3)]! * a[k % 3]!);
  const two = strongest(rest).axis;
  two.addScaledVector(one.axis, -two.dot(one.axis)).normalize();
  return [one.axis, two];
}

/**
 * 권총 모델을 게임의 좌표(총구 -z, 위 +y)에 맞춘다. 모델마다 놓인 방향과 크기가 제각각이므로
 * 생김새로 가늠한다: 가장 긴 쪽이 총열, 그다음이 높이, 가장 얇은 쪽이 두께이고,
 * 손잡이가 달려 키가 큰 쪽이 뒤, 손잡이가 처진 쪽이 아래다.
 * 돌려준 묶음은 총구 끝이 front, 윗면이 top에 오도록 놓여 있다.
 */
export function fitGun(model: THREE.Object3D, packed: PackedModel, front: number, top: number): THREE.Group {
  const holder = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.add(model);
  holder.add(pivot);
  if (packed.fit === 'auto') {
    // 모델이 비스듬히 놓여 있어도 되도록, 상자가 아니라 꼭짓점들이 퍼진 모양에서 축을 찾는다.
    const [wide, deep] = spread(points(model));
    const flat = points(model).map((p) => [p.dot(wide), p.dot(deep)] as const);
    // 옆모습을 가장 꼭 맞게 감싸는 직사각형의 긴 변이 총열 방향이다.
    let best = { area: Infinity, angle: 0, long: true };
    for (let deg = 0; deg < 180; deg++) {
      const c = Math.cos((deg * Math.PI) / 180);
      const sn = Math.sin((deg * Math.PI) / 180);
      let lo1 = Infinity;
      let hi1 = -Infinity;
      let lo2 = Infinity;
      let hi2 = -Infinity;
      for (const [u, v] of flat) {
        const a1 = u * c + v * sn;
        const a2 = -u * sn + v * c;
        lo1 = Math.min(lo1, a1);
        hi1 = Math.max(hi1, a1);
        lo2 = Math.min(lo2, a2);
        hi2 = Math.max(hi2, a2);
      }
      const area = (hi1 - lo1) * (hi2 - lo2);
      if (area < best.area) best = { area, angle: (deg * Math.PI) / 180, long: hi1 - lo1 >= hi2 - lo2 };
    }
    const first = wide.clone().multiplyScalar(Math.cos(best.angle)).addScaledVector(deep, Math.sin(best.angle));
    const second = wide.clone().multiplyScalar(-Math.sin(best.angle)).addScaledVector(deep, Math.cos(best.angle));
    // 긴 쪽 → z, 그다음 → y, 얇은 쪽 → x.
    const z = best.long ? first : second;
    const y = best.long ? second : first;
    const x = new THREE.Vector3().crossVectors(y, z);
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).invert();
    let cloud = points(pivot);
    let bounds = new THREE.Box3().setFromPoints(cloud);
    const mid = (bounds.min.z + bounds.max.z) / 2;
    const span = (side: (p: THREE.Vector3) => boolean): { height: number; centre: number } => {
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      let n = 0;
      for (const p of cloud) {
        if (!side(p)) continue;
        lo = Math.min(lo, p.y);
        hi = Math.max(hi, p.y);
        sum += p.y;
        n++;
      }
      return { height: hi - lo, centre: n > 0 ? sum / n : 0 };
    };
    // 키가 큰 절반(손잡이 쪽)이 뒤(+z)로 가야 한다.
    if (span((p) => p.z < mid).height > span((p) => p.z >= mid).height) {
      pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(AXES[1]!, Math.PI));
      cloud = points(pivot);
    }
    // 손잡이는 아래로 처진다: 뒤쪽 절반의 무게중심이 앞쪽(총열)보다 낮아야 한다.
    bounds = new THREE.Box3().setFromPoints(cloud);
    const middle = (bounds.min.z + bounds.max.z) / 2;
    if (span((p) => p.z >= middle).centre > span((p) => p.z < middle).centre) {
      pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(AXES[2]!, Math.PI));
    }
  }
  const rad = packed.turn.map((d) => (d * Math.PI) / 180) as [number, number, number];
  holder.quaternion.setFromEuler(new THREE.Euler(rad[0], rad[1], rad[2]));
  // 크기를 맞추고, 총구 끝과 윗면을 제자리에 댄다.
  let box = new THREE.Box3().setFromPoints(points(holder));
  const size = box.getSize(new THREE.Vector3());
  holder.scale.setScalar(packed.size / Math.max(size.x, size.y, size.z));
  box = new THREE.Box3().setFromPoints(points(holder));
  holder.position.set(
    -(box.min.x + box.max.x) / 2 + packed.shift[0],
    top - box.max.y + packed.shift[1],
    front - box.min.z + packed.shift[2],
  );
  return holder;
}
