import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECRUIT_IDS, cardDef } from '../src/game/cards.ts';
import {
  ENERGY_PER_TURN, FREE_PICKS, HAND_SIZE, HEAT_LIMIT, PATROL_STEP_TURNS, REMOVE_COST, REROLL_COST,
  buyOffer, canEscape, canPlay, currentLocation, endTurn, escapeHeist, isUsableState, newGame,
  nextHeist, patrolAt, pendingPatrol, playCard, previewPlay, removeCard, rerollShop, vaultLocked,
} from '../src/game/engine.ts';
import { LOCATIONS } from '../src/game/locations.ts';
import type { GameState } from '../src/game/types.ts';

/** 손패를 원하는 카드로 바꾸고 각 카드의 uid를 돌려준다. */
function setHand(g: GameState, ids: string[]): number[] {
  const h = g.heist!;
  h.hand = ids.map((id) => ({ uid: g.nextUid++, id }));
  return h.hand.map((c) => c.uid);
}

/** 지금 작전을 철수 가능한 상태로 만들고 철수한다. */
function clearHeist(g: GameState, extra = 0): void {
  const loc = currentLocation(g);
  g.heist!.loot = loc.quota + extra;
  g.heist!.escape = loc.escapeNeeded;
  assert.equal(escapeHeist(g), true);
}

test('시작 덱은 10장이고 첫 턴에 5장을 뽑는다', () => {
  const g = newGame(1);
  assert.equal(g.deck.length, 10);
  assert.equal(g.heist!.hand.length, HAND_SIZE);
  assert.equal(g.heist!.drawPile.length, 5);
  assert.equal(g.heist!.energy, ENERGY_PER_TURN);
});

test('같은 시드는 같은 손패를 준다', () => {
  const a = newGame(42).heist!.hand.map((c) => c.id);
  const b = newGame(42).heist!.hand.map((c) => c.id);
  assert.deepEqual(a, b);
});

test('좀도둑은 수익 +3, 경보 +1이고 행동력 1을 쓴다', () => {
  const g = newGame(1);
  const [uid] = setHand(g, ['thief']);
  assert.equal(playCard(g, uid!), true);
  const h = g.heist!;
  assert.deepEqual([h.loot, h.heat, h.energy], [3, 1, ENERGY_PER_TURN - 1]);
  assert.equal(h.hand.length, 0);
  assert.equal(h.discard.at(-1)!.id, 'thief');
});

test('행동력이 모자라면 카드를 낼 수 없다', () => {
  const g = newGame(1);
  const [uid] = setHand(g, ['safecracker']);
  g.heist!.energy = 1;
  assert.equal(canPlay(g, uid!), false);
  assert.equal(playCard(g, uid!), false);
  assert.equal(g.heist!.loot, 0);
});

test('턴을 끝내면 순찰만큼 경보가 오르고 새로 5장을 뽑는다', () => {
  const g = newGame(1);
  const patrol = pendingPatrol(g);
  endTurn(g);
  const h = g.heist!;
  assert.equal(h.heat, patrol);
  assert.equal(h.turn, 2);
  assert.equal(h.hand.length, HAND_SIZE);
  assert.equal(h.energy, ENERGY_PER_TURN);
});

test('순찰은 정해진 턴 수마다 1씩 세진다', () => {
  const loc = LOCATIONS[0]!;
  assert.equal(patrolAt(loc, 1), loc.patrol);
  assert.equal(patrolAt(loc, PATROL_STEP_TURNS), loc.patrol);
  assert.equal(patrolAt(loc, PATROL_STEP_TURNS + 1), loc.patrol + 1);
  assert.equal(patrolAt(loc, PATROL_STEP_TURNS * 2 + 1), loc.patrol + 2);
});

test('경보가 한계에 닿으면 카드를 내는 순간 검거된다', () => {
  const g = newGame(1);
  const [uid] = setHand(g, ['thief']);
  g.heist!.heat = HEAT_LIMIT - 1;
  assert.equal(previewPlay(g, uid!)!.bust, true);
  playCard(g, uid!);
  assert.equal(g.phase, 'busted');
});

test('턴 종료 순찰로도 검거된다', () => {
  const g = newGame(1);
  g.heist!.heat = HEAT_LIMIT - 1;
  endTurn(g);
  assert.equal(g.phase, 'busted');
});

