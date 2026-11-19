// 건물 안 1인칭 장면의 3D 그리기.
// 바깥과 같은 블록 규칙을 쓴다: 모든 것은 상자와 원통이고, 색은 재질에서 오며, 같은 굵기의 외곽선을 두른다.
import * as THREE from 'three';
import { ENEMY_KITS, INK, MATERIAL, PLAYER_KIT } from '../kit.ts';
import { EYE, ROOM } from './level.ts';
import type { Block, Guard, Interior, Mat3, V3 } from './level.ts';

const COLOR: Record<Mat3, string> = {
  wood: MATERIAL.wood.top,
  brick: MATERIAL.brick.top,
  metal: MATERIAL.metal.top,
  glass: MATERIAL.glass.top,
  powder: MATERIAL.powder.top,
};
/** 재질마다 튀는 조각의 색. */
const CHIP: Record<Mat3, string[]> = {
  wood: [MATERIAL.wood.light, MATERIAL.wood.side],
  brick: [MATERIAL.brick.top, '#d9a08c'],
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
  arm: THREE.Group;
  glint: THREE.Mesh;
  paint: THREE.MeshLambertMaterial[];
  fall: number;
}

const edgeMaterial = new THREE.LineBasicMaterial({ color: INK });

/** 외곽선을 두른 상자. 블록 그림체의 기본 단위다. */
function block(w: number, h: number, d: number, color: string, map?: THREE.Texture): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: map ? '#ffffff' : color, map }));
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMaterial));
  return mesh;
}

