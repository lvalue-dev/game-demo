import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JOBS, WORLD_H, WORLD_W, makeObstacle } from '../src/game/map.ts';
import {
  BASE_STATS, FREE_PICKS, PERKS, buy, canBuy, choosePerk, finishJob, newRun, nextJob, perkChoices, perkDef,
  startJob, takePerk,
} from '../src/game/run.ts';
import {
  ESCAPE_TIME, NO_INPUT, PLAYER_R, createWorld, hasLineOfSight, heatLevel, quotaMet, spawnEnemy, step, xpForLevel,
} from '../src/game/sim.ts';
import type { Bullet, Input, World } from '../src/game/types.ts';

const DT = 1 / 60;
const make = (job = 0): World => createWorld(job, 123, { ...BASE_STATS }, BASE_STATS.maxHp);
const input = (over: Partial<Input>): Input => ({ ...NO_INPUT, ...over });
function run(w: World, seconds: number, inp: Input = NO_INPUT): void {
  for (let t = 0; t < seconds; t += DT) step(w, inp, DT);
}
/** 건물이 없는 빈 들판으로 옮긴다. 흩어진 선인장, 바위, 덤불, 소품도 치워 둔다. */
function toOpenField(w: World): void {
  w.player.x = 760;
  w.player.y = 1080;
  w.obstacles = w.obstacles.filter((o) => o.kind === 'building');
  w.bushes = [];
}
/** 경보는 울렸지만 새 적은 오지 않는 상태로 만든다. */
function quiet(w: World): void {
  w.alarmed = true;
  w.heat = 1;
  w.spawnTimer = 1e9;
  w.sheriffSpawned = true;
}
const enemyBullet = (w: World, damage = 1): Bullet => ({
  x: w.player.x - 30, y: w.player.y, vx: 300, vy: 0, life: 1, fromPlayer: false, damage, pierce: 0, hit: [],
});

test('입력대로 움직이고 벽은 통과하지 못한다', () => {
  const w = make();
  const bank = w.obstacles.find((o) => o.label === '은행')!;
  w.player.x = bank.x - 60;
  w.player.y = bank.y + bank.h / 2;
  const startX = w.player.x;
  run(w, 0.1, input({ moveX: 1 }));
  assert.ok(w.player.x > startX);
  run(w, 2, input({ moveX: 1 }));
  assert.ok(w.player.x <= bank.x - PLAYER_R + 0.01, '은행 벽 앞에서 멈춰야 한다');
});

test('세계 밖으로 나가지 못한다', () => {
  const w = make();
  run(w, 4, input({ moveX: -1, moveY: 1 }));
  assert.ok(w.player.x >= PLAYER_R && w.player.y <= WORLD_H - PLAYER_R);
  assert.ok(w.player.x <= WORLD_W);
});

test('쏘면 탄이 줄고, 다 쓰면 재장전된다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  step(w, input({ aim: 0, fire: true }), DT);
  assert.equal(w.player.ammo, BASE_STATS.maxAmmo - 1);
  assert.equal(w.bullets.filter((b) => b.fromPlayer).length, 1);
  run(w, BASE_STATS.fireInterval * BASE_STATS.maxAmmo + 0.2, input({ aim: 0, fire: true }));
  assert.equal(w.player.ammo, 0);
  assert.ok(w.player.reload > 0, '탄이 떨어지면 자동으로 재장전을 시작한다');
  run(w, BASE_STATS.reloadTime + 0.1);
  assert.equal(w.player.ammo, BASE_STATS.maxAmmo);
});

test('총을 쏘면 경보가 울려 보안관보가 온다', () => {
  const w = make();
  toOpenField(w);
  assert.equal(w.alarmed, false);
  assert.equal(w.enemies.length, 0);
  step(w, input({ aim: 0, fire: true }), DT);
  assert.equal(w.alarmed, true);
  assert.equal(heatLevel(w), 1);
  assert.equal(w.enemies.length, 2);
  assert.ok(w.events.includes('alarm') && w.events.includes('shot'));
});

