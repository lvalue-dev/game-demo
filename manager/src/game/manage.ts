// 구단 관리 화면에서 바로 하는 일: 선발 자동 배치, 후보를 선발로 올리기, 외국인 한도 맞추기,
// 그리고 이적시장에서만 할 수 있는 일(재계약, 판매, 들어온 제안)로 곧장 가기.
// 할 일 목록(agenda.ts)의 버튼이 여기 있는 동작을 부른다.
import { ko } from './josa.ts';
import { STYLES } from './data.ts';
import { effOvr, formationOf, lineAt, linesOf, lineupLocked, slotsFor, spotAt } from './squad.ts';
import { SLOTS, slotSpot } from './live.ts';
import { posPenalty } from './player.ts';
import { enforceQuota, isForeign, placeAt, promiseKept, quota } from './contract.ts';
import { windowScene } from './transfer.ts';
import { DIALS, NEUTRAL, ROLES, SHAPES, SHAPE_IDS, presetDials, roleFits } from './tactics.ts';
import type { Dials, Game, Level, Plan, Player, RoleId, ShapeId } from './types.ts';

/** 시장이 열려 있는지(여름·겨울 이적시장 화면). */
export const marketOpen = (g: Game): boolean => (g.phase === 'market' || g.phase === 'winter') && !!g.window;

/** 출전 보장을 한 선수에게 주는 덤. 같은 실력이면 약속한 선수를 세운다. */
const promiseBonus = (p: Player): number => (p.contract?.promise === 'star' ? 4 : p.contract?.promise === 'starter' ? 2.5 : 0);

/**
 * 가장 강한 선발 열한 명을 자리에 맞게 세운다. 자리마다 그 줄에서 낸 OVR(포지션 감점 포함)에 출전 약속의 덤을 더해 고르고,
 * 외국인 선발 한도를 지킨다. 골키퍼 자리부터, 고를 사람이 적은 자리부터 채운 뒤, 두 자리씩 맞바꿔 더 나아지면 바꾼다.
 */
export function autoLineup(g: Game): string {
  if (lineupLocked(g)) return '경기 중에는 바꿀 수 없다.';
  const pool = [...g.squad, ...g.reserves].filter((p) => !p.loan || p.loan.dir === 'in');
  const limit = quota(g).pitch;
  const score = (p: Player, i: number): number => effOvr(p, lineAt(g, i)) + p.temp + promiseBonus(p);
  const n = linesOf(g).length;
  const order = Array.from({ length: n }, (_, i) => i);
  const pick: (Player | null)[] = order.map(() => null);
  const used = new Set<number>();
  let foreign = 0;
  for (const i of order) {
    const best = pool.filter((p) => !used.has(p.id) && (limit === null || !isForeign(g, p) || foreign < limit))
      .sort((a, b) => score(b, i) - score(a, i))[0];
    if (!best) continue;
    pick[i] = best;
    used.add(best.id);
    if (isForeign(g, best)) foreign++;
  }
  // 두 자리씩 맞바꿔 합이 커지면 바꾼다(골키퍼를 공격수로 세우는 식의 실수를 고친다).
  for (let pass = 0; pass < 3; pass++) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const pa = pick[a];
        const pb = pick[b];
        if (!pa || !pb) continue;
        if (score(pb, a) + score(pa, b) > score(pa, a) + score(pb, b) + 0.01) {
          pick[a] = pb;
          pick[b] = pa;
        }
      }
    }
  }
  if (pick.some((p) => !p)) return '세울 선수가 모자란다.';
  const before = g.squad.map((p) => p.id).join(',');
  const squad = pick as Player[];
  g.reserves = pool.filter((p) => !squad.includes(p));
  g.squad = squad;
  refresh(g);
  if (before === squad.map((p) => p.id).join(',')) return '지금이 가장 강한 배치다.';
  const gain = squad.reduce((s, p, i) => s + effOvr(p, lineAt(g, i)), 0);
  return `가장 강한 배치로 바꿨다(선발 OVR 합 ${Math.round(gain)}).`;
}

