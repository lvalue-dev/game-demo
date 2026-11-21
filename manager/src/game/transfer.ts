// 이적 시장. 실제 이적 절차를 따른다.
//   1. 구단 간 협상: 판매 구단에 이적료를 제안한다. 요구액, 할인 제안, 셀온 조항, 바이아웃 지불.
//   2. 개인 조건 협상: 선수(와 에이전트)에게 연봉, 계약 기간, 출전 보장, 바이아웃, 계약금을 제안한다.
//   3. 서명: 이적료, 에이전트 수수료, 계약금이 이적 예산에서 나가고, 연봉은 연봉 예산 안에 들어야 한다.
// 시장이 열려 있는 동안 영입, 재계약, 판매, 계약 해지, 다른 구단 제안 처리를 여러 번 할 수 있다.
import { ko } from './josa.ts';
import { CLUB_LEAGUES, won } from './data.ts';
import {
  PROMISES, PROMISE_IDS, RESERVE_LIMIT, agentFee, amateur, askOf, assignNumber, checkPromises, clauseAmount,
  contractText, defaultTerms, feeOdds, makeContract, oddsText, settle, signingBonus, termsOdds, totalWages, wageFor,
} from './contract.ts';
import { profileText } from './player.ts';
import { chance, int, pick, spread } from './rng.ts';
import { fillSlot, makePlayer, myClub, potentialText, priceFor, stage, valueOf, weakest } from './squad.ts';
import type { Block, Choice, Club, ClubLeagueId, Deal, Game, Player, Pos, PromiseId, Terms, TransferWindow } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** 대표팀이 한 번 소집 때 바꿀 수 있는 자리 수. */
const NATION_CHANGES = 2;
/** 스카우트를 다시 보낼 수 있는 횟수와 비용(그 무대 한 시즌 예산 대비). */
const SCOUT_TIMES = 2;
const SCOUT_COST = 0.04;
/** 개인 조건 협상에서 이만큼 거절당하면 선수가 떠난다. */
const MAX_TALKS = 3;

const nationOf = (g: Game): boolean => myClub(g).nation;
const all = (g: Game): Player[] => [...g.squad, ...g.reserves];

/** 판매 구단 후보: 우리와 같은 리그나 한 단계 아래 리그의 구단. */
function sellerName(g: Game): string {
  const club = myClub(g);
  if (club.nation) return '소속 구단';
  const idx = CLUB_LEAGUES.indexOf(club.league as ClubLeagueId);
  const pool = [...g.leagues[club.league], ...g.leagues[CLUB_LEAGUES[Math.max(0, idx - 1)] as ClubLeagueId]].filter((id) => id !== club.id);
  return (g.clubs[pick(g, pool)] as Club).name;
}

function newDeal(g: Game, id: string, kind: Deal['kind'], player: Player, price: number, tag: string, from: string): Deal {
  const ask = askOf(g, player, kind === 'renew');
  if (kind === 'youth') {
    ask.promise = 'backup';
    ask.wage = round1(ask.wage * 0.5);
  }
  return {
    id, kind, player, price, from, tag, stage: kind === 'sign' ? 'fee' : 'terms', fee: 0, sellOn: 0,
    ask, offer: defaultTerms(ask), tries: 0, talks: 0,
  };
}

/** 후보 하나를 만든다. 성격(tag)에 따라 나이, OVR, 값이 다르다. */
function candidate(g: Game, id: string, pos: Pos, tag: string): Deal {
  const { level, region } = stage(g);
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
  const player = makePlayer(g, pos, Math.round(ovr), age, region, nation);
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

/** 시장에 나온 후보들. 여름에는 여섯, 겨울에는 넷. 스카우팅이 좋으면 하나 더. */
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
  if (!nation && kind === 'summer' && round === 0) {
    const { level, region } = stage(g);
    const oldest = [...g.squad].sort((a, b) => b.age - a.age)[0] as Player;
    const kid = makePlayer(g, oldest.pos, level - int(g, 3, 8), int(g, 17, 18), region, region === 'kr');
    kid.pot = Math.min(99, kid.ovr + int(g, 8, 16) + Math.round(g.manager.attrs.youth / 2));
    kid.homegrown = true;
    list.push(newDeal(g, 'youth', 'youth', kid, 0, '유스', '유소년 팀'));
  }
  return list;
}

