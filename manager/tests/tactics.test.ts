import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAVE_VERSION, act, createGame, migrate } from '../src/game/career.ts';
import { STYLE_IDS } from '../src/game/data.ts';
import { SHAPE_ORDER, SLOTS, movedSlot, pairSlots, slotSpot, slotsOf } from '../src/game/live.ts';
import type { Slot } from '../src/game/live.ts';
import { manage, planDials, planRole } from '../src/game/manage.ts';
import { TACTIC_GAIN, actingSpot, applyPlan, benchPlayers, liveCommand, liveTick, outlook } from '../src/game/match.ts';
import { customSlots, formationOf, lineupLocked, linesOf, spotAt } from '../src/game/squad.ts';
import { COMBOS, DIALS, NEUTRAL, PHASES, ROLES, SHAPES, SHAPE_IDS, attackVs, comboEdge, comboState, dialEdge, fits, flankEdge, presetDials, roleEdge, roleFits, roleName, shiftCost, tempoCost } from '../src/game/tactics.ts';
import type { RoleInput } from '../src/game/tactics.ts';
import type { Dials, Game, LivePlayer, Pos, RoleId, ShapeId, Spot } from '../src/game/types.ts';

type Match = NonNullable<Game['match']>;
type Live = NonNullable<Match['live']>;

/** 막히지 않은 첫 선택지. 구직 화면에서는 들어온 제안을 받고, 이적시장은 바로 마감한다(career.test.ts의 firstChoice를 줄인 것). */
function firstChoice(g: Game): string {
  if (g.phase === 'market' || g.phase === 'winter') return g.window?.view ? 'back' : 'done';
  const open = g.scene.choices.filter((c) => !c.disabled);
  return (open.find((c) => c.id.startsWith('take')) ?? open[0]!).id;
}

/** 다음 직접 지휘 경기의 대형 선택 화면까지 간다. */
function toMatch(g: Game): Game {
  while (g.phase !== 'match') act(g, firstChoice(g));
  assert.equal(g.match!.step, 'shape');
  return g;
}

const newGame = (seed: number): Game => toMatch(createGame(seed, '전술', 'analyst', 'kr5'));

/** 구단 대형과 경기 대형을 같은 것으로 맞추고 실시간 경기를 시작한다. */
function liveGame(seed: number, shape: ShapeId = '433'): { g: Game; m: Match; L: Live; P: LivePlayer[] } {
  const g = newGame(seed);
  manage(g, `formation:${shape}`);
  act(g, shape);
  act(g, g.season.style);
  act(g, 'live');
  const m = g.match!;
  assert.equal(m.step, 'live');
  const L = m.live!;
  return { g, m, L, P: L.teams[0].players };
}

/** 경기장의 우리 선수가 지금 선 자리(좌표와 줄). */
const slotAt = (m: Match, L: Live, lp: LivePlayer): Slot => slotsOf(L, 0, m.me.shape)[lp.slot]!;

/** 그 세부 자리에 선 우리 선수들의 경기장 번호. */
const indexesAt = (m: Match, L: Live, spot: Spot): number[] =>
  L.teams[0].players.flatMap((p, i) => (!p.off && actingSpot(m, L, p) === spot ? [i] : []));

/** 남은 역할이 모두 지금 뛰는 선수의 것이고 그 선수가 선 자리에서 맡을 수 있는 역할인지 확인한다. */
function assertRolesFit(m: Match, L: Live, note: string): void {
  for (const [pid, role] of Object.entries(m.roles)) {
    const lp = L.teams[0].players.find((p) => p.pid === Number(pid) && !p.off);
    assert.ok(lp, `${note}: 경기장에 없는 선수(${pid})의 역할이 남았다`);
    assert.ok(roleFits(actingSpot(m, L, lp), role), `${note}: ${actingSpot(m, L, lp)} 자리에 ${role} 역할이 남았다`);
  }
}

// ---------- 대형 ----------

test('대형 여덟 가지: 자리표는 열한 자리에 골키퍼가 하나이고, 줄 구성이 대형 이름과 맞는다', () => {
  assert.equal(SHAPE_IDS.length, 8);
  assert.equal(new Set(SHAPE_IDS).size, 8);
  assert.deepEqual([...SHAPE_ORDER].sort(), [...SHAPE_IDS].sort(), '실시간 보정 표가 쓰는 대형 목록도 같은 여덟 가지');
  assert.deepEqual(Object.keys(SLOTS).sort(), [...SHAPE_IDS].sort());
  for (const id of SHAPE_IDS) {
    const slots = SLOTS[id];
    const count = (line: Pos): number => slots.filter((s) => s.line === line).length;
    assert.equal(slots.length, 11, id);
    assert.equal(count('GK'), 1, `${id}: 골키퍼는 하나`);
    assert.equal(slotSpot(slots[0]!), 'GK', `${id}: 0번 자리가 골키퍼`);
    assert.equal(new Set(slots.map((s) => `${s.u}:${s.v}`)).size, 11, `${id}: 자리가 겹치지 않는다`);
    // 이름이 "4-1-4-1"이면 수비 넷, 미드필더 다섯, 공격수 하나다.
    const digits = SHAPES[id].name.split('-').map(Number);
    assert.equal(digits.reduce((sum, n) => sum + n, 0), 10, `${id}: 이름의 숫자 합`);
    assert.equal(count('DF'), digits[0], `${id}: 수비수 수`);
    assert.equal(count('FW'), digits.at(-1), `${id}: 공격수 수`);
    assert.equal(count('MF'), digits.slice(1, -1).reduce((sum, n) => sum + n, 0), `${id}: 미드필더 수`);
    assert.ok(STYLE_IDS.some((style) => fits(style, id)), `${id}: 어울리는 전술이 하나는 있다`);
  }
});

test('새 대형(4-1-4-1, 4-3-1-2, 3-4-3)은 구단 관리, 경기 전 선택지, 경기 중 변경에서 모두 고를 수 있다', () => {
  const fresh = ['4141', '4312', '343'] as const;
  const g = newGame(99);
  const open = g.scene.choices.filter((c) => !c.disabled).map((c) => c.id);
  for (const id of SHAPE_IDS) assert.ok(open.includes(id), `경기 전 선택지에 ${id}`);
  for (const id of fresh) {
    manage(g, `formation:${id}`);
    assert.equal(g.formation, id);
    assert.equal(g.squad.length, 11);
    assert.deepEqual(linesOf(g), SLOTS[id].map((s) => s.line));
    assert.deepEqual(g.squad.map((_, i) => spotAt(g, i)), SLOTS[id].map(slotSpot));
  }
  act(g, '4141');
  const m = g.match!;
  assert.equal(m.me.shape, '4141');
  act(g, g.season.style);
  act(g, 'live');
  const L = m.live!;
  const P = L.teams[0].players;
  const spots = (): Spot[] => P.filter((p) => !p.off).map((p) => actingSpot(m, L, p)).sort();
  assert.equal(P.length, 11);
  assert.deepEqual(spots(), SLOTS['4141'].map(slotSpot).sort());
  for (const id of ['4312', '343'] as const) {
    const subs = m.subs;
    liveCommand(g, `shape:${id}`);
    assert.equal(m.me.shape, id);
    assert.equal(m.subs, subs - 1, '경기 중 대형 변경은 교체 카드를 한 장 쓴다');
    assert.equal(new Set(P.map((p) => p.slot)).size, 11, '자리가 겹치지 않는다');
    assert.deepEqual(spots(), SLOTS[id].map(slotSpot).sort());
    assert.equal(indexesAt(m, L, 'GK').length, 1);
  }
});

// ---------- 역할 ----------

