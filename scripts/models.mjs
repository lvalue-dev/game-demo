// 게임에 넣을 3D 모델(GLB)을 가볍게 줄여 웹 페이지에 실을 수 있는 꼴로 바꾼다.
//   <프로젝트>/assets/models.json  어떤 파일을 어떤 이름으로 쓸지 적은 목록
//   <프로젝트>/assets/*.glb        AI 도구나 에셋 장터에서 받은 원본
// 원본은 수십 MB일 수 있으므로 면 수를 줄이고 질감 그림을 작게 다시 저장한다.
// 질감은 모델에서 떼어 따로 싣는다. 페이지 안에서 그림 주소를 만들지 않고 바로 풀 수 있게 하려는 것이다.
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/** 줄이는 방식을 바꾸면 올린다. 예전 방식으로 줄여 둔 결과를 다시 쓰지 않게 한다. */
const PACK_VERSION = 2;
const DEFAULTS = { fit: 'auto', size: 0.264, turn: [0, 0, 0], shift: [0, 0, 0], triangles: 40000, texture: 1024 };
/** 재질의 질감 칸. 게임 쪽 이름과 짝을 맞춘다. */
const SLOTS = [
  ['map', (m) => m.getBaseColorTexture(), (m) => m.setBaseColorTexture(null)],
  ['normalMap', (m) => m.getNormalTexture(), (m) => m.setNormalTexture(null)],
  ['roughMetalMap', (m) => m.getMetallicRoughnessTexture(), (m) => m.setMetallicRoughnessTexture(null)],
  ['aoMap', (m) => m.getOcclusionTexture(), (m) => m.setOcclusionTexture(null)],
  ['emissiveMap', (m) => m.getEmissiveTexture(), (m) => m.setEmissiveTexture(null)],
];

const exists = (path) => stat(path).then(() => true, () => false);

async function pack(path, opts) {
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(path);
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += count / 3;
    }
  }
  const steps = [dedup(), weld()];
  if (triangles > opts.triangles) {
    steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: opts.triangles / triangles, error: 0.002 }));
  }
  if (root.listTextures().length > 0) {
    steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [opts.texture, opts.texture], quality: 84 }));
  }
  await doc.transform(...steps);

  const textures = [];
  root.listMaterials().forEach((material, i) => {
    material.setName(`m${i}`);
    for (const [slot, get, clear] of SLOTS) {
      const texture = get(material);
      const image = texture?.getImage();
      if (!image) continue;
      textures.push({ material: `m${i}`, slot, mime: texture.getMimeType(), data: Buffer.from(image).toString('base64') });
      clear(material);
    }
  });
  // 질감을 뗐다고 해서 질감 좌표까지 지워지면 안 된다.
  await doc.transform(prune({ keepAttributes: true }));
  const glb = Buffer.from(await io.writeBinary(doc)).toString('base64');
  return { glb, textures, fit: opts.fit, size: opts.size, turn: opts.turn, shift: opts.shift, from: Math.round(triangles) };
}

/** 프로젝트의 모델들을 묶어 돌려준다. 목록이 없거나 파일이 아직 없으면 빈 묶음이다. */
export async function packModels(projectRoot) {
  const dir = `${projectRoot}/assets`;
  if (!(await exists(`${dir}/models.json`))) return {};
  const list = JSON.parse(await readFile(`${dir}/models.json`, 'utf8'));
  const out = {};
  for (const [name, entry] of Object.entries(list)) {
    const opts = { ...DEFAULTS, ...entry };
    const path = `${dir}/${opts.file}`;
    if (!(await exists(path))) continue;
    const info = await stat(path);
    const key = createHash('sha1').update(JSON.stringify([PACK_VERSION, opts, info.size, info.mtimeMs])).digest('hex');
    const cached = `${dir}/.cache/${name}.json`;
    if (await exists(cached)) {
      const hit = JSON.parse(await readFile(cached, 'utf8'));
      if (hit.key === key) {
        out[name] = hit.model;
        continue;
      }
    }
    const model = await pack(path, opts);
    await mkdir(`${dir}/.cache`, { recursive: true });
    await writeFile(cached, JSON.stringify({ key, model }));
    const kb = Math.round((model.glb.length + model.textures.reduce((sum, t) => sum + t.data.length, 0)) * 0.75 / 1024);
    console.log(`모델 ${name}: ${opts.file} (${Math.round(info.size / 1024)}KB, 삼각형 ${model.from}) → ${kb}KB`);
    out[name] = model;
  }
  return out;
}