test('총알은 적을 맞혀 쓰러뜨리고, 시체와 현상금이 남는다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const e = spawnEnemy(w, 'deputy', { x: w.player.x + 150, y: w.player.y });
  e.cooldown = 99;
  for (let t = 0; t < 3 && e.hp > 0; t += DT) {
    step(w, input({ aim: Math.atan2(e.y - w.player.y, e.x - w.player.x), fire: true }), DT);
  }
  assert.equal(w.enemies.some((x) => x.id === e.id), false);
  assert.equal(w.kills, 1);
  assert.equal(w.corpses.length, 1);
  assert.equal(w.pickups.filter((k) => k.kind === 'coin').length, 1);
  assert.ok(w.xp > 0);
});

test('적을 쓰러뜨린 순간 게임이 아주 잠깐 멈춘다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const e = spawnEnemy(w, 'deputy', { x: w.player.x + 60, y: w.player.y });
  e.cooldown = 99;
  e.hp = 1;
  for (let t = 0; t < 1 && w.kills === 0; t += DT) step(w, input({ aim: 0, fire: true }), DT);
  assert.ok(w.hitStop > 0);
  const frozen = w.time;
  step(w, NO_INPUT, DT);
  assert.equal(w.time, frozen);
  run(w, 0.2);
  assert.ok(w.time > frozen);
});

test('총알은 건물을 통과하지 못한다', () => {
  const w = make();
  const bank = w.obstacles.find((o) => o.label === '은행')!;
  w.player.x = bank.x - 40;
  w.player.y = bank.y + bank.h / 2;
  quiet(w);
  const e = spawnEnemy(w, 'deputy', { x: bank.x + bank.w + 40, y: w.player.y });
  e.cooldown = 99;
  assert.equal(hasLineOfSight(w, w.player, e), false);
  run(w, 1, input({ aim: 0, fire: true }));
  assert.equal(e.hp, 2);
});

test('적은 움직이는 방향을 앞질러 겨눈다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const e = spawnEnemy(w, 'rifle', { x: w.player.x, y: w.player.y - 300 });
  e.cooldown = 0;
  run(w, 0.3, input({ moveX: 1 }));
  assert.ok(e.aim > 0, '조준을 시작했어야 한다');
  const direct = Math.atan2(w.player.y - e.y, w.player.x - e.x);
  // 플레이어가 오른쪽(+x)으로 달리므로, 아래를 보는 적의 조준은 정면보다 +x 쪽으로 기운다.
  assert.ok(Math.cos(e.aimDir) > Math.cos(direct) + 0.02, '정면이 아니라 가는 쪽을 겨눠야 한다');
});

test('돈자루 곁에 머물면 털리고 수배와 악명이 오른다', () => {
  const w = make();
  const bag = w.loots.find((l) => l.kind === 'bag')!;
  w.player.x = bag.x + 20;
  w.player.y = bag.y;
  run(w, bag.time - 0.2);
  assert.equal(bag.taken, false);
  run(w, 0.4);
  assert.equal(bag.taken, true);
  assert.equal(w.loot, bag.value);
  assert.equal(w.alarmed, true);
  assert.ok(w.heat >= 1.5);
  assert.ok(w.xp >= 1);
  assert.equal(w.texts.length, 1);
});

test('상납금을 채워야만 말을 타고 탈출할 수 있다', () => {
  const w = make();
  w.player.x = w.horse.x;
  w.player.y = w.horse.y;
  run(w, ESCAPE_TIME + 0.5);
  assert.equal(w.phase, 'play');
  w.loot = w.quota;
  assert.equal(quotaMet(w), true);
  run(w, ESCAPE_TIME + 0.1);
  assert.equal(w.phase, 'escaped');
});

test('적의 총알에 맞으면 체력이 줄고, 잠깐 무적이 된다', () => {
  const w = make();
  toOpenField(w);
  w.bullets.push(enemyBullet(w));
  run(w, 0.3);
  assert.equal(w.player.hp, BASE_STATS.maxHp - 1);
  w.bullets.push(enemyBullet(w));
  run(w, 0.2);
  assert.equal(w.player.hp, BASE_STATS.maxHp - 1, '무적 시간에는 다시 맞지 않는다');
});

test('구르는 동안에는 총알을 피한다', () => {
  const w = make();
  toOpenField(w);
  w.bullets.push({ ...enemyBullet(w), x: w.player.x - 12 });
  step(w, input({ moveY: -1, dash: true }), DT);
  run(w, 0.15, input({ moveY: -1 }));
  assert.equal(w.player.hp, BASE_STATS.maxHp);
  assert.ok(w.player.dashCd > 0);
});

