// 선수 계약. 실제 축구의 계약 요소를 단순한 규칙으로 옮겼다.
// - 연봉: 리그 수준과 선수 OVR로 정해지는 시장 연봉. K5(동호인)는 무급이다.
// - 계약 기간: 남은 시즌 수. 0이 되면 자유계약으로 떠난다(보스만 룰).
// - 출전 보장: 핵심 선수 > 주전 > 로테이션 > 백업. 약속을 어기면 불만을 품는다.
// - 바이아웃: 그 금액을 내는 구단에는 이적을 막을 수 없다. 선수는 낮은 바이아웃을 좋아한다.
// - 계약금(서명 보너스), 에이전트 수수료, 셀온 조항.
import { ko } from './josa.ts';
import { LEAGUES, won } from './data.ts';
import { fillSlot, lineAt, myClub, stage, valueOf } from './squad.ts';
import type { ClubLeagueId, Contract, Deal, Game, Player, PromiseId, Spot, Terms } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

export const PROMISES: Record<PromiseId, { name: string; desc: string; rank: number }> = {
  star: { name: '핵심 선수', desc: '팀의 중심으로 늘 선발 출전', rank: 3 },
  starter: { name: '주전', desc: '선발 일곱 명 안에 든다', rank: 2 },
  rotation: { name: '로테이션', desc: '선발과 후보를 오간다', rank: 1 },
  backup: { name: '백업', desc: '후보로 기회를 기다린다', rank: 0 },
};
export const PROMISE_IDS: PromiseId[] = ['star', 'starter', 'rotation', 'backup'];

/** 아마추어 리그면 연봉이 없다. */
export const amateur = (g: Game): boolean => !myClub(g).nation && myClub(g).league === 'kr5';

/** 등록 선수 한도: 선발 일곱에 후보 아홉. */
export const RESERVE_LIMIT = 9;

/** 선수의 시장 연봉(백만 원, 한 시즌). */
export function wageFor(g: Game, p: Player): number {
  if (amateur(g) || myClub(g).nation) return 0;
  const { level, money } = stage(g);
  const age = p.age <= 21 ? 0.6 : p.age >= 32 ? 0.8 : 1;
  return round1(Math.max(money * 0.015, money * 0.1 * Math.pow(1.22, p.ovr - level) * age));
}

/** 이 팀에 오면 기대하는 출전 시간. 지금 같은 포지션 주전들과 견준다. */
export function expectedPromise(g: Game, p: Player): PromiseId {
  const same = g.squad.filter((q, i) => lineAt(i) === p.pos && q.id !== p.id).map((q) => q.ovr);
  const best = same.length ? Math.max(...same) : 0;
  const worst = same.length ? Math.min(...same) : 0;
  if (p.ovr >= best + 2 && p.ovr >= stage(g).level + 2) return 'star';
  if (p.ovr > worst) return 'starter';
  if (p.age <= 21) return 'backup';
  return 'rotation';
}

/** 원하는 계약 기간. 어릴수록 길게, 노장은 짧게라도 보장받고 싶어 한다. */
export const preferredYears = (p: Player): number => (p.age <= 23 ? 5 : p.age <= 28 ? 4 : p.age <= 31 ? 3 : 2);

/** 시장가. 바이아웃과 판매가의 기준이다. */
export function marketValue(g: Game, p: Player): number {
  const { level, money } = stage(g);
  return round1(valueOf(p, level, money));
}

/** 바이아웃 추천값: 높게(시장가 2.5배), 낮게(1.5배). */
export const clauseAmount = (g: Game, p: Player, kind: 'high' | 'low'): number => round1(marketValue(g, p) * (kind === 'high' ? 2.5 : 1.5));

/** 에이전트 수수료: 이적료의 pct%. 이적료가 없으면(자유계약, 재계약) 연봉의 pct/32(8%면 4분의 1). */
export const agentFee = (fee: number, wage: number, pct: number): number => round1(Math.max(fee * pct / 100, wage * pct / 32));

/** 계약금(서명 보너스). */
export const signingBonus = (t: Terms): number => round1(t.bonus);

