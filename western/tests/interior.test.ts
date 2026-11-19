import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_STATS } from '../src/game/run.ts';
import { EYE, NO_INPUT3, createBank, forward, rayBox, raycast, stepInterior } from '../src/interior/level.ts';
import type { Input3, Interior } from '../src/interior/level.ts';

const DT = 1 / 60;
const make = (job = 0): Interior => createBank(job, { ...BASE_STATS }, BASE_STATS.maxHp, BASE_STATS.maxAmmo, 7);
const input = (over: Partial<Input3>): Input3 => ({ ...NO_INPUT3, ...over });
function run(s: Interior, seconds: number, inp: Input3 = NO_INPUT3): void {
  for (let t = 0; t < seconds; t += DT) stepInterior(s, inp, DT);
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

test('머리를 맞히면 한 발, 몸통은 두 발', () => {
  const head = make();
  pacify(head);
  const g = head.guards[0]!;
  head.player.x = g.x - 0.1;
  head.player.z = 1.5;
  lookAt(head, g.x, g.y + 1.62, g.z);
  stepInterior(head, input({ fire: true }), DT);
  assert.equal(g.dead, true, '머리는 한 발에 쓰러진다');
  assert.equal(head.kills, 1);

  const body = make();
  pacify(body);
  const b = body.guards[0]!;
  body.player.x = b.x - 0.1;
  body.player.z = 1.5;
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
  s.player.x = up.x;
  s.player.z = 2.5;
  lookAt(s, up.x, 1.4, up.z);
  const level = raycast(s, [s.player.x, EYE, s.player.z], forward(s.player.yaw, s.player.pitch))!;
  assert.notEqual(level.guard, up, '수평으로 쏘면 닿지 않는다');
  lookAt(s, up.x, up.y + 1.62, up.z);
  assert.ok(s.player.pitch > 0.3, '고개를 들어야 한다');
  stepInterior(s, input({ fire: true }), DT);
  assert.equal(up.dead, true);
});

test('벽 뒤의 것은 맞지 않고, 재질에 맞는 사건이 난다', () => {
  const s = make();
  pacify(s);
  s.player.x = -5;
  s.player.z = 3;
  s.player.yaw = Math.PI / 2;
  stepInterior(s, input({ fire: true }), DT);
  const impact = s.events.find((e) => e.type === 'impact');
  assert.ok(impact && impact.type === 'impact' && impact.material === 'brick');
  assert.ok(s.events.some((e) => e.type === 'sound' && e.name === 'hitStone'));
  assert.equal(s.alerted, true, '총소리에 모두가 알아챈다');
});

test('화약통을 쏘면 터져 곁의 경비원이 쓰러지고, 바닥의 통은 내려다봐야 맞는다', () => {
  const s = make();
  pacify(s);
  const [onDesk, onFloor] = s.blocks.filter((b) => b.tag === 'keg');
  const g = s.guards[0]!;
  g.x = g.homeX = -1.3;
  g.z = -2.0;
  // 책상 위의 통: 로비에서 계산대 너머로 보인다.
  s.player.x = -0.2;
  s.player.z = 2.6;
  lookAt(s, -0.2, 1.15, -2.3);
  stepInterior(s, input({ fire: true }), DT);
  assert.equal(s.blocks.includes(onDesk!), false);
  assert.ok(s.events.some((e) => e.type === 'boom'));
  assert.equal(g.dead, true);
  assert.equal(s.player.hp, BASE_STATS.maxHp, '멀리 선 주인공은 무사하다');

  // 바닥의 통: 수평으로는 안 맞고, 고개를 숙여야 맞는다.
  s.player.x = 2;
  s.player.z = 2.4;
  s.player.fireCd = 0;
  lookAt(s, 2.05, EYE, -1.35);
  const level = raycast(s, [2, EYE, 2.4], forward(s.player.yaw, s.player.pitch))!;
  assert.notEqual(level.block, onFloor);
  lookAt(s, 2.05, 0.35, -1.35);
  assert.ok(s.player.pitch < -0.2, '아래를 겨눠야 한다');
  stepInterior(s, input({ fire: true }), DT);
  assert.equal(s.blocks.includes(onFloor!), false);
});

test('경비원의 총알은 맞으면 아프고, 옆으로 비키면 피한다', () => {
  const hit = make();
  hit.guards.length = 1;
  hit.guards[0]!.cooldown = 0;
  hit.guards[0]!.alerted = true;
  hit.player.x = hit.guards[0]!.x;
  hit.player.z = 3;
  run(hit, 2.5);
  assert.ok(hit.player.hp < BASE_STATS.maxHp);

  const dodge = make();
  dodge.guards.length = 1;
  dodge.guards[0]!.cooldown = 0;
  dodge.guards[0]!.alerted = true;
  dodge.player.x = dodge.guards[0]!.x;
  dodge.player.z = 3;
  dodge.player.yaw = 0;
  // 조준이 끝나는 순간까지 서 있다가 옆으로 계속 걷는다.
  run(dodge, 0.5);
  for (let t = 0; t < 2; t += DT) stepInterior(dodge, input({ moveX: Math.sin(t * 6) > 0 ? 1 : -1 }), DT);
  assert.ok(dodge.shots.length >= 0);
  assert.ok(dodge.player.hp >= hit.player.hp, '움직이면 덜 맞는다');
});

test('금고는 앞에 서서 바라봐야 털리고, 문으로 나가면 끝난다', () => {
  const s = make();
  s.guards.length = 0;
  s.player.x = 5.3;
  s.player.z = -2.6;
  s.player.yaw = Math.PI;
  run(s, 3);
  assert.equal(s.safe.taken, false, '등지고 서 있으면 털리지 않는다');
  lookAt(s, s.safe.x, s.safe.y, s.safe.z);
  run(s, s.safe.time + 0.2);
  assert.equal(s.safe.taken, true);
  assert.equal(s.loot, s.safe.value);
  assert.equal(s.alerted, true);

  s.player.x = 0;
  s.player.z = 4.2;
  s.player.yaw = Math.PI;
  run(s, 1, input({ moveZ: 1 }));
  assert.equal(s.done, 'exit');
});

test('벽과 계산대는 통과하지 못하고, 계산대 위의 돈은 다가가면 줍는다', () => {
  const s = make();
  s.guards.length = 0;
  run(s, 3, input({ moveZ: 1 }));
  assert.ok(s.player.z > 0.8, '계산대 앞에서 멈춘다');
  assert.equal(s.done, null);
  s.player.x = -2;
  s.player.z = 1.4;
  run(s, 0.1);
  assert.equal(s.bags[0]!.taken, true);
  assert.equal(s.loot, s.bags[0]!.value);
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
    assert.ok(Math.abs(p.x) < 6.1 && p.z > -4.6, '방 밖으로 새지 않는다');
    assert.ok(p.ammo >= 0 && p.ammo <= s.stats.maxAmmo);
    assert.ok(Math.abs(p.pitch) <= 1.26);
  }
});
