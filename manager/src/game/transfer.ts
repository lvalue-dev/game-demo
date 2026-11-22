// 이적 시장. 실제 이적 절차를 따른다. 금액과 기간은 감독이 직접 정한다.
//   1. 구단 간 협상: 판매 구단에 이적료(금액, 셀온 비율, 분할 지급)를 제안한다. 바이아웃이 있으면 그 금액으로 바로 된다.
//   2. 개인 조건 협상: 선수(와 에이전트)에게 연봉, 계약 기간, 출전 보장, 바이아웃, 계약금, 에이전트 수수료율을 제안한다.
//   3. 서명: 이적료(분할이면 첫 회분), 에이전트 수수료, 계약금이 이적 예산에서 나가고, 연봉은 연봉 예산 안에 들어야 한다.
// 임대: 다른 구단 선수를 기간(반 시즌, 한 시즌), 연봉 분담 비율, 임대료를 정해 빌려 오고, 우리 선수를 빌려준다.
// 시장이 열려 있는 동안 영입, 임대, 재계약, 판매(희망가), 계약 해지, 다른 구단 제안 처리를 여러 번 할 수 있다.
import { ko } from './josa.ts';
import { LEAGUES, won } from './data.ts';
import {
  PROMISES, PROMISE_IDS, RESERVE_LIMIT, agentFee, amateur, askOf, assignNumber, checkPromises, clauseAmount, contractText,
  defaultTerms, enforceQuota, englandCheck, englandStatus, englandText, ESC_SLOTS, feeOdds, foreignCount, gbePoints, inEngland, isForeign, makeContract, marketValue, NON_HG_LIMIT, nonEu, nonEuSigningLimit, quota, quotaWord, settle,
  signingBonus, termsOdds, totalWages, wageFor,
} from './contract.ts';
import { profileText } from './player.ts';
import { COUNTRIES, countryOf } from './countries.ts';
import { chance, int, pick, spread } from './rng.ts';
import { fillSlot, makePlayer, myClub, potentialText, priceFor, stage, weakest } from './squad.ts';
import type { Block, Choice, Club, Deal, DealRow, Game, MarketCard, MarketTab, Player, Pos, PromiseId, Tone, TransferWindow } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;
const pct = (p: number): string => `${Math.round(p * 100)}%`;

/** 대표팀이 한 번 소집 때 바꿀 수 있는 자리 수. */
const NATION_CHANGES = 2;
/** 스카우트를 다시 보낼 수 있는 횟수와 비용(그 무대 한 시즌 예산 대비). */
const SCOUT_TIMES = 2;
const SCOUT_COST = 0.04;
/** 개인 조건 협상에서 이만큼 거절당하면 선수가 떠난다. */
const MAX_TALKS = 3;
/** 한 선수를 한 시장에서 팔아 보려는 시도 횟수. */
const SALE_TRIES = 2;

const nationOf = (g: Game): boolean => myClub(g).nation;
const all = (g: Game): Player[] => [...g.squad, ...g.reserves];
/** 금액 슬라이더의 눈금. 금액이 클수록 크게 움직인다. */
const stepFor = (v: number): number => (v >= 1000 ? 10 : v >= 100 ? 1 : 0.1);

function leagueClub(g: Game, offset: number): string {
  const club = myClub(g);
  // offset 0은 같은 리그, -1은 한 단계 아래 리그(없으면 같은 리그).
  const league = (offset < 0 ? LEAGUES[club.league]!.down : null) ?? club.league;
  const pool = g.leagues[league].filter((id) => id !== club.id);
  return (g.clubs[pick(g, pool)] as Club).name;
}

/** 판매 구단 후보: 우리와 같은 리그나 한 단계 아래 리그의 구단. */
const sellerName = (g: Game): string => (nationOf(g) ? '소속 구단' : leagueClub(g, -int(g, 0, 1)));

function newDeal(g: Game, id: string, kind: Deal['kind'], player: Player, price: number, tag: string, from: string): Deal {
  const ask = askOf(g, player, kind === 'renew');
  if (kind === 'youth') {
    ask.promise = 'backup';
    ask.wage = round1(ask.wage * 0.5);
  }
  return {
    id, kind, player, price, from, tag, stage: kind === 'sign' ? 'fee' : kind === 'loan' ? 'loan' : 'terms',
    draft: { fee: price, sellOn: 0, inst: 1 }, fee: 0, sellOn: 0, inst: 1, ask, offer: defaultTerms(ask), loan: null, tries: 0, talks: 0,
  };
}

/** 후보 하나를 만든다. 성격(tag)에 따라 나이, OVR, 값이 다르다. */
function candidate(g: Game, id: string, pos: Pos, tag: string): Deal {
  const { level, where } = stage(g);
  const nation = nationOf(g);
  const eye = (g.manager.attrs.eye - 6) / 4;
  const current = weakest(g.squad, pos);
  let ovr: number;
  let age: number;
  if (tag === '유망주') {
    ovr = level - int(g, 2, 6) + eye;
    age = int(g, 18, 21);
  } else if (tag === '베테랑') {
    ovr = level + spread(g, 0, 4) + eye;
    age = int(g, 31, 34);
  } else if (tag === '자유계약') {
    ovr = level - spread(g, 2, 6) + eye;
    age = int(g, 26, 33);
  } else {
    ovr = Math.max(current.ovr + 1, level + spread(g, -2, 5) + eye);
    age = int(g, 22, 29);
  }
  // 대표팀은 그 나라 선수층의 한계를 넘는 선수를 부를 수 없다.
  if (nation) ovr = Math.min(level + 4, ovr);
  const player = makePlayer(g, pos, Math.round(ovr), age, where, nation);
  if (tag === '유망주') player.pot = Math.min(99, player.ovr + int(g, 8, 18));
  if (nation) return newDeal(g, id, 'free', player, 0, tag, '소속 구단');
  if (tag === '자유계약') return newDeal(g, id, 'free', player, 0, tag, '무소속');
  // 지금 소속 구단과의 계약. 남은 기간이 짧을수록 싸게 판다. 바이아웃이 걸린 선수도 있다.
  const years = int(g, 1, 4);
  player.contract = { wage: wageFor(g, player), years, promise: 'starter', clause: null, sellOn: 0, since: g.year - int(g, 0, 3) };
  if (chance(g, 0.3)) player.contract.clause = clauseAmount(g, player, chance(g, 0.5) ? 'low' : 'high');
  const premium = (tag === '즉시 전력' ? 1.5 : tag === '베테랑' ? 0.8 : 1) * (years === 1 ? 0.6 : years >= 3 ? 1.1 : 1);
  return newDeal(g, id, 'sign', player, round1(priceFor(g, player) * premium), tag, sellerName(g));
}

/** 임대 후보. 윗물 구단에서 뛸 자리가 없는 젊은 선수다. 원 소속 구단은 연봉 분담과 임대료, 출전 시간을 따진다. */
function loanCandidate(g: Game, id: string, pos: Pos, kind: 'summer' | 'winter'): Deal {
  const { level, where } = stage(g);
  const eye = (g.manager.attrs.eye - 6) / 4;
  const player = makePlayer(g, pos, Math.round(level + spread(g, -1, 4) + eye), int(g, 19, 23), where);
  player.pot = Math.min(99, player.ovr + int(g, 4, 12));
  // 큰 구단 선수라 시장 연봉보다 더 받는다. 아마추어 리그면 연봉 없이 온다.
  player.contract = { wage: round1(wageFor(g, player) * 1.3), years: int(g, 2, 4), promise: 'rotation', clause: null, sellOn: 0, since: g.year - 1 };
  const d = newDeal(g, id, 'loan', player, 0, '임대', leagueClub(g, 1));
  const askShare = round1(spread(g, 0.5, 1) * 20) / 20;
  const askFee = round1(marketValue(g, player) * spread(g, 0.03, 0.1));
  d.loan = { until: 'end', share: askShare, fee: askFee, askShare, askFee };
  d.offer.promise = 'starter';
  d.ask.promise = 'starter';
  void kind;
  return d;
}

/** 시장에 나온 후보들. 여름에는 여섯과 임대 둘, 겨울에는 넷과 임대 하나. 스카우팅이 좋으면 하나 더. */
function scoutList(g: Game, kind: 'summer' | 'winter', round: number): Deal[] {
  const nation = nationOf(g);
  const count = (kind === 'summer' ? 6 : 4) + (g.manager.attrs.eye >= 12 ? 1 : 0);
  const needs = [...g.squad].sort((a, b) => a.ovr - b.ovr).map((p) => p.pos);
  const tags = nation ? ['즉시 전력', '즉시 전력', '유망주', '베테랑'] : ['즉시 전력', '즉시 전력', '유망주', '베테랑', '자유계약', '즉시 전력', '유망주'];
  const list: Deal[] = [];
  for (let i = 0; i < count; i++) {
    const pos = i < 3 ? (needs[i] as Pos) : pick(g, ['GK', 'DF', 'MF', 'FW'] as Pos[]);
    list.push(candidate(g, `c${round}-${i}`, pos, tags[i % tags.length] as string));
  }
  if (!nation) {
    for (let i = 0; i < (kind === 'summer' ? 2 : 1); i++) list.push(loanCandidate(g, `l${round}-${i}`, (needs[i] as Pos) ?? 'MF', kind));
  }
  if (!nation && kind === 'summer' && round === 0) {
    const { level, where } = stage(g);
    const oldest = [...g.squad].sort((a, b) => b.age - a.age)[0] as Player;
    const kid = makePlayer(g, oldest.pos, level - int(g, 3, 8), int(g, 17, 18), where, true);
    kid.pot = Math.min(99, kid.ovr + int(g, 8, 16) + Math.round(g.manager.attrs.youth / 2));
    kid.homegrown = true;
    kid.hg = true;
    list.push(newDeal(g, 'youth', 'youth', kid, 0, '유스', '유소년 팀'));
  }
  return list;
}