test('역할표: 자리마다 기본 역할이 맨 앞이고, 적힌 역할은 모두 아는 역할이며, 자리에 없는 역할은 받지 않는다', () => {
  // RoleId가 늘거나 줄면 이 표가 타입 검사에서 걸린다.
  const all: Record<RoleId, true> = {
    base: true, sweeper: true, stopper: true, mark: true, libero: true, wing: true, invert: true, stay: true, hold: true, maker: true, runner: true,
    hunter: true, shadow: true, inside: true, hug: true, track: true, link: true, target: true, drift: true, poach: true, harry: true,
  };
  const spots: Spot[] = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];
  assert.deepEqual(Object.keys(ROLES).sort(), [...spots].sort());
  const seen = new Set<string>();
  for (const spot of spots) {
    const list = ROLES[spot];
    assert.ok(list.length >= 2, `${spot}: 기본 말고도 고를 역할이 있다`);
    assert.equal(list[0]!.id, 'base', `${spot}: 첫째가 기본 역할`);
    assert.equal(new Set(list.map((r) => r.id)).size, list.length, `${spot}: 같은 역할이 두 번 나오지 않는다`);
    for (const r of list) {
      assert.ok(Object.hasOwn(all, r.id), `${spot}: 모르는 역할 ${r.id}`);
      assert.ok(r.name.length > 0 && r.desc.length > 0);
      assert.ok(roleFits(spot, r.id));
      assert.equal(roleName(spot, r.id), r.name);
      seen.add(r.id);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(all).sort(), '모든 역할이 어느 자리에서든 쓰인다');
  assert.equal(roleFits('ST', 'target'), true);
  assert.equal(roleFits('CB', 'target'), false, '중앙 수비수에게 공격수 역할은 줄 수 없다');
  assert.equal(roleFits('CB', 'poach'), false);
  assert.equal(roleFits('ST', 'stopper'), false);
  assert.equal(roleFits('GK', 'sweeper'), true);
  assert.equal(roleFits('LW', 'sweeper'), false);
  assert.equal(roleFits('CB', 'nope'), false);
  assert.equal(roleFits('CB', ''), false);
});

test('역할 보정은 아무리 많이 겹쳐도 공격, 수비 각각 ±3을 넘지 않고, 역할이 없으면 0이다', () => {
  const pos: Record<Spot, Pos> = { GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', CDM: 'MF', CM: 'MF', CAM: 'MF', LM: 'MF', RM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' };
  const every: RoleInput[] = (Object.keys(ROLES) as Spot[]).flatMap((spot) =>
    ROLES[spot].filter((r) => r.id !== 'base').map((r) => ({ pos: pos[spot], role: r.id, scale: 1.5 })));
  const dials: Dials[] = [NEUTRAL, { ...NEUTRAL, line: 1, width: 1, overlap: true }, { ...NEUTRAL, line: -1, width: -1 }];
  for (const mine of STYLE_IDS) {
    for (const theirs of STYLE_IDS) {
      assert.deepEqual(roleEdge([], mine, theirs, NEUTRAL), { att: 0, def: 0, oAtt: 0 });
      for (const d of dials) {
        for (const list of [every, every.filter((r) => r.pos === 'FW'), every.filter((r) => r.pos === 'DF' || r.pos === 'GK')]) {
          const e = roleEdge(list, mine, theirs, d);
          assert.ok(Math.abs(e.att) <= 3 && Math.abs(e.def) <= 3, `${mine} 대 ${theirs}: ${e.att}, ${e.def}`);
        }
      }
    }
  }
});

// ---------- 팀 지시 ----------

test('팀 지시: 세 단계 지시 열 가지와 오버래핑이 있고, 아무 지시도 없으면 보정도 체력 소모도 그대로다', () => {
  assert.deepEqual(DIALS.map((d) => d.id).sort(), Object.keys(NEUTRAL).filter((k) => k !== 'overlap').sort());
  assert.equal(DIALS.length, 10);
  for (const d of DIALS) assert.equal(d.steps.length, 3);
  assert.equal(tempoCost(NEUTRAL), 1);
  for (const mine of STYLE_IDS) {
    assert.deepEqual(flankEdge(NEUTRAL, 9, mine), { att: 0, def: 0 }, '고루 공격하면 측면 차이는 상관없다');
    for (const theirs of STYLE_IDS) assert.deepEqual(dialEdge(NEUTRAL, mine, theirs), { att: 0, def: 0 });
  }
});

test('팀 지시의 방향: 압박은 체력을 더 쓰고 긴 공에 약하며, 긴 패스는 압박을 건너뛰고, 공격 방향은 잘하는 쪽으로 몰아야 통한다', () => {
  const hard: Dials = { ...NEUTRAL, press: 1 };
  const wait: Dials = { ...NEUTRAL, press: -1 };
  assert.ok(tempoCost(hard) > 1 && tempoCost(wait) < 1);
  assert.ok(tempoCost({ ...hard, tempo: 1 }) > tempoCost({ ...NEUTRAL, tempo: 1 }), '빠른 템포에 압박까지 얹으면 더 닳는다');
  assert.ok(dialEdge(hard, 'press', 'possess').def > 0, '달려들면 짧은 패스로 풀어 나오는 팀을 끊는다');
  assert.ok(dialEdge(hard, 'press', 'direct').def < 0, '긴 공은 압박을 건너뛴다');
  assert.ok(dialEdge(wait, 'park', 'counter').def > 0, '기다리면 역습에 단단하다');
  const long: Dials = { ...NEUTRAL, pass: 1 };
  const short: Dials = { ...NEUTRAL, pass: -1 };
  assert.ok(dialEdge(long, 'direct', 'press').att > 0, '긴 패스는 상대 압박을 건너뛴다');
  assert.ok(dialEdge(long, 'direct', 'park').att < 0, '내려앉은 수비에는 걸린다');
  assert.ok(dialEdge(short, 'possess', 'park').att > 0 && dialEdge(short, 'possess', 'press').att < 0);
  for (const flank of [-1, 1] as const) {
    const d: Dials = { ...NEUTRAL, flank };
    assert.ok(flankEdge(d, 6, 'wide').att > 0, '좋은 선수가 선 쪽으로 몰면 득이다');
    assert.ok(flankEdge(d, -6, 'wide').att < 0, '약한 쪽으로 몰면 손해다');
    assert.ok(flankEdge(d, 0, 'possess').att < 0, '양쪽이 같으면 읽히는 만큼 손해다');
    assert.ok(flankEdge(d, 100, 'possess').att < 2 && flankEdge(d, -100, 'possess').att > -2, '효과에는 한도가 있다');
  }
});