test('상납금과 도주 준비를 모두 채워야 철수할 수 있다', () => {
  const g = newGame(1);
  const loc = currentLocation(g);
  g.heist!.loot = loc.quota;
  assert.equal(canEscape(g), false);
  g.heist!.escape = loc.escapeNeeded;
  g.heist!.loot = loc.quota - 1;
  assert.equal(canEscape(g), false);
  assert.equal(escapeHeist(g), false);
  g.heist!.loot = loc.quota + 7;
  assert.equal(canEscape(g), true);
});

test('철수하면 상납금을 뺀 돈을 챙기고 상점이 열린다', () => {
  const g = newGame(1);
  clearHeist(g, 7);
  assert.equal(g.phase, 'shop');
  assert.equal(g.money, 7);
  assert.equal(g.shop!.offers.length, 3);
  assert.equal(g.shop!.freePicks, FREE_PICKS);
  assert.equal(new Set(g.shop!.offers.map((o) => o.id)).size, 3);
  assert.ok(g.shop!.offers.every((o) => RECRUIT_IDS.includes(o.id)));
});

test('해커는 다음 털이의 경보를 없애고, 작전 참모는 수익을 2배로 만든다', () => {
  const g = newGame(1);
  const [hacker, strategist, safecracker, thief] = setHand(g, ['hacker', 'strategist', 'safecracker', 'thief']);
  g.heist!.energy = 5;
  playCard(g, hacker!);
  playCard(g, strategist!);
  playCard(g, safecracker!);
  assert.deepEqual([g.heist!.loot, g.heist!.heat], [16, 0]);
  playCard(g, thief!);
  assert.deepEqual([g.heist!.loot, g.heist!.heat], [19, 1]);
});

test('해커와 참모의 효과는 턴이 끝나면 사라진다', () => {
  const g = newGame(1);
  const [hacker] = setHand(g, ['hacker']);
  playCard(g, hacker!);
  endTurn(g);
  assert.equal(g.heist!.nextLootNoHeat, false);
});

test('한탕주의자는 경보가 7 이상일 때 크게 번다', () => {
  const g = newGame(1);
  const [low, high] = setHand(g, ['gambler', 'gambler']);
  playCard(g, low!);
  assert.equal(g.heist!.loot, 2);
  g.heist!.heat = 7;
  playCard(g, high!);
  assert.equal(g.heist!.loot, 12);
  assert.equal(g.heist!.heat, 8);
});

test('싹쓸이는 이번 턴에 낸 카드 수만큼 번다', () => {
  const g = newGame(1);
  const [a, b, sweeper] = setHand(g, ['rookie', 'pickpocket', 'sweeper']);
  playCard(g, a!);
  playCard(g, b!);
  const before = g.heist!.loot;
  playCard(g, sweeper!);
  assert.equal(g.heist!.loot - before, 6);
});

test('뇌물은 수익이 3 이상일 때만 낼 수 있다', () => {
  const g = newGame(1);
  const [uid] = setHand(g, ['bribe']);
  assert.equal(canPlay(g, uid!), false);
  g.heist!.loot = 5;
  g.heist!.heat = 4;
  playCard(g, uid!);
  assert.deepEqual([g.heist!.loot, g.heist!.heat], [2, 1]);
});

test('변장의 달인은 경보가 낮으면 행동력을 돌려준다', () => {
  const g = newGame(1);
  const [cool, hot] = setHand(g, ['disguise', 'disguise']);
  g.heist!.heat = 4;
  playCard(g, cool!);
  assert.deepEqual([g.heist!.heat, g.heist!.energy], [3, ENERGY_PER_TURN]);
  g.heist!.heat = 8;
  playCard(g, hot!);
  assert.deepEqual([g.heist!.heat, g.heist!.energy], [7, ENERGY_PER_TURN - 1]);
});

test('내부자를 내면 그 턴의 순찰이 없다', () => {
  const g = newGame(1);
  const [uid] = setHand(g, ['insider']);
  playCard(g, uid!);
  assert.equal(pendingPatrol(g), 0);
  endTurn(g);
  assert.equal(g.heist!.heat, 0);
  assert.ok(pendingPatrol(g) > 0);
});