/** 계약이 이번 시즌으로 끝나는 선수들과의 재계약 협상. 임대 온 선수는 뺀다. */
function renewals(g: Game): Deal[] {
  if (nationOf(g)) return [];
  return all(g).filter((p) => p.contract && p.contract.years <= 1 && !p.loan).map((p) => newDeal(g, `r${p.id}`, 'renew', p, 0, '재계약', myClub(g).name));
}

/** 다른 구단의 제안. 리그 수준을 넘어선 선수, 불만이 있는 선수에게 들어온다. 바이아웃을 채우면 발동이다. */
function makeBids(g: Game, kind: 'summer' | 'winter'): TransferWindow['bids'] {
  if (nationOf(g)) return [];
  const club = myClub(g);
  const { level } = stage(g);
  const upper = LEAGUES[club.league]!.up ?? club.league;
  const suitors = [...g.leagues[upper], ...g.leagues[club.league]].filter((id) => id !== club.id).map((id) => g.clubs[id] as Club);
  const bids: TransferWindow['bids'] = [];
  for (const p of all(g).filter((q) => !q.loan).sort((a, b) => b.ovr - a.ovr)) {
    if (bids.length >= 2) break;
    // 리그 수준을 한참(3 이상) 넘어선 선수와 불만 있는 선수에게만 제안이 온다.
    const hot = p.ovr - level;
    const want = (kind === 'summer' ? 0.2 : 0.1) + Math.max(0, hot - 3) * 0.06 + (p.unhappy ? 0.4 : 0);
    if ((hot < 3 && !p.unhappy) || !chance(g, clamp(want, 0, 0.8))) continue;
    const suitor = pick(g, suitors);
    // 계약이 얼마 안 남은 선수는 싸게 부른다.
    const lastYear = (p.contract?.years ?? 2) <= 1;
    let fee = round1(marketValue(g, p) * spread(g, 0.9, 1.4) * (lastYear ? 0.6 : 1));
    const clause = p.contract?.clause ?? null;
    const trigger = clause !== null && (fee >= clause || (hot >= 4 && chance(g, 0.5)));
    if (trigger) fee = clause as number;
    bids.push({ id: `b${bids.length}`, player: p.id, club: suitor.name, fee, clause: trigger, countered: false });
  }
  return bids;
}

/**
 * 임대 기간이 끝난 선수를 정리한다. 빌려 온 선수는 원 소속 구단으로 돌아가고(선발이면 빈자리를 채운다),
 * 빌려준 선수는 후보 명단으로 돌아온다. 설명 줄을 돌려준다.
 */
export function returnLoans(g: Game, when: 'winter' | 'end'): string[] {
  if (nationOf(g)) return [];
  const lines: string[] = [];
  const { level, where } = stage(g);
  for (const p of all(g)) {
    if (p.loan?.dir !== 'in' || p.loan.until !== when) continue;
    if (g.squad.includes(p)) lines.push(ko`임대가 끝나 ${p.name}이 ${p.loan.club}으로 돌아갔다. ${fillSlot(g, p, level - 2, where)}`);
    else {
      g.reserves = g.reserves.filter((q) => q.id !== p.id);
      lines.push(ko`임대가 끝나 ${p.name}이 ${p.loan.club}으로 돌아갔다.`);
    }
  }
  for (const p of [...g.loaned]) {
    if (p.loan?.until !== when) continue;
    g.loaned = g.loaned.filter((q) => q.id !== p.id);
    lines.push(ko`${p.loan.club}에 임대 보냈던 ${p.name}(OVR ${p.ovr})이 돌아왔다.`);
    p.loan = null;
    g.reserves.push(p);
  }
  settle(g);
  return lines;
}

export function openWindow(g: Game, kind: 'summer' | 'winter'): void {
  const back = kind === 'winter' ? returnLoans(g, 'winter') : [];
  g.window = {
    kind, list: [...renewals(g), ...scoutList(g, kind, 0)], bids: makeBids(g, kind), view: null, log: back,
    signed: 0, sold: 0, scouted: 0, depthDone: false,
    sale: { price: 0, tries: {} }, lend: { until: 'end', share: 0.5, fee: 0 },
  };
}

// ---------- 돈 계산 ----------

/** 서명할 때 이적 예산에서 바로 나가는 돈: 이적료(분할이면 첫 회분), 에이전트 수수료, 계약금, 임대료. */
export function upfront(d: Deal): { fee: number; later: number; agent: number; bonus: number; total: number } {
  if (d.kind === 'loan') {
    const fee = round1(d.loan?.fee ?? 0);
    return { fee, later: 0, agent: 0, bonus: 0, total: fee };
  }
  const full = d.kind === 'sign' ? d.fee : 0;
  const fee = round1(full / d.inst);
  const later = round1(full - fee);
  const agent = d.kind === 'renew' ? round1(agentFee(0, d.offer.wage, d.offer.agent) * 0.4) : agentFee(full, d.offer.wage, d.offer.agent);
  const bonus = signingBonus(d.offer);
  return { fee, later, agent, bonus, total: round1(fee + agent + bonus) };
}

/** 이 계약으로 우리가 내게 될 연봉. */
const wageOf = (d: Deal): number => (d.kind === 'loan' ? round1((d.player.contract?.wage ?? 0) * (d.loan?.share ?? 1)) : d.offer.wage);

/** 서명하면 연봉 총액이 얼마가 되는지. 재계약은 지금 연봉을 빼고 센다. */
const wagesAfter = (g: Game, d: Deal): number => round1(totalWages(g, d.kind === 'renew' ? d.player.id : undefined) + wageOf(d));

/** 서명하면 선발로 들어가는지. */
const startsOnSign = (d: Deal): boolean => (d.kind === 'loan' ? d.offer.promise === 'starter' || d.offer.promise === 'star' : d.offer.promise === 'star' || d.offer.promise === 'starter');

/** 서명을 막는 사유. 없으면 null. */
function blocker(g: Game, d: Deal): string | null {
  if (nationOf(g)) return g.window!.signed >= NATION_CHANGES ? `이번 소집에서 바꿀 수 있는 ${NATION_CHANGES}자리를 다 썼다` : null;
  const job = g.job!;
  if (upfront(d).total > job.budget) return '이적 예산이 모자란다';
  // 재계약은 이사회가 연봉 예산의 10%까지 넘는 것을 눈감아 준다.
  const cap = job.wageBudget * (d.kind === 'renew' ? 1.1 : 1);
  if (!amateur(g) && wagesAfter(g, d) > cap) return `연봉 예산 초과(${won(wagesAfter(g, d))} / ${won(cap)})`;
  if (d.kind === 'renew') return null;
  // 주전으로 오면 밀려난 선수가, 후보로 오면 본인이 후보 명단에 들어간다.
  if (g.reserves.length >= RESERVE_LIMIT) return `등록 인원이 꽉 찼다(후보 ${RESERVE_LIMIT}명). 먼저 판매, 임대, 계약 해지로 자리를 비워라`;
  const eng = englandCheck(g, d.player);
  if (eng.why) return eng.why;
  const q = quota(g);
  const euCap = nonEuSigningLimit(g);
  if (euCap !== null && d.kind !== 'youth' && g.window!.kind === 'summer' && nonEu(d.player) && (g.window!.nonEu ?? 0) >= euCap) return `해외 비EU 선수 신규 영입은 여름 시장에 ${euCap}명까지다`;
  if (isForeign(g, d.player)) {
    if (q.reg !== null && foreignCount(g, all(g)) >= q.reg) return `${quotaWord(g)} 등록 한도(${q.reg}명)가 찼다`;
    if (q.pitch !== null && startsOnSign(d)) {
      const out = weakest(g.squad, d.player.pos);
      if (foreignCount(g, g.squad) - (isForeign(g, out) ? 1 : 0) + 1 > q.pitch) return `${quotaWord(g)} 선발 한도(${q.pitch}명)를 넘는다. 출전 보장을 로테이션 이하로 하거나 ${quotaWord(g)} 선발을 먼저 빼라`;
    }
  }
  return null;
}

// ---------- 장면 ----------

function dealLabel(d: Deal): string {
  const p = d.player;
  return `${p.spot} ${p.name} · ${p.age}세 · OVR ${p.ovr}`;
}

/** 맡은 팀 나라의 국적. */
const localNat = (g: Game): string => (myClub(g).nation ? '대한민국' : COUNTRIES[countryOf(myClub(g).league)].name);