/** 지금 등록된 선수들의 연봉 합. except는 빼고 센다. */
export function totalWages(g: Game, except?: number): number {
  // 임대 보낸 선수는 상대 구단이 내지 않는 몫만 우리가 낸다.
  const out = (g.loaned ?? []).reduce((s, p) => s + (p.contract?.wage ?? 0) * (1 - (p.loan?.share ?? 0)), 0);
  return round1([...g.squad, ...g.reserves].filter((p) => p.id !== except).reduce((s, p) => s + (p.contract?.wage ?? 0), 0) + out);
}

/** 한 시즌 연봉 예산. 구단의 재정 형편을 따른다. */
export function wageBudgetFor(g: Game): number {
  if (amateur(g) || myClub(g).nation) return 0;
  return round1(stage(g).money * 1.8 * (1 + myClub(g).wealth * 0.05));
}

/** 선수가 처음 내놓는 요구. */
export function askOf(g: Game, p: Player, renew = false): Deal['ask'] {
  const market = wageFor(g, p);
  // 재계약은 지금 연봉보다 낮게 받으려 하지 않는다.
  const now = renew ? (p.contract?.wage ?? 0) : 0;
  const greed = p.unhappy ? 1.2 : 1;
  // 아마추어 리그에서는 누구도 연봉을 받지 않는다.
  const wage = amateur(g) || myClub(g).nation ? 0 : round1(Math.max(market, now * 1.05) * greed);
  // 에이전트는 6~10%를 요구한다.
  return { wage, promise: expectedPromise(g, p), years: preferredYears(p), agent: 6 + (p.id % 5) };
}

export function defaultTerms(ask: Deal['ask']): Terms {
  return { wage: ask.wage, years: ask.years, promise: ask.promise, clause: 0, bonus: 0, agent: ask.agent };
}

/** 개인 조건을 받아들일 가능성(0~1). 화면에 그대로 보여 준다. */
export function termsOdds(g: Game, d: Deal): number {
  const p = d.player;
  const t = d.offer;
  const level = stage(g).level;
  // 요구를 그대로 들어주면 대체로(80~90%) 받아들인다. 연봉을 깎을수록 빠르게 어려워진다.
  let score = 0.9;
  if (d.ask.wage > 0) score += clamp((t.wage / d.ask.wage - 1) * 6, -3, 0.6);
  const gap = PROMISES[t.promise].rank - PROMISES[d.ask.promise].rank;
  score += gap >= 0 ? Math.min(gap, 1) * 0.25 : gap * 0.9;
  score -= Math.abs(t.years - d.ask.years) * 0.15;
  // 좋은 선수일수록 빠져나갈 길(바이아웃)을 원한다. 바이아웃이 낮을수록(시장가에 가까울수록) 좋아한다.
  const ratio = t.clause > 0 ? t.clause / Math.max(0.1, marketValue(g, p)) : 0;
  const clauseLike = t.clause > 0 ? clamp(0.25 - (ratio - 1.5) * 0.2, -0.05, 0.3) : 0;
  score += p.ovr >= level + 2 ? (t.clause > 0 ? clauseLike : -0.25) : clauseLike * 0.6;
  // 계약금은 연봉의 절반이면 +0.35, 많을수록 더(최대 +0.5).
  if (t.bonus > 0) score += Math.min(0.5, (t.bonus / Math.max(0.1, t.wage || 1)) * 0.7);
  // 에이전트 수수료를 요구보다 깎으면 에이전트가 반대한다.
  score += clamp((t.agent - d.ask.agent) * 0.06, -0.5, 0.25);
  score += (g.manager.attrs.deal - 6) * 0.04;
  if (d.kind === 'renew' && p.unhappy) score -= 0.6;
  score -= d.talks * 0.1;
  return clamp(1 / (1 + Math.exp(-score * 2.2)), 0.03, 0.97);
}