/** 후보를 선발로 올린다. 그 선수 포지션의 줄에서 출전 약속이 없는 가장 약한 선발과 바꾼다. */
export function promote(g: Game, id: number): string {
  const p = g.reserves.find((x) => x.id === id);
  if (!p) return '후보 명단에 없는 선수다.';
  const slots = g.squad.map((q, i) => ({ q, i })).filter(({ i }) => lineAt(g, i) === p.pos);
  const candidates = (slots.length ? slots : g.squad.map((q, i) => ({ q, i })))
    .sort((a, b) => promiseBonus(a.q) - promiseBonus(b.q) || effOvr(a.q, lineAt(g, a.i)) - effOvr(b.q, lineAt(g, b.i)));
  const at = candidates[0];
  if (!at) return '바꿀 자리가 없다.';
  const why = placeAt(g, p.id, at.i);
  refresh(g);
  return why ?? ko`${p.name}을 선발로 올리고 ${at.q.name}을 후보로 돌렸다.${promiseKept(g, at.q) ? '' : ` ${at.q.name}에게 한 약속이 깨진다.`}`;
}

/** 선발의 외국인이 한도를 넘으면 맞춘다. */
export function fixQuota(g: Game): string {
  const lines = enforceQuota(g);
  refresh(g);
  return lines.length ? lines.join(' ') : '한도를 넘지 않는다.';
}

/** 재계약 협상 화면을 연다(시장이 열려 있을 때). */
export function openRenewal(g: Game, id: number): string | null {
  if (!marketOpen(g)) return '재계약은 이적시장(여름, 겨울)에서 한다.';
  const d = g.window!.list.find((x) => x.kind === 'renew' && x.player.id === id);
  if (!d) return '이 선수와의 재계약 협상이 없다.';
  g.window!.view = d.id;
  refresh(g);
  return null;
}

/** 이적시장 첫 화면으로 돌아간다(카드 탭은 화면 쪽에서 고른다). */
export function openMarket(g: Game): string | null {
  if (!marketOpen(g)) return '이적시장이 열려 있지 않다.';
  g.window!.view = null;
  refresh(g);
  return null;
}

/** 시장 화면이 열려 있으면 다시 그린다(선발이 바뀌면 카드의 "주전 대비" 숫자가 바뀐다). */
function refresh(g: Game): void {
  if (marketOpen(g)) windowScene(g, g.scene.eyebrow);
}

export interface ManageResult {
  /** 화면에 잠깐 보여 줄 말. */
  msg: string | null;
  /** 진행 화면으로 가야 하면 true(시장의 협상 화면 등). */
  go: boolean;
  /** 시장 첫 화면에서 열 탭. */
  tab?: string;
}

/** 평소 팀 지시와 개인 역할. 없으면 만든다. */
export function planOf(g: Game): Plan {
  return (g.plan ??= { dials: { ...NEUTRAL }, roles: {} });
}

/** 평소 지시(읽기 전용). */
export const planDials = (g: Game): Dials => g.plan?.dials ?? NEUTRAL;

/** 선발 i번 자리의 선수가 평소 맡는 역할. 지금 선 자리에 맞지 않는 역할은 기본으로 본다. */
export function planRole(g: Game, i: number): RoleId {
  const p = g.squad[i];
  const role = p ? g.plan?.roles[p.id] : undefined;
  return role && roleFits(spotAt(g, i), role) ? role : (ROLES[spotAt(g, i)][0]!.id);
}

