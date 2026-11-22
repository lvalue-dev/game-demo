// 구단 관리 화면에서 바로 하는 일: 선발 자동 배치, 후보를 선발로 올리기, 외국인 한도 맞추기,
// 그리고 이적시장에서만 할 수 있는 일(재계약, 판매, 들어온 제안)로 곧장 가기.
// 할 일 목록(agenda.ts)의 버튼이 여기 있는 동작을 부른다.
import { ko } from './josa.ts';
import { effOvr, lineAt } from './squad.ts';
import { enforceQuota, isForeign, placeAt, promiseKept, quota } from './contract.ts';
import { windowScene } from './transfer.ts';
import type { Game, Player } from './types.ts';

/** 시장이 열려 있는지(여름·겨울 이적시장 화면). */
export const marketOpen = (g: Game): boolean => (g.phase === 'market' || g.phase === 'winter') && !!g.window;

/** 출전 보장을 한 선수에게 주는 덤. 같은 실력이면 약속한 선수를 세운다. */
const promiseBonus = (p: Player): number => (p.contract?.promise === 'star' ? 4 : p.contract?.promise === 'starter' ? 2.5 : 0);

/**
 * 가장 강한 선발 일곱 명을 자리에 맞게 세운다. 자리마다 그 줄에서 낸 OVR(포지션 감점 포함)에 출전 약속의 덤을 더해 고르고,
 * 외국인 선발 한도를 지킨다. 골키퍼 자리부터, 고를 사람이 적은 자리부터 채운 뒤, 두 자리씩 맞바꿔 더 나아지면 바꾼다.
 */
export function autoLineup(g: Game): string {
  if (g.phase === 'match') return '경기 중에는 바꿀 수 없다.';
  const pool = [...g.squad, ...g.reserves].filter((p) => !p.loan || p.loan.dir === 'in');
  const limit = quota(g).pitch;
  const score = (p: Player, i: number): number => effOvr(p, lineAt(i)) + p.temp + promiseBonus(p);
  const order = [0, 1, 2, 3, 4, 5, 6];
  const pick: (Player | null)[] = [null, null, null, null, null, null, null];
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
    for (let a = 0; a < 7; a++) {
      for (let b = a + 1; b < 7; b++) {
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
  const gain = squad.reduce((s, p, i) => s + effOvr(p, lineAt(i)), 0);
  return `가장 강한 배치로 바꿨다(선발 OVR 합 ${Math.round(gain)}).`;
}

/** 후보를 선발로 올린다. 그 선수 포지션의 줄에서 출전 약속이 없는 가장 약한 선발과 바꾼다. */
export function promote(g: Game, id: number): string {
  const p = g.reserves.find((x) => x.id === id);
  if (!p) return '후보 명단에 없는 선수다.';
  const slots = g.squad.map((q, i) => ({ q, i })).filter(({ i }) => lineAt(i) === p.pos);
  const candidates = (slots.length ? slots : g.squad.map((q, i) => ({ q, i })))
    .sort((a, b) => promiseBonus(a.q) - promiseBonus(b.q) || effOvr(a.q, lineAt(a.i)) - effOvr(b.q, lineAt(b.i)));
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

/** 할 일 버튼과 스쿼드 편집 버튼의 동작. 모르는 동작이면 아무 일도 하지 않는다. */
export function manage(g: Game, id: string): ManageResult {
  const [verb, arg = ''] = id.split(':');
  switch (verb) {
    case 'auto': return { msg: autoLineup(g), go: false };
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