/** 비교 표의 색: 우리 제안이 요구 이상이면 good, 모자라면 bad. */
const vs = (offer: number, ask: number): Tone => (offer >= ask - 1e-9 ? 'good' : 'bad');

/** 협상 테이블 블록. */
function dealBlock(g: Game, p: Player, note: string, side: string, rows: DealRow[], odds: number | null, oddsLabel: string, money: { label: string; value: string; tone?: Tone }[], compare = true): Block {
  return { kind: 'deal', player: p, note, gain: compare ? p.ovr - weakest(g.squad, p.pos).ovr : undefined, side, rows, odds, oddsLabel, money };
}

const natText = (g: Game, p: Player): string => (isForeign(g, p) ? ` · ${quotaWord(g)}(${p.nat})` : inEngland(g) ? ` · ${p.nat} · ${englandText(g, p)}` : ` · ${p.nat}`);

function feeScene(g: Game, d: Deal, eyebrow: string): void {
  const p = d.player;
  const c = p.contract;
  const budget = g.job!.budget;
  const draft = d.draft;
  const frac = draft.fee / Math.max(0.1, d.price);
  const odds = feeOdds(g, d, frac, draft.sellOn, draft.inst);
  const now = round1(draft.fee / draft.inst);
  const blocks: Block[] = [
    dealBlock(g, p, `${d.tag} · ${potentialText(g, p)}${natText(g, p)}`, `${d.from} 요구`, [
      { label: '이적료', ask: won(d.price), offer: won(draft.fee), tone: vs(draft.fee, d.price) },
      { label: '셀온 조항', ask: '없음', offer: draft.sellOn > 0 ? pct(draft.sellOn) : '없음', tone: draft.sellOn > 0 ? 'good' : 'plain' },
      { label: '지급 방식', ask: '일시불', offer: draft.inst > 1 ? `${draft.inst}시즌 분할` : '일시불', tone: draft.inst > 1 ? 'bad' : 'good' },
    ], odds, '수락 가능성', [
      { label: '지금 나갈 이적료 / 예산', value: `${won(now)} / ${won(budget)}`, tone: now > budget ? 'bad' : 'plain' },
      { label: '지금 계약', value: c ? `${c.years}년 남음 · 연봉 ${won(c.wage)}` : '-' },
      { label: '바이아웃', value: c?.clause ? won(c.clause) : '없음' },
    ]),
    {
      kind: 'form', title: `${d.from}에 보내는 이적 제안`, rows: [
        { label: '이적료', note: `요구액의 ${pct(frac)}`, range: { id: 'f:fee', min: round1(d.price * 0.4), max: round1(Math.max(d.price * 1.6, c?.clause ?? 0)), step: stepFor(d.price), value: draft.fee, unit: 'money' } },
        { label: '셀온 조항', note: draft.sellOn > 0 ? `나중에 팔면 이적료의 ${pct(draft.sellOn)}를 ${d.from}에 준다` : '없음', range: { id: 'f:sellon', min: 0, max: 0.4, step: 0.05, value: draft.sellOn, unit: 'pct' } },
        { label: '지급 방식', note: draft.inst > 1 ? `지금 ${won(now)}, 다음 ${draft.inst - 1}시즌 동안 시즌마다 ${won(now)}` : '일시불', options: [1, 2, 3].map((n) => ({ id: `f:inst:${n}`, label: n === 1 ? '일시불' : `${n}시즌 분할`, on: draft.inst === n })) },
      ],
    },
    { kind: 'text', text: ko`1단계: ${d.from}과 이적료 합의 → 2단계: 선수 측과 개인 조건 → 서명. 이적료는 서명할 때 나간다.${d.tries > 0 ? ` 지금까지 ${d.tries}번 거절당했다.` : ''}` },
  ];
  const choices: Choice[] = [
    { id: 'submit', label: `${won(draft.fee)} 제안을 보낸다`, tone: 'primary', disabled: now > budget, detail: now > budget ? '이적 예산이 모자란다' : frac >= 1 && draft.inst === 1 ? '요구액 이상이라 바로 합의한다' : '거절되면 다시 제안할 수 있지만, 판매 구단이 협상을 끊을 수도 있다' },
  ];
  if (c?.clause) choices.push({ id: 'fee:clause', label: `바이아웃 ${won(c.clause)} 지불`, detail: '판매 구단은 거절할 수 없다. 곧장 개인 조건 협상으로 간다', disabled: c.clause > budget });
  choices.push({ id: 'back', label: '목록으로' });
  g.scene = { eyebrow, title: `${p.name} 이적료 협상`, blocks, choices };
}

function termsScene(g: Game, d: Deal, eyebrow: string): void {
  const p = d.player;
  const t = d.offer;
  if (nationOf(g)) {
    const why = blocker(g, d);
    g.scene = {
      eyebrow, title: dealLabel(d),
      blocks: [{ kind: 'card', player: p, compare: weakest(g.squad, p.pos), note: `${d.tag} · ${potentialText(g, p)}` }],
      choices: [
        { id: 'submit', label: `${p.name} 발탁`, tone: 'primary', disabled: !!why, detail: why ?? '소집 명단에 넣는다' },
        { id: 'back', label: '목록으로' },
      ],
    };
    return;
  }
  const odds = termsOdds(g, d);
  const cost = upfront(d);
  const free = amateur(g);
  const value = Math.max(0.1, marketValue(g, p));
  const wageMax = Math.max(1, d.ask.wage * 2.5);
  const blocks: Block[] = [];
  const why = blocker(g, d);
  blocks.push(dealBlock(g, p, `${d.tag} · ${potentialText(g, p)}${natText(g, p)}`, `${p.name} 측 요구`, [
    ...(free ? [] : [{ label: '연봉', ask: won(d.ask.wage), offer: won(t.wage), tone: vs(t.wage, d.ask.wage) }]),
    { label: '계약 기간', ask: `${d.ask.years}년`, offer: `${t.years}년`, tone: t.years === d.ask.years ? ('good' as Tone) : ('plain' as Tone) },
    { label: '출전 보장', ask: PROMISES[d.ask.promise].name, offer: PROMISES[t.promise].name, tone: vs(PROMISES[d.ask.promise].rank, PROMISES[t.promise].rank) },
    { label: '바이아웃', ask: '낮을수록', offer: t.clause > 0 ? won(t.clause) : '없음', tone: t.clause > 0 ? 'good' : 'bad' },
    ...(free ? [] : [{ label: '계약금', ask: '있으면 좋다', offer: t.bonus > 0 ? won(t.bonus) : '없음', tone: (t.bonus > 0 ? 'good' : 'plain') as Tone }]),
    { label: '에이전트 수수료', ask: `${d.ask.agent}%`, offer: `${t.agent}%`, tone: vs(t.agent, d.ask.agent) },
  ], odds, '합의 가능성', [
    ...(d.kind === 'sign' ? [{ label: d.inst > 1 ? `이적료(${d.inst}시즌 분할 첫 회)` : '합의한 이적료', value: won(cost.fee) }] : []),
    ...(cost.later > 0 ? [{ label: '다음 시즌부터 낼 이적료', value: won(cost.later) }] : []),
    { label: '지금 나갈 돈 / 이적 예산', value: `${won(cost.total)} / ${won(g.job!.budget)}`, tone: cost.total > g.job!.budget ? 'bad' : 'plain' },
    ...(free ? [] : [{ label: '서명 후 연봉 총액 / 예산', value: `${won(wagesAfter(g, d))} / ${won(g.job!.wageBudget)}`, tone: wagesAfter(g, d) > g.job!.wageBudget ? ('bad' as const) : ('plain' as const) }]),
  ], d.kind !== 'renew'));
  if (d.kind === 'renew') blocks.push({ kind: 'text', text: ko`${p.name}의 계약은 이번 시즌으로 끝난다. 재계약하지 못하면 시즌이 끝나고 자유계약으로 떠난다(보스만 룰).${p.unhappy ? ' 지금 팀에 불만이 있어 협상이 어렵다.' : ''}` });
  blocks.push({
    kind: 'form', title: `${p.name} 계약 제안서`, rows: [
      ...(free ? [] : [{ label: '연봉(한 시즌)', note: `요구액의 ${pct(t.wage / Math.max(0.1, d.ask.wage))}`, range: { id: 't:wage', min: round1(Math.max(0.1, d.ask.wage * 0.4)), max: round1(wageMax), step: stepFor(d.ask.wage), value: t.wage, unit: 'money' as const } }]),
      { label: '계약 기간', note: `${g.year + t.years - 1}년 시즌 끝 만료`, options: [1, 2, 3, 4, 5].map((y) => ({ id: `t:years:${y}`, label: `${y}년`, on: t.years === y })) },
      { label: '출전 보장', note: PROMISES[t.promise].desc, options: PROMISE_IDS.map((id) => ({ id: `t:promise:${id}`, label: PROMISES[id].name, on: t.promise === id })) },
      { label: '바이아웃', note: t.clause > 0 ? `${won(t.clause)}(시장가의 ${(t.clause / value).toFixed(1)}배)에 다른 구단이 데려갈 수 있다` : '없음. 좋은 선수는 싫어한다', range: { id: 't:clause', min: 0, max: round1(value * 5), step: stepFor(value), value: t.clause, unit: 'money' } },
      ...(free ? [] : [{ label: '계약금', note: t.bonus > 0 ? `연봉의 ${pct(t.bonus / Math.max(0.1, t.wage))} 일시불` : '없음', range: { id: 't:bonus', min: 0, max: round1(Math.max(1, t.wage * 1.5)), step: stepFor(t.wage), value: t.bonus, unit: 'money' as const } }]),
      { label: '에이전트 수수료율', note: `요구 ${d.ask.agent}% · ${won(cost.agent)}`, range: { id: 't:agent', min: 0, max: 15, step: 1, value: t.agent, unit: 'pct100' } },
    ],
  });
  if (d.talks > 0) blocks.push({ kind: 'note', text: `${d.talks}번 거절당했다. ${MAX_TALKS}번 거절당하면 협상이 끝난다.`, tone: 'bad' });
  g.scene = {
    eyebrow, title: d.kind === 'renew' ? `${p.name} 재계약` : `${p.name} 개인 조건 협상`, blocks,
    choices: [
      { id: 'submit', label: '제안서를 보낸다', tone: 'primary', disabled: !!why, detail: why ?? `합의하면 바로 서명한다${cost.total > 0 ? ` · ${won(cost.total)} 지출` : ''}` },
      { id: 'back', label: d.kind === 'renew' ? '나중에 다시 한다' : '협상을 잠시 미룬다', detail: d.kind === 'sign' ? '합의한 이적료는 이번 시장 동안 유지된다' : undefined },
    ],
  };
}