test('체력이 0이 되면 쓰러진다', () => {
  const w = make();
  toOpenField(w);
  w.player.hp = 1;
  w.bullets.push(enemyBullet(w, 2));
  run(w, 0.3);
  assert.equal(w.phase, 'dead');
  assert.equal(w.player.hp, 0);
});

test('다이너마이트는 범위 안의 적을 날리고 금고를 터뜨린다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const near = spawnEnemy(w, 'deputy', { x: w.player.x + 200, y: w.player.y + 20 });
  const far = spawnEnemy(w, 'deputy', { x: w.player.x + 200, y: w.player.y - 420 });
  near.cooldown = far.cooldown = 99;
  const safe = w.loots.find((l) => l.kind === 'safe')!;
  safe.x = w.player.x + 230;
  safe.y = w.player.y;
  const heatBefore = w.heat;
  step(w, input({ aim: 0, aimDist: 200, bomb: true }), DT);
  assert.equal(w.bombs.length, 1);
  assert.ok(w.player.bombCd > 0);
  step(w, input({ aim: 0, aimDist: 200, bomb: true }), DT);
  assert.equal(w.bombs.length, 1, '대기 시간에는 또 던질 수 없다');
  run(w, 1);
  assert.equal(w.bombs.length, 0);
  assert.equal(w.enemies.some((e) => e.id === near.id), false);
  assert.equal(w.enemies.some((e) => e.id === far.id), true);
  assert.equal(safe.taken, true);
  assert.equal(w.loot, safe.value);
  assert.ok(w.heat > heatBefore + 1);
  assert.equal(w.blasts.length + w.events.filter((e) => e === 'boom').length > 0, true);
});

test('적이 던진 다이너마이트는 그 자리에 있으면 맞고, 벗어나면 피한다', () => {
  const stay = make();
  toOpenField(stay);
  quiet(stay);
  stay.bombs.push({ sx: 0, sy: 0, tx: stay.player.x, ty: stay.player.y, elapsed: 0, flight: 0.5, fuse: 0.3, radius: 72, damage: 2, owner: 'enemy' });
  run(stay, 1);
  assert.equal(stay.player.hp, BASE_STATS.maxHp - 2);

  const flee = make();
  toOpenField(flee);
  quiet(flee);
  flee.bombs.push({ sx: 0, sy: 0, tx: flee.player.x, ty: flee.player.y, elapsed: 0, flight: 0.5, fuse: 0.3, radius: 72, damage: 2, owner: 'enemy' });
  run(flee, 1, input({ moveX: 1 }));
  assert.equal(flee.player.hp, BASE_STATS.maxHp);
});

test('떨어진 돈은 가까이 가면 끌려와 수익이 되고, 위스키는 체력을 채운다', () => {
  const w = make();
  toOpenField(w);
  w.player.hp = 3;
  w.pickups.push({ id: 900, x: w.player.x + 50, y: w.player.y, vx: 0, vy: 0, kind: 'coin', value: 2, life: 10 });
  w.pickups.push({ id: 901, x: w.player.x - 50, y: w.player.y, vx: 0, vy: 0, kind: 'whiskey', value: 1, life: 10 });
  w.pickups.push({ id: 902, x: w.player.x + 400, y: w.player.y, vx: 0, vy: 0, kind: 'coin', value: 2, life: 10 });
  run(w, 0.6);
  assert.equal(w.loot, 2);
  assert.equal(w.player.hp, 4);
  assert.equal(w.pickups.length, 1, '멀리 있는 돈은 그대로 있다');
});

