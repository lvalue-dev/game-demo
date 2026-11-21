import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createGame, legacyScore } from '../src/game/career.ts';
import { CLUB_LEAGUES, CLUB_SEEDS, LINEUP } from '../src/game/data.ts';
import { rand } from '../src/game/rng.ts';
import { roundRobin, sortTable } from '../src/game/world.ts';
import type { Game } from '../src/game/types.ts';

/** 막히지 않은 첫 선택지. 이적 시장에서는 바로 마감한다(후보 보기와 돌아가기를 오가지 않게). */
function firstChoice(g: Game): string {
  if (g.phase === 'market' || g.phase === 'winter') return g.window?.view ? 'back' : 'done';
  return g.scene.choices.find((c) => !c.disabled)!.id;
}

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
    const table = sortTable(g.tables.eu1);
    const strongest = [...g.leagues.eu1].sort((x, y) => g.clubs[y]!.att + g.clubs[y]!.def - (g.clubs[x]!.att + g.clubs[x]!.def))[0];
    if (table.findIndex((r) => r.club === strongest) < 10) topHalf++;
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

test('직접 지휘한 라이벌전도 순위표에 반영되어 모든 팀의 경기 수가 맞는다', () => {
  for (let seed = 0; seed < 6; seed++) {
    const g = createGame(seed * 13 + 77, '지휘', 'analyst');
    const dice = { rng: seed + 1 };
    let matches = 0;
    while (g.phase !== 'end') {
      if (g.phase === 'match' && g.match!.step === 'shape') matches++;
      const open = g.scene.choices.filter((c) => !c.disabled && c.id !== 'auto');
      act(g, open[Math.floor(rand(dice) * open.length)]!.id);
    }
    assert.ok(matches >= 2, '라이벌전은 전반기와 후반기에 한 번씩 있다');
    const size = g.leagues.kr5.length;
    for (const row of g.tables.kr5) assert.equal(row.p, 2 * (size - 1), '시즌이 끝나면 모든 팀이 같은 수의 경기를 치렀다');
    assert.equal(g.match, null);
    assert.ok(g.season.lines.some((l) => l.note === '직접 지휘'));
  }
});

test('수석 코치에게 맡기면 선택 없이 경기가 끝난다', () => {
  const g = createGame(4242, '위임', 'pro');
  while (g.phase !== 'match') act(g, firstChoice(g));
  act(g, 'auto');
  assert.equal(g.match!.step, 'done');
  assert.equal(g.match!.seg, 6);
  assert.deepEqual(g.scene.choices.map((c) => c.id), ['next']);
});

test('전술 상성: 맞춤 전술은 실제로 유리하고, 유불리는 서로 뒤집힌다', async () => {
  const { advantage, bestCounter, matchup } = await import('../src/game/tactics.ts');
  const { STYLE_IDS } = await import('../src/game/data.ts');
  for (const a of STYLE_IDS) {
    assert.ok(advantage(bestCounter(a), a) > 0, `${a}를 받아치는 전술이 있다`);
    for (const b of STYLE_IDS) assert.ok(Math.abs(advantage(a, b) + advantage(b, a)) < 1e-9);
  }
  assert.ok(['direct', 'counter'].includes(bestCounter('press')), '높이 올라온 팀에는 롱볼과 역습이 통한다');
  assert.equal(bestCounter('park'), 'wide', '밀집 수비는 측면에서 흔든다');
  // 압박과 점유의 싸움은 중원의 기술이 가른다.
  assert.ok(matchup('possess', 'press', 0).att < 0);
  assert.ok(matchup('possess', 'press', 3).att > 0);
});

/** 첫 직접 지휘 경기를 실시간 모드로 시작한다. */
async function liveGame(seed: number) {
  const { liveTick, liveCommand } = await import('../src/game/match.ts');
  const g = createGame(seed, '실시간', 'analyst');
  while (g.phase !== 'match') act(g, firstChoice(g));
  act(g, '433');
  act(g, g.season.style);
  assert.equal(g.match!.step, 'mode');
  act(g, 'live');
  assert.equal(g.match!.step, 'live');
  return { g, liveTick, liveCommand };
}

