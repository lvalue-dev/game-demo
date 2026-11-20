import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createGame, legacyScore } from '../src/game/career.ts';
import { CLUB_LEAGUES, CLUB_SEEDS, LINEUP } from '../src/game/data.ts';
import { rand } from '../src/game/rng.ts';
import { roundRobin, sortTable } from '../src/game/world.ts';
import type { Game } from '../src/game/types.ts';

/** 정년까지 아무 선택지나 고르며 커리어를 끝까지 돌린다. 한 걸음마다 check를 부른다. */
function playOut(g: Game, seed: number, check?: (g: Game) => void): string[] {
  const dice = { rng: seed };
  const picks: string[] = [];
  for (let guard = 0; g.phase !== 'retired'; guard++) {
    assert.ok(guard < 5000, '커리어가 끝나지 않는다');
    const open = g.scene.choices.filter((c) => !c.disabled && c.id !== 'retire');
    assert.ok(open.length > 0, `${g.phase} 장면에 고를 수 있는 선택지가 없다`);
    const id = open[Math.floor(rand(dice) * open.length)]!.id;
    picks.push(id);
    act(g, id);
    check?.(g);
  }
  return picks;
}

test('일정은 모든 팀이 서로 홈과 원정으로 한 번씩 만나게 짠다', () => {
  const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const rounds = roundRobin(ids, true);
  assert.equal(rounds.length, 18);
  const seen = new Map<string, number>();
  for (const round of rounds) {
    assert.deepEqual([...round.flat()].sort((a, b) => a - b), ids, '한 라운드에 모든 팀이 한 번씩 뛴다');
    for (const [h, a] of round) seen.set(`${h}-${a}`, (seen.get(`${h}-${a}`) ?? 0) + 1);
  }
  assert.equal(seen.size, 90);
  assert.ok([...seen.values()].every((n) => n === 1));
});

test('팀 수가 홀수면 라운드마다 한 팀이 쉬고, 그래도 모두가 서로 두 번 만난다', () => {
  const ids = Array.from({ length: 17 }, (_, i) => i);
  const rounds = roundRobin(ids, true);
  assert.equal(rounds.length, 34);
  const played = new Map<number, number>();
  for (const round of rounds) {
    assert.equal(round.length, 8);
    for (const id of round.flat()) played.set(id, (played.get(id) ?? 0) + 1);
  }
  assert.ok(ids.every((id) => played.get(id) === 32), 'K리그2처럼 17팀이면 팀당 32경기다');
});

test('커리어는 첫 팀을 고르는 장면에서 시작한다', () => {
  const g = createGame(1, '테스트', 'analyst');
  assert.equal(g.phase, 'offers');
  assert.equal(g.scene.choices.length, 3);
  assert.equal(g.manager.attrs.tactics, 10);
  const sizes = Object.fromEntries(CLUB_LEAGUES.map((l) => [l, g.leagues[l].length]));
  assert.deepEqual(sizes, { kr5: 10, kr4: 13, kr3: 14, kr2: 17, kr1: 12, eu2: 24, eu1: 20 }, '2026년 실제 리그 구성');
  assert.ok(g.scene.choices.every((c) => g.clubs[c.club!]!.league === 'kr5'), '첫 제안은 동호인 리그에서 온다');
});

test('같은 시드와 같은 선택이면 같은 커리어가 나온다', () => {
  const a = createGame(42, '가', 'pro');
  const picks = playOut(a, 7);
  const b = createGame(42, '가', 'pro');
  for (const id of picks) act(b, id);
  assert.deepEqual(b.history, a.history);
  assert.equal(legacyScore(b), legacyScore(a));
});