test('악명이 차면 능력을 고를 기회가 생기고, 고르면 수치가 바뀐다', () => {
  const r = newRun(11);
  const w = startJob(r);
  toOpenField(w);
  quiet(w);
  const e = spawnEnemy(w, 'sheriff', { x: w.player.x + 80, y: w.player.y });
  e.cooldown = 99;
  e.hp = 1;
  for (let t = 0; t < 1 && w.kills === 0; t += DT) step(w, input({ aim: 0, fire: true }), DT);
  assert.ok(w.pendingPerks >= 1, '보안관을 잡으면 악명이 오른다');
  assert.ok(w.level >= 1);
  assert.ok(w.xp < xpForLevel(w.level));
  const pending = w.pendingPerks;
  const choices = perkChoices(r, w);
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices).size, 3);
  assert.equal(choices.includes('whiskey'), false, '체력이 가득하면 위스키는 나오지 않는다');
  choosePerk(r, w, 'cylinder');
  assert.equal(w.pendingPerks, pending - 1);
  assert.equal(w.stats.maxAmmo, BASE_STATS.maxAmmo + 2);
  assert.equal(r.owned.cylinder, 1);
});

test('수배 등급이 오르면 적 종류가 늘고 보안관이 한 번 나선다', () => {
  const w = make();
  toOpenField(w);
  w.alarmed = true;
  w.heat = 4.5;
  w.player.invuln = 1e9;
  run(w, 30);
  assert.ok(w.enemies.length >= 6, '적이 ' + w.enemies.length + '명뿐이다');
  assert.ok(w.enemies.some((e) => e.kind !== 'deputy' && e.kind !== 'sheriff'));
  assert.equal(w.enemies.filter((e) => e.kind === 'sheriff').length, 1);
  assert.equal(w.sheriffSpawned, true);
});

test('아무 입력이나 넣어도 수치가 망가지지 않는다', () => {
  const w = make(2);
  let seed = 7;
  const r = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 60 * 90 && w.phase === 'play'; i++) {
    step(w, {
      moveX: r() * 2 - 1, moveY: r() * 2 - 1, aim: r() * Math.PI * 2, aimDist: r() * 500,
      fire: r() < 0.6, dash: r() < 0.02, reload: r() < 0.01, bomb: r() < 0.01,
    }, DT);
    w.events.length = 0;
    w.pendingPerks = 0;
    const p = w.player;
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(p.x >= 0 && p.x <= WORLD_W && p.y >= 0 && p.y <= WORLD_H);
    assert.ok(p.ammo >= 0 && p.ammo <= w.stats.maxAmmo);
    assert.ok(p.hp >= 0 && p.hp <= w.stats.maxHp);
    for (const e of w.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
    assert.ok(w.particles.length <= 520);
  }
});

test('한 판: 정산, 무료 선택, 구매, 다음 작전, 마지막 작전', () => {
  const r = newRun(5);
  let w = startJob(r);
  assert.equal(w.quota, JOBS[0]!.quota);
  w.loot = w.quota + 50;
  w.player.hp = 2;
  w.level = 2;
  w.xp = 3;
  assert.equal(finishJob(r, w), false);
  assert.equal(r.money, 50);
  assert.equal(r.hp, 4);
  assert.equal(r.offers.length, 3);
  assert.equal(r.freePicks, FREE_PICKS);

  const first = r.offers[0]!.id;
  assert.equal(buy(r, 0), true);
  assert.equal(r.money, 50, '첫 선택은 무료다');
  assert.equal(r.owned[first], 1);
  assert.equal(buy(r, 0), false, '같은 것을 두 번 살 수 없다');
  const second = perkDef(r.offers[1]!.id);
  assert.equal(canBuy(r, 1), second.price <= 50);
  if (second.price <= 50) {
    buy(r, 1);
    assert.equal(r.money, 50 - second.price);
  }

  nextJob(r);
  w = startJob(r);
  assert.equal(w.quota, JOBS[1]!.quota);
  assert.equal(w.player.hp, r.hp);
  assert.deepEqual([w.level, w.xp], [2, 3], '악명은 다음 작전으로 이어진다');
  w.loot = w.quota;
  finishJob(r, w);
  nextJob(r);
  w = startJob(r);
  w.loot = w.quota + 1;
  assert.equal(finishJob(r, w), true);
});

test('능력은 정해진 횟수까지만 겹치고, 기본 수치는 건드리지 않는다', () => {
  const r = newRun(1);
  takePerk(r, 'cylinder');
  takePerk(r, 'shotgun');
  takePerk(r, 'vest');
  assert.equal(r.stats.maxAmmo, BASE_STATS.maxAmmo + 2);
  assert.equal(r.stats.pellets, 3);
  assert.equal(r.stats.maxHp, BASE_STATS.maxHp + 1);
  assert.equal(BASE_STATS.maxAmmo, 6);
  const w = startJob(r);
  step(w, input({ aim: 0, fire: true }), DT);
  assert.equal(w.bullets.length, 3);

  // 끝까지 가진 능력은 더 나오지 않는다.
  for (const perk of PERKS) r.owned[perk.id] = perk.max;
  assert.deepEqual(perkChoices(r, w), []);
});