/** 계약이 이번 시즌으로 끝나는 선수들과의 재계약 협상. */
function renewals(g: Game): Deal[] {
  if (nationOf(g)) return [];
  return all(g).filter((p) => p.contract && p.contract.years <= 1).map((p) => newDeal(g, `r${p.id}`, 'renew', p, 0, '재계약', myClub(g).name));
}

/** 다른 구단의 제안. 리그 수준을 넘어선 선수, 불만이 있는 선수에게 들어온다. 바이아웃을 채우면 발동이다. */
function makeBids(g: Game, kind: 'summer' | 'winter'): TransferWindow['bids'] {
  if (nationOf(g)) return [];
  const club = myClub(g);
  const { level, money } = stage(g);
  const idx = CLUB_LEAGUES.indexOf(club.league as ClubLeagueId);
  const upper = CLUB_LEAGUES[Math.min(CLUB_LEAGUES.length - 1, idx + 1)] as ClubLeagueId;
  const suitors = [...g.leagues[upper], ...g.leagues[club.league]].filter((id) => id !== club.id).map((id) => g.clubs[id] as Club);
  const bids: TransferWindow['bids'] = [];
  for (const p of all(g).sort((a, b) => b.ovr - a.ovr)) {
    if (bids.length >= 2) break;
    // 리그 수준을 한참(3 이상) 넘어선 선수와 불만 있는 선수에게만 제안이 온다.
    const hot = p.ovr - level;
    const want = (kind === 'summer' ? 0.2 : 0.1) + Math.max(0, hot - 3) * 0.06 + (p.unhappy ? 0.4 : 0);
    if ((hot < 3 && !p.unhappy) || !chance(g, clamp(want, 0, 0.8))) continue;
    const suitor = pick(g, suitors);
    // 계약이 얼마 안 남은 선수는 싸게 부른다.
    const lastYear = (p.contract?.years ?? 2) <= 1;
    let fee = round1(valueOf(p, level, money) * spread(g, 0.9, 1.4) * (lastYear ? 0.6 : 1));
    const clause = p.contract?.clause ?? null;
    const trigger = clause !== null && (fee >= clause || (hot >= 4 && chance(g, 0.5)));
    if (trigger) fee = clause as number;
    bids.push({ id: `b${bids.length}`, player: p.id, club: suitor.name, fee, clause: trigger, countered: false });
  }
  return bids;
}

export function openWindow(g: Game, kind: 'summer' | 'winter'): void {
  g.window = {
    kind, list: [...renewals(g), ...scoutList(g, kind, 0)], bids: makeBids(g, kind), view: null, log: [],
    signed: 0, sold: 0, scouted: 0, depthDone: false,
  };
}

// ---------- 돈 계산 ----------

/** 서명할 때 이적 예산에서 나가는 돈: 이적료, 에이전트 수수료, 계약금. */
export function upfront(d: Deal): { fee: number; agent: number; bonus: number; total: number } {
  const fee = d.kind === 'sign' ? d.fee : 0;
  const agent = d.kind === 'renew' ? round1(agentFee(0, d.offer.wage) * 0.4) : agentFee(fee, d.offer.wage);
  const bonus = signingBonus(d.offer);
  return { fee, agent, bonus, total: round1(fee + agent + bonus) };
}

/** 서명하면 연봉 총액이 얼마가 되는지. 재계약은 지금 연봉을 빼고 센다. */
const wagesAfter = (g: Game, d: Deal): number => round1(totalWages(g, d.kind === 'renew' ? d.player.id : undefined) + d.offer.wage);