/** 벽돌과 마루널의 결. 작은 그림 한 장을 반복해 붙인다. */
function pattern(kind: 'brick' | 'plank'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'brick') {
    g.fillStyle = MATERIAL.brick.top;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = MATERIAL.brick.side;
    g.lineWidth = 3;
    for (let row = 0; row < 8; row++) {
      g.strokeRect(-2, row * 16, 132, 16);
      for (let x = row % 2 ? 16 : 0; x < 128; x += 32) {
        g.beginPath();
        g.moveTo(x, row * 16);
        g.lineTo(x, row * 16 + 16);
        g.stroke();
      }
    }
  } else {
    g.fillStyle = '#8a6540';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#5f4226';
    g.lineWidth = 3;
    for (let x = 0; x <= 128; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 128);
      g.stroke();
    }
    g.fillStyle = '#9a7650';
    for (let i = 0; i < 8; i++) g.fillRect((i % 4) * 32 + 4, ((i * 53) % 110) + 4, 22, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
  camera.rotation.order = 'YXZ';
  let scene = new THREE.Scene();
  const brick = pattern('brick');
  const plank = pattern('plank');

  const blocks = new Map<number, THREE.Object3D>();
  const lamps = new Map<number, THREE.PointLight>();
  const rigs = new Map<number, Rig>();
  let bagMeshes: THREE.Object3D[] = [];
  let shotMeshes: THREE.Mesh[] = [];
  let chips: Chip[] = [];
  let holes: THREE.Mesh[] = [];
  let blasts: { mesh: THREE.Mesh; life: number; radius: number }[] = [];
  let gun = new THREE.Group();
  let flash = new THREE.PointLight('#ffd27a', 0, 8);
  let muzzle = new THREE.Mesh();
  let recoil = 0;
  let shake = 0;
  let walk = 0;
  let blastLight = new THREE.PointLight('#ff9a3a', 0, 14);

  function addBlock(b: Block): void {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    let map: THREE.Texture | undefined;
    if (b.tag === 'wall' || b.tag === 'floor') {
      map = (b.material === 'brick' ? brick : plank).clone();
      map.needsUpdate = true;
      if (b.tag === 'floor') map.repeat.set(w / 1.6, d / 1.6);
      else map.repeat.set(Math.max(w, d) / 1.6, h / 1.6);
    }
    const mesh = block(w, h, d, COLOR[b.material], map);
    mesh.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    const mat = mesh.material as THREE.MeshLambertMaterial;
    if (b.tag === 'lamp') {
      mat.emissive = new THREE.Color('#ffcf70');
      const light = new THREE.PointLight('#ffc978', 9, 16);
      light.position.copy(mesh.position);
      scene.add(light);
      lamps.set(b.id, light);
    }
    if (b.tag === 'keg') {
      // 화약통의 붉은 띠
      const band = block(w + 0.02, h * 0.18, d + 0.02, MATERIAL.red.top);
      mesh.add(band);
    }
    if (b.tag === 'safe') {
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16), new THREE.MeshLambertMaterial({ color: MATERIAL.gold.top }));
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0, 0.1, d / 2 + 0.03);
      mesh.add(dial);
    }
    scene.add(mesh);
    blocks.set(b.id, mesh);
  }

  function addGuard(g: Guard): void {
    const kit = ENEMY_KITS.deputy;
    const group = new THREE.Group();
    const paint: THREE.MeshLambertMaterial[] = [];
    const part = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = group): THREE.Mesh => {
      const m = block(w, h, d, color);
      m.position.set(x, y, z);
      parent.add(m);
      paint.push(m.material as THREE.MeshLambertMaterial);
      return m;
    };
    part(0.2, 0.8, 0.22, kit.legs, -0.13, 0.4, 0);
    part(0.2, 0.8, 0.22, kit.legs, 0.13, 0.4, 0);
    part(0.6, 0.65, 0.3, kit.torso, 0, 1.125, 0);
    part(0.16, 0.6, 0.16, kit.torso, -0.38, 1.15, 0);
    part(0.32, 0.33, 0.32, kit.skin, 0, 1.615, 0);
    // 가슴의 별 배지
    part(0.12, 0.12, 0.03, MATERIAL.gold.top, 0.15, 1.3, -0.16);
    // 모자: 넓은 챙과 정수리
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 20), new THREE.MeshLambertMaterial({ color: kit.hat.brim }));
    brim.position.y = 1.8;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.2, 16), new THREE.MeshLambertMaterial({ color: kit.hat.crown }));
    crown.position.y = 1.92;
    group.add(brim, crown);
    // 총을 든 오른팔. 어깨를 축으로 들어 올린다.
    const arm = new THREE.Group();
    arm.position.set(0.38, 1.42, 0);
    part(0.16, 0.6, 0.16, kit.torso, 0, -0.28, 0, arm);
    part(0.07, 0.1, 0.34, '#2b2b2f', 0, -0.6, -0.14, arm);
    group.add(arm);
    // 쏘기 직전에 총구에서 붉게 빛나는 경고
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2e' }));
    glint.position.set(0, -0.6, -0.36);
    arm.add(glint);
    scene.add(group);
    rigs.set(g.id, { group, arm, glint, paint, fall: 0 });
  }

  function buildGun(): void {
    gun = new THREE.Group();
    const add = (w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.Mesh => {
      const m = block(w, h, d, color);
      m.position.set(x, y, z);
      gun.add(m);
      return m;
    };
    add(0.045, 0.055, 0.34, '#2f2f34', 0, 0.02, -0.2);
    add(0.08, 0.08, 0.09, '#3a3a40', 0, 0.01, -0.02);
    add(0.05, 0.16, 0.07, MATERIAL.wood.top, 0, -0.09, 0.05).rotation.x = 0.35;
    add(0.1, 0.1, 0.12, PLAYER_KIT.skin, 0, -0.1, 0.07);
    add(0.13, 0.13, 0.34, PLAYER_KIT.torso, 0.01, -0.16, 0.28).rotation.x = -0.25;
    muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff1b8' }));
    muzzle.position.set(0, 0.02, -0.42);
    muzzle.visible = false;
    gun.add(muzzle);
    flash = new THREE.PointLight('#ffd27a', 0, 8);
    flash.position.set(0, 0.05, -0.5);
    gun.add(flash);
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
      scene.background = new THREE.Color('#1c1410');
      scene.fog = new THREE.Fog('#1c1410', 14, 30);
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
      scene.add(new THREE.AmbientLight('#ffe6c4', 0.62));
      // 문으로 들어오는 바깥 햇빛
      const sun = new THREE.DirectionalLight('#fff0d0', 0.9);
      sun.position.set(0, 3, ROOM.halfD + 4);
      sun.target.position.set(0, 0.5, 0);
      scene.add(sun, sun.target);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.3), new THREE.MeshBasicMaterial({ color: '#f6e2b0' }));
      door.position.set(0, 1.15, ROOM.halfD + 0.19);
      door.rotation.y = Math.PI;
      scene.add(door);
      blastLight = new THREE.PointLight('#ff9a3a', 0, 14);
      scene.add(blastLight);
      for (const b of s.blocks) addBlock(b);
      for (const g of s.guards) addGuard(g);
      bagMeshes = s.bags.map((bag) => {
        const sack = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.3, 12), new THREE.MeshLambertMaterial({ color: '#c9a36a' }));
        sack.position.set(bag.x, bag.y + 0.15, bag.z);
        const tie = block(0.1, 0.08, 0.1, '#a07c48');
        tie.position.y = 0.19;
        sack.add(tie);
        scene.add(sack);
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
        } else if (e.type === 'impact') {
          const fast = e.material === 'metal' || e.material === 'powder' || e.material === 'glass';
          spray(e.pos, e.normal, CHIP[e.material], fast ? 9 : 7, fast ? 4.5 : 2.6, fast ? 0.03 : 0.06, fast ? 5 : 9);
          // 총알구멍
          const hole = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), new THREE.MeshBasicMaterial({ color: '#160d08' }));
          hole.position.set(e.pos[0] + e.normal[0] * 0.006, e.pos[1] + e.normal[1] * 0.006, e.pos[2] + e.normal[2] * 0.006);
          hole.lookAt(e.pos[0] + e.normal[0], e.pos[1] + e.normal[1], e.pos[2] + e.normal[2]);
          scene.add(hole);
          holes.push(hole);
          if (holes.length > 90) scene.remove(holes.shift()!);
        } else if (e.type === 'blood') {
          spray(e.pos, [0, 0.4, 0], ['#8c1d16', '#b3261e'], 10, 2.2, 0.05, 9);
        } else if (e.type === 'remove') {
          const mesh = blocks.get(e.id);
          if (mesh) {
            const p = mesh.position;
            spray([p.x, p.y, p.z], [0, 1, 0], [MATERIAL.wood.light, MATERIAL.wood.side, '#fff1b8'], 16, 3.4, 0.09, 9);
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
          blastLight.intensity = 90;
          shake = 0.22;
        }
      }
    },

    render(s, dt) {
      const p = s.player;
      const moving = recoil < 0.1 && (Math.abs(p.x - camera.position.x) + Math.abs(p.z - camera.position.z)) > 0.004;
      if (moving) walk += dt * 10;
      shake = Math.max(0, shake - dt * 0.7);
      const jitter = (): number => (Math.random() - 0.5) * shake;
      camera.position.set(p.x + jitter(), EYE + Math.sin(walk) * 0.025 + jitter(), p.z + jitter());
      camera.rotation.y = p.yaw;
      camera.rotation.x = p.pitch + recoil * 0.035;

      // 손에 든 권총: 반동과 재장전 동작
      recoil = Math.max(0, recoil - dt * 7);
      const reloading = p.reload > 0 ? Math.sin((1 - p.reload / s.stats.reloadTime) * Math.PI) : 0;
      gun.position.set(0.2, -0.17 - reloading * 0.22 + Math.sin(walk) * 0.008, -0.42 + recoil * 0.07);
      gun.rotation.x = recoil * 0.4 - reloading * 0.9;
      muzzle.visible = recoil > 0.72;
      flash.intensity = recoil > 0.72 ? 8 : 0;

      for (const g of s.guards) {
        const rig = rigs.get(g.id);
        if (!rig) continue;
        if (g.dead) {
          // 쓰러진다.
          rig.fall = Math.min(1, rig.fall + dt * 3.2);
          rig.group.rotation.x = -rig.fall * (Math.PI / 2);
          rig.group.position.set(g.x, g.y + rig.fall * 0.16, g.z);
          rig.glint.visible = false;
          continue;
        }
        rig.group.position.set(g.x, g.y, g.z);
        rig.group.rotation.y = g.yaw;
        const aiming = g.aim > 0;
        rig.arm.rotation.x = aiming ? Math.PI / 2 : 0.15;
        rig.glint.visible = aiming;
        rig.glint.scale.setScalar(aiming ? 0.5 + (1 - g.aim / 0.55) * 1.6 : 1);
        for (const m of rig.paint) m.emissive.set(g.hitFlash > 0 ? '#ffffff' : '#000000');
      }

      s.bags.forEach((bag, i) => {
        bagMeshes[i]!.visible = !bag.taken;
      });

      // 경비원이 쏜 총알
      while (shotMeshes.length < s.shots.length) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff5a3c' }));
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
      blastLight.intensity = Math.max(0, blastLight.intensity - dt * 270);

      renderer.render(scene, camera);
    },
  };
}