test('구단 관리의 팀 지시와 역할은 계획으로 저장되고, 다음 경기에도 그대로 들고 나간다', () => {
  const g = newGame(7);
  manage(g, 'formation:433');
  assert.deepEqual(planDials(g), NEUTRAL, '처음에는 모두 보통');
  for (const cmd of ['dial:line.1', 'dial:tempo.1', 'dial:press.-1', 'dial:pass.1', 'dial:flank.-1', 'dial:overlap.1', 'dial:width.1', 'dial:width.0']) {
    assert.deepEqual(manage(g, cmd), { msg: null, go: false }, cmd);
  }
  const want: Dials = { ...NEUTRAL, line: 1, tempo: 1, overlap: true, press: -1, pass: 1, flank: -1 };
  assert.deepEqual(g.plan!.dials, want);
  assert.deepEqual(planDials(g), want);
  const at = (spot: Spot): number => g.squad.findIndex((_, i) => spotAt(g, i) === spot);
  const [gk, cb, st] = [at('GK'), at('CB'), at('ST')];
  const idOf = (i: number): number => g.squad[i]!.id;
  manage(g, `role:${idOf(gk)}.sweeper`);
  manage(g, `role:${idOf(cb)}.stopper`);
  manage(g, `role:${idOf(st)}.poach`);
  assert.deepEqual(g.plan!.roles, { [idOf(gk)]: 'sweeper', [idOf(cb)]: 'stopper', [idOf(st)]: 'poach' });
  assert.equal(planRole(g, cb), 'stopper');
  manage(g, `role:${idOf(cb)}.base`);
  assert.equal(idOf(cb) in g.plan!.roles, false, '기본 역할로 돌리면 계획에서 빠진다');
  assert.equal(planRole(g, cb), 'base');
  manage(g, `role:${idOf(cb)}.libero`);
  const roles = { [idOf(gk)]: 'sweeper', [idOf(cb)]: 'libero', [idOf(st)]: 'poach' };
  assert.deepEqual(g.plan!.roles, roles);
  assert.equal(g.match!.step, 'shape', '구단 관리 명령은 경기를 진행시키지 않는다');
  const loaded = JSON.parse(JSON.stringify(g)) as Game;
  assert.deepEqual(loaded.plan, g.plan, '저장을 거쳐도 계획이 남는다');

  // 이번 경기는 수석 코치에게 맡긴다. 그래도 계획대로 나간다.
  act(g, 'auto');
  assert.equal(g.match!.step, 'done');
  assert.deepEqual(g.match!.dials, want);
  assert.deepEqual(g.match!.roles, roles);
  act(g, 'next');

  // 다음 경기: 계획이 그대로 경기에 실린다. 그 사이 선발이 바뀌었으면 지금 선 자리에 맞는 역할만 실린다.
  toMatch(g);
  const m = g.match!;
  assert.deepEqual(g.plan, { dials: want, roles }, '경기가 끝나도 계획은 남는다');
  const carried = (): Record<number, string> => Object.fromEntries(Object.entries(roles).filter(([pid, role]) => {
    const i = g.squad.findIndex((p) => p.id === Number(pid));
    return i >= 0 && roleFits(spotAt(g, i), role);
  }));
  assert.deepEqual(m.dials, want);
  assert.deepEqual(m.roles, carried());
  assert.ok(Object.keys(m.roles).length > 0, '역할이 하나는 실렸다');

  // 킥오프 전에 계획을 고치면 그 경기부터 반영된다.
  manage(g, 'dial:tempo.-1');
  act(g, formationOf(g));
  act(g, g.season.style);
  act(g, 'live');
  assert.deepEqual(m.dials, { ...want, tempo: -1 });
  assert.deepEqual(m.roles, carried());
  assertRolesFit(m, m.live!, '킥오프');

  // 경기 중 지시는 그 경기에만 쓰이고 계획을 바꾸지 않는다.
  liveCommand(g, 'line:-1');
  assert.equal(m.dials.line, -1);
  assert.equal(g.plan!.dials.line, 1);
  applyPlan(g, m);
  assert.deepEqual(m.dials, g.plan!.dials, 'applyPlan은 계획을 경기에 다시 싣는다');
  assert.notEqual(m.dials, g.plan!.dials, '경기는 계획의 사본을 쓴다');
});

test('팀 지시 되돌리기는 지시만 보통으로 돌리고 역할은 남긴다', () => {
  const g = newGame(7);
  manage(g, 'dial:press.1');
  manage(g, 'dial:overlap.1');
  const gk = g.squad[g.squad.findIndex((_, i) => spotAt(g, i) === 'GK')]!.id;
  manage(g, `role:${gk}.sweeper`);
  const r = manage(g, 'dial:reset');
  assert.equal(typeof r.msg, 'string');
  assert.equal(r.go, false);
  assert.deepEqual(g.plan, { dials: NEUTRAL, roles: { [gk]: 'sweeper' } });
});

test('구단 관리: 잘못된 팀 지시와 역할 입력은 받지 않고 계획이 그대로다', () => {
  const g = newGame(7);
  manage(g, 'formation:442');
  const cb = g.squad[g.squad.findIndex((_, i) => spotAt(g, i) === 'CB')]!.id;
  manage(g, 'dial:line.1');
  manage(g, 'dial:overlap.1');
  manage(g, `role:${cb}.stopper`);
  const before = JSON.stringify(g.plan);
  assert.equal(before, JSON.stringify({ dials: { ...NEUTRAL, line: 1, overlap: true }, roles: { [cb]: 'stopper' } }));
  const bad = [
    'dial:bogus.1', 'dial:press.2', 'dial:press.-2', 'dial:press.x', 'dial:press.', 'dial:press', 'dial:.1', 'dial:',
    `role:${cb}.poach`, `role:${cb}.shadow`, `role:${cb}.nope`, `role:${cb}.`, `role:${cb}`,
    'role:99999.stopper', `role:${g.reserves[0]!.id}.stopper`, 'role:.stopper', 'role:',
  ];
  for (const cmd of bad) {
    assert.deepEqual(manage(g, cmd), { msg: null, go: false }, cmd);
    assert.equal(JSON.stringify(g.plan), before, cmd);
  }
});

// ---------- 킥오프 전 잠금 해제 ----------

test('킥오프 전(대형, 전술, 지휘 방식 선택)에는 선발과 계획을 고칠 수 있고, 경기가 시작되면 잠긴다', () => {
  const g = newGame(31);
  const others = SHAPE_IDS.filter((id) => id !== formationOf(g));
  const m = g.match!;
  const change = (shape: ShapeId, step: string): void => {
    assert.equal(m.step, step);
    assert.equal(lineupLocked(g), false, `${step}: 아직 잠기지 않았다`);
    manage(g, `formation:${shape}`);
    assert.equal(g.formation, shape, `${step}: 대형을 바꿀 수 있다`);
    assert.deepEqual(linesOf(g), SLOTS[shape].map((s) => s.line));
    assert.equal(m.step, step, '구단 관리 명령은 경기를 진행시키지 않는다');
  };
  change(others[0]!, 'shape');
  act(g, others[0]!);
  change(others[1]!, 'plan');
  act(g, g.season.style);
  change(others[2]!, 'mode');
  // 선발 교체, 자유 배치, 자동 배치, 팀 지시도 킥오프 전에는 된다.
  const out = g.squad[10]!.id;
  manage(g, 'bench:10');
  assert.notEqual(g.squad[10]!.id, out, '선발을 후보로 내릴 수 있다');
  assert.notEqual(manage(g, 'auto').msg, '경기 중에는 바꿀 수 없다.');
  manage(g, 'move:6.50.30');
  assert.equal(customSlots(g)?.[others[2]!]?.[6]?.u, 50, '자유 배치도 된다');
  manage(g, 'reset');
  assert.equal(customSlots(g)?.[others[2]!], undefined);
  manage(g, 'dial:press.1');
  assert.equal(g.plan!.dials.press, 1);

  // 같은 상태에서 두 방식으로 시작해 본다: 보면서 지휘, 빠르게 진행.
  for (const mode of ['live', 'text'] as const) {
    const s = JSON.parse(JSON.stringify(g)) as Game;
    act(s, mode);
    assert.equal(s.match!.step, mode === 'live' ? 'live' : 'm30');
    assert.equal(lineupLocked(s), true, `${mode}: 시작하면 잠긴다`);
    const before = JSON.stringify([s.formation, s.squad, s.reserves, s.tweaks ?? null, s.plan]);
    const gk = s.squad[0]!.id;
    for (const cmd of [`formation:${others[3]}`, 'bench:10', 'move:6.50.30', 'reset', 'dial:press.-1', 'dial:reset', `role:${gk}.sweeper`]) {
      assert.equal(manage(s, cmd).msg, null, `${mode}: ${cmd}`);
      assert.equal(JSON.stringify([s.formation, s.squad, s.reserves, s.tweaks ?? null, s.plan]), before, `${mode}: ${cmd}은 경기 중에 받지 않는다`);
    }
    assert.equal(manage(s, 'auto').msg, '경기 중에는 바꿀 수 없다.');
    assert.equal(JSON.stringify([s.formation, s.squad, s.reserves, s.tweaks ?? null, s.plan]), before);
  }
});