// ---------- 재질 반응 ----------

/** 주인공 오른쪽에 물체 하나를 놓는다. */
function place(w: World, kind: Parameters<typeof makeObstacle>[1], dx: number, dy = 0, size = 30): ReturnType<typeof makeObstacle> {
  const o = makeObstacle(w.nextId++, kind, w.player.x + dx, w.player.y + dy - size / 2, size, size);
  w.obstacles.push(o);
  return o;
}

test('나무 상자는 총알에 조각이 튀고 구멍이 나다가 부서진다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const crate = place(w, 'crate', 120);
  step(w, input({ aim: 0, fire: true }), DT);
  run(w, 0.15);
  assert.equal(crate.hp, crate.maxHp - 1);
  assert.equal(crate.marks.filter((m) => m.kind === 'hole').length, 1);
  assert.ok(w.particles.some((q) => q.shape === 'shard'), '나뭇조각이 튀어야 한다');
  run(w, 2, input({ aim: 0, fire: true }));
  assert.equal(w.obstacles.includes(crate), false);
  assert.ok(w.decals.some((d) => d.kind === 'debris'));
});

test('재질마다 튀는 조각과 소리가 다르다', () => {
  const cases = [
    ['crate', 'shard', 'hitWood'], ['rock', 'spark', 'hitStone'], ['cactus', 'leaf', 'hitPlant'],
  ] as const;
  for (const [kind, shape, sound] of cases) {
    const w = make();
    toOpenField(w);
    quiet(w);
    place(w, kind, 120);
    step(w, input({ aim: 0, fire: true }), DT);
    const events: string[] = [];
    for (let t = 0; t < 0.2; t += DT) {
      step(w, NO_INPUT, DT);
      events.push(...w.events);
      w.events.length = 0;
    }
    assert.ok(w.particles.some((q) => q.shape === shape), kind + '에서 ' + shape + '가 튀어야 한다');
    assert.ok(events.includes(sound), kind + '에서 ' + sound + ' 소리가 나야 한다');
  }
});

test('바위는 부서지지 않고, 총알은 덤불을 뚫고 지나간다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const rock = place(w, 'rock', 200);
  w.bushes.push({ id: w.nextId++, x: w.player.x + 90, y: w.player.y, size: 1, burnt: false });
  run(w, 0.3, input({ aim: 0, fire: true }));
  assert.ok(w.particles.some((q) => q.shape === 'leaf'), '덤불에서 잎이 날려야 한다');
  assert.ok(rock.marks.length > 0, '덤불을 지나 바위까지 닿아야 한다');
  run(w, 2, input({ aim: 0, fire: true }));
  assert.equal(w.obstacles.includes(rock), true);
});

test('화약통은 쏘면 터지고, 옆의 통도 따라 터진다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const first = place(w, 'tnt', 220, 0, 22);
  const second = place(w, 'tnt', 290, 0, 22);
  const victim = spawnEnemy(w, 'deputy', { x: w.player.x + 330, y: w.player.y + 30 });
  victim.cooldown = 99;
  step(w, input({ aim: 0, fire: true }), DT);
  const events: string[] = [];
  for (let t = 0; t < 1.2; t += DT) {
    step(w, NO_INPUT, DT);
    events.push(...w.events);
    w.events.length = 0;
  }
  assert.equal(w.obstacles.includes(first), false);
  assert.equal(w.obstacles.includes(second), false, '연쇄 폭발');
  assert.equal(events.filter((e) => e === 'boom').length, 2);
  assert.equal(w.enemies.some((e) => e.id === victim.id), false);
  assert.equal(w.corpses.at(-1)!.charred, true, '폭발에 쓰러지면 그을린다');
  assert.equal(w.player.hp, BASE_STATS.maxHp, '멀리 있던 주인공은 무사하다');
});