/** 원 소속 구단이 임대 조건을 받아들일 가능성. */
function loanOdds(g: Game, d: Deal): number {
  const l = d.loan!;
  const promise = d.offer.promise === 'star' || d.offer.promise === 'starter' ? 0.25 : d.offer.promise === 'rotation' ? 0 : -0.35;
  const fee = l.askFee > 0 ? clamp((l.fee - l.askFee) / l.askFee, -1, 1) * 0.25 : 0;
  return clamp(0.5 + (l.share - l.askShare) * 1.6 + fee + promise + (g.manager.attrs.deal - 6) * 0.03 - d.talks * 0.1, 0.03, 0.97);
}

function loanScene(g: Game, d: Deal, eyebrow: string): void {
  const p = d.player;
  const l = d.loan!;
  const w = g.window!;
  const odds = loanOdds(g, d);
  const why = blocker(g, d);
  const wage = p.contract?.wage ?? 0;
  g.scene = {
    eyebrow, title: `${dealLabel(d)} 임대`,
    blocks: [
      dealBlock(g, p, `${d.from} 소속 · ${potentialText(g, p)}${natText(g, p)}`, `${d.from} 요구`, [
        { label: '우리가 낼 연봉', ask: pct(l.askShare), offer: pct(l.share), tone: vs(l.share, l.askShare) },
        { label: '임대료', ask: won(l.askFee), offer: won(l.fee), tone: vs(l.fee, l.askFee) },
        { label: '출전 보장', ask: '주전', offer: PROMISES[d.offer.promise].name, tone: vs(PROMISES[d.offer.promise].rank, PROMISES.starter.rank) },
        { label: '기간', ask: '-', offer: l.until === 'winter' ? '반 시즌' : w.kind === 'summer' ? '한 시즌' : '시즌 끝까지', tone: 'plain' },
      ], odds, '수락 가능성', [
        { label: '임대료 / 이적 예산', value: `${won(l.fee)} / ${won(g.job!.budget)}`, tone: l.fee > g.job!.budget ? 'bad' : 'plain' },
        ...(amateur(g) ? [] : [{ label: '서명 후 연봉 총액 / 예산', value: `${won(wagesAfter(g, d))} / ${won(g.job!.wageBudget)}`, tone: wagesAfter(g, d) > g.job!.wageBudget ? ('bad' as const) : ('plain' as const) }]),
      ]),
      { kind: 'text', text: ko`${d.from}은 ${p.name}이 경기를 뛰며 크기를 바란다. 임대가 끝나면 원 소속 구단으로 돌아간다.` },
      {
        kind: 'form', title: `${d.from}에 보내는 임대 제안`, rows: [
          { label: '임대 기간', note: l.until === 'winter' ? '겨울 이적시장에 돌아간다' : '시즌이 끝나면 돌아간다', options: (w.kind === 'summer' ? (['winter', 'end'] as const) : (['end'] as const)).map((u) => ({ id: `l:until:${u}`, label: u === 'winter' ? '반 시즌' : w.kind === 'summer' ? '한 시즌' : '시즌 끝까지', on: l.until === u })) },
          { label: '우리가 낼 연봉', note: `${won(round1(wage * l.share))}(연봉 ${won(wage)}의 ${pct(l.share)})`, range: { id: 'l:share', min: 0, max: 1, step: 0.05, value: l.share, unit: 'pct' } },
          { label: '임대료', note: `요구 ${won(l.askFee)}`, range: { id: 'l:fee', min: 0, max: round1(Math.max(1, l.askFee * 3)), step: stepFor(l.askFee), value: l.fee, unit: 'money' } },
          { label: '출전 보장', note: PROMISES[d.offer.promise].desc, options: (['starter', 'rotation', 'backup'] as PromiseId[]).map((id) => ({ id: `t:promise:${id}`, label: PROMISES[id].name, on: d.offer.promise === id })) },
        ],
      },
    ],
    choices: [
      { id: 'submit', label: '임대 제안을 보낸다', tone: 'primary', disabled: !!why, detail: why ?? '합의하면 바로 합류한다' },
      { id: 'back', label: '목록으로' },
    ],
  };
}

/** 우리 선수를 팔 때 받을 만한 값(시장가 기준). 계약이 1년 남았으면 크게 떨어진다. */
function saleValue(g: Game, p: Player): number {
  const lastYear = (p.contract?.years ?? 2) <= 1;
  return round1(marketValue(g, p) * (lastYear ? 0.55 : 1));
}

/** 그 희망가에 사려는 구단이 나올 가능성. */
function saleOdds(g: Game, p: Player, price: number): number {
  const ratio = price / Math.max(0.1, saleValue(g, p));
  return clamp(1.35 - ratio * 0.65 + (g.manager.attrs.deal - 6) * 0.02 + (p.unhappy ? 0.1 : 0), 0.03, 0.95);
}

/** 임대를 받아 줄 구단이 나올 가능성. share는 상대가 낼 연봉 비율. */
function lendOdds(g: Game, p: Player, share: number, fee: number): number {
  const value = Math.max(0.1, marketValue(g, p));
  return clamp(0.35 + (1 - share) * -0.45 + 0.45 + (p.age <= 23 ? 0.15 : 0) - (fee / (value * 0.1)) * 0.12, 0.03, 0.95);
}

function sellScene(g: Game, eyebrow: string): void {
  const choices: Choice[] = [];
  const row = (p: Player, group: string): void => {
    if (p.loan) {
      choices.push({ id: `noop:${p.id}`, group, label: `${p.spot} ${p.name} · ${p.loan.club}에서 임대 중`, detail: '빌려 온 선수는 팔거나 다시 빌려줄 수 없다', disabled: true });
      return;
    }
    choices.push({ id: `sale:${p.id}`, group, label: `${p.spot} ${p.name} 판매 협상`, detail: `OVR ${p.ovr + p.temp} · ${p.age}세 · 시장가 ${won(saleValue(g, p))} · ${contractText(g, p.contract)}` });
    choices.push({ id: `lend:${p.id}`, group, label: `${p.name} 임대 보내기`, detail: '기간, 연봉 분담, 임대료를 정해 다른 구단에 빌려준다. 뛰면서 큰다' });
    if (group === '후보') {
      const pay = releaseCost(p);
      choices.push({ id: `release:${p.id}`, group, label: `${p.name} 계약 해지 · 위약금 ${won(pay)}`, detail: '남은 연봉의 절반을 주고 내보낸다', disabled: pay > g.job!.budget });
    }
  };
  for (const p of g.squad) row(p, '선발');
  for (const p of g.reserves) row(p, '후보');
  choices.push({ id: 'back', label: '목록으로', group: ' ' });
  const away = g.loaned.map((p) => `${p.name}(${p.loan?.club}, ${p.loan?.until === 'winter' ? '겨울 복귀' : '시즌 끝 복귀'})`).join(', ');
  g.scene = {
    eyebrow, title: '판매 · 임대 · 방출',
    blocks: [
      { kind: 'text', text: '선발을 팔거나 임대 보내면 같은 포지션 후보 중 가장 좋은 선수가 올라가고, 없으면 2군 선수가 메운다. 판매는 희망가를 정해 구매 구단을 찾는다. 핵심 선수를 팔면 라커룸 분위기가 흔들린다.' },
      ...(away ? [{ kind: 'note' as const, text: `임대 보낸 선수: ${away}`, tone: 'plain' as const }] : []),
    ],
    choices,
  };
}