// ---------- 실시간 경기: 자리 옮기기 ----------

test('실시간 경기: 선수 자리를 조금 옮기면 혼선이 없고, 줄이 바뀌게 크게 옮기면 혼선이 생긴다', () => {
  const { g, m, L, P } = liveGame(99);
  const table = JSON.stringify(SLOTS);
  const i = indexesAt(m, L, 'CM')[0]!;
  const lp = P[i]!;
  const base = { ...slotAt(m, L, lp) };
  assert.equal(m.confusion, 0);
  liveCommand(g, `move:${i}:${base.u + 3}:${base.v + 2}`);
  assert.deepEqual([slotAt(m, L, lp).u, slotAt(m, L, lp).v, slotAt(m, L, lp).line], [base.u + 3, base.v + 2, 'MF']);
  assert.equal(m.confusion, 0, '조금 옮긴 것은 혼선이 없다');
  assert.equal(L.confusedUntil, 0);
  liveCommand(g, `move:${i}:${base.u + 3.2}:${base.v + 2}`);
  assert.equal(slotAt(m, L, lp).u, base.u + 3, '거의 같은 자리면 그대로 둔다');

  liveCommand(g, `move:${i}:70:${base.v}`);
  assert.equal(slotAt(m, L, lp).line, 'FW');
  assert.ok((['ST', 'LW', 'RW'] as Spot[]).includes(actingSpot(m, L, lp)));
  assert.equal(m.confusion, 1, '줄이 바뀌면 혼선이 생긴다');
  assert.ok(L.confusedUntil > L.tick);
  assert.equal(JSON.stringify(SLOTS), table, '대형의 기본 자리표는 건드리지 않는다');
  assert.equal(new Set(P.map((p) => p.slot)).size, 11);
});

test('실시간 경기: 자리는 경기장 안쪽 한도까지만 옮겨지고, 골키퍼와 잘못된 입력은 받지 않는다', () => {
  const { g, m, L, P } = liveGame(99);
  const i = indexesAt(m, L, 'CM')[0]!;
  const lp = P[i]!;
  for (const [u, v] of [[999, -50], [-999, 500], [40, 34]] as const) {
    const prev = { ...slotAt(m, L, lp) };
    liveCommand(g, `move:${i}:${u}:${v}`);
    const now = slotAt(m, L, lp);
    assert.deepEqual(now, movedSlot(prev, u, v, false), '경기 전 자유 배치와 같은 규칙으로 정해진다');
    assert.ok(now.u > 5 && now.u < 80 && now.v > 0 && now.v < 68, `경기장 안: ${now.u}, ${now.v}`);
    assert.notEqual(now.line, 'GK', '필드 선수는 골키퍼 자리에 설 수 없다');
  }
  const keeper = indexesAt(m, L, 'GK')[0]!;
  assert.equal(keeper, 0);
  const before = JSON.stringify([L.custom, P.map((p) => [p.slot, p.ovr]), m.roles, L.confusedUntil]);
  for (const cmd of [`move:${keeper}:40:34`, `move:${i}`, `move:${i}:40`, `move:${i}:abc:30`, `move:${i}:40:`, 'move:99:40:30', 'move::40:30', 'move:']) {
    liveCommand(g, cmd);
    assert.equal(JSON.stringify([L.custom, P.map((p) => [p.slot, p.ovr]), m.roles, L.confusedUntil]), before, cmd);
  }
  assert.deepEqual(slotAt(m, L, P[keeper]!), SLOTS['433'][0], '골키퍼 자리는 옮기지 않는다');
});

test('실시간 경기: 자리 되돌리기는 대형의 기본 자리와 그 자리의 OVR로 돌려놓는다', () => {
  const { g, m, L, P } = liveGame(99);
  liveCommand(g, 'move:reset');
  assert.equal(m.confusion, 0, '옮긴 자리가 없으면 아무 일도 없다');
  const ovr = P.map((p) => p.ovr);
  const [a, b] = indexesAt(m, L, 'CM') as [number, number];
  liveCommand(g, `move:${a}:20:34`); // 미드필더를 수비 줄로
  liveCommand(g, `move:${b}:72:30`); // 미드필더를 공격 줄로
  assert.deepEqual([slotAt(m, L, P[a]!).line, slotAt(m, L, P[b]!).line], ['DF', 'FW']);
  assert.ok(L.custom?.['433']);
  liveCommand(g, 'move:reset');
  assert.equal(L.custom?.['433'], undefined);
  assert.deepEqual(slotsOf(L, 0, '433'), SLOTS['433']);
  assert.deepEqual(P.map((p) => p.ovr), ovr, '자리의 OVR도 처음으로 돌아온다');
  assert.equal(m.confusion, 1);
});

test('실시간 경기: 경기 전에 옮겨 둔 자리에서 시작하고, 되돌리기는 그 배치로 돌아간다', () => {
  const g = newGame(99);
  manage(g, 'formation:4141');
  const i = g.squad.findIndex((_, k) => spotAt(g, k) === 'CM');
  manage(g, `move:${i}.50.30`); // 킥오프 전 자유 배치
  const mine = { ...customSlots(g)!['4141']![i]! };
  assert.deepEqual([mine.u, mine.v], [50, 30]);
  act(g, '4141');
  act(g, g.season.style);
  act(g, 'live');
  const m = g.match!;
  const L = m.live!;
  const at = L.teams[0].players.findIndex((p) => p.pid === g.squad[i]!.id);
  const lp = L.teams[0].players[at]!;
  assert.deepEqual(slotAt(m, L, lp), mine, '감독이 세운 자리에서 시작한다');
  liveCommand(g, `move:${at}:60:20`);
  assert.deepEqual([slotAt(m, L, lp).u, slotAt(m, L, lp).v], [60, 20]);
  assert.deepEqual(customSlots(g)!['4141']![i], mine, '경기 중에 옮긴 자리는 저장된 배치를 바꾸지 않는다');
  liveCommand(g, 'move:reset');
  assert.deepEqual(slotAt(m, L, lp), mine);
});

