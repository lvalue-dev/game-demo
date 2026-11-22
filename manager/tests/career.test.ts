import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createGame, legacyScore } from '../src/game/career.ts';
import { CLUB_LEAGUES, CLUB_SEEDS, LEAGUES, LINEUP } from '../src/game/data.ts';
import { rand } from '../src/game/rng.ts';
import { roundRobin, sortTable } from '../src/game/world.ts';
import type { Game } from '../src/game/types.ts';

/** 막히지 않은 첫 선택지. 이적 시장에서는 바로 마감한다(후보 보기와 돌아가기를 오가지 않게). */
function firstChoice(g: Game): string {
  if (g.phase === 'market' || g.phase === 'winter') return g.window?.view ? 'back' : 'done';
  if (g.phase === 'career') return careerChoice(g);
  return g.scene.choices.find((c) => !c.disabled)!.id;
}

/** 구직 화면에서 고르는 순서: 제안 수락 → 지원서 제출 → 지원 가능한 첫 공고 → 다음 → 첫 대답 → 남기 → 쉬기. */
function careerChoice(g: Game): string {
  const open = g.scene.choices.filter((c) => !c.disabled);
  const find = (f: (id: string) => boolean): string | undefined => open.find((c) => f(c.id))?.id;
  const h = g.hiring!;
  const vac = h.step === 'browse' && !h.list.some((v) => v.state === 'applied') ? find((id) => /^v\d+$/.test(id)) : undefined;
  return find((id) => id.startsWith('take')) ?? find((id) => id === 'submit') ?? vac ?? find((id) => id === 'next')
    ?? find((id) => id.startsWith('a:')) ?? find((id) => id === 'stay') ?? find((id) => id === 'idle') ?? open[0]!.id;
}

/** 무작위로 고를 때 "코치로 지낸다"는 다른 길이 없을 때만 고른다(아니면 대부분의 해를 쉬며 보낸다). */
function withoutIdle<T extends { id: string }>(open: T[]): T[] {
  const rest = open.filter((c) => c.id !== 'idle' && c.id !== 'course');
  return rest.length > 0 ? open.filter((c) => c.id !== 'idle') : open;
}

/** 정년까지 아무 선택지나 고르며 커리어를 끝까지 돌린다. 한 걸음마다 check를 부른다. */
function playOut(g: Game, seed: number, check?: (g: Game) => void): string[] {
  const dice = { rng: seed };
  const picks: string[] = [];
  for (let guard = 0; g.phase !== 'retired'; guard++) {
    // 이적시장의 판매·임대 화면은 선택지가 많아 무작위로 고르면 오래 머문다.
    assert.ok(guard < 15000, '커리어가 끝나지 않는다');
    const open = withoutIdle(g.scene.choices.filter((c) => !c.disabled && c.id !== 'retire'));
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

test('커리어는 구직에서 시작한다: 리그마다 요구 자격이 있고, 모자라면 지원할 수 없다', () => {
  const g = createGame(1, '테스트', 'analyst');
  assert.equal(g.phase, 'career');
  assert.equal(g.manager.attrs.tactics, 10);
  assert.equal(g.manager.license, 1, '전력 분석관 출신은 C급을 가지고 시작한다');
  for (const league of CLUB_LEAGUES) assert.equal(g.leagues[league]!.length, CLUB_SEEDS[league]!.length);
  assert.equal(CLUB_LEAGUES.length, 35, '7개국 5부까지');
  const vac = g.hiring!.list;
  assert.ok(vac.length >= 10, '여러 나라의 구인 공고가 있다');
  const k5 = g.scene.choices.find((c) => c.id.startsWith('v') && g.clubs[c.club!]!.league === 'kr5');
  assert.ok(k5 && !k5.disabled, 'C급이면 K5에 지원할 수 있다');
  const closed = g.scene.blocks.flatMap((b) => (b.kind === 'stats' ? b.rows : [])).filter((r) => /필요/.test(r.value));
  assert.ok(closed.length > 0, '자격이 모자란 공고는 따로 모아 이유를 보여 준다');
  assert.ok(g.scene.choices.filter((c) => c.id.startsWith('v')).every((c) => !c.disabled), '지원할 수 있는 공고만 선택지로 나온다');
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
      assert.equal(h.squad.length, LINEUP.length, '선발은 늘 일곱 명이다');
      assert.ok(h.job.confidence >= 0 && h.job.confidence <= 100);
      assert.ok(h.job.budget >= 0, `예산이 음수다: ${h.job.budget}`);
      assert.ok(h.morale >= 0 && h.morale <= 100 && h.cohesion >= 0 && h.cohesion <= 100);
      assert.ok(h.manager.rep >= 0 && h.manager.rep <= 100);
      for (const league of CLUB_LEAGUES) {
        assert.equal(h.leagues[league].length, CLUB_SEEDS[league].length, `${league}의 팀 수가 달라졌다`);
        assert.equal(h.tables[league].length, CLUB_SEEDS[league].length);
      }
    });
    assert.equal(g.history.length + g.manager.idle, 30, '35세에 시작해 65세에 정년을 맞는다(감독 자리 없이 보낸 해 포함)');
    assert.equal(g.manager.age, 65);
  }
});