test('실시간 경기: 하프타임 대화를 거쳐 90분을 마치고, 결과가 순위표에 들어간다', async () => {
  const { g, liveTick, liveCommand } = await liveGame(31337);
  let ticks = 0;
  while (g.match!.step === 'live' && ticks < 5000) {
    const L = g.match!.live!;
    if (L.halfTimeDone && !L.talked) {
      const before = L.tick;
      liveTick(g);
      assert.equal(g.match!.live!.tick, before, '라커룸 대화 전에는 후반이 시작되지 않는다');
      liveCommand(g, 'talk:calm');
    }
    liveTick(g);
    ticks++;
  }
  const m = g.match!;
  assert.equal(m.step, 'done');
  assert.ok(m.live!.over && m.live!.tick >= 1800);
  const goals = m.log.filter((l) => l.tone !== 'plain' && !l.text.includes('레드카드') && !l.text.includes('퇴장')).length;
  assert.equal(goals, m.score[0] + m.score[1], '골마다 기록이 한 줄씩 남는다');
  const [gf, ga] = m.score;
  const club = g.job!.club;
  const league = m.league!;
  const row = () => g.tables[league].find((r) => r.club === club)!;
  const played = row().p;
  act(g, 'next');
  assert.equal(g.match, null);
  assert.equal(row().p, played + 1);
  assert.ok(g.season.lines.some((l) => l.gf === gf && l.ga === ga && l.note === '직접 지휘'));
});

test('실시간 경기: 같은 시드와 같은 지시면 같은 경기가 나온다', async () => {
  const play = async (): Promise<string> => {
    const { g, liveTick, liveCommand } = await liveGame(2718);
    liveCommand(g, 'line:1');
    liveCommand(g, 'role:' + g.squad.find((p) => p.pos === 'FW')!.id + ':target');
    for (let k = 0; k < 2000 && g.match!.step === 'live'; k++) {
      if (g.match!.live!.halfTimeDone && !g.match!.live!.talked) liveCommand(g, 'talk:praise');
      liveTick(g);
    }
    return JSON.stringify([g.match!.score, g.match!.log]);
  };
  assert.equal(await play(), await play());
});

test('실시간 경기: 지시가 상태에 반영되고, 교체 카드가 모자라면 거절된다', async () => {
  const { g, liveCommand } = await liveGame(99);
  const m = g.match!;
  const other = (['press', 'possess', 'counter', 'direct', 'wide', 'park'] as const).find((s) => s !== m.me.style)!;
  liveCommand(g, `style:${other}`);
  assert.equal(m.me.style, other);
  assert.equal(m.confusion, 1, '전술을 바꾸면 혼선이 생긴다');
  liveCommand(g, 'tempo:1');
  liveCommand(g, 'overlap:1');
  assert.deepEqual(m.dials, { line: 0, width: 0, tempo: 1, overlap: true });
  const mf = g.squad.find((p) => p.pos === 'MF')!;
  liveCommand(g, `role:${mf.id}:hold`);
  assert.equal(m.roles[mf.id], 'hold');
  liveCommand(g, `role:${mf.id}:target`);
  assert.equal(m.roles[mf.id], 'hold', '포지션에 없는 역할은 받지 않는다');
  liveCommand(g, 'shape:541');
  assert.equal(m.me.shape, '541');
  assert.equal(m.subs, 2);
  const slots = new Set(m.live!.teams[0].players.map((p) => p.slot));
  assert.equal(slots.size, 11, '대형을 바꿔도 자리가 겹치지 않는다');
  liveCommand(g, 'sub:legs');
  assert.equal(m.subs, 0);
  liveCommand(g, 'sub:fw');
  assert.equal(m.subs, 0);
  liveCommand(g, 'shape:442');
  assert.equal(m.me.shape, '541', '카드가 없으면 대형을 못 바꾼다');
});

test('실시간 경기: 건너뛰면 지금 지시대로 끝까지 진행된다', async () => {
  const { g } = await liveGame(5150);
  act(g, 'skip');
  assert.equal(g.match!.step, 'done');
  assert.deepEqual(g.scene.choices.map((c) => c.id), ['next']);
});