test('실시간 경기: 두 선수의 자리를 맞바꾸면 자리와 OVR이 바뀌고, 골키퍼와 잘못된 입력은 받지 않는다', () => {
  const { g, m, L, P } = liveGame(99, '4312');
  const cb = indexesAt(m, L, 'CB')[0]!;
  const st = indexesAt(m, L, 'ST')[0]!;
  const [x, y] = [P[cb]!, P[st]!];
  const [sx, sy, ox, oy] = [x.slot, y.slot, x.ovr, y.ovr];
  liveCommand(g, `trade:${cb}:${st}`);
  assert.deepEqual([x.slot, y.slot], [sy, sx]);
  assert.deepEqual([actingSpot(m, L, x), actingSpot(m, L, y)], ['ST', 'CB']);
  assert.ok(x.ovr < ox && y.ovr < oy, '자기 포지션에서 두 줄 떨어지면 OVR이 깎인다');
  assert.equal(m.confusion, 1, '자리를 맞바꾸면 잠깐 흐트러진다');
  assert.ok(L.confusedUntil > L.tick);
  assert.equal(new Set(P.map((p) => p.slot)).size, 11);
  liveCommand(g, `trade:${st}:${cb}`);
  assert.deepEqual([x.slot, y.slot, x.ovr, y.ovr], [sx, sy, ox, oy], '다시 맞바꾸면 원래대로');

  const before = JSON.stringify([P.map((p) => [p.slot, p.ovr]), L.custom ?? null, L.confusedUntil]);
  for (const cmd of [`trade:0:${cb}`, `trade:${cb}:0`, `trade:${cb}:${cb}`, `trade:${cb}:`, `trade::${cb}`, `trade:99:${cb}`, `trade:${cb}:x`, 'trade:']) {
    liveCommand(g, cmd);
    assert.equal(JSON.stringify([P.map((p) => [p.slot, p.ovr]), L.custom ?? null, L.confusedUntil]), before, cmd);
  }
  assert.equal(actingSpot(m, L, P[0]!), 'GK', '골키퍼는 맞바꾸지 않는다');
});

// ---------- 실시간 경기: 역할 ----------

test('실시간 경기: 자리를 맞바꾸면 새 자리에 없는 역할은 지워지고, 같은 자리끼리면 남는다', () => {
  const { g, m, L, P } = liveGame(99, '4312');
  const cb = indexesAt(m, L, 'CB')[0]!;
  const st = indexesAt(m, L, 'ST')[0]!;
  const [c1, c2] = indexesAt(m, L, 'CM') as [number, number];
  const pid = (i: number): number => P[i]!.pid!;
  liveCommand(g, `role:${pid(cb)}:stopper`);
  liveCommand(g, `role:${pid(st)}:poach`);
  liveCommand(g, `role:${pid(c1)}:runner`);
  assert.deepEqual(m.roles, { [pid(cb)]: 'stopper', [pid(st)]: 'poach', [pid(c1)]: 'runner' });
  liveCommand(g, `trade:${c1}:${c2}`);
  assert.equal(m.roles[pid(c1)], 'runner', '같은 중앙 미드필더 자리끼리 바꾸면 역할이 남는다');
  liveCommand(g, `trade:${cb}:${st}`);
  assert.deepEqual(m.roles, { [pid(c1)]: 'runner' }, '수비수가 된 공격수의 포처, 공격수가 된 수비수의 전진 수비는 지워진다');
  // 자리를 옮겨 세부 자리가 바뀌어도 마찬가지다: 중앙 미드필더를 최전방으로 올리면 침투(미드필더 역할)가 지워진다.
  liveCommand(g, `move:${c1}:72:34`);
  assert.equal(actingSpot(m, L, P[c1]!), 'ST');
  assert.deepEqual(m.roles, {});
  liveCommand(g, `role:${pid(c1)}:target`);
  assert.equal(m.roles[pid(c1)], 'target', '새 자리의 역할은 줄 수 있다');
  liveCommand(g, 'move:reset');
  assert.deepEqual(m.roles, {}, '자리를 되돌리면 그 역할도 지워진다');
});

test('실시간 경기: 대형을 바꾸면 새 자리에 맞지 않는 역할은 지워진다', () => {
  const { g, m, L, P } = liveGame(99, '4312');
  const pid = (i: number): number => P[i]!.pid!;
  const strikers = indexesAt(m, L, 'ST');
  assert.equal(strikers.length, 2);
  for (const i of strikers) liveCommand(g, `role:${pid(i)}:poach`);
  liveCommand(g, `role:${pid(indexesAt(m, L, 'CAM')[0]!)}:shadow`);
  liveCommand(g, `role:${pid(indexesAt(m, L, 'GK')[0]!)}:sweeper`);
  assert.equal(Object.keys(m.roles).length, 4);
  liveCommand(g, 'shape:541'); // 원톱, 공격형 미드필더 없음
  assert.equal(m.me.shape, '541');
  assertRolesFit(m, L, '5-4-1로 바꾼 뒤');
  assert.equal(m.roles[pid(0)], 'sweeper', '자리가 그대로인 골키퍼의 역할은 남는다');
  const left = Object.values(m.roles);
  assert.ok(!left.includes('shadow'), '공격형 미드필더 자리가 없어졌다');
  assert.ok(left.filter((r) => r === 'poach').length <= 1, '최전방은 한 자리뿐이다');
  assert.ok(left.length <= 2);
});

test('실시간 경기: 교체로 나간 선수의 역할은 지워지고, 들어온 선수에게도 그 자리의 역할을 줄 수 있다', () => {
  const { g, m, L, P } = liveGame(99, '4312');
  const cam = indexesAt(m, L, 'CAM')[0]!;
  const out = P[cam]!.pid!;
  liveCommand(g, `role:${out}:shadow`);
  assert.equal(m.roles[out], 'shadow');
  const r = benchPlayers(g, L).find((p) => p.pos !== 'GK')!;
  liveCommand(g, `role:${r.id}:shadow`);
  assert.equal(r.id in m.roles, false, '벤치에 앉은 선수에게는 역할을 줄 수 없다');
  liveCommand(g, `swap:${cam}:${r.id}`);
  assert.equal(P[cam]!.pid, r.id);
  assert.equal(m.subs, 2);
  assert.deepEqual(m.roles, {}, '나간 선수의 역할은 지워진다');
  liveCommand(g, `role:${r.id}:target`);
  assert.deepEqual(m.roles, {}, '들어온 선수도 선 자리에 없는 역할은 못 맡는다');
  liveCommand(g, `role:${r.id}:shadow`);
  assert.deepEqual(m.roles, { [r.id]: 'shadow' });
  liveCommand(g, `role:${out}:maker`);
  assert.deepEqual(m.roles, { [r.id]: 'shadow' }, '나간 선수에게는 역할을 줄 수 없다');
  liveCommand(g, `role:${r.id}:base`);
  assert.deepEqual(m.roles, {}, '기본 역할로 돌리면 지워진다');
});

test('실시간 경기: 구단 대형과 다른 대형으로 나가면 그 대형에 없는 자리의 계획 역할은 빠진다', () => {
  const g = newGame(7);
  manage(g, 'formation:433');
  const at = (spot: Spot): number => g.squad[g.squad.findIndex((_, i) => spotAt(g, i) === spot)]!.id;
  const [lw, cdm] = [at('LW'), at('CDM')];
  manage(g, `role:${lw}.inside`);
  manage(g, `role:${cdm}.hold`);
  act(g, '4312'); // 윙어 자리가 없다
  act(g, g.season.style);
  act(g, 'live');
  const m = g.match!;
  assertRolesFit(m, m.live!, '킥오프');
  assert.equal(lw in m.roles, false, '윙어 자리가 없으니 안으로 좁히는 역할도 없다');
  assert.deepEqual(g.plan!.roles, { [lw]: 'inside', [cdm]: 'hold' }, '계획은 그대로 남는다');
});

// ---------- 실시간 경기: 팀 지시 ----------