/** 판매 구단이 이적료 제안을 받아들일 가능성. frac은 요구액 대비 제안 비율. */
export function feeOdds(g: Game, d: Deal, frac: number, sellOn: number, inst = 1): number {
  if (frac >= 1 && inst <= 1) return 1;
  // 셀온 10%는 이적료 6%쯤의 값어치. 분할 지급은 한 시즌 늘 때마다 5%쯤 깎는 셈이다.
  const effective = frac + sellOn * 0.6 - (inst - 1) * 0.05;
  if (effective >= 1) return 0.97;
  return clamp(0.15 + (effective - 0.75) * 2.6 + (g.manager.attrs.deal - 6) * 0.03 - d.tries * 0.12 + (d.tag === '베테랑' ? 0.1 : 0), 0.02, 0.98);
}

export const oddsText = (p: number): string => (p >= 0.8 ? '매우 높음' : p >= 0.6 ? '높음' : p >= 0.4 ? '반반' : p >= 0.2 ? '낮음' : '매우 낮음');

export function makeContract(g: Game, t: Terms, sellOn = 0): Contract {
  return { wage: round1(t.wage), years: t.years, promise: t.promise, clause: t.clause > 0 ? round1(t.clause) : null, sellOn, since: g.year };
}

/** 새로 팀을 맡았을 때나 이전 저장을 불러왔을 때 기존 선수들의 계약. */
export function existingContract(g: Game, p: Player, starter: boolean, years: number): Contract {
  return { wage: wageFor(g, p), years, promise: starter ? 'starter' : p.age <= 21 ? 'backup' : 'rotation', clause: null, sellOn: 0, since: g.year };
}

// ---------- 등번호 ----------

const SHIRT: Record<Spot, number[]> = {
  GK: [1, 13, 31], RB: [2, 22], LB: [3, 23], CB: [4, 5, 15, 24], CDM: [6, 16], CM: [8, 14, 18], CAM: [10, 20],
  RM: [7, 17], LM: [11, 21], RW: [7, 17], LW: [11, 21], ST: [9, 19, 10],
};

/** 팀 안에서 겹치지 않는 등번호를 준다. 포지션의 관례 번호부터 찾는다. */
export function assignNumber(g: Game, p: Player): number {
  const used = new Set([...g.squad, ...g.reserves].filter((q) => q.id !== p.id).map((q) => q.no));
  let n = SHIRT[p.spot].find((x) => !used.has(x)) ?? 12;
  while (used.has(n)) n++;
  p.no = n;
  return n;
}

/**
 * 새로 들어온 선수(2군에서 올라온 선수, 빈자리를 메운 선수)에게 등번호와 계약을 준다.
 * 아마추어 리그를 벗어났는데 무급 계약인 선수는 프로 계약(시장 연봉의 70%)으로 바꾼다.
 */
export function settle(g: Game): void {
  if (myClub(g).nation) return;
  for (const p of [...g.squad, ...g.reserves]) {
    if (!p.no) assignNumber(g, p);
    if (!p.contract) p.contract = existingContract(g, p, g.squad.includes(p), 2);
    if (p.contract.wage === 0 && !amateur(g)) p.contract.wage = round1(wageFor(g, p) * 0.7);
  }
}

// ---------- 출전 보장 ----------

/** 약속을 지키고 있는지. 후보 명단에 있는 핵심 선수, 주전은 약속 위반이다. */
export function promiseKept(g: Game, p: Player): boolean {
  const promise = p.contract?.promise ?? 'backup';
  if (promise === 'star' || promise === 'starter') return g.squad.some((q) => q.id === p.id);
  if (promise === 'rotation') {
    if (g.squad.some((q) => q.id === p.id)) return true;
    // 후보 중 같은 포지션 1순위면 로테이션으로 본다.
    const same = g.reserves.filter((q) => q.pos === p.pos).sort((a, b) => b.ovr - a.ovr);
    return same[0]?.id === p.id;
  }
  return true;
}

/** 시장이 닫히거나 시즌이 끝날 때 약속을 점검한다. 어긴 선수는 불만을 품는다. */
export function checkPromises(g: Game): string[] {
  const lines: string[] = [];
  for (const p of [...g.squad, ...g.reserves]) {
    if (!p.contract || p.unhappy || promiseKept(g, p)) continue;
    p.unhappy = true;
    p.temp -= 2;
    g.morale = clamp(g.morale - 3, 0, 100);
    lines.push(ko`${PROMISES[p.contract.promise].name}로 약속받은 ${p.name}이 후보로 밀려 불만을 터뜨렸다. 이번 시즌 OVR -2, 이적을 요구할 수 있다.`);
  }
  return lines;
}