test('도주로 설계자는 도주 준비만큼 수익을 준다', () => {
  const g = newGame(1);
  const [uid] = setHand(g, ['routeplanner']);
  g.heist!.escape = 1;
  playCard(g, uid!);
  assert.deepEqual([g.heist!.escape, g.heist!.loot], [3, 3]);
});

test('경보는 0 아래로 내려가지 않는다', () => {
  const g = newGame(1);
  const [uid] = setHand(g, ['decoy']);
  g.heist!.heat = 1;
  playCard(g, uid!);
  assert.equal(g.heist!.heat, 0);
});

test('금고가 잠겨 있으면 털이 수익이 절반이고, 기술 카드를 내면 열린다', () => {
  const g = newGame(1);
  g.heistIndex = LOCATIONS.findIndex((l) => l.vaultTech > 0);
  assert.ok(g.heistIndex >= 0, '금고가 있는 장소가 있어야 한다');
  const need = currentLocation(g).vaultTech;
  const techs = Array.from({ length: need }, () => 'hacker');
  const uids = setHand(g, ['safecracker', ...techs, 'safecracker']);
  g.heist!.energy = 20;
  assert.equal(vaultLocked(g), true);
  playCard(g, uids[0]!);
  assert.equal(g.heist!.loot, 4);
  for (const uid of uids.slice(1, 1 + need)) playCard(g, uid);
  assert.equal(vaultLocked(g), false);
  playCard(g, uids.at(-1)!);
  assert.equal(g.heist!.loot, 12);
});

test('상점: 첫 영입은 무료이고 그다음부터 돈을 낸다', () => {
  const g = newGame(3);
  clearHeist(g, 0);
  assert.equal(buyOffer(g, 0), true);
  assert.equal(g.deck.length, 11);
  assert.equal(g.money, 0);
  assert.equal(buyOffer(g, 0), false, '이미 영입한 후보는 다시 살 수 없다');
  assert.equal(buyOffer(g, 1), false, '돈이 없으면 살 수 없다');
  g.money = 20;
  const price = g.shop!.offers[1]!.price;
  assert.equal(price, cardDef(g.shop!.offers[1]!.id).price);
  assert.equal(buyOffer(g, 1), true);
  assert.equal(g.money, 20 - price);
});

test('상점: 다시 뽑기와 내보내기는 돈을 쓴다', () => {
  const g = newGame(3);
  clearHeist(g, 0);
  assert.equal(rerollShop(g), false);
  assert.equal(removeCard(g, g.deck[0]!.uid), false);
  g.money = REROLL_COST + REMOVE_COST;
  assert.equal(rerollShop(g), true);
  assert.equal(g.shop!.offers.every((o) => !o.sold), true);
  const victim = g.deck[0]!.uid;
  assert.equal(removeCard(g, victim), true);
  assert.equal(g.money, 0);
  assert.equal(g.deck.some((c) => c.uid === victim), false);
});

test('다음 작전은 영입한 카드를 포함한 덱으로 시작한다', () => {
  const g = newGame(3);
  clearHeist(g, 0);
  buyOffer(g, 0);
  nextHeist(g);
  const h = g.heist!;
  assert.equal(g.heistIndex, 1);
  assert.equal(h.hand.length + h.drawPile.length, 11);
  assert.deepEqual([h.loot, h.heat, h.escape, h.turn], [0, 0, 0, 1]);
});

test('마지막 작전까지 철수하면 승리한다', () => {
  const g = newGame(5);
  for (let i = 0; i < LOCATIONS.length; i++) {
    clearHeist(g, 1);
    if (i < LOCATIONS.length - 1) nextHeist(g);
  }
  assert.equal(g.phase, 'won');
  assert.equal(g.money, LOCATIONS.length);
});

test('저장된 상태는 JSON을 거쳐도 이어서 할 수 있고, 낡은 상태는 거른다', () => {
  const g = newGame(9);
  const copy: unknown = JSON.parse(JSON.stringify(g));
  assert.equal(isUsableState(copy), true);
  assert.equal(isUsableState({ ...g, version: 0 }), false);
  assert.equal(isUsableState(null), false);
  assert.equal(isUsableState({ ...g, deck: [{ uid: 1, id: 'nope' }] }), false);
});