test('실시간 경기: 압박, 패스, 공격 방향 지시가 상태에 반영되고, 같은 지시를 다시 내리면 혼선이 늘지 않는다', () => {
  const { g, m, L } = liveGame(99);
  assert.deepEqual(m.dials, NEUTRAL);
  liveCommand(g, 'press:1');
  assert.equal(m.dials.press, 1);
  assert.equal(m.confusion, 1, '지시를 바꾸면 잠깐 흐트러진다');
  const until = L.confusedUntil;
  for (let k = 0; k < 5; k++) liveTick(g);
  assert.ok(L.tick > 0);
  liveCommand(g, 'press:1');
  assert.equal(L.confusedUntil, until, '이미 내린 지시는 다시 내려도 그대로다');
  liveCommand(g, 'pass:-1');
  liveCommand(g, 'flank:1');
  assert.deepEqual(m.dials, { ...NEUTRAL, press: 1, pass: -1, flank: 1 });
  assert.ok(L.confusedUntil > until);
  liveCommand(g, 'press:0');
  liveCommand(g, 'pass:0');
  liveCommand(g, 'flank:0');
  assert.deepEqual(m.dials, NEUTRAL);
});

test('실시간 경기: 잘못된 역할과 대형, 모르는 지시는 받지 않고 상태가 그대로다', () => {
  const { g, m, L, P } = liveGame(99);
  const cb = P[indexesAt(m, L, 'CB')[0]!]!.pid!;
  liveCommand(g, 'press:1');
  liveCommand(g, `role:${cb}:stopper`);
  const snap = (): string => JSON.stringify([m.dials, m.roles, m.subs, m.me, m.confusion, L.confusedUntil, L.custom ?? null, P.map((p) => [p.slot, p.pid, p.ovr])]);
  const before = snap();
  const bad = [
    `role:${cb}:poach`, `role:${cb}:shadow`, `role:${cb}:nope`, `role:${cb}:`, `role:${cb}`, 'role:99999:stopper', 'role::stopper', 'role:',
    `role:${benchPlayers(g, L)[0]!.id}:stopper`, 'shape:999', 'shape:', `shape:${m.me.shape}`, 'style:nope', `style:${m.me.style}`, 'swap:1:99999', 'swap:99:1',
    'bogus:1', 'dial:press.-1', '',
  ];
  for (const cmd of bad) {
    liveCommand(g, cmd);
    assert.equal(snap(), before, cmd);
  }
});

test('잘못된 값의 팀 지시는 받지 않고 상태가 그대로다', () => {
  const { g, m } = liveGame(99);
  liveCommand(g, 'press:1');
  liveCommand(g, 'overlap:1');
  for (const cmd of ['press:abc', 'press:', 'press:2', 'overlap:abc']) {
    liveCommand(g, cmd);
    assert.deepEqual(m.dials, { ...NEUTRAL, press: 1, overlap: true }, cmd);
  }
  const s = newGame(7);
  manage(s, 'dial:overlap.1');
  for (const cmd of ['dial:overlap.abc', 'dial:overlap.', 'dial:overlap.2']) {
    manage(s, cmd);
    assert.equal(s.plan!.dials.overlap, true, cmd);
  }
});

// ---------- 저장 ----------

test('버전 10 저장을 불러오면 버전 11이 되고, 진행 중인 경기의 팀 지시에 새 지시들이 보통으로 채워진다', () => {
  assert.equal(SAVE_VERSION, 11);
  const { g } = liveGame(31337);
  liveCommand(g, 'line:1');
  liveCommand(g, 'overlap:1');
  for (let k = 0; k < 40; k++) liveTick(g);
  const old = JSON.parse(JSON.stringify(g)) as Game;
  old.version = 10;
  delete (old as unknown as Record<string, unknown>).plan;
  for (const key of ['press', 'pass', 'flank', 'final', 'lose', 'win', 'block']) delete (old.match!.dials as unknown as Record<string, unknown>)[key];
  assert.deepEqual(old.match!.dials, { line: 1, width: 0, tempo: 0, overlap: true });
  assert.equal(migrate(old), true);
  assert.equal(old.version, SAVE_VERSION);
  assert.deepEqual(old.match!.dials, { ...NEUTRAL, line: 1, overlap: true }, '하던 지시는 남고 새 지시는 보통');
  assert.equal(old.plan, undefined, '계획은 처음 고칠 때 생긴다');
  assert.deepEqual(planDials(old), NEUTRAL);
  // 불러온 경기를 이어서 지휘할 수 있다.
  const tick = old.match!.live!.tick;
  liveCommand(old, 'press:1');
  liveCommand(old, 'flank:-1');
  assert.deepEqual(old.match!.dials, { ...NEUTRAL, line: 1, overlap: true, press: 1, flank: -1 });
  for (let k = 0; k < 40; k++) liveTick(old);
  assert.equal(old.match!.live!.tick, tick + 40);

  // 경기 밖에서 저장한 버전 10도 불러와 평소 팀 지시를 정할 수 있다.
  const idle = createGame(5, '전술', 'analyst', 'kr5');
  const saved = JSON.parse(JSON.stringify(idle)) as Game;
  saved.version = 10;
  assert.equal(migrate(saved), true);
  assert.equal(saved.version, 11);
  assert.equal(saved.match, null);
  toMatch(saved);
  manage(saved, 'dial:pass.1');
  assert.deepEqual(saved.match!.dials, NEUTRAL, '계획은 킥오프 때 경기에 실린다');
  act(saved, 'auto');
  assert.deepEqual(saved.match!.dials, { ...NEUTRAL, pass: 1 });
});

// ---------- 공 소유에 따른 지시, 조합, 맞대결 ----------
const near = (a: number, b: number, note: string): void => assert.ok(Math.abs(a - b) < 1e-9, `${note}: ${a} != ${b}`);

test('팀 지시는 공격 시, 수비 시, 전환의 세 국면으로 나뉘고, 국면마다 지시가 둘 이상 있다', () => {
  assert.deepEqual(PHASES.map((x) => x.id), ['att', 'def', 'turn']);
  for (const ph of PHASES) assert.ok(DIALS.filter((x) => x.phase === ph.id).length >= 2, `${ph.name}의 지시가 모자라다`);
  assert.ok(DIALS.every((x) => PHASES.some((ph) => ph.id === x.phase)), '국면이 없는 지시가 있다');
});

test('조합: 맞물리는 지시를 모두 맞추면 걸리고, 하나가 모자라면 그 지시를 알려 주며, 보통 지시에는 아무것도 없다', () => {
  const none = comboState(NEUTRAL, []);
  assert.deepEqual([none.on, none.near], [[], []]);
  assert.deepEqual(comboEdge(NEUTRAL, []), { att: 0, def: 0 });

  const two = comboState({ ...NEUTRAL, line: 1, press: 1 }, []);
  assert.ok(!two.on.some((c) => c.id === 'gegen'));
  const hint = two.near.find((x) => x.combo.id === 'gegen');
  assert.deepEqual(hint?.fix, { dial: 'lose', level: 1 }, '모자란 지시를 바로 누를 수 있게 알려 준다');

  const full = { ...NEUTRAL, line: 1, press: 1, lose: 1 } as Dials;
  const gegen = comboState(full, []).on.find((c) => c.id === 'gegen');
  assert.ok(gegen, '세 지시가 맞물리면 게겐프레싱이 걸린다');
  const edge = comboEdge(full, []);
  const on = comboState(full, []).on;
  near(edge.att, on.reduce((a, c) => a + c.att, 0), '조합의 공격 보정');
  near(edge.def, on.reduce((a, c) => a + c.def, 0), '조합의 수비 보정');
  assert.ok(tempoCost(full) > tempoCost({ ...NEUTRAL, line: 1, press: 1 }), '게겐프레싱은 체력을 더 쓴다');

  assert.ok(COMBOS.some((c) => !c.good), '서로 어긋나는 지시(나쁜 조합)도 있다');
  for (const c of COMBOS.filter((x) => !x.good)) assert.ok(c.att + c.def < 0, `${c.name}은 손해여야 한다`);
});