test('끝까지 돌려도 상태가 망가지지 않는다', () => {
  for (let seed = 0; seed < 12; seed++) {
    const g = createGame(seed * 31 + 5, '봇', 'teacher');
    playOut(g, seed, (h) => {
      if (!h.job) return;
      assert.deepEqual(h.squad.map((p) => p.pos).sort(), [...LINEUP].sort(), '주전은 늘 일곱 명, 정해진 구성이다');
      assert.ok(h.job.confidence >= 0 && h.job.confidence <= 100);
      assert.ok(h.job.budget >= 0, `예산이 음수다: ${h.job.budget}`);
      assert.ok(h.morale >= 0 && h.morale <= 100 && h.cohesion >= 0 && h.cohesion <= 100);
      assert.ok(h.manager.rep >= 0 && h.manager.rep <= 100);
      for (const league of CLUB_LEAGUES) {
        assert.equal(h.leagues[league].length, CLUB_SEEDS[league].length, `${league}의 팀 수가 달라졌다`);
        assert.equal(h.tables[league].length, CLUB_SEEDS[league].length);
      }
    });
    assert.equal(g.history.length, 30, '35세에 시작해 65세에 정년을 맞는다');
    assert.equal(g.manager.age, 65);
  }
});

test('저장했다가 불러와도 똑같이 이어진다', () => {
  const a = createGame(99, '저장', 'scout');
  const dice = { rng: 3 };
  const next = (g: Game): string => {
    const open = g.scene.choices.filter((c) => !c.disabled && c.id !== 'retire');
    return open[Math.floor(rand(dice) * open.length)]!.id;
  };
  for (let i = 0; i < 60; i++) act(a, next(a));
  const b = JSON.parse(JSON.stringify(a)) as Game;
  const fork = { rng: dice.rng };
  for (let i = 0; i < 80 && a.phase !== 'retired'; i++) {
    const id = next(a);
    act(a, id);
    act(b, id);
  }
  assert.ok(fork.rng !== dice.rng);
  assert.deepEqual(b.history, a.history);
  assert.deepEqual(b.scene, a.scene);
});

test('없는 선택지나 막힌 선택지는 무시한다', () => {
  const g = createGame(5, '무시', 'sales');
  const before = JSON.stringify(g);
  act(g, 'nothing');
  assert.equal(JSON.stringify(g), before);
});

test('전력이 강한 팀이 대체로 위에 선다', () => {
  let topHalf = 0;
  const runs = 40;
  for (let seed = 0; seed < runs; seed++) {
    const g = createGame(seed + 1000, '관찰', 'pro');
    act(g, 'offer0');
    // 한 시즌을 끝까지 넘긴다.
    const dice = { rng: seed };
    while (g.phase !== 'end') {
      const open = g.scene.choices.filter((c) => !c.disabled);
      act(g, open[Math.floor(rand(dice) * open.length)]!.id);
    }
    const table = sortTable(g.tables.kr1);
    const strongest = [...g.leagues.kr1].sort((x, y) => g.clubs[y]!.att + g.clubs[y]!.def - (g.clubs[x]!.att + g.clubs[x]!.def))[0];
    if (table.findIndex((r) => r.club === strongest) < 5) topHalf++;
  }
  assert.ok(topHalf >= runs * 0.8, `가장 강한 팀이 상위 절반에 든 횟수: ${topHalf}/${runs}`);
});

test('조사는 이름의 받침에 맞춰 붙는다', async () => {
  const { ko } = await import('../src/game/josa.ts');
  assert.equal(ko`${'임진준'}은 떠났다`, '임진준은 떠났다');
  assert.equal(ko`${'서태호'}은 떠났다`, '서태호는 떠났다');
  assert.equal(ko`${'한빛 FC'}이 이겼다. ${'노을 SC'}을 꺾었다`, '한빛 FC가 이겼다. 노을 SC를 꺾었다');
  assert.equal(ko`${'마테오 실바'}과 ${'루카 로시'}이 다퉜다`, '마테오 실바와 루카 로시가 다퉜다');
  assert.equal(ko`${'챌린저스 리그'}으로 내려간다, ${'서울'}으로`, '챌린저스 리그로 내려간다, 서울로');
  assert.equal(ko`${'김민준'}이라는 선수`, '김민준이라는 선수', '조사가 아닌 말은 건드리지 않는다');
});