function saleScene(g: Game, p: Player, eyebrow: string): void {
  const w = g.window!;
  const value = saleValue(g, p);
  const odds = saleOdds(g, p, w.sale.price);
  const left = SALE_TRIES - (w.sale.tries[p.id] ?? 0);
  const share = p.contract?.sellOn ? round1(w.sale.price * p.contract.sellOn) : 0;
  g.scene = {
    eyebrow, title: `${p.name} 판매`,
    blocks: [
      dealBlock(g, p, `${contractText(g, p.contract)}${natText(g, p)}`, '시장 평가', [
        { label: '이적료', ask: won(value), offer: won(w.sale.price), tone: w.sale.price <= value ? 'good' : 'bad' },
      ], odds, '사려는 구단이 나올 가능성', [
        ...(share > 0 ? [{ label: '셀온 조항으로 전 소속 구단 몫', value: won(share) }] : []),
        { label: '이번 시장 남은 시도', value: `${left}번`, tone: left <= 0 ? ('bad' as const) : undefined },
      ], false),
      { kind: 'form', title: '판매 조건', rows: [{ label: '희망 이적료', note: `시장가 ${won(value)}의 ${pct(w.sale.price / Math.max(0.1, value))}`, range: { id: 's:price', min: round1(value * 0.3), max: round1(value * 2.5), step: stepFor(value), value: w.sale.price, unit: 'money' } }] },
    ],
    choices: [
      { id: 'sell', label: `${won(w.sale.price)}에 내놓는다`, tone: 'primary', disabled: left <= 0, detail: left <= 0 ? '이번 시장에서는 더 시도할 수 없다' : '사려는 구단이 나오면 바로 팔린다' },
      { id: 'back', label: '목록으로' },
    ],
  };
}

function lendScene(g: Game, p: Player, eyebrow: string): void {
  const w = g.window!;
  const l = w.lend;
  const odds = lendOdds(g, p, l.share, l.fee);
  const wage = p.contract?.wage ?? 0;
  g.scene = {
    eyebrow, title: `${p.name} 임대 보내기`,
    blocks: [
      dealBlock(g, p, contractText(g, p.contract), '상대 구단이 바라는 것', [
        { label: '상대가 낼 연봉', ask: '낮을수록', offer: pct(l.share), tone: l.share <= 0.5 ? 'good' : 'bad' },
        { label: '받을 임대료', ask: '없을수록', offer: won(l.fee), tone: l.fee > 0 ? 'bad' : 'good' },
        { label: '기간', ask: '-', offer: l.until === 'winter' ? '반 시즌' : w.kind === 'summer' ? '한 시즌' : '시즌 끝까지', tone: 'plain' },
      ], odds, '받아 줄 구단이 나올 가능성', [{ label: '우리가 계속 낼 연봉', value: won(round1(wage * (1 - l.share))) }], false),
      {
        kind: 'form', title: '임대 조건', rows: [
          { label: '임대 기간', note: l.until === 'winter' ? '겨울 이적시장에 돌아온다' : '시즌이 끝나면 돌아온다', options: (w.kind === 'summer' ? (['winter', 'end'] as const) : (['end'] as const)).map((u) => ({ id: `l:until:${u}`, label: u === 'winter' ? '반 시즌' : w.kind === 'summer' ? '한 시즌' : '시즌 끝까지', on: l.until === u })) },
          { label: '상대 구단이 낼 연봉', note: `${won(round1(wage * l.share))}(연봉 ${won(wage)}의 ${pct(l.share)})`, range: { id: 'l:share', min: 0, max: 1, step: 0.05, value: l.share, unit: 'pct' } },
          { label: '받을 임대료', range: { id: 'l:fee', min: 0, max: round1(Math.max(1, marketValue(g, p) * 0.3)), step: stepFor(marketValue(g, p) * 0.1), value: l.fee, unit: 'money' } },
        ],
      },
      { kind: 'text', text: '임대 간 선수는 등록 인원에 세지 않고, 경기를 뛰며 조금 더 큰다. 연봉은 상대 구단이 내는 몫을 빼고 우리가 낸다.' },
    ],
    choices: [
      { id: 'lend', label: '임대 제안을 돌린다', tone: 'primary', detail: '받아 줄 구단이 나오면 바로 떠난다' },
      { id: 'back', label: '목록으로' },
    ],
  };
}

/** 계약 한 줄 요약(카드용). */
function contractShort(g: Game, p: Player): string {
  const c = p.contract;
  if (!c) return '계약 없음';
  return `${amateur(g) ? '무급' : `연봉 ${won(c.wage)}`} · ${c.years}년 남음`;
}