test('지시 맞대결은 가위바위보다: 보통끼리는 0이고, 긴 패스는 높은 라인과 압박을 넘기며, 짧은 패스는 압박에 걸린다', () => {
  assert.deepEqual(attackVs(NEUTRAL, NEUTRAL), { value: 0, notes: [] });
  const long = { ...NEUTRAL, pass: 1 } as Dials;
  const short = { ...NEUTRAL, pass: -1 } as Dials;
  const high = { ...NEUTRAL, line: 1 } as Dials;
  const deep = { ...NEUTRAL, line: -1 } as Dials;
  const press = { ...NEUTRAL, press: 1 } as Dials;
  assert.ok(attackVs(long, high).value > 0);
  assert.ok(attackVs(long, deep).value < 0);
  assert.ok(attackVs(long, press).value > 0);
  assert.ok(attackVs(short, press).value < 0);
  assert.ok(attackVs(short, { ...NEUTRAL, press: -1 }).value > 0);
  assert.ok(attackVs({ ...NEUTRAL, width: 1 }, { ...NEUTRAL, block: -1 }).value > 0);
  assert.ok(attackVs({ ...NEUTRAL, width: -1 }, { ...NEUTRAL, block: -1 }).value < 0);
  assert.equal(attackVs(long, high).notes.length, 1, '왜 그런지 한 줄로 말해 준다');
});

test('코치 추천: 전술마다 맞는 지시 묶음이 있고, 수준이 높은 팀은 더 촘촘히 짜서 조합까지 건다', () => {
  for (const style of STYLE_IDS) {
    const basic = presetDials(style, 0.3);
    const full = presetDials(style, 1);
    const changed = (d: Dials): number => DIALS.filter((x) => d[x.id] !== 0).length + (d.overlap ? 1 : 0);
    assert.ok(changed(basic) >= 2, `${style}: 기본 묶음이 비었다`);
    assert.ok(changed(full) > changed(basic), `${style}: 수준이 높아도 지시가 늘지 않는다`);
    assert.ok(comboState(full, []).on.every((c) => c.good), `${style}: 추천 지시에 나쁜 조합이 걸린다`);
  }
  assert.ok(comboState(presetDials('press', 1), []).on.some((c) => c.id === 'gegen'));
  assert.ok(comboState(presetDials('counter', 1), []).on.some((c) => c.id === 'lowcounter'));
  assert.ok(comboState(presetDials('possess', 1), []).on.some((c) => c.id === 'tiki'));
});

test('구단 관리의 코치 추천은 몸에 밴 전술에 맞춘 지시 묶음을 계획에 넣는다', () => {
  const g = newGame(31);
  manage(g, 'dial:preset');
  assert.deepEqual(planDials(g), presetDials(g.season.style, 1));
  manage(g, 'dial:reset');
  assert.deepEqual(planDials(g), NEUTRAL);
});

test('실시간 경기: 코치 추천과 모두 보통은 지시를 한 번에 바꾸고, 바꿀 것이 없으면 혼선도 없다', () => {
  const { g, m, L } = liveGame(99);
  liveCommand(g, 'dials:preset');
  assert.deepEqual(m.dials, presetDials(m.me.style, 1));
  const until = L.confusedUntil;
  assert.ok(until > L.tick, '한꺼번에 바꾸면 손발이 잠깐 어긋난다');
  liveCommand(g, 'dials:preset');
  assert.equal(L.confusedUntil, until);
  liveCommand(g, 'dials:reset');
  assert.deepEqual(m.dials, NEUTRAL);
  liveCommand(g, 'dials:nope');
  assert.deepEqual(m.dials, NEUTRAL);
});

// ---------- 판세 ----------
test('판세: 지시를 바꾸면 숫자가 눈에 띄게 움직이고, 미리 본 숫자는 실제로 바꾼 뒤의 숫자와 같다', () => {
  const { g, m } = liveGame(99);
  const base = outlook(g);
  const next = presetDials(m.me.style, 1);
  const seen = outlook(g, { dials: next });
  assert.ok(Math.abs(seen.atk - base.atk) + Math.abs(seen.dfn - base.dfn) >= 0.5, '코치 추천을 걸어도 판세가 거의 그대로다');
  assert.ok(seen.combos.on.length > base.combos.on.length, '미리 보기에 걸릴 조합이 들어 있다');
  assert.deepEqual(m.dials, NEUTRAL, '미리 보기는 상태를 건드리지 않는다');
  liveCommand(g, 'dials:preset');
  const after = outlook(g);
  near(after.atk, seen.atk, '공격 판세');
  near(after.dfn, seen.dfn, '수비 판세');

  // 지시 하나하나도 판세를 움직인다. 열 가지 가운데 대부분은 어느 쪽으로든 0.1 넘게 움직여야 한다.
  liveCommand(g, 'dials:reset');
  const zero = outlook(g);
  const moved = DIALS.filter((x) => ([-1, 1] as const).some((lv) => {
    const o = outlook(g, { dials: { ...NEUTRAL, [x.id]: lv } });
    return Math.abs(o.atk - zero.atk) + Math.abs(o.dfn - zero.dfn) > 0.1;
  }));
  assert.ok(moved.length >= 8, `판세를 움직이는 지시가 ${moved.length}가지뿐이다`);
});

test('판세의 이유: 걸린 조합과 지시 맞대결이 이유 목록에 이름과 함께 나온다', () => {
  const { g } = liveGame(99);
  for (const cmd of ['line:1', 'press:1', 'lose:1']) liveCommand(g, cmd);
  const o = outlook(g);
  const combo = o.parts.find((x) => x.id === 'combo');
  assert.ok(combo && combo.notes.includes('게겐프레싱'));
  assert.ok(combo.att > 0 && combo.def > 0);
  assert.ok(o.parts.some((x) => x.id === 'duel'), '지시 맞대결 항목이 있다');
});

// ---------- 수비 대형 ----------
test('공격 대형을 수비 대형으로 바꿔 설 때 자리 짝짓기는 골키퍼끼리 맞고 겹치지 않으며, 같은 대형이면 제자리다', () => {
  for (const a of SHAPE_IDS) for (const b of SHAPE_IDS) {
    const from = SLOTS[a];
    const to = SLOTS[b];
    const map = pairSlots(from, to);
    assert.deepEqual([...map].sort((x, y) => x - y), from.map((_, i) => i), `${a}→${b}: 자리가 겹치거나 빈다`);
    assert.equal(to[map[from.findIndex((x) => x.line === 'GK')]!]!.line, 'GK', `${a}→${b}: 골키퍼가 골문을 떠난다`);
    if (a === b) assert.deepEqual(map, from.map((_, i) => i));
  }
});

test('실시간 경기: 수비 대형은 교체 카드 없이 따로 둘 수 있고, 공격 대형과 같게 하면 지워진다', () => {
  const { g, m, L } = liveGame(1, '442');
  const subs = m.subs;
  const base = outlook(g);
  const seen = outlook(g, { shapeDef: '4141' });
  liveCommand(g, 'shapedef:4141');
  assert.equal(m.me.shapeDef, '4141');
  assert.equal(m.me.shape, '442', '공격 대형은 그대로다');
  assert.equal(m.subs, subs, '카드는 들지 않는다');
  assert.ok(L.confusedUntil > L.tick);
  const after = outlook(g);
  near(after.dfn, seen.dfn, '수비 대형 미리 보기');
  near(after.atk, seen.atk, '수비 대형 미리 보기(공격)');
  assert.ok(after.atk < base.atk, '두 대형을 오가면 공격 출발이 조금 늦다');
  assert.ok(L.marks?.some((x) => x.text.includes('수비 대형')), '바꾼 순간이 적힌다');

  liveCommand(g, 'shapedef:zzz');
  assert.equal(m.me.shapeDef, '4141', '모르는 대형은 받지 않는다');
  liveCommand(g, 'shapedef:442');
  assert.equal(m.me.shapeDef, undefined, '공격 대형과 같으면 따로 두지 않는다');
  near(outlook(g).dfn, base.dfn, '되돌리면 판세도 돌아온다');
  liveCommand(g, 'shapedef:352');
  liveCommand(g, 'shapedef:same');
  assert.equal(m.me.shapeDef, undefined);
});