/** 후보 명단이 팀 뎁스에 주는 영향. 후보 상위 네 명이 뎁스보다 좋으면 오르고, 나쁘면 조금 내린다. */
export function depthOf(g: Game): number {
  const base = g.depth + g.season.depthMod;
  const top = [...g.reserves].sort((a, b) => b.ovr - a.ovr).slice(0, 4).map((p) => p.ovr + p.temp);
  // 비어 있는 자리는 이름 없는 2군 선수(뎁스 수준)가 메운다.
  while (top.length < 4) top.push(g.depth);
  const avg = top.reduce((a, b) => a + b, 0) / 4;
  return base + clamp((avg - g.depth) * 0.35, -0.5, 2.5);
}

/** 연봉과 기간을 한 줄로. */
export function contractText(g: Game, c: Contract | null): string {
  if (!c) return '대표팀 소집';
  const pay = c.wage > 0 ? `연봉 ${won(c.wage)}` : '무급(아마추어)';
  return `${pay} · ${c.years}년 남음(${g.year + c.years - 1}년 만료) · ${PROMISES[c.promise].name}${c.clause ? ` · 바이아웃 ${won(c.clause)}` : ''}`;
}

/**
 * 시즌이 끝나면 계약 기간이 한 시즌 줄어든다. 0이 된 선수는 자유계약으로 떠난다(보스만 룰).
 * 선발이 떠나면 같은 포지션 후보가 올라가거나 새 선수가 온다. 약속이 지켜지고 있는 선수는 불만을 푼다.
 */
export function expireContracts(g: Game, nextLevel: number): string[] {
  if (myClub(g).nation) return [];
  const lines: string[] = [];
  const { region } = stage(g);
  for (const p of [...g.squad, ...g.reserves]) {
    if (!p.contract) continue;
    if (p.unhappy && promiseKept(g, p)) p.unhappy = false;
    p.contract.years -= 1;
    if (p.contract.years > 0) continue;
    if (g.squad.includes(p)) {
      lines.push(ko`${p.name}의 계약이 끝났다. 이적료 없이 자유계약으로 떠났다. ${fillSlot(g, p, nextLevel, region)}`);
    } else {
      g.reserves = g.reserves.filter((q) => q.id !== p.id);
      lines.push(ko`후보 ${p.name}의 계약이 끝나 팀을 떠났다.`);
    }
  }
  settle(g);
  return lines;
}

/** 선발과 후보를 맞바꾼다. 같은 포지션끼리만 된다. 경기 중에는 못 바꾼다. */
export function swapLineup(g: Game, inId: number, outId: number): boolean {
  const at = g.squad.findIndex((p) => p.id === outId);
  return at >= 0 && placeAt(g, inId, at) === null;
}

/**
 * 선수를 선발 자리 at(0~6: GK, DF, DF, MF, MF, FW, FW)에 세운다. 선발끼리는 자리를 맞바꾸고,
 * 후보면 그 자리의 선발과 맞바꾼다. 포지션이 달라도 되지만 OVR이 깎인다. 안 되면 이유를 돌려준다.
 */
export function placeAt(g: Game, id: number, at: number): string | null {
  if (g.phase === 'match') return '경기 중에는 바꿀 수 없다';
  if (at < 0 || at >= g.squad.length) return '없는 자리다';
  const from = g.squad.findIndex((p) => p.id === id);
  if (from === at) return null;
  const squad = [...g.squad];
  const reserves = [...g.reserves];
  const target = squad[at] as Player;
  if (from >= 0) {
    squad[at] = squad[from] as Player;
    squad[from] = target;
  } else {
    const r = reserves.findIndex((p) => p.id === id);
    if (r < 0) return '등록 선수가 아니다';
    squad[at] = reserves[r] as Player;
    reserves[r] = target;
  }
  const limit = quota(g).pitch;
  const foreign = (list: Player[]): number => list.filter((p) => isForeign(g, p)).length;
  if (limit !== null && foreign(squad) > limit && foreign(squad) > foreign(g.squad)) return `외국인 선발은 ${limit}명까지다`;
  g.squad = squad;
  g.reserves = reserves;
  return null;
}