/** 첫 여름 이적시장 목록 화면까지 간다. */
function toMarket(seed: number): Game {
  const g = createGame(seed, '시장', 'scout');
  while (g.phase !== 'market') act(g, g.scene.choices.find((c) => !c.disabled)!.id);
  return g;
}

test('이적시장: 한 시장에서 여러 명을 영입하고, 판매하고, 마감할 수 있다', () => {
  const g = toMarket(808);
  g.job!.budget = 1e6;
  const w = g.window!;
  assert.ok(w.list.length >= 6, '여름에는 후보가 여섯 명 넘게 나온다');
  const before = g.squad.length;
  for (let k = 0; k < 3; k++) {
    const d = g.window!.list.find((x) => x.kind !== 'youth')!;
    act(g, `view:${d.id}`);
    assert.equal(g.scene.blocks[0]!.kind, 'card', '후보를 누르면 선수 카드가 보인다');
    act(g, 'buy');
    assert.ok(g.squad.some((p) => p.id === d.player.id));
  }
  assert.equal(g.window!.signed, 3);
  assert.equal(g.squad.length, before, '주전은 언제나 일곱 명이다');
  const budget = g.job!.budget;
  const star = g.squad[5]!;
  act(g, 'sellmenu');
  act(g, `sell:${star.id}`);
  assert.ok(!g.squad.some((p) => p.id === star.id));
  assert.ok(g.job!.budget > budget, '팔면 이적료가 들어온다');
  assert.equal(g.squad.length, before);
  act(g, 'done');
  assert.equal(g.window, null);
  assert.ok(g.phase === 'half1' || g.phase === 'match', '시장이 닫히면 전반기가 시작된다');
});

test('이적시장: 깎아서 제안하면 싸게 사거나, 요구액이 오르거나, 선수가 떠난다', () => {
  const outcomes = new Set<string>();
  for (let seed = 0; seed < 40; seed++) {
    const g = toMarket(9000 + seed);
    g.job!.budget = 1e6;
    const d = g.window!.list.find((x) => x.price > 0)!;
    const price = d.price;
    act(g, `view:${d.id}`);
    act(g, 'haggle');
    const w = g.window!;
    if (g.squad.some((p) => p.id === d.player.id)) outcomes.add('signed');
    else if (!w.list.some((x) => x.id === d.id)) outcomes.add('gone');
    else {
      assert.ok(w.list.find((x) => x.id === d.id)!.price > price);
      outcomes.add('up');
    }
  }
  assert.deepEqual([...outcomes].sort(), ['gone', 'signed', 'up']);
});

test('선수는 세부 포지션, 주발, 능력치 여섯 개를 가진다', async () => {
  const { statsOf } = await import('../src/game/player.ts');
  const g = createGame(55, '카드', 'pro');
  act(g, g.scene.choices[0]!.id);
  for (const p of g.squad) {
    assert.ok(p.spot && ['R', 'L', 'B'].includes(p.foot));
    assert.equal(statsOf(p).length, 6);
    assert.ok(statsOf(p).every((v) => v >= 15 && v <= 99));
  }
});

test('이전 버전(3)의 저장도 불러와 이어 할 수 있다', async () => {
  const { migrate } = await import('../src/game/career.ts');
  const g = toMarket(321);
  const old = JSON.parse(JSON.stringify(g)) as Record<string, unknown> & Game;
  old.version = 3;
  for (const p of old.squad) for (const key of ['spot', 'foot', 'weak', 'height', 'dev']) delete (p as unknown as Record<string, unknown>)[key];
  delete (old as unknown as Record<string, unknown>).window;
  (old as unknown as Record<string, unknown>).market = [];
  assert.ok(migrate(old));
  assert.equal(old.version, 4);
  assert.ok(old.squad.every((p) => p.spot && p.dev.length === 6));
  assert.ok(old.window && old.window.list.length > 0, '시장 한가운데 저장이면 시장을 새로 연다');
  act(old, 'done');
  assert.ok(old.phase === 'half1' || old.phase === 'match');
});