/** 서명을 막는 사유. 없으면 null. */
function blocker(g: Game, d: Deal): string | null {
  if (nationOf(g)) return g.window!.signed >= NATION_CHANGES ? `이번 소집에서 바꿀 수 있는 ${NATION_CHANGES}자리를 다 썼다` : null;
  const job = g.job!;
  if (upfront(d).total > job.budget) return '이적 예산이 모자란다';
  // 재계약은 이사회가 연봉 예산의 10%까지 넘는 것을 눈감아 준다.
  const cap = job.wageBudget * (d.kind === 'renew' ? 1.1 : 1);
  if (!amateur(g) && wagesAfter(g, d) > cap) return `연봉 예산 초과(${won(wagesAfter(g, d))} / ${won(cap)})`;
  // 주전으로 오면 밀려난 선수가, 후보로 오면 본인이 후보 명단에 들어간다.
  if (d.kind !== 'renew' && g.reserves.length >= RESERVE_LIMIT) return `등록 인원이 꽉 찼다(후보 ${RESERVE_LIMIT}명). 먼저 판매하거나 계약을 해지하라`;
  return null;
}

// ---------- 장면 ----------

const pct = (p: number): string => `${Math.round(p * 100)}%`;

function dealLabel(d: Deal): string {
  const p = d.player;
  return `${p.spot} ${p.name} · ${p.age}세 · OVR ${p.ovr}`;
}

function feeScene(g: Game, d: Deal, eyebrow: string): void {
  const p = d.player;
  const current = weakest(g.squad, p.pos);
  const c = p.contract;
  const budget = g.job!.budget;
  const blocks: Block[] = [
    { kind: 'card', player: p, price: `요구 이적료 ${won(d.price)}`, compare: current, note: `${d.tag} · ${potentialText(g, p)}` },
    {
      kind: 'stats', rows: [
        { label: '현 소속', value: d.from },
        { label: '지금 계약', value: c ? `${c.years}년 남음 · 연봉 ${won(c.wage)}` : '-' },
        { label: '바이아웃', value: c?.clause ? won(c.clause) : '없음' },
        { label: '이적 예산', value: won(budget) },
      ],
    },
    { kind: 'text', text: ko`먼저 ${d.from}과 이적료를 합의해야 한다. 합의하면 선수 측과 연봉, 계약 기간, 출전 보장을 협상한다. 이적료는 개인 조건까지 합의해 서명할 때 나간다.${d.tries > 0 ? ` 지금까지 ${d.tries}번 거절당했다.` : ''}` },
  ];
  const offer = (id: string, frac: number, sellOn: number, label: string): Choice => {
    const amount = round1(d.price * frac);
    const odds = frac >= 1 ? 1 : feeOdds(g, d, frac, sellOn);
    return {
      id, label: `${label}: ${won(amount)}`, disabled: amount > budget,
      detail: `${frac >= 1 ? '바로 합의한다' : `수락 가능성 ${oddsText(odds)}(${pct(odds)})`}${sellOn ? ` · 나중에 팔면 이적료의 ${pct(sellOn)}를 ${d.from}에 준다` : ''}${amount > budget ? ' · 예산 부족' : ''}`,
    };
  };
  const choices: Choice[] = [
    offer('fee:100', 1, 0, '요구액 수락'),
    offer('fee:90', 0.9, 0, '10% 깎아 제안'),
    offer('fee:80', 0.8, 0, '20% 깎아 제안'),
    offer('fee:80s', 0.8, 0.2, '셀온 20% 붙여 깎기'),
  ];
  if (c?.clause) {
    choices.push({ id: 'fee:clause', label: `바이아웃 ${won(c.clause)} 지불`, detail: '판매 구단은 거절할 수 없다. 곧장 개인 조건 협상으로 간다', disabled: c.clause > budget });
  }
  choices.push({ id: 'back', label: '목록으로' });
  g.scene = { eyebrow, title: dealLabel(d), blocks, choices };
}