test('저장했다가 불러와도 똑같이 이어진다', () => {
  const a = createGame(99, '저장', 'scout');
  const dice = { rng: 3 };
  const next = (g: Game): string => {
    const open = withoutIdle(g.scene.choices.filter((c) => !c.disabled && c.id !== 'retire'));
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
    const g = createGame(seed + 1000, '관찰', 'pro', 'eng1');
    act(g, 'take0');
    // 한 시즌을 끝까지 넘긴다.
    const dice = { rng: seed };
    while (g.phase !== 'end') {
      const open = withoutIdle(g.scene.choices.filter((c) => !c.disabled));
      act(g, open[Math.floor(rand(dice) * open.length)]!.id);
    }
    const table = sortTable(g.tables.eng1!);
    const strongest = [...g.leagues.eng1!].sort((x, y) => g.clubs[y]!.att + g.clubs[y]!.def - (g.clubs[x]!.att + g.clubs[x]!.def))[0];
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
    const g = createGame(seed * 13 + 77, '지휘', 'analyst', 'kr5');
    const dice = { rng: seed + 1 };
    let matches = 0;
    while (g.phase !== 'end') {
      if (g.phase === 'match' && g.match!.step === 'shape') matches++;
      const open = withoutIdle(g.scene.choices.filter((c) => !c.disabled && c.id !== 'auto'));
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
  const g = createGame(4242, '위임', 'pro', 'kr5');
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
  const g = createGame(seed, '실시간', 'analyst', 'kr5');
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

/** 첫 여름 이적시장 목록 화면까지 간다. 예산은 넉넉하게 준다. */
function toMarket(seed: number, rich = true): Game {
  const g = createGame(seed, '시장', 'scout', 'kr5');
  // 연봉이 있는 리그에서 시험한다: K3 구단을 고른다.
  while (g.phase !== 'market') act(g, g.scene.choices.find((c) => !c.disabled)!.id);
  if (rich) {
    g.job!.budget = 1e6;
    g.job!.wageBudget = 1e6;
  }
  return g;
}

test('이적: 이적료 합의 → 개인 조건 협상 → 서명. 여러 명을 영입하고 판매, 해지도 한다', () => {
  const g = toMarket(808);
  const before = g.squad.length;
  let signed = 0;
  for (const d of g.window!.list.filter((x) => x.kind === 'sign').slice(0, 3)) {
    const budget = g.job!.budget;
    act(g, `view:${d.id}`);
    assert.equal(g.window!.list.find((x) => x.id === d.id)!.stage, 'fee');
    assert.ok(g.scene.blocks.some((b) => b.kind === 'form' && b.rows.some((r) => r.range?.id === 'f:fee')), '이적료는 직접 정한다');
    act(g, 'submit');
    assert.equal(g.window!.list.find((x) => x.id === d.id)!.stage, 'terms', '요구액 그대로 내면 바로 이적료 합의');
    assert.ok(g.scene.blocks.some((b) => b.kind === 'form'), '개인 조건 화면에는 계약 제안서가 있다');
    assert.equal(g.job!.budget, budget, '이적료는 서명할 때 나간다');
    for (let k = 0; k < 5 && g.window!.view === d.id; k++) {
      act(g, 't:agent=10');
      act(g, 'submit');
    }
    const p = [...g.squad, ...g.reserves].find((x) => x.id === d.player.id);
    if (p) {
      signed++;
      assert.ok(p.contract && p.contract.wage >= 0 && p.contract.years >= 1);
      assert.ok(g.job!.budget < budget - d.price + 1e-6, '이적료와 수수료, 계약금이 나갔다');
    }
  }
  assert.ok(signed >= 1);
  assert.equal(g.squad.length, before, '선발은 언제나 일곱 명이다');
  const numbers = [...g.squad, ...g.reserves].map((p) => p.no);
  assert.equal(new Set(numbers).size, numbers.length, '등번호는 겹치지 않는다');
  // 선발 판매
  const budget = g.job!.budget;
  const star = g.squad[5]!;
  act(g, `sale:${star.id}`);
  // 희망가를 낮게 잡으면 사려는 구단이 나올 가능성이 높다.
  const low = (g.scene.blocks.find((b) => b.kind === 'form') as { rows: { range?: { min: number } }[] }).rows[0]!.range!.min;
  act(g, `s:price=${low}`);
  act(g, 'sell');
  if (g.squad.some((p) => p.id === star.id)) act(g, 'sell');
  assert.ok(!g.squad.some((p) => p.id === star.id));
  assert.ok(g.job!.budget > budget);
  assert.equal(g.squad.length, before);
  // 후보 계약 해지
  const bench = g.reserves[0]!;
  act(g, `release:${bench.id}`);
  assert.ok(!g.reserves.some((p) => p.id === bench.id));
  act(g, 'back');
  act(g, 'done');
  assert.equal(g.window, null);
  assert.ok(g.phase === 'half1' || g.phase === 'match');
});

test('이적료 협상: 깎아서 제안하면 합의, 거절, 결렬이 모두 나온다', () => {
  const outcomes = new Set<string>();
  for (let seed = 0; seed < 50; seed++) {
    const g = toMarket(9000 + seed);
    const d = g.window!.list.find((x) => x.kind === 'sign')!;
    act(g, `view:${d.id}`);
    act(g, `f:fee=${Math.round(d.price * 0.8 * 10) / 10}`);
    act(g, 'submit');
    act(g, 'submit');
    const now = g.window!.list.find((x) => x.id === d.id);
    outcomes.add(!now ? 'gone' : now.stage === 'terms' ? 'agreed' : 'refused');
  }
  assert.deepEqual([...outcomes].sort(), ['agreed', 'gone', 'refused']);
});

test('계약: 연봉 예산을 넘기는 계약은 서명할 수 없다', () => {
  const g = toMarket(77, false);
  g.job!.budget = 1e6;
  g.job!.wageBudget = 0.1;
  const d = g.window!.list.find((x) => x.kind === 'sign')!;
  act(g, `view:${d.id}`);
  act(g, 'submit');
  const submit = g.scene.choices.find((c) => c.id === 'submit')!;
  if (d.ask.wage > 0) assert.ok(submit.disabled && submit.detail!.includes('연봉 예산'));
});

test('계약: 만료 임박 선수와 재계약하거나, 못 하면 시즌 끝에 자유계약으로 떠난다', async () => {
  const { openWindow } = await import('../src/game/transfer.ts');
  const { expireContracts } = await import('../src/game/contract.ts');
  const g = toMarket(4321);
  const a = g.squad[1]!;
  const b = g.squad[3]!;
  a.contract!.years = 1;
  b.contract!.years = 1;
  a.unhappy = false;
  openWindow(g, 'summer');
  const renew = g.window!.list.find((d) => d.kind === 'renew' && d.player.id === a.id)!;
  assert.ok(renew, '계약이 1년 남은 선수는 재계약 명단에 오른다');
  act(g, `view:${renew.id}`);
  act(g, 't:years:3');
  act(g, 't:agent=10');
  for (let k = 0; k < 5 && g.window!.view === renew.id; k++) act(g, 'submit');
  if (g.squad.includes(a) && a.contract!.years === 3) {
    expireContracts(g, 50);
    assert.ok(g.squad.includes(a), '재계약한 선수는 남는다');
    assert.equal(a.contract!.years, 2);
  }
  expireContracts(g, 50);
  assert.ok(!g.squad.includes(b), '재계약하지 않은 선수는 떠난다(보스만)');
  assert.equal(g.squad.length, 7, '빈자리는 후보나 새 선수가 메운다');
});

test('바이아웃이 발동하면 구단은 막을 수 없고, 선수가 응하면 떠난다', async () => {
  const { windowScene } = await import('../src/game/transfer.ts');
  const g = toMarket(2468);
  const p = g.squad[6]!;
  p.contract!.clause = 1;
  g.window!.bids = [{ id: 'bx', player: p.id, club: '어느 구단', fee: 1, clause: true, countered: false }];
  act(g, 'done');
  // 마감하면 제안은 사라지지만 선수는 남는다. 다시 열어 수락해 본다.
  const h = toMarket(2468);
  const q = h.squad[6]!;
  h.window!.bids = [{ id: 'bx', player: q.id, club: '어느 구단', fee: 1, clause: true, countered: false }];
  windowScene(h, '');
  assert.ok(!h.scene.choices.some((c) => c.id === 'bid:bx:no'), '바이아웃 제안에는 거절 선택지가 없다');
  act(h, 'bid:bx:no');
  assert.ok(h.window!.bids.length === 1, '바이아웃 제안은 거절할 수 없다');
  act(h, 'bid:bx:yes');
  assert.ok(!h.squad.some((x) => x.id === q.id));
});

test('선수를 아무 자리에나 세울 수 있지만 포지션 밖이면 OVR이 깎이고, 약속을 어기면 불만이 생긴다', async () => {
  const { placeAt, checkPromises } = await import('../src/game/contract.ts');
  const { effOvr, lineAt, ratings } = await import('../src/game/squad.ts');
  const g = toMarket(1357);
  act(g, 'done');
  while (g.phase === 'match') act(g, firstChoice(g));
  // 후보를 같은 포지션 선발 자리에
  const sub = g.reserves.find((r) => r.pos === 'MF')!;
  const at = g.squad.findIndex((_, i) => lineAt(i) === 'MF');
  const starter = g.squad[at]!;
  starter.contract!.promise = 'star';
  assert.equal(placeAt(g, sub.id, at), null);
  assert.ok(g.squad[at] === sub && g.reserves.includes(starter));
  const lines = checkPromises(g);
  assert.ok(starter.unhappy && lines.length >= 1, '핵심 선수로 약속한 선수를 빼면 불만');
  // 선발 공격수를 미드필더 자리로(선발끼리 맞바꿈)
  const fwAt = g.squad.findIndex((_, i) => lineAt(i) === 'FW');
  const fw = g.squad[fwAt]!;
  const mfAt = g.squad.findIndex((_, i) => lineAt(i) === 'MF' && i !== at);
  const before = ratings(g.squad, 30);
  assert.equal(placeAt(g, fw.id, mfAt), null);
  assert.equal(g.squad[mfAt], fw);
  assert.ok(effOvr(fw, 'MF') < fw.ovr + fw.temp, '포지션 밖이면 깎인다');
  assert.notDeepEqual(ratings(g.squad, 30), before);
  // 골키퍼를 공격수로 세우면 크게 깎인다
  const gk = g.squad[0]!;
  assert.ok(effOvr(gk, 'FW') <= gk.ovr - 25);
});

test('외국인 쿼터: 등록 한도가 차면 외국인을 더 영입할 수 없고, 선발 한도는 배치에서 막힌다', async () => {
  const { quota, placeAt, foreignCount } = await import('../src/game/contract.ts');
  const g = toMarket(2020);
  const q = quota(g);
  assert.equal(q.reg, 3, 'K5는 게임 규칙상 외국인 3명까지');
  // 우리 선수 셋을 외국인으로 만든다.
  for (const p of [...g.squad, ...g.reserves]) p.nat = '대한민국';
  for (const p of [...g.squad, ...g.reserves].slice(0, 3)) p.nat = '브라질';
  assert.equal(foreignCount(g, [...g.squad, ...g.reserves]), 3);
  const d = g.window!.list.find((x) => x.kind === 'sign' || x.kind === 'free')!;
  d.player.nat = '일본';
  act(g, `view:${d.id}`);
  if (d.stage === 'fee') act(g, 'submit');
  const submit = g.scene.choices.find((c) => c.id === 'submit')!;
  assert.ok(submit.disabled && submit.detail!.includes('외국인 등록 한도'));
  // 선발 한도: 후보 외국인을 국내 선발 자리에 넣으면 선발 외국인이 넷이 되어 막힌다.
  act(g, 'back');
  const foreignBench = g.reserves.find((p) => p.nat !== '대한민국');
  for (const p of g.squad) if (p.nat !== '대한민국') p.nat = '대한민국';
  for (const p of g.squad.slice(0, 3)) p.nat = '브라질';
  const sub = foreignBench ?? g.reserves[0]!;
  sub.nat = '호주';
  const domesticAt = g.squad.findIndex((p) => p.nat === '대한민국');
  act(g, 'done');
  while (g.phase === 'match') act(g, firstChoice(g));
  assert.match(placeAt(g, sub.id, domesticAt) ?? '', /외국인 선발/);
});

test('임대: 빌려 온 선수는 기간이 끝나면 돌아가고, 빌려준 선수는 돌아온다', async () => {
  const { returnLoans } = await import('../src/game/transfer.ts');
  const g = toMarket(3030);
  const d = g.window!.list.find((x) => x.kind === 'loan')!;
  assert.ok(d, '여름 시장에는 임대 후보가 있다');
  act(g, `view:${d.id}`);
  assert.ok(g.scene.blocks.some((b) => b.kind === 'form' && b.rows.some((r) => r.range?.id === 'l:share')));
  act(g, 'l:share=1');
  act(g, `l:fee=${d.loan!.askFee}`);
  for (let k = 0; k < 5 && g.window!.view === d.id; k++) act(g, 'submit');
  const p = [...g.squad, ...g.reserves].find((x) => x.id === d.player.id);
  if (p) {
    assert.equal(p.loan?.dir, 'in');
    returnLoans(g, 'end');
    assert.ok(![...g.squad, ...g.reserves].some((x) => x.id === p.id), '시즌 끝에 원 소속 구단으로 돌아간다');
    assert.equal(g.squad.length, 7);
  }
  // 임대 보내기
  const h = toMarket(3031);
  const young = h.reserves[0]!;
  act(h, `lend:${young.id}`);
  act(h, 'l:share=1');
  for (let k = 0; k < 6 && !h.loaned.includes(young); k++) act(h, 'lend');
  if (h.loaned.includes(young)) {
    assert.ok(!h.reserves.includes(young), '임대 간 선수는 등록 인원에서 빠진다');
    returnLoans(h, 'end');
    assert.ok(h.reserves.includes(young) && young.loan === null);
  }
});

test('분할 지급: 이적료를 나눠 내면 지금은 첫 회분만 나가고 나머지는 다음 시즌으로 넘어간다', () => {
  const g = toMarket(4040);
  const d = g.window!.list.find((x) => x.kind === 'sign')!;
  act(g, `view:${d.id}`);
  act(g, `f:fee=${d.price}`);
  act(g, 'f:inst:3');
  for (let k = 0; k < 6 && d.stage === 'fee' && g.window!.list.includes(d); k++) act(g, 'submit');
  if (d.stage !== 'terms') return;
  for (let k = 0; k < 5 && g.window!.view === d.id; k++) act(g, 'submit');
  if (![...g.squad, ...g.reserves].some((p) => p.id === d.player.id)) return;
  assert.equal(g.job!.debts.length, 2);
  assert.ok(g.job!.debts.every((x) => x.due > g.year));
});

test('할 일 목록에 계약 만료 임박 선수가 나온다', async () => {
  const { agenda } = await import('../src/game/agenda.ts');
  const g = toMarket(5050);
  g.squad[2]!.contract!.years = 1;
  const items = agenda(g);
  assert.ok(items.some((t) => t.text.includes('계약 만료 임박') && t.text.includes(g.squad[2]!.name)));
});

test('선수는 세부 포지션, 주발, 능력치 여섯 개를 가진다', async () => {
  const { statsOf } = await import('../src/game/player.ts');
  const g = createGame(55, '카드', 'pro', 'kr5');
  act(g, g.scene.choices[0]!.id);
  for (const p of g.squad) {
    assert.ok(p.spot && ['R', 'L', 'B'].includes(p.foot));
    assert.equal(statsOf(p).length, 6);
    assert.ok(statsOf(p).every((v) => v >= 15 && v <= 99));
  }
});

test('이전 버전(3)의 저장도 불러와 이어 할 수 있다', async () => {
  const { migrate } = await import('../src/game/career.ts');
  const g = toMarket(321, false);
  const old = JSON.parse(JSON.stringify(g)) as Record<string, unknown> & Game;
  old.version = 3;
  for (const p of old.squad) for (const key of ['spot', 'foot', 'weak', 'height', 'dev', 'no', 'contract', 'unhappy', 'nat', 'loan']) delete (p as unknown as Record<string, unknown>)[key];
  delete (old as unknown as Record<string, unknown>).loaned;
  delete (old as unknown as Record<string, unknown>).reserves;
  delete (old as unknown as Record<string, unknown>).window;
  (old as unknown as Record<string, unknown>).market = [];
  assert.ok(migrate(old));
  assert.equal(old.version, 8);
  assert.ok(old.squad.every((p) => typeof p.nat === 'string'), '국적이 생긴다');
  assert.ok(old.squad.every((p) => p.no > 0), '등번호가 생긴다');
  assert.ok(old.squad.every((p) => p.spot && p.dev.length === 6));
  assert.ok(old.window && old.window.list.length > 0, '시장 한가운데 저장이면 시장을 새로 연다');
  act(old, 'done');
  assert.ok(old.phase === 'half1' || old.phase === 'match');
});

test('K5리그는 2026 시즌 서울 디비전 실제 8팀이다', () => {
  const names = CLUB_SEEDS.kr5.map((c) => c.name).sort();
  assert.deepEqual(names, ['강남 NISSI', '강동 잇플', '관악 AS', '관악 벽산', '성동 투게더', '양천 TNT', '용산 건융', '중랑 구립'].sort());
});

test('시험용 지름길: 출발 리그를 주면 그 리그 구단들이 바로 감독직을 제안한다', () => {
  for (const start of ['kr3', 'jpn1', 'eng1', 'ita5'] as const) {
    const g = createGame(77, '출발', 'pro', start);
    assert.equal(g.phase, 'career');
    const clubs = g.hiring!.list.map((v) => g.clubs[v.club]!);
    assert.ok(clubs.length === 3 && clubs.every((c) => c.league === start), `${start}에서 제의가 온다`);
    act(g, 'take0');
    assert.equal(g.phase, 'style');
  }
});

/** 프리미어리그 구단의 첫 여름 이적시장. */
function toEngland(seed: number): Game {
  const g = createGame(seed, '잉글랜드', 'scout', 'eng1');
  while (g.phase !== 'market') act(g, g.scene.choices.find((c) => !c.disabled)!.id);
  g.job!.budget = 1e7;
  g.job!.wageBudget = 1e7;
  return g;
}

test('워크퍼밋: GBE 점수가 모자라면 23세 이하만 ESC 슬롯으로 데려올 수 있다', async () => {
  const { englandCheck, gbePoints, ESC_SLOTS } = await import('../src/game/contract.ts');
  const g = toEngland(606);
  const d = g.window!.list.find((x) => x.kind === 'sign')!;
  const p = d.player;
  p.nat = '브라질';
  p.hg = false;
  p.ovr = 64; // GBE 3점
  assert.ok(gbePoints(p) < 15);
  p.age = 27;
  assert.match(englandCheck(g, p).why ?? '', /워크퍼밋/);
  p.age = 21;
  for (const q of [...g.squad, ...g.reserves]) q.esc = false;
  assert.deepEqual(englandCheck(g, p), { why: null, esc: true });
  for (const q of [...g.squad, ...g.reserves].slice(0, ESC_SLOTS)) q.esc = true;
  assert.match(englandCheck(g, p).why ?? '', /ESC/);
  // 잉글랜드 국적이면 워크퍼밋이 필요 없다.
  p.nat = '잉글랜드';
  p.hg = true;
  assert.equal(englandCheck(g, p).why, null);
});

test('홈그로운: 21세 이상 비홈그로운이 11명이면 더 등록할 수 없고, 21세 이하나 홈그로운은 된다', async () => {
  const { englandCheck, NON_HG_LIMIT } = await import('../src/game/contract.ts');
  const g = toEngland(707);
  const everyone = [...g.squad, ...g.reserves];
  everyone.forEach((q, i) => { q.age = 25; q.hg = i >= NON_HG_LIMIT; q.nat = '잉글랜드'; q.esc = false; });
  while ([...g.squad, ...g.reserves].filter((q) => !q.hg).length < NON_HG_LIMIT) {
    g.reserves.push({ ...g.reserves[0]!, id: 90000 + g.reserves.length, hg: false, age: 25 });
  }
  const d = g.window!.list.find((x) => x.kind === 'sign')!;
  const p = d.player;
  p.nat = '잉글랜드';
  p.hg = false;
  p.age = 26;
  assert.match(englandCheck(g, p).why ?? '', /홈그로운/);
  p.age = 20;
  assert.equal(englandCheck(g, p).why, null, '21세 이하는 세지 않는다');
  p.age = 26;
  p.hg = true;
  assert.equal(englandCheck(g, p).why, null, '홈그로운은 세지 않는다');
});

test('이전 버전(6)의 저장도 불러오면 홈그로운과 ESC 표시가 생긴다', async () => {
  const { migrate } = await import('../src/game/career.ts');
  const g = toMarket(888, false);
  const old = JSON.parse(JSON.stringify(g)) as Game;
  old.version = 6;
  for (const p of old.squad) {
    delete (p as unknown as Record<string, unknown>).hg;
    delete (p as unknown as Record<string, unknown>).esc;
  }
  assert.ok(migrate(old));
  assert.equal(old.version, 8);
  assert.ok(old.squad.every((p) => typeof p.hg === 'boolean' && p.esc === false));
});

// ---------- 세계 리그와 감독 채용 ----------

test('7개국 5부까지 실제 구단 명단이 들어 있고, 구단 이름은 겹치지 않는다', () => {
  const names = CLUB_LEAGUES.flatMap((l) => CLUB_SEEDS[l]!.map((c) => c.name));
  assert.equal(new Set(names).size, names.length);
  for (const id of ['eng1', 'esp1', 'ger1', 'ita1', 'fra1', 'jpn1', 'kr1']) assert.ok(CLUB_SEEDS[id]!.length >= 12, `${id} 구단`);
  assert.ok(CLUB_SEEDS.esp1!.some((c) => c.name === '레알 마드리드'));
  assert.ok(CLUB_SEEDS.ger1!.some((c) => c.name === '바이에른 뮌헨'));
  assert.ok(CLUB_SEEDS.jpn1!.some((c) => c.name === '가시마 앤틀러스'));
  // 리그 사다리: 나라 안에서 위아래로 이어지고, 나라끼리는 이어지지 않는다.
  for (const id of CLUB_LEAGUES) {
    const m = LEAGUES[id]!;
    if (m.up) assert.equal(LEAGUES[m.up]!.country, m.country);
    if (m.down) assert.equal(LEAGUES[m.down]!.country, m.country);
  }
});

test('자격증: C급은 바로 따고, B급은 C급 뒤 2년(프로 출신은 바로), A급은 한 시즌 강습이다', async () => {
  const { courseStatus, enroll, finishCourses } = await import('../src/game/hiring.ts');
  const g = createGame(3, '자격', 'sales');
  assert.equal(g.manager.license, 0);
  assert.ok(courseStatus(g).ok);
  enroll(g);
  assert.equal(g.manager.license, 1, 'C급은 비시즌에 끝난다');
  assert.equal(courseStatus(g).ok, false, '일반 출신은 B급까지 2년을 기다린다');
  assert.match(courseStatus(g).why, /2028년/);
  const p = createGame(3, '선수', 'pro');
  assert.ok(courseStatus(p).ok && courseStatus(p).level === 2, '프로 출신은 B급 우선 과정');
  enroll(p);
  assert.equal(p.manager.license, 2);
  p.year += 1;
  assert.ok(courseStatus(p).ok && courseStatus(p).level === 3);
  enroll(p);
  assert.equal(p.manager.license, 2, 'A급은 한 시즌 동안 듣는다');
  assert.equal(p.manager.course!.level, 3);
  p.year += 1;
  finishCourses(p);
  assert.equal(p.manager.license, 3);
  assert.equal(p.manager.course, null);
  assert.match(courseStatus(p).why, /3년/, 'P급은 A급 뒤 3년');
});

test('채용: 지원서 → 서류 → 면접(질문 3~4개) → 제안 또는 탈락', () => {
  let offers = 0;
  let fails = 0;
  for (let seed = 0; seed < 30; seed++) {
    const g = createGame(seed + 500, '지원', 'teacher');
    const i = g.hiring!.list.findIndex((v) => g.clubs[v.club]!.league === 'kr5');
    assert.ok(i >= 0, 'K5 공고가 있다');
    act(g, `v${i}`);
    assert.equal(g.hiring!.list[i]!.state, 'applied');
    act(g, 'submit');
    assert.equal(g.hiring!.step, 'review');
    const v = g.hiring!.list[i]!;
    assert.ok(v.docNotes.length > 0, '서류 점수의 내역이 있다');
    if (v.state === 'rejected') continue;
    act(g, 'next');
    let asked = 0;
    while ((g.hiring?.step as string | undefined) === 'interview') {
      asked++;
      act(g, g.scene.choices[0]!.id);
    }
    assert.ok(asked >= 3 && asked <= 4);
    if ((g.hiring!.list[i]!.state as string) === 'offer') {
      offers++;
      act(g, `take${i}`);
      assert.equal(g.phase, 'style');
      assert.equal(g.job!.club, v.club);
    } else fails++;
  }
  assert.ok(offers > 5 && fails > 0, `제안 ${offers}, 탈락 ${fails}`);
});

test('자격이 모자라면 지원할 수 없다. 독일은 강습 등록을 조건으로 한 단계 아래도 받아 주고, 한국은 받지 않는다', async () => {
  const { eligibility } = await import('../src/game/hiring.ts');
  const g = createGame(9, '조건', 'pro');
  g.manager.license = 2;
  g.manager.licensed = [0, 2020, 2020, 0, 0];
  const club = (league: string) => g.clubs[g.leagues[league]![0]!]!;
  assert.equal(eligibility(g, club('kr5')).ok, true);
  assert.equal(eligibility(g, club('kr3')).ok, false, 'K3는 A급(게임 규칙)');
  const de = eligibility(g, club('ger4'));
  assert.ok(de.ok && de.provisional, '레기오날리가는 A급, B급이면 강습 등록 조건');
  assert.equal(eligibility(g, club('ger3')).ok, false, '두 단계 아래는 안 된다');
  assert.equal(eligibility(g, club('esp4')).ok, false, '스페인 4부는 UEFA Pro');
  g.manager.license = 4;
  g.manager.rep = 20;
  assert.match(eligibility(g, club('eng1')).why, /워크퍼밋/, '잉글랜드는 외국인 감독 워크퍼밋');
});

test('승격으로 요구 자격이 오르면: 일본은 강습을 들으며 한 시즌 지휘하고, 한국은 물러난다', async () => {
  const { reviewJob } = await import('../src/game/career.ts');
  const jp = createGame(11, '일본', 'pro', 'jpn3');
  act(jp, 'take0');
  jp.manager.license = 3;
  jp.manager.licensed = [0, 2015, 2016, 2020, 0];
  jp.manager.rep = 40;
  jp.clubs[jp.job!.club]!.league = 'jpn2';
  const a = reviewJob(jp, []);
  assert.ok(a.stay, a.note);
  assert.equal(jp.manager.course?.level, 4, 'P급 강습에 등록된다');
  const kr = createGame(11, '한국', 'pro', 'kr3');
  act(kr, 'take0');
  kr.manager.license = 3;
  kr.manager.licensed = [0, 2015, 2016, 2020, 0];
  kr.manager.rep = 40;
  kr.clubs[kr.job!.club]!.league = 'kr2';
  const b = reviewJob(kr, []);
  assert.equal(b.stay, false);
  assert.equal(kr.job, null);
});

test('외국인 규정은 나라마다 다르다: 스페인은 비EU, 일본은 제휴국 면제, 독일은 한도 없음', async () => {
  const { isForeign, quota } = await import('../src/game/contract.ts');
  const run = (start: string) => {
    const g = createGame(21, '쿼터', 'pro', start);
    act(g, 'take0');
    return g;
  };
  const es = run('esp1');
  const p = es.squad[0]!;
  assert.equal(quota(es).reg, 3);
  for (const [nat, counted] of [['브라질', true], ['프랑스', false], ['세네갈', false], ['스페인', false], ['잉글랜드', true]] as const) {
    p.nat = nat;
    assert.equal(isForeign(es, p), counted, `${nat}`);
  }
  const jp = run('jpn1');
  assert.equal(quota(jp).pitch, 5);
  p.nat = '태국';
  assert.equal(isForeign(jp, p), false, '태국은 J리그 제휴국');
  p.nat = '브라질';
  assert.equal(isForeign(jp, p), true);
  const de = run('ger1');
  assert.equal(quota(de).reg, null);
  assert.equal(quota(de).pitch, null);
});

test('이전 버전(7)의 저장: 잉글랜드 리그 이름이 바뀌고 새 나라 리그가 생기며, 맡은 리그의 자격은 가진 것으로 본다', async () => {
  const { migrate } = await import('../src/game/career.ts');
  const g = toEngland(4040);
  const old = JSON.parse(JSON.stringify(g)) as Game;
  old.version = 7;
  const keep = ['kr1', 'kr2', 'kr3', 'kr4', 'kr5', 'eng1', 'eng2', 'intl'];
  for (const rec of [old.leagues, old.tables, old.fixtures] as Record<string, unknown>[]) {
    for (const k of Object.keys(rec)) if (!keep.includes(k)) delete rec[k];
    rec.eu1 = rec.eng1;
    rec.eu2 = rec.eng2;
    delete rec.eng1;
    delete rec.eng2;
  }
  for (const c of old.clubs) if (c.league === 'eng1') c.league = 'eu1'; else if (c.league === 'eng2') c.league = 'eu2';
  for (const k of ['license', 'licensed', 'course', 'idle', 'countries']) delete (old.manager as unknown as Record<string, unknown>)[k];
  delete (old as unknown as Record<string, unknown>).hiring;
  assert.ok(migrate(old));
  assert.equal(old.version, 8);
  assert.equal(old.clubs[old.job!.club]!.league, 'eng1');
  for (const id of CLUB_LEAGUES) assert.ok(old.leagues[id]!.length > 0, `${id}가 생긴다`);
  assert.equal(old.manager.license, 4, '프리미어리그 감독은 Pro를 가진 것으로 본다');
  assert.ok(old.window && old.window.list.length > 0);
  act(old, 'done');
  assert.ok(old.phase === 'half1' || old.phase === 'match');
});

test('이적시장 화면: 탭으로 나눈 선수 카드에서 바로 협상, 판매로 간다. 협상 화면은 요구와 제안을 나란히 보여 준다', () => {
  const g = toMarket(9191);
  const market = g.scene.blocks.find((b) => b.kind === 'market') as Extract<Game['scene']['blocks'][number], { kind: 'market' }>;
  assert.ok(market, '시장 첫 화면에 카드 묶음이 있다');
  assert.deepEqual(market.tabs.map((t) => t.id).filter((id) => id !== 'bids'), ['sign', 'loan', 'renew', 'mine']);
  const mine = market.tabs.find((t) => t.id === 'mine')!;
  assert.equal(mine.cards.length, g.squad.length + g.reserves.length + g.loaned.length);
  // 카드의 버튼은 숨은 선택지로 들어 있어 act가 받아 준다.
  const first = market.tabs.find((t) => t.id === 'sign')!.cards[0]!;
  assert.ok(g.scene.choices.some((c) => c.id === first.act && c.hidden));
  act(g, first.act!);
  const deal = g.scene.blocks.find((b) => b.kind === 'deal') as Extract<Game['scene']['blocks'][number], { kind: 'deal' }>;
  assert.ok(deal && deal.rows.length >= 1 && deal.odds !== null);
  assert.equal(deal.rows[0]!.label, '이적료');
  act(g, 'back');
  const p = g.reserves[0]!;
  act(g, `sale:${p.id}`);
  assert.equal(g.window!.view, `sale:${p.id}`, '내 선수 카드에서 바로 판매 화면');
  act(g, 'back');
  assert.equal(g.window!.view, null, '판매 화면에서 돌아오면 시장 첫 화면');
});

test('실시간 경기 교체: 고른 선수가 실제로 경기장에 들어가고, 나간 선수는 다시 못 들어오며, 개인 기록이 쌓인다', async () => {
  const { benchPlayers } = await import('../src/game/match.ts');
  const { g, liveTick, liveCommand } = await liveGame(4545);
  for (let i = 0; i < 300; i++) liveTick(g);
  const L = g.match!.live!;
  const bench = benchPlayers(g, L);
  assert.ok(bench.length > 0, '벤치에 후보가 있다');
  const r = bench[0]!;
  const at = L.teams[0].players.findIndex((p) => !p.off && p.line !== 'GK');
  const out = L.teams[0].players[at]!.name;
  const subs = g.match!.subs;
  liveCommand(g, `swap:${at}:${r.id}`);
  assert.equal(g.match!.subs, subs - 1, '교체 카드 한 장');
  const lp = L.teams[0].players[at]!;
  assert.equal(lp.name, r.name, '들어간 선수가 그 자리에서 뛴다');
  assert.equal(lp.pid, r.id);
  assert.equal(lp.on, L.tick, '들어온 시각을 적는다(체력 표시)');
  assert.ok(!benchPlayers(g, L).some((p) => p.id === r.id), '들어간 선수는 벤치에서 빠진다');
  assert.ok((L.subbed ?? []).includes(out), '나간 선수는 다시 들어오지 못한다');
  // 같은 후보를 또 넣으려 하면 무시한다.
  liveCommand(g, `swap:${at}:${r.id}`);
  assert.equal(g.match!.subs, subs - 1);
  for (let i = 0; i < 800 && g.match!.step === 'live'; i++) {
    if (g.match!.live!.halfTimeDone && !g.match!.live!.talked) liveCommand(g, 'talk:calm');
    liveTick(g);
  }
  const shots = L.teams.flatMap((t) => t.players).reduce((s, p) => s + (p.rec?.shots ?? 0), 0);
  assert.ok(shots > 0, '슈팅이 선수 개인 기록에 쌓인다');
  assert.equal(shots, L.teams[0].shots + L.teams[1].shots, '개인 슈팅의 합이 팀 슈팅과 같다');
});