/** 이적시장 첫 화면: 위에는 예산과 규정, 가운데는 탭으로 나눈 선수 카드, 아래는 구단 운영과 마감. */
function listScene(g: Game, eyebrow: string): void {
  const w = g.window as TransferWindow;
  const nation = nationOf(g);
  const job = g.job!;
  const title = nation ? '대표팀 소집 명단' : w.kind === 'summer' ? '여름 이적시장' : '겨울 이적시장';
  const blocks: Block[] = [];
  const choices: Choice[] = [];
  const hide = (id: string, label = id): void => {
    choices.push({ id, label, hidden: true });
  };
  if (nation) blocks.push({ kind: 'text', text: `이번 소집에서 ${NATION_CHANGES - w.signed}자리를 더 바꿀 수 있다.` });
  else {
    const q = quota(g);
    blocks.push({
      kind: 'stats', rows: [
        { label: '이적 예산', value: won(job.budget), tone: job.budget < 0 ? 'bad' : 'plain' },
        ...(amateur(g) ? [{ label: '연봉', value: '무급(아마추어 리그)' }] : [{ label: '연봉 총액 / 예산', value: `${won(totalWages(g))} / ${won(job.wageBudget)}`, tone: totalWages(g) > job.wageBudget ? ('bad' as const) : ('plain' as const) }]),
        { label: '등록 선수', value: `선발 ${g.squad.length} · 후보 ${g.reserves.length}/${RESERVE_LIMIT}${g.loaned.length ? ` · 임대 보냄 ${g.loaned.length}` : ''}` },
        ...(inEngland(g) ? [{ label: '잉글랜드 규정', value: `비홈그로운(21세 이상) ${englandStatus(g).nonHg}/${NON_HG_LIMIT} · ESC 슬롯 ${englandStatus(g).esc}/${ESC_SLOTS}`, tone: englandStatus(g).nonHg > NON_HG_LIMIT ? ('bad' as const) : ('plain' as const) }] : []),
        ...(q.pitch !== null || q.reg !== null ? [{ label: quotaWord(g), value: `등록 ${foreignCount(g, all(g))}${q.reg !== null ? `/${q.reg}` : '(무제한)'} · 선발 ${foreignCount(g, g.squad)}/${q.pitch ?? '-'}` }] : []),
        ...(job.debts.length ? [{ label: '남은 분할 이적료', value: won(round1(job.debts.reduce((s, x) => s + x.amount, 0))) }] : []),
        { label: '이번 시장', value: `영입 ${w.signed} · 판매 ${w.sold}` },
      ],
    });
  }
  if (w.log.length > 0) blocks.push({ kind: 'log', items: w.log.map((text) => ({ min: 0, text, tone: 'plain' as const })) });

  const tabs: MarketTab[] = [];
  // 들어온 제안: 바로 답할 수 있게 카드에 버튼을 단다.
  const bidCards: MarketCard[] = [];
  for (const b of w.bids) {
    const p = all(g).find((x) => x.id === b.player);
    if (!p) continue;
    const net = p.contract?.sellOn ? `실수령 ${won(round1(b.fee * (1 - p.contract.sellOn)))}(셀온 ${pct(p.contract.sellOn)} 제외)` : '';
    const actions: NonNullable<MarketCard['actions']> = b.clause
      ? [{ act: `bid:${b.id}:yes`, label: '보내 준다', tone: 'primary' }, { act: `bid:${b.id}:stay`, label: '직접 설득(장악력 판정)' }]
      : [
        { act: `bid:${b.id}:yes`, label: '수락', tone: 'primary' },
        ...(!b.countered ? [{ act: `bid:${b.id}:counter`, label: `역제안 ${won(round1(b.fee * 1.2))}` }] : []),
        { act: `bid:${b.id}:no`, label: '거절', tone: 'danger' as const },
      ];
    for (const x of actions) hide(x.act, `${b.clause ? '바이아웃 ' : ''}${x.label} · ${p.name}`);
    bidCards.push({
      act: null, player: p, from: b.club, price: `${b.clause ? '바이아웃 발동 ' : '제안 '}${won(b.fee)}`,
      tags: [contractShort(g, p), ...(net ? [net] : [])],
      status: b.clause ? { text: '구단은 막을 수 없다. 선수가 응하면 떠난다', tone: 'bad' } : p.unhappy ? { text: '이적을 원하는 선수', tone: 'bad' } : undefined,
      actions,
    });
  }
  if (bidCards.length) tabs.push({ id: 'bids', label: '들어온 제안', hint: '답하지 않으면 시장이 닫힐 때 사라진다.', cards: bidCards });

  const card = (d: Deal): MarketCard => {
    const p = d.player;
    hide(`view:${d.id}`);
    const gain = p.ovr - weakest(g.squad, p.pos).ovr;
    const why = d.kind === 'renew' ? null : blocker(g, d);
    const status = d.stage === 'terms' && d.kind === 'sign' ? { text: `이적료 ${won(d.fee)} 합의 · 개인 조건 협상 중`, tone: 'good' as const }
      : why ? { text: why, tone: 'bad' as const }
      : d.tries + d.talks > 0 ? { text: `거절 ${d.tries + d.talks}번`, tone: 'plain' as const } : undefined;
    const tags = [d.tag, profileText(p), ...(isForeign(g, p) ? [`${quotaWord(g)} ${p.nat}`] : p.nat !== localNat(g) ? [p.nat] : []), potentialText(g, p)].filter(Boolean);
    if (d.kind === 'renew') {
      return { act: `view:${d.id}`, player: p, from: '재계약', price: contractShort(g, p), tags: [profileText(p), PROMISES[p.contract?.promise ?? 'rotation'].name], status: p.unhappy ? { text: '불만 있음 · 협상이 어렵다', tone: 'bad' } : { text: '재계약하지 못하면 시즌 끝에 떠난다', tone: 'plain' } };
    }
    if (d.kind === 'loan') {
      return { act: `view:${d.id}`, player: p, from: `${d.from} 소속`, price: `연봉 ${pct(d.loan!.askShare)} 부담 · 임대료 ${won(d.loan!.askFee)}`, gain, tags, status };
    }
    return { act: `view:${d.id}`, player: p, from: nation ? d.from : d.from, price: nation ? '발탁' : d.kind === 'sign' ? `요구 ${won(d.price)}` : '이적료 없음', gain, tags, status };
  };
  const signs = w.list.filter((d) => d.kind === 'sign' || d.kind === 'free' || d.kind === 'youth');
  tabs.push({ id: 'sign', label: nation ? '발탁 후보' : '영입', hint: nation ? '' : '카드를 누르면 이적료 협상, 개인 조건 협상 순으로 진행한다. 숫자는 같은 포지션 가장 약한 선발 대비 OVR.', cards: signs.map(card) });
  if (!nation) {
    tabs.push({ id: 'loan', label: '임대 영입', hint: '빌려 온 선수는 기간이 끝나면 돌아간다.', cards: w.list.filter((d) => d.kind === 'loan').map(card) });
    tabs.push({ id: 'renew', label: '재계약', hint: '계약이 1년 남은 선수들.', cards: w.list.filter((d) => d.kind === 'renew').map(card) });
    const mine: MarketCard[] = [];
    const own = (p: Player, starter: boolean): void => {
      if (p.loan?.dir === 'in') {
        mine.push({ act: null, player: p, from: starter ? '선발' : '후보', price: `${p.loan.club}에서 임대 중`, tags: [profileText(p)], status: { text: '빌려 온 선수는 팔거나 다시 빌려줄 수 없다', tone: 'plain' } });
        return;
      }
      const actions: NonNullable<MarketCard['actions']> = [{ act: `sale:${p.id}`, label: '판매' }, { act: `lend:${p.id}`, label: '임대 보내기' }];
      if (!starter) actions.push({ act: `release:${p.id}`, label: `해지 ${won(releaseCost(p))}`, tone: 'danger', disabled: releaseCost(p) > job.budget });
      for (const x of actions) if (!x.disabled) hide(x.act, `${x.label} · ${p.name}`);
      mine.push({ act: null, player: p, from: starter ? '선발' : '후보', price: `시장가 ${won(saleValue(g, p))}`, tags: [profileText(p), contractShort(g, p), ...(p.unhappy ? ['불만'] : [])], actions });
    };
    for (const p of g.squad) own(p, true);
    for (const p of g.reserves) own(p, false);
    for (const p of g.loaned) mine.push({ act: null, player: p, from: '임대 보냄', price: `${p.loan?.club} · ${p.loan?.until === 'winter' ? '겨울 복귀' : '시즌 끝 복귀'}`, tags: [profileText(p)] });
    tabs.push({ id: 'mine', label: '내 선수', hint: '판매는 희망가를 정해 구매 구단을 찾는다. 선발을 내보내면 같은 포지션 후보 중 가장 좋은 선수가 올라간다. 해지는 남은 연봉의 절반을 위약금으로 낸다.', cards: mine });
  }
  blocks.push({ kind: 'market', tabs });

  if (!nation) {
    if (!w.depthDone) {
      const price = depthPrice(g);
      choices.push({ id: 'depth', group: '구단 운영', label: '유소년·2군 보강', detail: `이름 없는 2군 선수들을 데려와 스쿼드 뎁스 +3 · ${won(price)}`, disabled: price > job.budget });
    }
    if (w.scouted < SCOUT_TIMES) {
      const cost = round1(stage(g).money * SCOUT_COST);
      choices.push({ id: 'scout', group: '구단 운영', label: '스카우트 재파견', detail: `새 후보 명단을 받는다 · ${won(cost)} · ${SCOUT_TIMES - w.scouted}번 남음`, disabled: cost > job.budget });
    }
  }
  choices.push({
    id: 'done', group: ' ', tone: 'primary', label: nation ? '명단 확정' : '이적시장 마감',
    detail: nation ? (w.signed === 0 ? '손발을 맞춘 선수들을 믿는다. 전술 완성도 +5' : '이 명단으로 간다') : '출전 보장을 어긴 선수가 있으면 불만이 생긴다. 외국인 선발이 한도를 넘으면 자동으로 조정된다',
  });
  g.scene = { eyebrow, title, blocks, choices };
}

/** 지금 시장 화면을 game.scene에 만든다. */
export function windowScene(g: Game, eyebrow: string): void {
  const w = g.window as TransferWindow;
  if (w.view === 'sell') return sellScene(g, eyebrow);
  if (w.view?.startsWith('sale:') || w.view?.startsWith('lend:')) {
    const p = all(g).find((x) => x.id === Number(w.view!.slice(5)));
    if (!p) {
      w.view = 'sell';
      return sellScene(g, eyebrow);
    }
    return w.view.startsWith('sale:') ? saleScene(g, p, eyebrow) : lendScene(g, p, eyebrow);
  }
  const d = w.view ? w.list.find((x) => x.id === w.view) : undefined;
  if (d && d.stage === 'fee') return feeScene(g, d, eyebrow);
  if (d && d.stage === 'loan') return loanScene(g, d, eyebrow);
  if (d) return termsScene(g, d, eyebrow);
  return listScene(g, eyebrow);
}

// ---------- 거래 ----------

const depthPrice = (g: Game): number => round1(stage(g).money * 0.3 * (1 - g.manager.attrs.deal * 0.015));

/** 계약 해지 위약금: 남은 연봉의 절반. */
const releaseCost = (p: Player): number => round1((p.contract?.wage ?? 0) * (p.contract?.years ?? 0) * 0.5);

/** 선발이면 빈자리를 채우고, 후보면 명단에서 뺀다. */
function vacate(g: Game, p: Player): string {
  if (g.squad.some((q) => q.id === p.id)) {
    const { level, where } = stage(g);
    const line = fillSlot(g, p, level - 4, where);
    settle(g);
    return ` ${line}`;
  }
  g.reserves = g.reserves.filter((q) => q.id !== p.id);
  return '';
}

/** 선수를 판다. fee는 받는 돈(셀온 몫은 여기서 뺀다). */
function letGo(g: Game, p: Player, fee: number, why: string): void {
  const w = g.window as TransferWindow;
  const share = round1(fee * (p.contract?.sellOn ?? 0));
  g.job!.budget = round1(g.job!.budget + fee - share);
  const starter = g.squad.some((q) => q.id === p.id);
  let line = why + (share > 0 ? ` 셀온 조항으로 ${won(share)}는 전 소속 구단에 갔다.` : '');
  line += vacate(g, p);
  if (starter) {
    const best = Math.max(...all(g).map((q) => q.ovr), p.ovr);
    g.morale = clamp(g.morale - (p.ovr >= best ? 4 : 2), 0, 100);
  }
  w.bids = w.bids.filter((b) => b.player !== p.id);
  w.list = w.list.filter((d) => !(d.kind === 'renew' && d.player.id === p.id));
  w.log.push(line);
  g.season.notes.push(line);
  w.sold++;
}