function termsScene(g: Game, d: Deal, eyebrow: string): void {
  const p = d.player;
  const nation = nationOf(g);
  const t = d.offer;
  const blocks: Block[] = [];
  if (nation) {
    blocks.push({ kind: 'card', player: p, compare: weakest(g.squad, p.pos), note: `${d.tag} · ${potentialText(g, p)}` });
    const why = blocker(g, d);
    g.scene = {
      eyebrow, title: dealLabel(d), blocks,
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
  blocks.push({ kind: 'card', player: p, compare: d.kind === 'renew' ? undefined : weakest(g.squad, p.pos), note: `${d.tag} · ${potentialText(g, p)}` });
  blocks.push({
    kind: 'text',
    text: d.kind === 'renew'
      ? ko`${p.name}의 계약은 이번 시즌으로 끝난다. 재계약하지 못하면 시즌이 끝나고 자유계약으로 떠난다(보스만 룰).${p.unhappy ? ' 지금 팀에 불만이 있어 협상이 어렵다.' : ''}`
      : ko`${d.kind === 'sign' ? `이적료 ${won(d.fee)}에 합의했다. ` : ''}${p.name} 측의 요구는 ${free ? '무급(아마추어 리그)' : `연봉 ${won(d.ask.wage)}`}, ${PROMISES[d.ask.promise].name} 보장, ${d.ask.years}년 계약이다.`,
  });
  const rel = (f: number): string => `t:wage:${f}`;
  const wageOpts = free ? [] : [0.8, 0.9, 1, 1.1, 1.25].map((f) => ({ id: rel(f), label: f === 1 ? `요구액 ${won(d.ask.wage)}` : `${f > 1 ? '+' : ''}${Math.round((f - 1) * 100)}%`, on: Math.abs(t.wage - round1(d.ask.wage * f)) < 0.05 }));
  blocks.push({
    kind: 'form', title: `${p.name} 계약 제안서`, rows: [
      ...(free ? [] : [{ label: '연봉', note: won(t.wage), options: wageOpts }]),
      { label: '계약 기간', note: `${g.year + t.years - 1}년 6월 만료`, options: [1, 2, 3, 4, 5].map((y) => ({ id: `t:years:${y}`, label: `${y}년`, on: t.years === y })) },
      { label: '출전 보장', note: PROMISES[t.promise].desc, options: PROMISE_IDS.map((id) => ({ id: `t:promise:${id}`, label: PROMISES[id].name, on: t.promise === id })) },
      { label: '바이아웃 조항', note: t.clause === 'none' ? '없음. 좋은 선수는 싫어한다' : `${won(clauseAmount(g, p, t.clause) ?? 0)}에 다른 구단이 데려갈 수 있다`, options: [{ id: 't:clause:none', label: '없음', on: t.clause === 'none' }, { id: 't:clause:high', label: '높게', on: t.clause === 'high' }, { id: 't:clause:low', label: '낮게', on: t.clause === 'low' }] },
      ...(free ? [] : [{ label: '계약금', note: t.bonus ? `${won(signingBonus(t))} 일시불` : '없음', options: [{ id: 't:bonus:0', label: '없음', on: !t.bonus }, { id: 't:bonus:1', label: '연봉 50%', on: t.bonus }] }]),
    ],
  });
  const why = blocker(g, d);
  blocks.push({
    kind: 'stats', rows: [
      ...(d.kind === 'sign' ? [{ label: '이적료', value: won(cost.fee) }] : []),
      ...(cost.agent > 0 ? [{ label: '에이전트 수수료', value: won(cost.agent) }] : []),
      ...(cost.bonus > 0 ? [{ label: '계약금', value: won(cost.bonus) }] : []),
      { label: '지금 나갈 돈 / 이적 예산', value: `${won(cost.total)} / ${won(g.job!.budget)}`, tone: cost.total > g.job!.budget ? 'bad' : 'plain' },
      ...(free ? [] : [{ label: '서명 후 연봉 총액 / 예산', value: `${won(wagesAfter(g, d))} / ${won(g.job!.wageBudget)}`, tone: wagesAfter(g, d) > g.job!.wageBudget ? ('bad' as const) : ('plain' as const) }]),
      { label: '합의 가능성', value: `${oddsText(odds)} (${pct(odds)})`, tone: odds >= 0.6 ? 'good' : odds < 0.35 ? 'bad' : 'plain' },
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

function sellScene(g: Game, eyebrow: string): void {
  const choices: Choice[] = [];
  for (const p of g.squad) {
    choices.push({ id: `sell:${p.id}`, group: '선발', label: `${p.spot} ${p.name} 판매 · ${won(saleFee(g, p))}`, detail: `OVR ${p.ovr + p.temp} · ${p.age}세 · ${contractText(g, p.contract)}${p.contract?.sellOn ? ` · 셀온 ${pct(p.contract.sellOn)}는 전 소속 구단 몫` : ''}` });
  }
  for (const p of g.reserves) {
    choices.push({ id: `sell:${p.id}`, group: '후보', label: `${p.spot} ${p.name} 판매 · ${won(saleFee(g, p))}`, detail: `OVR ${p.ovr} · ${p.age}세 · ${contractText(g, p.contract)}` });
    const pay = releaseCost(p);
    choices.push({ id: `release:${p.id}`, group: '후보', label: `${p.name} 계약 해지 · 위약금 ${won(pay)}`, detail: '남은 연봉의 절반을 주고 내보낸다. 연봉 예산과 등록 자리가 빈다', disabled: pay > g.job!.budget });
  }
  choices.push({ id: 'back', label: '목록으로', group: ' ' });
  g.scene = {
    eyebrow, title: '판매 · 방출',
    blocks: [{ kind: 'text', text: '선발을 팔면 같은 포지션 후보 중 가장 좋은 선수가 올라가고, 없으면 2군 선수가 메운다. 계약이 1년 남은 선수는 값이 크게 떨어진다. 핵심 선수를 팔면 라커룸 분위기가 흔들린다.' }],
    choices,
  };
}

function listScene(g: Game, eyebrow: string): void {
  const w = g.window as TransferWindow;
  const nation = nationOf(g);
  const job = g.job!;
  const title = nation ? '대표팀 소집 명단' : w.kind === 'summer' ? '여름 이적시장' : '겨울 이적시장';
  const blocks: Block[] = [];
  if (nation) blocks.push({ kind: 'text', text: `이번 소집에서 ${NATION_CHANGES - w.signed}자리를 더 바꿀 수 있다.` });
  else {
    blocks.push({
      kind: 'stats', rows: [
        { label: '이적 예산', value: won(job.budget) },
        ...(amateur(g) ? [{ label: '연봉', value: '무급(아마추어 리그)' }] : [{ label: '연봉 총액 / 예산', value: `${won(totalWages(g))} / ${won(job.wageBudget)}`, tone: totalWages(g) > job.wageBudget ? ('bad' as const) : ('plain' as const) }]),
        { label: '등록 선수', value: `선발 ${g.squad.length} · 후보 ${g.reserves.length}/${RESERVE_LIMIT}` },
        { label: '이번 시장', value: `영입 ${w.signed} · 판매 ${w.sold}` },
      ],
    });
  }
  if (w.log.length > 0) blocks.push({ kind: 'log', items: w.log.map((text) => ({ min: 0, text, tone: 'plain' as const })) });
  const choices: Choice[] = [];
  for (const b of w.bids) {
    const p = all(g).find((x) => x.id === b.player);
    if (!p) continue;
    const share = p.contract?.sellOn ? ` · 셀온 ${pct(p.contract.sellOn)} 제외 실수령 ${won(round1(b.fee * (1 - p.contract.sellOn)))}` : '';
    if (b.clause) {
      choices.push({ id: `bid:${b.id}:yes`, group: '들어온 제안', label: `바이아웃 발동! ${b.club} → ${p.name} ${won(b.fee)}`, detail: `구단은 막을 수 없다. 선수가 응하면 떠난다${share}` });
      choices.push({ id: `bid:${b.id}:stay`, group: '들어온 제안', label: ko`${p.name}을 직접 설득한다`, detail: '선수단 장악력 판정. 실패하면 떠나고, 성공해도 연봉 10% 인상을 약속한다' });
    } else {
      choices.push({ id: `bid:${b.id}:yes`, group: '들어온 제안', label: `${b.club}의 제안 수락: ${p.name}(${p.spot}) ${won(b.fee)}`, detail: `OVR ${p.ovr} · ${contractText(g, p.contract)}${share}` });
      if (!b.countered) choices.push({ id: `bid:${b.id}:counter`, group: '들어온 제안', label: `20% 올려 역제안: ${won(round1(b.fee * 1.2))}`, detail: '받아들이거나 제안을 거둔다' });
      choices.push({ id: `bid:${b.id}:no`, group: '들어온 제안', label: `${b.club}의 제안 거절`, detail: p.unhappy ? '이적을 원하던 선수라 크게 실망한다' : ko`${p.name}이 실망할 수도 있다` });
    }
  }
  for (const d of w.list) {
    if (d.kind === 'renew') {
      choices.push({ id: `view:${d.id}`, group: '재계약 협상', label: `${d.player.spot} ${d.player.name} · OVR ${d.player.ovr} · 계약 만료 임박`, detail: `${contractText(g, d.player.contract)}${d.player.unhappy ? ' · 불만 있음' : ''}` });
      continue;
    }
    const gain = d.player.ovr - weakest(g.squad, d.player.pos).ovr;
    const stageText = d.stage === 'terms' && d.kind === 'sign' ? ` · 이적료 ${won(d.fee)} 합의, 개인 조건 협상 중` : '';
    choices.push({
      id: `view:${d.id}`, group: nation ? '발탁 후보' : '영입 후보', label: dealLabel(d),
      detail: `${d.tag} · ${profileText(d.player)}${nation ? '' : ` · ${d.from} · ${d.kind === 'sign' ? `요구 ${won(d.price)}` : '이적료 없음'}`} · 주전 대비 ${gain > 0 ? `+${gain}` : gain}${stageText}`,
    });
  }
  if (!nation) {
    choices.push({ id: 'sellmenu', group: '구단 운영', label: '판매 · 방출', detail: '선수를 팔거나 후보의 계약을 해지한다' });
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
    detail: nation ? (w.signed === 0 ? '손발을 맞춘 선수들을 믿는다. 전술 완성도 +5' : '이 명단으로 간다') : '출전 보장을 어긴 선수가 있으면 불만이 생긴다',
  });
  g.scene = { eyebrow, title, blocks, choices };
}

/** 지금 시장 화면을 game.scene에 만든다. */
export function windowScene(g: Game, eyebrow: string): void {
  const w = g.window as TransferWindow;
  if (w.view === 'sell') return sellScene(g, eyebrow);
  const d = w.view ? w.list.find((x) => x.id === w.view) : undefined;
  if (d && d.stage === 'fee') return feeScene(g, d, eyebrow);
  if (d) return termsScene(g, d, eyebrow);
  return listScene(g, eyebrow);
}

// ---------- 거래 ----------

const depthPrice = (g: Game): number => round1(stage(g).money * 0.3 * (1 - g.manager.attrs.deal * 0.015));

/** 우리가 팔 때 받는 이적료. 계약이 1년 남았으면 크게 떨어진다. */
function saleFee(g: Game, p: Player): number {
  const { level, money } = stage(g);
  const lastYear = (p.contract?.years ?? 2) <= 1;
  return round1(valueOf(p, level, money) * (0.85 + g.manager.attrs.deal * 0.015) * (lastYear ? 0.55 : 1));
}

/** 계약 해지 위약금: 남은 연봉의 절반. */
const releaseCost = (p: Player): number => round1((p.contract?.wage ?? 0) * (p.contract?.years ?? 0) * 0.5);

/** 선수를 내보낸다. 선발이면 빈자리를 채운다. fee는 받는 돈(셀온 몫은 여기서 뺀다). */
function letGo(g: Game, p: Player, fee: number, why: string): void {
  const w = g.window as TransferWindow;
  const share = round1(fee * (p.contract?.sellOn ?? 0));
  g.job!.budget = round1(g.job!.budget + fee - share);
  let line = why + (share > 0 ? ` 셀온 조항으로 ${won(share)}는 전 소속 구단에 갔다.` : '');
  if (g.squad.some((q) => q.id === p.id)) {
    const { level, region } = stage(g);
    line += ` ${fillSlot(g, p, level - 4, region)}`;
    settle(g);
    const best = Math.max(...all(g).map((q) => q.ovr), p.ovr);
    g.morale = clamp(g.morale - (p.ovr >= best ? 4 : 2), 0, 100);
  } else {
    g.reserves = g.reserves.filter((q) => q.id !== p.id);
  }
  w.bids = w.bids.filter((b) => b.player !== p.id);
  w.list = w.list.filter((d) => !(d.kind === 'renew' && d.player.id === p.id));
  w.log.push(line);
  g.season.notes.push(line);
  w.sold++;
}

/** 서명. 영입이면 선발이나 후보로 들어가고, 재계약이면 계약만 바뀐다. */
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
  g.job!.budget = round1(g.job!.budget - cost.total);
  const terms = `${amateur(g) ? '무급' : `연봉 ${won(d.offer.wage)}`}, ${d.offer.years}년, ${PROMISES[d.offer.promise].name}${d.offer.clause !== 'none' ? `, 바이아웃 ${won(clauseAmount(g, p, d.offer.clause) ?? 0)}` : ''}`;
  if (d.kind === 'renew') {
    p.contract = makeContract(g, p, d.offer, p.contract?.sellOn ?? 0);
    p.contract.since = g.year;
    p.unhappy = p.unhappy && PROMISES[d.offer.promise].rank < PROMISES[d.ask.promise].rank;
    const line = ko`${p.name}과 재계약했다(${terms}).`;
    w.log.push(line);
    g.season.notes.push(line);
    return;
  }
  p.contract = makeContract(g, p, d.offer, d.sellOn);
  p.unhappy = false;
  assignNumber(g, p);
  let where: string;
  if (d.offer.promise === 'star' || d.offer.promise === 'starter') {
    const out = weakest(g.squad, p.pos);
    g.squad = g.squad.map((q) => (q.id === out.id ? p : q));
    g.reserves.push(out);
    where = ko`선발로 들어가고 ${out.name}은 후보로 밀려났다.`;
  } else {
    g.reserves.push(p);
    where = '후보 명단에 들어간다.';
  }
  w.signed++;
  const paid = [cost.fee > 0 ? `이적료 ${won(cost.fee)}` : '', cost.agent > 0 ? `에이전트 수수료 ${won(cost.agent)}` : '', cost.bonus > 0 ? `계약금 ${won(cost.bonus)}` : ''].filter(Boolean).join(', ');
  const line = ko`${p.name}(${p.spot}, 등번호 ${p.no})과 계약했다. ${terms}${paid ? `. ${paid}` : ''}. ${where}`;
  w.log.push(line);
  g.season.notes.push(line);
}

function setTerm(g: Game, d: Deal, key: string, value: string): void {
  const t: Terms = d.offer;
  if (key === 'wage' && !amateur(g)) {
    const f = Number(value);
    if ([0.8, 0.9, 1, 1.1, 1.25].includes(f)) t.wage = round1(d.ask.wage * f);
  } else if (key === 'years') {
    const y = Number(value);
    if (y >= 1 && y <= 5) t.years = y;
  } else if (key === 'promise' && PROMISE_IDS.includes(value as PromiseId)) {
    t.promise = value as PromiseId;
  } else if (key === 'clause' && ['none', 'high', 'low'].includes(value)) {
    t.clause = value as Terms['clause'];
  } else if (key === 'bonus' && !amateur(g)) {
    t.bonus = value === '1';
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
  const d = w.view && w.view !== 'sell' ? w.list.find((x) => x.id === w.view) : undefined;
  if (id === 'back') {
    w.view = null;
    return false;
  }
  if (d) {
    actDeal(g, w, d, id);
    return false;
  }
  if (w.view === 'sell') {
    const [verb, raw] = id.split(':');
    const p = all(g).find((x) => x.id === Number(raw));
    if (!p) return false;
    if (verb === 'sell') {
      letGo(g, p, saleFee(g, p), ko`${p.name}(${p.spot})을 ${won(saleFee(g, p))}에 팔았다.`);
      w.view = null;
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
      const keep = w.list.filter((x) => x.kind === 'youth' || x.kind === 'renew' || x.stage === 'terms');
      w.list = [...keep, ...scoutList(g, w.kind, w.scouted).filter((x) => x.kind !== 'youth')];
      w.log.push('스카우트를 다시 보내 새 후보 명단을 받았다.');
      return false;
    }
    case 'done': {
      if (nation && w.signed === 0) g.cohesion = clamp(g.cohesion + 5, 0, 100);
      for (const line of nation ? [] : checkPromises(g)) g.season.notes.push(line);
      g.window = null;
      return true;
    }
  }
  return false;
}

function actDeal(g: Game, w: TransferWindow, d: Deal, id: string): void {
  if (d.stage === 'fee') {
    if (!id.startsWith('fee:')) return;
    const kind = id.slice(4);
    const budget = g.job!.budget;
    if (kind === 'clause') {
      const clause = d.player.contract?.clause;
      if (!clause || clause > budget) return;
      d.fee = clause;
      d.stage = 'terms';
      w.log.push(ko`${d.player.name}의 바이아웃 ${won(clause)}을 지불하기로 했다. ${d.from}은 막을 수 없다.`);
      return;
    }
    const frac = kind === '100' ? 1 : kind === '90' ? 0.9 : kind === '80' || kind === '80s' ? 0.8 : 0;
    if (!frac) return;
    const sellOn = kind === '80s' ? 0.2 : 0;
    const amount = round1(d.price * frac);
    if (amount > budget) return;
    if (frac >= 1 || chance(g, feeOdds(g, d, frac, sellOn))) {
      d.fee = amount;
      d.sellOn = sellOn;
      d.stage = 'terms';
      w.log.push(ko`${d.from}과 ${d.player.name}의 이적료 ${won(amount)}에 합의했다${sellOn ? `(셀온 ${pct(sellOn)})` : ''}. 이제 개인 조건 협상이다.`);
    } else if (d.tries >= 1 && chance(g, 0.35)) {
      w.list = w.list.filter((x) => x.id !== d.id);
      w.view = null;
      w.log.push(ko`${d.from}이 협상을 끊었다. ${d.player.name} 영입은 무산됐다.`);
    } else {
      d.tries++;
      w.log.push(ko`${d.from}이 ${won(amount)} 제안을 거절했다. 요구액 ${won(d.price)}에서 물러서지 않는다.`);
    }
    return;
  }
  if (id.startsWith('t:')) {
    const [, key = '', value = ''] = id.split(':');
    setTerm(g, d, key, value);
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