// ---------- 외국인 쿼터 ----------

/**
 * 리그별 외국인 한도. reg는 등록, pitch는 선발(동시 출전). null은 제한 없음.
 * K리그1·2는 2026 시즌부터 보유 한도가 없고 동시 출전은 5명, 4명이다. K4는 2025 시즌 기준 보유·출전 4명이고,
 * K3도 같게 두었다(원문 미확인). K5는 게임용 규칙이다. 잉글랜드에는 외국인 쿼터가 없다.
 */
const QUOTA: Record<ClubLeagueId, { reg: number | null; pitch: number | null }> = {
  kr5: { reg: 3, pitch: 3 }, kr4: { reg: 4, pitch: 4 }, kr3: { reg: 4, pitch: 4 }, kr2: { reg: null, pitch: 4 }, kr1: { reg: null, pitch: 5 },
  eu2: { reg: null, pitch: null }, eu1: { reg: null, pitch: null },
};

export function quota(g: Game): { reg: number | null; pitch: number | null } {
  const club = myClub(g);
  return club.nation ? { reg: null, pitch: null } : QUOTA[club.league as ClubLeagueId];
}

/** 쿼터에 세는 외국인인지. 국내 리그에서만 센다. */
export function isForeign(g: Game, p: Player): boolean {
  const club = myClub(g);
  return !club.nation && LEAGUES[club.league as ClubLeagueId].region === 'kr' && p.nat !== '대한민국';
}

export const foreignCount = (g: Game, list: Player[]): number => list.filter((p) => isForeign(g, p)).length;

/**
 * 선발의 외국인이 한도를 넘으면(승격, 규정 변경 등) 가장 약한 외국인 선발을 국내 후보와 바꾼다.
 * 맞는 국내 후보가 없으면 2군 선수가 선다. 바꾼 내용을 돌려준다.
 */
export function enforceQuota(g: Game): string[] {
  const limit = quota(g).pitch;
  const lines: string[] = [];
  while (limit !== null && foreignCount(g, g.squad) > limit) {
    const at = g.squad.map((p, i) => ({ p, i })).filter((x) => isForeign(g, x.p)).sort((a, b) => a.p.ovr - b.p.ovr)[0]!;
    const line = lineAt(at.i);
    const sub = g.reserves.filter((r) => !isForeign(g, r) && !r.loan).sort((a, b) => (b.pos === line ? 5 : 0) + b.ovr - ((a.pos === line ? 5 : 0) + a.ovr))[0];
    if (sub) {
      placeAt(g, sub.id, at.i);
      lines.push(ko`외국인 선발 한도(${limit}명) 때문에 ${at.p.name} 대신 ${sub.name}이 선발로 나선다.`);
    } else {
      const { level, region } = stage(g);
      lines.push(ko`외국인 선발 한도(${limit}명) 때문에 ${at.p.name}이 빠졌다. ${fillSlot(g, at.p, level - 2, region)}`);
      if (!g.reserves.includes(at.p)) g.reserves.push(at.p);
      settle(g);
    }
  }
  return lines;
}

/**
 * 강등 시 연봉 삭감 조항. 실제 계약에 흔히 들어가는 조항으로, 강등되면 새 리그 시장 연봉의
 * 1.3배를 넘는 연봉은 그 수준으로 깎인다. 동호인 리그(K5)로 떨어지면 모두 무급이 된다.
 */