/** 서명. 영입과 임대는 선발이나 후보로 들어가고, 재계약이면 계약만 바뀐다. */
function sign(g: Game, d: Deal): void {
  const w = g.window as TransferWindow;
  const p = d.player;
  w.list = w.list.filter((x) => x.id !== d.id);
  if (nationOf(g)) {
    const out = weakest(g.squad, p.pos);
    g.squad = g.squad.map((q) => (q.id === out.id ? p : q));
    w.signed++;
    const line = ko`${p.name}이 처음 대표팀에 뽑혔다. ${out.name}은 명단에서 빠졌다.`;
    w.log.push(line);
    g.season.notes.push(line);
    return;
  }
  const cost = upfront(d);
  const job = g.job!;
  job.budget = round1(job.budget - cost.total);
  for (let k = 1; k < d.inst && d.kind === 'sign'; k++) job.debts.push({ amount: round1(d.fee / d.inst), due: g.year + k, what: `${p.name} 이적료 ${k + 1}회분` });
  const terms = `${amateur(g) ? '무급' : `연봉 ${won(d.offer.wage)}`}, ${d.offer.years}년, ${PROMISES[d.offer.promise].name}${d.offer.clause > 0 ? `, 바이아웃 ${won(d.offer.clause)}` : ''}`;
  if (d.kind === 'renew') {
    p.contract = makeContract(g, d.offer, p.contract?.sellOn ?? 0);
    p.unhappy = p.unhappy && PROMISES[d.offer.promise].rank < PROMISES[d.ask.promise].rank;
    const line = ko`${p.name}과 재계약했다(${terms}${cost.agent > 0 ? `, 에이전트 수수료 ${won(cost.agent)}` : ''}).`;
    w.log.push(line);
    g.season.notes.push(line);
    return;
  }
  let line: string;
  if (d.kind === 'loan') {
    const l = d.loan!;
    p.contract = { wage: wageOf(d), years: 1, promise: d.offer.promise, clause: null, sellOn: 0, since: g.year };
    p.loan = { dir: 'in', club: d.from, until: l.until, year: g.year, share: l.share };
    line = ko`${d.from}에서 ${p.name}(${p.spot})을 ${l.until === 'winter' ? '반 시즌' : '시즌 끝까지'} 임대해 왔다. 연봉 ${pct(l.share)} 부담${l.fee > 0 ? `, 임대료 ${won(l.fee)}` : ''}.`;
  } else {
    p.contract = makeContract(g, d.offer, d.sellOn);
    const paid = [cost.fee > 0 ? `이적료 ${won(cost.fee)}${cost.later > 0 ? `(나머지 ${won(cost.later)}는 분할)` : ''}` : '', cost.agent > 0 ? `에이전트 수수료 ${won(cost.agent)}` : '', cost.bonus > 0 ? `계약금 ${won(cost.bonus)}` : ''].filter(Boolean).join(', ');
    line = ko`${p.name}(${p.spot})과 계약했다. ${terms}${paid ? `. ${paid}` : ''}.`;
  }
  p.unhappy = false;
  if (englandCheck(g, p).esc) {
    p.esc = true;
    line += ` 워크퍼밋 점수(GBE ${gbePoints(p)}점)가 모자라 ESC 예외 슬롯으로 등록했다.`;
  }
  assignNumber(g, p);
  if (startsOnSign(d)) {
    const out = weakest(g.squad, p.pos);
    g.squad = g.squad.map((q) => (q.id === out.id ? p : q));
    g.reserves.push(out);
    line += ko` 등번호 ${p.no}. 선발로 들어가고 ${out.name}은 후보로 밀려났다.`;
  } else {
    g.reserves.push(p);
    line += ` 등번호 ${p.no}. 후보 명단에 들어간다.`;
  }
  w.signed++;
  if (d.kind !== 'youth' && nonEu(p)) w.nonEu = (w.nonEu ?? 0) + 1;
  w.log.push(line);
  g.season.notes.push(line);
}

/** 금액 입력 "키=값"을 숫자로. 범위를 벗어나면 NaN. */
function num(raw: string, lo: number, hi: number): number {
  const v = Number(raw);
  return Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9 ? v : NaN;
}

/** 제안서의 한 항목을 바꾼다. 칩은 "t:키:값", 슬라이더는 "t:키=값"으로 온다. */
function setTerm(g: Game, d: Deal, id: string): void {
  const t = d.offer;
  const [head, value = ''] = id.includes('=') ? id.split('=') : [id.slice(0, id.lastIndexOf(':')), id.slice(id.lastIndexOf(':') + 1)];
  const key = head!.split(':')[1];
  const value0 = value;
  if (key === 'wage' && !amateur(g)) {
    const v = num(value0, 0, Math.max(1, d.ask.wage * 2.5));
    if (!Number.isNaN(v)) t.wage = round1(v);
  } else if (key === 'years') {
    const y = Number(value0);
    if (y >= 1 && y <= 5) t.years = y;
  } else if (key === 'promise' && PROMISE_IDS.includes(value0 as PromiseId)) {
    t.promise = value0 as PromiseId;
  } else if (key === 'clause') {
    const v = num(value0, 0, marketValue(g, d.player) * 5 + 1);
    if (!Number.isNaN(v)) t.clause = round1(v);
  } else if (key === 'bonus' && !amateur(g)) {
    const v = num(value0, 0, Math.max(1, t.wage * 1.5) + 1);
    if (!Number.isNaN(v)) t.bonus = round1(v);
  } else if (key === 'agent') {
    const v = num(value0, 0, 15);
    if (!Number.isNaN(v)) t.agent = Math.round(v);
  }
}

/**
 * 시장에서 고른 일을 처리한다. 시장이 닫히면 true를 돌려준다.
 * 잘못된 선택은 무시한다.
 */
export function actWindow(g: Game, id: string): boolean {
  const w = g.window;
  if (!w) return true;
  const nation = nationOf(g);
  if (id === 'back') {
    w.view = null;
    return false;
  }
  if (w.view?.startsWith('sale:') || w.view?.startsWith('lend:')) {
    const p = all(g).find((x) => x.id === Number(w.view!.slice(5)));
    if (p) actPlayer(g, w, p, id);
    return false;
  }
  const d = w.view && w.view !== 'sell' ? w.list.find((x) => x.id === w.view) : undefined;
  if (d) {
    actDeal(g, w, d, id);
    return false;
  }
  if (w.view === 'sell' || (!w.view && /^(sale|lend|release):/.test(id))) {
    const [verb, raw] = id.split(':');
    const p = all(g).find((x) => x.id === Number(raw));
    if (!p || p.loan) return false;
    if (verb === 'sale') {
      w.view = `sale:${p.id}`;
      w.sale.price = saleValue(g, p);
    } else if (verb === 'lend') {
      w.view = `lend:${p.id}`;
      w.lend = { until: 'end', share: 0.5, fee: 0 };
    } else if (verb === 'release' && g.reserves.includes(p) && releaseCost(p) <= g.job!.budget) {
      g.job!.budget = round1(g.job!.budget - releaseCost(p));
      g.reserves = g.reserves.filter((q) => q.id !== p.id);
      w.list = w.list.filter((x) => !(x.kind === 'renew' && x.player.id === p.id));
      w.log.push(ko`${p.name}과 계약을 해지했다. 위약금 ${won(releaseCost(p))}.`);
    }
    return false;
  }
  if (id.startsWith('view:')) {
    if (w.list.some((x) => x.id === id.slice(5))) w.view = id.slice(5);
    return false;
  }
  if (id.startsWith('bid:')) {
    actBid(g, w, id);
    return false;
  }
  if (nation && id !== 'done') return false;
  switch (id) {
    case 'sellmenu':
      w.view = 'sell';
      return false;
    case 'depth': {
      const price = depthPrice(g);
      if (w.depthDone || price > g.job!.budget) return false;
      g.depth += 3;
      g.job!.budget = round1(g.job!.budget - price);
      w.depthDone = true;
      w.log.push('유소년·2군 선수들이 합류해 스쿼드 뎁스가 두꺼워졌다.');
      return false;
    }
    case 'scout': {
      const cost = round1(stage(g).money * SCOUT_COST);
      if (w.scouted >= SCOUT_TIMES || cost > g.job!.budget) return false;
      w.scouted++;
      g.job!.budget = round1(g.job!.budget - cost);
      // 이미 협상 중인 후보와 재계약, 유스는 남긴다.
      const keep = w.list.filter((x) => x.kind === 'youth' || x.kind === 'renew' || (x.kind === 'sign' && x.stage === 'terms'));
      w.list = [...keep, ...scoutList(g, w.kind, w.scouted).filter((x) => x.kind !== 'youth')];
      w.log.push('스카우트를 다시 보내 새 후보 명단을 받았다.');
      return false;
    }
    case 'done': {
      if (nation && w.signed === 0) g.cohesion = clamp(g.cohesion + 5, 0, 100);
      if (!nation) for (const line of [...enforceQuota(g), ...checkPromises(g)]) g.season.notes.push(line);
      g.window = null;
      return true;
    }
  }
  return false;
}

