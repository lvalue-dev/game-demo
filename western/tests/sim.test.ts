import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JOBS, WORLD_H, WORLD_W } from '../src/game/map.ts';
import { BASE_STATS, FREE_PICKS, buy, canBuy, finishJob, newRun, nextJob, startJob, upgradeDef } from '../src/game/run.ts';
import {
  ESCAPE_TIME, NO_INPUT, PLAYER_R, createWorld, hasLineOfSight, heatLevel, quotaMet, spawnEnemy, step,
} from '../src/game/sim.ts';
import type { Input, World } from '../src/game/types.ts';

const DT = 1 / 60;
const make = (job = 0): World => createWorld(job, 123, { ...BASE_STATS }, BASE_STATS.maxHp);
const input = (over: Partial<Input>): Input => ({ ...NO_INPUT, ...over });
function run(w: World, seconds: number, inp: Input = NO_INPUT): void {
  for (let t = 0; t < seconds; t += DT) step(w, inp, DT);
}
/** 건물이 없는 빈 들판으로 옮긴다. */
function toOpenField(w: World): void {
  w.player.x = 760;
  w.player.y = 1080;
}

test('입력대로 움직이고 벽은 통과하지 못한다', () => {
  const w = make();
  const bank = w.obstacles.find((o) => o.kind === 'bank')!;
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
});

test('총알은 적을 맞혀 쓰러뜨린다', () => {
  const w = make();
  toOpenField(w);
  w.alarmed = true;
  w.spawnTimer = 999;
  const e = spawnEnemy(w, 'deputy', { x: w.player.x + 150, y: w.player.y });
  e.cooldown = 99;
  for (let t = 0; t < 2 && e.hp > 0; t += DT) {
    step(w, input({ aim: Math.atan2(e.y - w.player.y, e.x - w.player.x), fire: true }), DT);
  }
  assert.equal(w.enemies.some((x) => x.id === e.id), false);
  assert.equal(w.kills, 1);
});

test('총알은 건물을 통과하지 못한다', () => {
  const w = make();
  const bank = w.obstacles.find((o) => o.kind === 'bank')!;
  w.player.x = bank.x - 40;
  w.player.y = bank.y + bank.h / 2;
  w.alarmed = true;
  w.spawnTimer = 999;
  const e = spawnEnemy(w, 'deputy', { x: bank.x + bank.w + 40, y: w.player.y });
  e.cooldown = 99;
  assert.equal(hasLineOfSight(w, w.player, e), false);
  run(w, 1, input({ aim: 0, fire: true }));
  assert.equal(e.hp, 2);
});

test('돈자루 곁에 머물면 털리고 수배가 오른다', () => {
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
  const hit = (): void => {
    w.bullets.push({ x: w.player.x - 30, y: w.player.y, vx: 300, vy: 0, life: 1, fromPlayer: false, damage: 1, pierce: 0, hit: [] });
  };
  hit();
  run(w, 0.2);
  assert.equal(w.player.hp, BASE_STATS.maxHp - 1);
  hit();
  run(w, 0.2);
  assert.equal(w.player.hp, BASE_STATS.maxHp - 1, '무적 시간에는 다시 맞지 않는다');
});

test('구르는 동안에는 총알을 피한다', () => {
  const w = make();
  toOpenField(w);
  w.bullets.push({ x: w.player.x - 12, y: w.player.y, vx: 300, vy: 0, life: 1, fromPlayer: false, damage: 1, pierce: 0, hit: [] });
  step(w, input({ moveY: -1, dash: true }), DT);
  run(w, 0.15, input({ moveY: -1 }));
  assert.equal(w.player.hp, BASE_STATS.maxHp);
  assert.ok(w.player.dashCd > 0);
});

test('체력이 0이 되면 쓰러진다', () => {
  const w = make();
  toOpenField(w);
  w.player.hp = 1;
  w.bullets.push({ x: w.player.x - 30, y: w.player.y, vx: 300, vy: 0, life: 1, fromPlayer: false, damage: 2, pierce: 0, hit: [] });
  run(w, 0.3);
  assert.equal(w.phase, 'dead');
  assert.equal(w.player.hp, 0);
});

test('수배 등급이 오를수록 적이 많아지고 소총수가 섞인다', () => {
  const w = make();
  toOpenField(w);
  w.alarmed = true;
  w.heat = 4.5;
  w.player.invuln = 1e9;
  run(w, 30);
  assert.ok(w.enemies.length >= 6, `적이 ${w.enemies.length}명뿐이다`);
  assert.ok(w.enemies.some((e) => e.kind === 'rifle'));
});

test('아무 입력이나 넣어도 수치가 망가지지 않는다', () => {
  const w = make(2);
  let seed = 7;
  const r = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 60 * 90 && w.phase === 'play'; i++) {
    step(w, {
      moveX: r() * 2 - 1, moveY: r() * 2 - 1, aim: r() * Math.PI * 2,
      fire: r() < 0.6, dash: r() < 0.02, reload: r() < 0.01,
    }, DT);
    const p = w.player;
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(p.x >= 0 && p.x <= WORLD_W && p.y >= 0 && p.y <= WORLD_H);
    assert.ok(p.ammo >= 0 && p.ammo <= w.stats.maxAmmo);
    for (const e of w.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
  }
});

test('한 판: 정산, 무료 선택, 구매, 다음 작전, 마지막 작전', () => {
  const r = newRun(5);
  let w = startJob(r);
  assert.equal(w.quota, JOBS[0]!.quota);
  w.loot = w.quota + 50;
  w.player.hp = 2;
  assert.equal(finishJob(r, w), false);
  assert.equal(r.money, 50);
  assert.equal(r.hp, 4);
  assert.equal(r.offers.length, 3);
  assert.equal(r.freePicks, FREE_PICKS);

  const first = upgradeDef(r.offers[0]!.id);
  assert.equal(buy(r, 0), true);
  assert.equal(r.money, 50, '첫 선택은 무료다');
  assert.equal(buy(r, 0), false, '같은 것을 두 번 살 수 없다');
  const second = upgradeDef(r.offers[1]!.id);
  assert.equal(canBuy(r, 1), second.price <= 50);
  if (second.price <= 50) {
    buy(r, 1);
    assert.equal(r.money, 50 - second.price);
  }
  if (!first.repeat) assert.ok(r.owned.includes(first.id));

  nextJob(r);
  w = startJob(r);
  assert.equal(w.quota, JOBS[1]!.quota);
  assert.equal(w.player.hp, r.hp);
  w.loot = w.quota;
  finishJob(r, w);
  nextJob(r);
  w = startJob(r);
  w.loot = w.quota + 1;
  assert.equal(finishJob(r, w), true);
});

test('업그레이드는 수치를 바꾼다', () => {
  const r = newRun(1);
  upgradeDef('cylinder').apply(r);
  upgradeDef('shotgun').apply(r);
  upgradeDef('vest').apply(r);
  assert.equal(r.stats.maxAmmo, BASE_STATS.maxAmmo + 2);
  assert.equal(r.stats.pellets, 3);
  assert.equal(r.stats.maxHp, BASE_STATS.maxHp + 1);
  assert.equal(BASE_STATS.maxAmmo, 6, '기본 수치는 그대로여야 한다');
  const w = startJob(r);
  step(w, { ...NO_INPUT, aim: 0, fire: true }, DT);
  assert.equal(w.bullets.length, 3);
});