export function relegationCut(g: Game, league: ClubLeagueId): string | null {
  const meta = LEAGUES[league];
  let cut = 0;
  for (const p of [...g.squad, ...g.reserves]) {
    if (!p.contract || p.contract.wage <= 0) continue;
    const age = p.age <= 21 ? 0.6 : p.age >= 32 ? 0.8 : 1;
    const cap = league === 'kr5' ? 0 : round1(Math.max(meta.money * 0.015, meta.money * 0.1 * Math.pow(1.22, p.ovr - meta.level) * age) * 1.3);
    if (p.contract.wage > cap) {
      cut += p.contract.wage - cap;
      p.contract.wage = cap;
    }
  }
  return cut > 0 ? `강등 시 연봉 삭감 조항이 발동해 선수단 연봉이 모두 ${won(round1(cut))} 줄었다.` : null;
}

// ---------- 잉글랜드: 워크퍼밋과 홈그로운 ----------

/** 잉글랜드 리그(프리미어리그, 챔피언십)를 맡고 있는지. */
export const inEngland = (g: Game): boolean => !myClub(g).nation && (myClub(g).league === 'eu1' || myClub(g).league === 'eu2');

/** 워크퍼밋에 필요한 GBE 점수와 ESC 예외 슬롯. 실제 규정을 게임에 맞게 줄였다(RULES.md). */
export const GBE_NEED = 15;
export const ESC_SLOTS = 4;
export const ESC_MAX_AGE = 23;
/** 홈그로운이 아닌 21세 이상 선수의 등록 한도. 25명 중 17명을 우리 등록 인원 16명에 맞춰 줄였다. */
export const NON_HG_LIMIT = 11;

/** 잉글랜드 국적이 아니면 워크퍼밋이 필요하다. */
export const needsPermit = (g: Game, p: Player): boolean => inEngland(g) && p.nat !== '잉글랜드';

/**
 * GBE 점수. 실제로는 A매치 출전, 소속 리그 수준, 출전 시간, 이적료 등으로 매기지만,
 * 게임에서는 OVR로 갈음한다. OVR 72면 15점이다.
 */
export const gbePoints = (p: Player): number => clamp(Math.round((p.ovr - 62) * 1.5), 0, 40);

/** 홈그로운 규정에 세는 선수: 21세 이상이면서 홈그로운이 아닌 선수. */
export const countsNonHg = (p: Player): boolean => p.age >= 21 && !p.hg;

export function englandStatus(g: Game): { nonHg: number; esc: number } {
  const list = [...g.squad, ...g.reserves];
  return { nonHg: list.filter(countsNonHg).length, esc: list.filter((p) => p.esc).length };
}

/**
 * 잉글랜드에서 이 선수를 새로 등록할 수 있는지. 안 되면 이유를, 되면 null과 ESC 슬롯을 쓰는지를 돌려준다.
 */
export function englandCheck(g: Game, p: Player): { why: string | null; esc: boolean } {
  if (!inEngland(g)) return { why: null, esc: false };
  const st = englandStatus(g);
  let esc = false;
  if (needsPermit(g, p) && gbePoints(p) < GBE_NEED) {
    if (p.age > ESC_MAX_AGE) return { why: `워크퍼밋을 받을 수 없다(GBE ${gbePoints(p)}점 / ${GBE_NEED}점, ESC 예외는 ${ESC_MAX_AGE}세 이하만)`, esc: false };
    if (st.esc >= ESC_SLOTS) return { why: `ESC 예외 슬롯 ${ESC_SLOTS}개를 다 썼다(GBE ${gbePoints(p)}점)`, esc: false };
    esc = true;
  }
  if (countsNonHg(p) && st.nonHg >= NON_HG_LIMIT) return { why: `홈그로운이 아닌 21세 이상 선수 등록 한도(${NON_HG_LIMIT}명)가 찼다`, esc };
  return { why: null, esc };
}

/** 선수 한 명의 잉글랜드 규정 상태를 한 줄로. */
export function englandText(g: Game, p: Player): string {
  if (!inEngland(g)) return '';
  const permit = !needsPermit(g, p) ? '워크퍼밋 불필요' : p.esc ? 'ESC 슬롯 등록' : `GBE ${gbePoints(p)}점${gbePoints(p) >= GBE_NEED ? '(통과)' : '(미달)'}`;
  return `${permit} · ${p.hg ? '홈그로운' : p.age < 21 ? '21세 이하' : '비홈그로운'}`;
}