/** 할 일 버튼과 스쿼드 편집 버튼의 동작. 모르는 동작이면 아무 일도 하지 않는다. */
export function manage(g: Game, id: string): ManageResult {
  const [verb, arg = ''] = id.split(':');
  switch (verb) {
    case 'auto': return { msg: autoLineup(g), go: false };
    case 'formation': {
      if (!SHAPE_IDS.includes(arg as ShapeId) || lineupLocked(g)) return { msg: null, go: false };
      g.formation = arg as ShapeId;
      // 자리가 바뀌었으니 가장 강한 배치로 다시 세운다.
      autoLineup(g);
      return { msg: `대형을 ${SHAPES[arg as ShapeId].name}으로 바꾸고 선발을 다시 세웠다.`, go: false };
    }
    case 'up': return { msg: promote(g, Number(arg)), go: false };
    case 'quota': return { msg: fixQuota(g), go: false };
    case 'renew': {
      const why = openRenewal(g, Number(arg));
      return why ? { msg: why, go: false } : { msg: null, go: true };
    }
    case 'market': {
      const why = openMarket(g);
      return why ? { msg: why, go: false } : { msg: null, go: true, tab: arg || undefined };
    }
    case 'move': {
      // move:자리.u.v — 선발 한 자리를 경기장의 다른 곳으로 옮긴다(손으로 짜는 대형). 골키퍼 자리는 옮기지 않는다.
      const [i, u, v] = arg.split('.').map(Number) as [number, number, number];
      if (lineupLocked(g) || !(i > 0 && i < g.squad.length) || !Number.isFinite(u) || !Number.isFinite(v)) return { msg: null, go: false };
      const shape = formationOf(g);
      const tweak = (g.tweaks ??= {})[shape] ?? SLOTS[shape].map((x) => ({ u: x.u, v: x.v }));
      const before = slotsFor(g)[i]!.line;
      tweak[i] = { u: Math.round(Math.max(12, Math.min(76, u))), v: Math.round(Math.max(3, Math.min(65, v))) };
      g.tweaks[shape] = tweak;
      const after = slotsFor(g)[i]!;
      refresh(g);
      const p = g.squad[i]!;
      return { msg: ko`${p.name}의 자리를 옮겼다: ${slotSpot(after)}${after.line !== before ? `(${before}에서 ${after.line} 줄로)` : ''}.${posPenalty(p.spot, after.line) ? ` 포지션 밖이라 OVR -${posPenalty(p.spot, after.line)}.` : ''}`, go: false };
    }
    case 'reset': {
      if (lineupLocked(g)) return { msg: null, go: false };
      if (g.tweaks) delete g.tweaks[formationOf(g)];
      refresh(g);
      return { msg: `${SHAPES[formationOf(g)].name} 기본 자리로 되돌렸다.`, go: false };
    }
    case 'bench': {
      // bench:자리 — 선발을 후보로 내리고, 그 줄에 가장 잘 맞는 후보를 올린다.
      const i = Number(arg);
      const out = g.squad[i];
      if (!out || lineupLocked(g)) return { msg: null, go: false };
      const line = lineAt(g, i);
      const best = g.reserves.filter((p) => !p.loan || p.loan.dir === 'in').sort((a, b) => effOvr(b, line) - effOvr(a, line))[0];
      if (!best) return { msg: '올릴 후보가 없다.', go: false };
      const why = placeAt(g, best.id, i);
      refresh(g);
      return { msg: why ?? ko`${out.name}을 후보로 내리고 ${best.name}을 ${line} 자리에 세웠다.`, go: false };
    }
    case 'dial': {
      // dial:이름.값 — 평소 팀 지시. 경기를 시작할 때 이대로 들고 나간다. dial:reset은 전부 보통으로, dial:preset은 몸에 밴 전술에 맞춘 코치의 추천으로.
      if (lineupLocked(g)) return { msg: null, go: false };
      const plan = planOf(g);
      if (arg === 'reset') {
        plan.dials = { ...NEUTRAL };
        return { msg: '팀 지시를 모두 보통으로 되돌렸다.', go: false };
      }
      if (arg === 'preset') {
        plan.dials = presetDials(g.season.style, 1);
        return { msg: ko`코치가 ${STYLES[g.season.style].name}에 맞춰 팀 지시를 짰다.`, go: false };
      }
      const [name = '', raw = '', more] = arg.split('.');
      const value = Number(raw);
      if (name === 'overlap') {
        if (more === undefined && (raw === '0' || raw === '1')) plan.dials.overlap = raw === '1';
        return { msg: null, go: false };
      }
      const dial = DIALS.find((x) => x.id === name);
      if (!dial || more !== undefined || !['-1', '0', '1'].includes(raw)) return { msg: null, go: false };
      plan.dials[dial.id] = value as Level;
      return { msg: null, go: false };
    }
    case 'role': {
      // role:선수.역할 — 선발 선수의 평소 역할. 그 선수가 선 자리에서 맡을 수 있는 역할이어야 한다.
      const [pid = '', role = ''] = arg.split('.');
      const i = g.squad.findIndex((p) => p.id === Number(pid));
      if (lineupLocked(g) || i < 0 || !roleFits(spotAt(g, i), role)) return { msg: null, go: false };
      const plan = planOf(g);
      if (role === 'base') delete plan.roles[Number(pid)];
      else plan.roles[Number(pid)] = role;
      return { msg: null, go: false };
    }
    case 'place': {
      // place:선수:자리 — 탭으로 고른 두 자리를 맞바꾼다.
      const [pid, at] = arg.split('.');
      const why = placeAt(g, Number(pid), Number(at));
      refresh(g);
      return { msg: why, go: false };
    }
  }
  return { msg: null, go: false };
}