test('수비 대형은 상대에 따라 득이 되기도 손해가 되기도 하고, 전환 지시와 겹치면 부담이 커진다', () => {
  const { g, m } = liveGame(1, '442');
  const base = outlook(g);
  const gains = SHAPE_IDS.filter((x) => x !== m.me.shape).map((x) => outlook(g, { shapeDef: x }).dfn - base.dfn);
  assert.ok(gains.some((v) => v > 0.5), '중원이 얇은 4-4-2는 수비 때 중원을 채우면 득을 본다');
  const other = liveGame(1, '433');
  const base2 = outlook(other.g);
  assert.ok(SHAPE_IDS.filter((x) => x !== '433').some((x) => outlook(other.g, { shapeDef: x }).dfn < base2.dfn - 0.5), '맞지 않는 수비 대형은 손해다');

  assert.equal(shiftCost('442', undefined), 0);
  assert.equal(shiftCost('442', '442'), 0);
  assert.ok(shiftCost('442', '541') > shiftCost('442', '4141') - 1e-9 && shiftCost('442', '4141') > 0);
  // 잃자마자 압박 + 다른 수비 대형: 자리 찾기가 늦어 수비가 더 깎인다. 바로 역습 + 다른 수비 대형: 공격 출발이 늦다.
  const plain = outlook(g, { shapeDef: '4141' });
  const lose = outlook(g, { shapeDef: '4141', dials: { ...NEUTRAL, lose: 1 } });
  const loseOnly = outlook(g, { dials: { ...NEUTRAL, lose: 1 } });
  near((lose.dfn - loseOnly.dfn) - (plain.dfn - base.dfn), -0.5 * TACTIC_GAIN, '즉시 압박과 겹친 부담');
  const win = outlook(g, { shapeDef: '4141', dials: { ...NEUTRAL, win: 1 } });
  const winOnly = outlook(g, { dials: { ...NEUTRAL, win: 1 } });
  near((win.atk - winOnly.atk) - (plain.atk - base.atk), -0.4 * TACTIC_GAIN, '바로 역습과 겹친 부담');
});

// ---------- 교체와 대형 ----------
test('실시간 경기: 교체하면서 대형을 함께 바꿔도 카드는 한 장만 들고, 모르는 대형이면 교체만 한다', () => {
  const { g, m, L, P } = liveGame(99);
  const i = P.findIndex((p) => !p.off && actingSpot(m, L, p) !== 'GK');
  const [first, second] = benchPlayers(g, L);
  assert.ok(first && second);
  const subs = m.subs;
  liveCommand(g, `swap:${i}:${first.id}:442`);
  assert.equal(m.subs, subs - 1, '카드 한 장');
  assert.equal(m.me.shape, '442');
  assert.equal(P[i]!.pid, first.id);
  assert.equal(P.filter((p) => !p.off).length, 11);
  assert.deepEqual([...new Set(P.filter((p) => !p.off).map((p) => p.slot))].length, 11, '열한 명이 서로 다른 자리에 선다');
  assertRolesFit(m, L, '교체 + 대형');
  assert.ok(L.marks?.some((x) => x.text.includes(SHAPES['442'].name)));

  const j = P.findIndex((p, k) => k !== i && !p.off && actingSpot(m, L, p) !== 'GK');
  liveCommand(g, `swap:${j}:${second.id}:zzz`);
  assert.equal(m.subs, subs - 2);
  assert.equal(m.me.shape, '442', '모르는 대형은 무시하고 교체만 한다');
  assert.equal(P[j]!.pid, second.id);
});

test('실시간 경기: 교체와 함께 바꾼 대형이 수비 대형과 같아지면 수비 대형을 따로 두지 않는다', () => {
  const { g, m, L, P } = liveGame(99);
  liveCommand(g, 'shapedef:4141');
  const i = P.findIndex((p) => !p.off && actingSpot(m, L, p) !== 'GK');
  liveCommand(g, `swap:${i}:${benchPlayers(g, L)[0]!.id}:4141`);
  assert.equal(m.me.shape, '4141');
  assert.equal(m.me.shapeDef, undefined);
});

// ---------- 바꾼 뒤 ----------
test('실시간 경기: 지시를 바꾼 순간이 그때의 기록과 함께 적히고, 잇달아 바꾼 것은 한 줄로 묶이며, 최근 넷만 남는다', () => {
  const { g, m, L } = liveGame(99);
  for (let k = 0; k < 100; k++) liveTick(g);
  assert.equal(L.marks?.length ?? 0, 0);
  liveCommand(g, 'press:1');
  liveCommand(g, 'line:1');
  assert.equal(L.marks?.length, 1, '2분 안에 바꾼 것은 한 줄이다');
  const first = L.marks![0]!;
  assert.equal(first.tick, L.tick);
  assert.ok(first.text.includes(', '), first.text);
  assert.deepEqual(first.shots, [L.teams[0].shots, L.teams[1].shots]);
  assert.deepEqual(first.score, [m.score[0], m.score[1]]);
  const cmds = ['pass:1', 'tempo:1', 'width:1', 'lose:1'];
  for (const cmd of cmds) {
    for (let k = 0; k < 50; k++) liveTick(g);
    liveCommand(g, cmd);
  }
  assert.equal(L.marks?.length, 4, '최근 넷만 남긴다');
  assert.ok(L.marks![0]!.tick > first.tick, '가장 오래된 것이 밀려난다');
  const ticks = L.marks!.map((x) => x.tick);
  assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b));
});

// ---------- 상대의 대응 ----------
test('실시간 경기: 상대도 지시를 들고 나오고, 경기 중에 우리 전술에 맞춰 지시를 바꾸며, 벤치가 읽은 만큼만 판세에 들어간다', () => {
  let moved = 0;
  let told = 0;
  for (const seed of [3, 11, 99, 123]) {
    const { g, m, L } = liveGame(seed);
    assert.ok(m.oppDials, '상대 지시가 있다');
    const start = JSON.stringify(m.oppDials);
    for (const cmd of ['line:1', 'press:1', 'pass:-1']) liveCommand(g, cmd);
    while (m.step === 'live' && L.tick < 1800) {
      if (L.halfTimeDone && !L.talked) liveCommand(g, 'talk:calm');
      liveTick(g);
      // 아직 읽지 못한 변화가 있으면 벤치가 아는 상대 지시는 실제와 다르다.
      if (m.oppNews) assert.notDeepEqual(m.oppSeen ?? NEUTRAL, m.oppDials);
    }
    assert.ok((m.oppMoves ?? 0) <= 6, '상대의 지시 변경은 여섯 번까지다');
    if (JSON.stringify(m.oppDials) !== start) moved++;
    if (m.log.some((x) => x.text.includes('상대 벤치가 움직였다') || x.text.includes('상대의 변화가 읽혔다') || x.text.includes('상대의 움직임이 달라졌다'))) told++;
  }
  assert.ok(moved >= 2, `네 경기 가운데 상대가 지시를 바꾼 경기가 ${moved}경기뿐이다`);
  assert.ok(told >= moved, '상대가 바꾸면 중계에 알린다');
});
