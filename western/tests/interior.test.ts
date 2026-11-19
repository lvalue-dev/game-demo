import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_STATS } from '../src/game/run.ts';
import { EYE, NO_INPUT3, ROOM, createBank, forward, rayBox, raycast, stepInterior } from '../src/interior/level.ts';
import type { Block, Input3, Interior } from '../src/interior/level.ts';

const DT = 1 / 60;
const make = (job = 0): Interior => createBank(job, { ...BASE_STATS }, BASE_STATS.maxHp, BASE_STATS.maxAmmo, 7);
const input = (over: Partial<Input3>): Input3 => ({ ...NO_INPUT3, ...over });
function run(s: Interior, seconds: number, inp: Input3 = NO_INPUT3): void {
  for (let t = 0; t < seconds; t += DT) stepInterior(s, inp, DT);
}
/** 주인공을 옮긴다. */
function stand(s: Interior, x: number, z: number): void {
  s.player.x = x;
  s.player.z = z;
}
/** 주인공이 한 점을 정확히 바라보게 한다. */
function lookAt(s: Interior, x: number, y: number, z: number): void {
  const dx = x - s.player.x;
  const dy = y - EYE;
  const dz = z - s.player.z;
  s.player.yaw = Math.atan2(-dx, -dz);
  s.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
/** 경비원이 쏘지 못하게 해 둔다. */
function pacify(s: Interior): void {
  for (const g of s.guards) g.cooldown = 1e9;
}
const center = (b: Block): [number, number, number] => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const aimed = (s: Interior) => raycast(s, [s.player.x, EYE, s.player.z], forward(s.player.yaw, s.player.pitch));

test('광선은 상자의 맞은 면을 알려 준다', () => {
  const hit = rayBox([0, 1, 5], [0, 0, -1], [-1, 0, -1], [1, 2, 1])!;
  assert.equal(hit.t, 4);
  assert.deepEqual(hit.normal, [0, 0, 1]);
  assert.equal(rayBox([0, 5, 5], [0, 0, -1], [-1, 0, -1], [1, 2, 1]), null);
  const down = rayBox([0, 5, 0], [0, -1, 0], [-1, 0, -1], [1, 2, 1])!;
  assert.deepEqual([down.t, down.normal], [3, [0, 1, 0]]);
});

test('바라보는 방향: 정면은 북쪽, 고개를 들면 위를 본다', () => {
  assert.deepEqual(forward(0, 0).map((v) => Math.round(v * 100) / 100 + 0), [0, 0, -1]);
  assert.ok(forward(0, 0.5)[1] > 0.4);
  assert.ok(forward(Math.PI / 2, 0)[0] < -0.99, '왼쪽으로 돌면 서쪽을 본다');
});

test('홀은 넓고, 경비원은 문에서 멀리 떨어져 있다', () => {
  const s = make(2);
  assert.ok(ROOM.halfW * 2 >= 20 && ROOM.halfD * 2 >= 16);
  for (const g of s.guards) {
    const d = Math.hypot(g.x - s.player.x, g.z - s.player.z);
    assert.ok(d >= 11, '경비원이 ' + d.toFixed(1) + 'm 거리에 있다');
  }
  // 들어서자마자 들키지는 않는다.
  run(s, 1);
  assert.equal(s.alerted, false);
});

test('머리를 맞히면 한 발, 몸통은 두 발', () => {
  const head = make();
  pacify(head);
  const g = head.guards[0]!;
  stand(head, g.x - 0.1, g.z + 3);
  lookAt(head, g.x, g.y + 1.62, g.z);
  stepInterior(head, input({ fire: true }), DT);
  assert.equal(g.dead, true, '머리는 한 발에 쓰러진다');
  assert.equal(head.kills, 1);

  const body = make();
  pacify(body);
  const b = body.guards[0]!;
  stand(body, b.x - 0.1, b.z + 3);
  lookAt(body, b.x, b.y + 1.25, b.z);
  stepInterior(body, input({ fire: true }), DT);
  assert.equal(b.dead, false);
  assert.equal(b.hp, 1);
  // 맞은 뒤 경비원이 좌우로 움직이므로 다시 겨눈 뒤 쏜다.
  for (let t = 0; t < 1 && !b.dead; t += DT) {
    lookAt(body, b.x, b.y + 1.25, b.z);
    stepInterior(body, input({ fire: true }), DT);
  }
  assert.equal(b.dead, true);
});

test('2층 난간 위의 경비원은 위를 겨눠야만 맞는다', () => {
  const s = make();
  pacify(s);
  const up = s.guards.find((g) => g.y > 2)!;
  stand(s, up.x, 2);
  lookAt(s, up.x, 1.4, up.z);
  assert.notEqual(aimed(s)!.guard, up, '수평으로 쏘면 닿지 않는다');
  lookAt(s, up.x, up.y + 1.62, up.z);
  assert.ok(s.player.pitch > 0.25, '고개를 들어야 한다');
  stepInterior(s, input({ fire: true }), DT);
  assert.equal(up.dead, true);
});

test('벽에 쏘면 재질에 맞는 사건이 나고, 총소리에 모두가 알아챈다', () => {
  const s = make();
  pacify(s);
  stand(s, -9, 7);
  s.player.yaw = Math.PI / 2;
  stepInterior(s, input({ fire: true }), DT);
  const impact = s.events.find((e) => e.type === 'impact');
  assert.ok(impact && impact.type === 'impact' && impact.material === 'plaster');
  assert.ok(s.events.some((e) => e.type === 'sound' && e.name === 'hitStone'));
  assert.equal(s.alerted, true);
});

test('화약통을 쏘면 터져 곁의 경비원이 쓰러지고, 바닥의 통은 내려다봐야 맞는다', () => {
  const s = make();
  pacify(s);
  const kegs = s.blocks.filter((b) => b.tag === 'keg');
  const onDesk = kegs.find((b) => b.min[1] > 0.5)!;
  const onFloor = kegs.find((b) => b.min[1] === 0)!;
  const deskAt = center(onDesk);
  const g = s.guards[0]!;
  g.x = g.homeX = deskAt[0] - 1.2;
  g.z = deskAt[2];
  // 책상 위의 통: 로비에서 계산대 너머로 보인다.
  stand(s, deskAt[0] + 0.1, 3);
  lookAt(s, ...deskAt);
  assert.equal(aimed(s)!.block, onDesk);
  stepInterior(s, input({ fire: true }), DT);
  assert.equal(s.blocks.includes(onDesk), false);
  assert.ok(s.events.some((e) => e.type === 'boom'));
  assert.equal(g.dead, true);
  assert.equal(s.player.hp, BASE_STATS.maxHp, '멀리 선 주인공은 무사하다');

  // 바닥의 통: 수평으로는 안 맞고, 고개를 숙여야 맞는다.
  const floorAt = center(onFloor);
  stand(s, floorAt[0], 1.5);
  s.player.fireCd = 0;
  lookAt(s, floorAt[0], EYE, floorAt[2]);
  assert.notEqual(aimed(s)!.block, onFloor);
  lookAt(s, ...floorAt);
  assert.ok(s.player.pitch < -0.2, '아래를 겨눠야 한다');
  stepInterior(s, input({ fire: true }), DT);
  assert.equal(s.blocks.includes(onFloor), false);
});

test('경비원의 총알은 맞으면 아프고, 기둥 뒤에 숨으면 막힌다', () => {
  const open = make();
  open.guards.length = 1;
  const g = open.guards[0]!;
  g.cooldown = 0;
  g.alerted = true;
  stand(open, g.x, 2.5);
  run(open, 3);
  assert.ok(open.player.hp < BASE_STATS.maxHp);

  const hidden = make();
  hidden.guards.length = 1;
  const h = hidden.guards[0]!;
  h.cooldown = 0;
  h.alerted = true;
  // 기둥 바로 남쪽에 붙어 선다. 경비원과의 사이를 기둥이 가린다.
  const column = hidden.blocks.find((b) => b.tag === 'column' && b.min[0] < 0 && b.min[2] > 2)!;
  const at = center(column);
  h.x = h.homeX = at[0];
  stand(hidden, at[0], column.max[2] + 0.45);
  run(hidden, 3);
  assert.equal(hidden.player.hp, BASE_STATS.maxHp);
});

test('금고는 앞에 서서 바라봐야 털리고, 문으로 나가면 끝난다', () => {
  const s = make();
  s.guards.length = 0;
  stand(s, s.safe.x - 0.2, s.safe.z + 1.5);
  s.player.yaw = Math.PI;
  run(s, 3);
  assert.equal(s.safe.taken, false, '등지고 서 있으면 털리지 않는다');
  lookAt(s, s.safe.x, s.safe.y, s.safe.z);
  run(s, s.safe.time + 0.2);
  assert.equal(s.safe.taken, true);
  assert.equal(s.loot, s.safe.value);
  assert.equal(s.alerted, true);

  stand(s, 0, ROOM.halfD - 0.5);
  s.player.yaw = Math.PI;
  run(s, 1, input({ moveZ: 1 }));
  assert.equal(s.done, 'exit');
});

test('계산대는 통과하지 못하고, 계산대 위의 돈은 다가가면 줍는다', () => {
  const s = make();
  s.guards.length = 0;
  const counter = s.blocks.find((b) => b.tag === 'counter')!;
  run(s, 6, input({ moveZ: 1 }));
  assert.ok(s.player.z > counter.max[2], '계산대 앞에서 멈춘다');
  assert.equal(s.done, null);
  const bag = s.bags[0]!;
  stand(s, bag.x, bag.z + 1.1);
  run(s, 0.1);
  assert.equal(bag.taken, true);
  assert.equal(s.loot, bag.value);
});

test('아무 입력이나 넣어도 수치가 망가지지 않는다', () => {
  const s = make(2);
  let seed = 3;
  const r = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 60 * 40 && !s.done; i++) {
    stepInterior(s, {
      moveX: r() * 2 - 1, moveZ: r() * 2 - 1, lookX: (r() - 0.5) * 0.2, lookY: (r() - 0.5) * 0.2,
      fire: r() < 0.5, reload: r() < 0.01, assist: r() < 0.5,
    }, DT);
    s.events.length = 0;
    const p = s.player;
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.ok(Math.abs(p.x) < ROOM.halfW + 0.1 && p.z > -ROOM.halfD - 0.1, '방 밖으로 새지 않는다');
    assert.ok(p.ammo >= 0 && p.ammo <= s.stats.maxAmmo);
    assert.ok(Math.abs(p.pitch) <= 1.26);
  }
});