test('화약통 곁에 있으면 주인공도 다친다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const tnt = place(w, 'tnt', 40, 0, 22);
  tnt.hp = 0.5;
  step(w, input({ aim: 0, fire: true }), DT);
  run(w, 0.6);
  assert.ok(w.player.hp < BASE_STATS.maxHp);
});

test('폭발 하나가 사람, 덤불, 나무 건물, 흙벽 건물, 상자에 각각 다르게 작용한다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const p = w.player;
  const at = { x: p.x + 200, y: p.y };
  const wood = makeObstacle(w.nextId++, 'building', at.x - 40, at.y + 50, 80, 60, { material: 'wood' });
  const adobe = makeObstacle(w.nextId++, 'building', at.x - 40, at.y - 110, 80, 60, { material: 'adobe' });
  const crate = makeObstacle(w.nextId++, 'crate', at.x + 50, at.y - 15, 30, 30);
  w.obstacles = [wood, adobe, crate];
  const bush = { id: w.nextId++, x: at.x - 60, y: at.y, size: 1, burnt: false };
  w.bushes = [bush];
  const man = spawnEnemy(w, 'deputy', { x: at.x - 20, y: at.y + 10 });
  man.cooldown = 99;

  step(w, input({ aim: 0, aimDist: 200, bomb: true }), DT);
  run(w, 0.8);

  // 사람: 쓰러지고 그을린다
  assert.equal(w.enemies.length, 0);
  assert.equal(w.corpses[0]!.charred, true);
  // 덤불: 탄다
  assert.equal(bush.burnt, true);
  // 나무 건물: 그을리고 불이 붙는다
  assert.ok(wood.marks.some((m) => m.kind === 'scorch'));
  assert.ok(w.fires.some((f) => f.lift > 0), '나무 건물에는 불이 붙어야 한다');
  // 흙벽 건물: 그을리기만 한다
  assert.ok(adobe.marks.some((m) => m.kind === 'scorch'));
  assert.equal(w.fires.filter((f) => f.lift > 0).length, 1, '흙벽 건물에는 불이 붙지 않는다');
  // 상자: 부서진다
  assert.equal(w.obstacles.includes(crate), false);
  // 모래 바닥: 구덩이가 남는다
  assert.ok(w.decals.some((d) => d.kind === 'crater'));
  // 건물은 그대로 서 있다
  assert.equal(w.obstacles.includes(wood) && w.obstacles.includes(adobe), true);
});

test('불은 닿은 사람을 다치게 하고, 시간이 지나면 재를 남기고 꺼진다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  w.player.invuln = 0;
  w.bushes = [{ id: w.nextId++, x: w.player.x + 10, y: w.player.y, size: 1, burnt: false }];
  w.bombs.push({ sx: 0, sy: 0, tx: w.player.x + 10, ty: w.player.y, elapsed: 0, flight: 0, fuse: 0.05, radius: 30, damage: 1, owner: 'player' });
  run(w, 0.2);
  assert.equal(w.fires.length, 1);
  assert.equal(w.player.hp, BASE_STATS.maxHp, '자기 폭탄의 폭발 자체에는 다치지 않는다');
  run(w, 1.2);
  assert.ok(w.player.hp < BASE_STATS.maxHp, '그러나 번진 불에는 덴다');
  run(w, 3);
  assert.equal(w.fires.length, 0);
  assert.ok(w.decals.some((d) => d.kind === 'ash'));
});

test('물통이 터지면 물이 쏟아져 근처의 불을 끈다', () => {
  const w = make();
  toOpenField(w);
  quiet(w);
  const trough = place(w, 'trough', 150, 0, 40);
  w.fires.push({ x: trough.x + 60, y: trough.y, r: 20, life: 30, maxLife: 30, tick: 99, lift: 0 });
  w.fires.push({ x: trough.x + 400, y: trough.y, r: 20, life: 30, maxLife: 30, tick: 99, lift: 0 });
  step(w, input({ aim: 0, aimDist: 170, bomb: true }), DT);
  run(w, 0.8);
  assert.equal(w.obstacles.includes(trough), false);
  assert.ok(w.decals.some((d) => d.kind === 'puddle'));
  assert.equal(w.fires.filter((f) => f.life > 20).length, 1, '가까운 불만 꺼진다');
  assert.ok(w.particles.some((q) => q.shape === 'drop'));
});