/** 판매 화면과 임대 보내기 화면의 조작. */
function actPlayer(g: Game, w: TransferWindow, p: Player, id: string): void {
  if (w.view?.startsWith('sale:')) {
    if (id.startsWith('s:price=')) {
      const v = num(id.slice(8), saleValue(g, p) * 0.3 - 0.1, saleValue(g, p) * 2.5 + 0.1);
      if (!Number.isNaN(v)) w.sale.price = round1(v);
    } else if (id === 'sell' && (w.sale.tries[p.id] ?? 0) < SALE_TRIES) {
      w.sale.tries[p.id] = (w.sale.tries[p.id] ?? 0) + 1;
      if (chance(g, saleOdds(g, p, w.sale.price))) {
        letGo(g, p, w.sale.price, ko`${leagueClub(g, int(g, 0, 1))}이 ${p.name}(${p.spot})을 ${won(w.sale.price)}에 사 갔다.`);
        w.view = null;
      } else {
        w.log.push(ko`${won(w.sale.price)}에 ${p.name}을 사려는 구단이 나오지 않았다.`);
      }
    }
    return;
  }
  // 임대 보내기
  if (id.startsWith('l:until:')) {
    const u = id.slice(8);
    if (u === 'end' || (u === 'winter' && w.kind === 'summer')) w.lend.until = u;
  } else if (id.startsWith('l:share=')) {
    const v = num(id.slice(8), 0, 1);
    if (!Number.isNaN(v)) w.lend.share = v;
  } else if (id.startsWith('l:fee=')) {
    const v = num(id.slice(6), 0, Math.max(1, marketValue(g, p) * 0.3) + 0.1);
    if (!Number.isNaN(v)) w.lend.fee = round1(v);
  } else if (id === 'lend') {
    if (chance(g, lendOdds(g, p, w.lend.share, w.lend.fee))) {
      const club = leagueClub(g, -1);
      const line = ko`${p.name}을 ${club}에 ${w.lend.until === 'winter' ? '반 시즌' : '시즌 끝까지'} 임대 보냈다. 상대가 연봉 ${pct(w.lend.share)}를 낸다${w.lend.fee > 0 ? `, 임대료 ${won(w.lend.fee)}` : ''}.${vacate(g, p)}`;
      g.job!.budget = round1(g.job!.budget + w.lend.fee);
      p.loan = { dir: 'out', club, until: w.lend.until, year: g.year, share: w.lend.share };
      g.loaned.push(p);
      w.bids = w.bids.filter((b) => b.player !== p.id);
      w.list = w.list.filter((x) => !(x.kind === 'renew' && x.player.id === p.id));
      w.log.push(line);
      g.season.notes.push(line);
      w.view = null;
    } else {
      w.log.push(ko`그 조건으로 ${p.name}을 받아 줄 구단이 나오지 않았다.`);
    }
  }
}

function actDeal(g: Game, w: TransferWindow, d: Deal, id: string): void {
  if (d.stage === 'fee') {
    const budget = g.job!.budget;
    if (id.startsWith('f:fee=')) {
      const v = num(id.slice(6), d.price * 0.4 - 0.1, Math.max(d.price * 1.6, d.player.contract?.clause ?? 0) + 0.1);
      if (!Number.isNaN(v)) d.draft.fee = round1(v);
    } else if (id.startsWith('f:sellon=')) {
      const v = num(id.slice(9), 0, 0.4);
      if (!Number.isNaN(v)) d.draft.sellOn = Math.round(v * 20) / 20;
    } else if (id.startsWith('f:inst:')) {
      const n = Number(id.slice(7));
      if (n >= 1 && n <= 3) d.draft.inst = n;
    } else if (id === 'fee:clause') {
      const clause = d.player.contract?.clause;
      if (!clause || clause > budget) return;
      d.fee = clause;
      d.sellOn = 0;
      d.inst = 1;
      d.stage = 'terms';
      w.log.push(ko`${d.player.name}의 바이아웃 ${won(clause)}을 지불하기로 했다. ${d.from}은 막을 수 없다.`);
    } else if (id === 'submit') {
      const { fee, sellOn, inst } = d.draft;
      if (round1(fee / inst) > budget) return;
      if (chance(g, feeOdds(g, d, fee / Math.max(0.1, d.price), sellOn, inst))) {
        d.fee = fee;
        d.sellOn = sellOn;
        d.inst = inst;
        d.stage = 'terms';
        w.log.push(ko`${d.from}과 ${d.player.name}의 이적료 ${won(fee)}에 합의했다${sellOn ? `(셀온 ${pct(sellOn)})` : ''}${inst > 1 ? `(${inst}시즌 분할)` : ''}. 이제 개인 조건 협상이다.`);
      } else if (d.tries >= 1 && chance(g, 0.35)) {
        w.list = w.list.filter((x) => x.id !== d.id);
        w.view = null;
        w.log.push(ko`${d.from}이 협상을 끊었다. ${d.player.name} 영입은 무산됐다.`);
      } else {
        d.tries++;
        w.log.push(ko`${d.from}이 ${won(fee)} 제안을 거절했다. 요구액 ${won(d.price)}에서 크게 물러서지 않는다.`);
      }
    }
    return;
  }
  if (d.stage === 'loan') {
    const l = d.loan!;
    if (id.startsWith('l:until:')) {
      const u = id.slice(8);
      if (u === 'end' || (u === 'winter' && w.kind === 'summer')) l.until = u;
    } else if (id.startsWith('l:share=')) {
      const v = num(id.slice(8), 0, 1);
      if (!Number.isNaN(v)) l.share = v;
    } else if (id.startsWith('l:fee=')) {
      const v = num(id.slice(6), 0, Math.max(1, l.askFee * 3) + 0.1);
      if (!Number.isNaN(v)) l.fee = round1(v);
    } else if (id.startsWith('t:promise:')) {
      const v = id.slice(10) as PromiseId;
      if (['starter', 'rotation', 'backup'].includes(v)) d.offer.promise = v;
    } else if (id === 'submit' && !blocker(g, d)) {
      if (chance(g, loanOdds(g, d))) {
        sign(g, d);
        w.view = null;
      } else if (++d.talks >= MAX_TALKS) {
        w.list = w.list.filter((x) => x.id !== d.id);
        w.view = null;
        w.log.push(ko`${d.from}이 임대 협상을 끝냈다. ${d.player.name}은 다른 구단으로 간다.`);
      } else {
        w.log.push(ko`${d.from}이 임대 조건을 거절했다. 연봉 분담이나 출전 보장을 더 원한다.`);
      }
    }
    return;
  }
  if (id.startsWith('t:')) {
    setTerm(g, d, id);
    return;
  }
  if (id !== 'submit' || blocker(g, d)) return;
  if (nationOf(g) || d.kind === 'youth' || chance(g, termsOdds(g, d))) {
    sign(g, d);
    w.view = null;
    return;
  }
  d.talks++;
  if (d.talks >= MAX_TALKS) {
    w.list = w.list.filter((x) => x.id !== d.id);
    w.view = null;
    w.log.push(d.kind === 'renew'
      ? ko`${d.player.name}과의 재계약 협상이 결렬됐다. 시즌이 끝나면 자유계약으로 떠난다.`
      : ko`${d.player.name} 측이 협상 테이블을 떠났다. 영입은 무산됐다.`);
    return;
  }
  // 거절하면서 요구를 올린다.
  d.ask.wage = round1(d.ask.wage * 1.06);
  w.log.push(ko`${d.player.name} 측이 제안을 거절했다.${d.ask.wage > 0 ? ` 연봉 요구가 ${won(d.ask.wage)}로 올랐다.` : ''}`);
}

function actBid(g: Game, w: TransferWindow, id: string): void {
  const [, bidId, answer] = id.split(':');
  const bid = w.bids.find((b) => b.id === bidId);
  const p = bid && all(g).find((x) => x.id === bid.player);
  if (!bid || !p) return;
  if (answer === 'yes') {
    letGo(g, p, bid.fee, ko`${bid.club}${bid.clause ? '이 바이아웃을 발동해' : '의 제안을 받아들여'} ${p.name}을 ${won(bid.fee)}에 보냈다.`);
    return;
  }
  if (answer === 'stay' && bid.clause) {
    w.bids = w.bids.filter((b) => b.id !== bidId);
    if (chance(g, clamp(0.2 + g.manager.attrs.lead * 0.04 - (p.unhappy ? 0.3 : 0), 0.05, 0.9))) {
      if (p.contract) p.contract.wage = round1(p.contract.wage * 1.1);
      w.log.push(ko`${p.name}이 감독의 설득에 남기로 했다. 연봉을 10% 올려 주기로 했다.`);
    } else {
      letGo(g, p, bid.fee, ko`설득은 통하지 않았다. ${p.name}은 바이아웃 ${won(bid.fee)}에 ${bid.club}으로 떠났다.`);
    }
    return;
  }
  if (answer === 'counter' && !bid.clause && !bid.countered) {
    bid.countered = true;
    if (chance(g, clamp(0.45 + (g.manager.attrs.deal - 6) * 0.04, 0.1, 0.9))) {
      bid.fee = round1(bid.fee * 1.2);
      w.log.push(ko`${bid.club}이 역제안을 받아들였다. ${won(bid.fee)}에 수락할 수 있다.`);
    } else {
      w.bids = w.bids.filter((b) => b.id !== bidId);
      w.log.push(ko`${bid.club}이 제안을 거둬들였다.`);
    }
    return;
  }
  if (answer === 'no' && !bid.clause) {
    w.bids = w.bids.filter((b) => b.id !== bidId);
    // 큰 무대를 꿈꾸는 선수(리그 수준보다 4 이상)나 원래 불만 있던 선수만 실망한다.
    if (chance(g, p.unhappy ? 0.7 : p.ovr - stage(g).level >= 4 ? 0.3 : 0.1)) {
      p.temp -= 1;
      p.unhappy = true;
      g.morale = clamp(g.morale - 2, 0, 100);
      w.log.push(ko`${bid.club}의 제안을 거절했다. 이적을 바랐던 ${p.name}이 불만을 드러냈다(이번 시즌 OVR -1).`);
    } else {
      w.log.push(ko`${bid.club}의 제안을 거절했다. ${p.name}은 남는 데 동의했다.`);
    }
  }
}
