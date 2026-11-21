// 이적 시장. 시장이 열려 있는 동안 여러 건을 거래할 수 있다.
// 후보 목록 → 선수 카드(능력치, 주발, 비교) → 요구액 수락 또는 협상. 주전을 팔 수도 있고,
// 다른 구단이 우리 선수에게 제안을 넣기도 한다. "이적시장 마감"을 누르면 끝난다.
import { ko } from './josa.ts';
import { CLUB_LEAGUES, won } from './data.ts';
import { profileText } from './player.ts';
import { chance, int, pick, spread } from './rng.ts';
import { addPlayer, makePlayer, myClub, potentialText, priceFor, stage, valueOf, weakest } from './squad.ts';
import type { Block, Choice, Club, ClubLeagueId, Deal, Game, Player, Pos, TransferWindow } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** 대표팀이 한 번 소집 때 바꿀 수 있는 자리 수. */
const NATION_CHANGES = 2;
/** 스카우트를 다시 보낼 수 있는 횟수와 비용(그 무대 한 시즌 예산 대비). */
const SCOUT_TIMES = 2;
const SCOUT_COST = 0.04;

const nationOf = (g: Game): boolean => myClub(g).nation;

/** 후보 하나를 만든다. 성격(tag)에 따라 나이, OVR, 값이 다르다. */
function candidate(g: Game, id: string, pos: Pos, tag: string): Deal {
  const { level, region } = stage(g);
  const nation = nationOf(g);
  const eye = (g.manager.attrs.eye - 6) / 4;
  const current = weakest(g.squad, pos);
  let ovr: number;
  let age: number;
  let kind: Deal['kind'] = 'sign';
  if (tag === '유망주') {
    ovr = level - int(g, 2, 6) + eye;
    age = int(g, 18, 21);
  } else if (tag === '베테랑') {
    ovr = level + spread(g, 0, 4) + eye;
    age = int(g, 31, 34);
  } else if (tag === '자유계약') {
    ovr = level - spread(g, 2, 6) + eye;
    age = int(g, 26, 33);
    kind = 'free';
  } else {
    // 즉시 전력: 지금 주전보다 낫다.
    ovr = Math.max(current.ovr + 1, level + spread(g, -2, 5) + eye);
    age = int(g, 22, 29);
  }
  // 대표팀은 그 나라 선수층의 한계를 넘는 선수를 부를 수 없다.
  if (nation) ovr = Math.min(level + 4, ovr);
  const player = makePlayer(g, pos, Math.round(ovr), age, region, nation);
  if (tag === '유망주') player.pot = Math.min(99, player.ovr + int(g, 8, 18));
  // 즉시 전력감은 다른 구단과 경쟁이 붙어 웃돈이 붙고, 베테랑은 싸다.
  const premium = tag === '즉시 전력' ? 1.5 : tag === '베테랑' ? 0.8 : 1;
  const price = nation ? 0 : kind === 'free' ? round1(stage(g).money * 0.02) : round1(priceFor(g, player) * premium);
  return { id, kind, player, price, tag, tries: 0 };
}

/** 시장에 나온 후보들. 여름에는 여섯, 겨울에는 넷. 스카우팅이 좋으면 하나 더. */
function scoutList(g: Game, kind: 'summer' | 'winter', round: number): Deal[] {
  const nation = nationOf(g);
  const count = (kind === 'summer' ? 6 : 4) + (g.manager.attrs.eye >= 12 ? 1 : 0);
  // 약한 자리부터 찾는다.
  const needs = [...g.squad].sort((a, b) => a.ovr - b.ovr).map((p) => p.pos);
  const tags = nation ? ['즉시 전력', '즉시 전력', '유망주', '베테랑'] : ['즉시 전력', '즉시 전력', '유망주', '베테랑', '자유계약', '즉시 전력', '유망주'];
  const list: Deal[] = [];
  for (let i = 0; i < count; i++) {
    const pos = i < 3 ? (needs[i] as Pos) : pick(g, ['GK', 'DF', 'MF', 'FW'] as Pos[]);
    list.push(candidate(g, `c${round}-${i}`, pos, tags[i % tags.length] as string));
  }
  if (!nation && kind === 'summer' && round === 0) {
    // 유소년 팀에서 올라올 선수.
    const { level, region } = stage(g);
    const oldest = [...g.squad].sort((a, b) => b.age - a.age)[0] as Player;
    const kid = makePlayer(g, oldest.pos, level - int(g, 3, 8), int(g, 17, 18), region, region === 'kr');
    kid.pot = Math.min(99, kid.ovr + int(g, 8, 16) + Math.round(g.manager.attrs.youth / 2));
    kid.homegrown = true;
    list.push({ id: 'youth', kind: 'youth', player: kid, price: 0, tag: '유스', tries: 0 });
  }
  return list;
}

/** 다른 구단의 제안. 이 무대 수준을 넘어선 주전에게 윗물 구단이 관심을 보인다. */
function makeBids(g: Game, kind: 'summer' | 'winter'): TransferWindow['bids'] {
  if (nationOf(g)) return [];
  const club = myClub(g);
  const { level, money } = stage(g);
  const idx = CLUB_LEAGUES.indexOf(club.league as ClubLeagueId);
  const upper = CLUB_LEAGUES[Math.min(CLUB_LEAGUES.length - 1, idx + 1)] as ClubLeagueId;
  const suitors = [...g.leagues[upper], ...g.leagues[club.league]].filter((id) => id !== club.id).map((id) => g.clubs[id] as Club);
  const bids: TransferWindow['bids'] = [];
  for (const p of [...g.squad].sort((a, b) => b.ovr - a.ovr)) {
    if (bids.length >= 2) break;
    const hot = p.ovr - level;
    if (hot < 1 || !chance(g, clamp((kind === 'summer' ? 0.25 : 0.15) + hot * 0.06, 0, 0.8))) continue;
    const suitor = pick(g, suitors);
    const fee = round1(valueOf(p, level, money) * spread(g, 1.0, 1.45) * (1 + g.manager.attrs.deal * 0.01));
    bids.push({ id: `b${bids.length}`, player: p.id, club: suitor.name, fee });
  }
  return bids;
}

export function openWindow(g: Game, kind: 'summer' | 'winter'): void {
  g.window = {
    kind, list: scoutList(g, kind, 0), bids: makeBids(g, kind), view: null, log: [],
    signed: 0, sold: 0, scouted: 0, depthDone: false,
  };
}

// ---------- 장면 ----------

function squadItems(g: Game): Block {
  const { level, money } = stage(g);
  const nation = nationOf(g);
  return {
    kind: 'players',
    items: g.squad.map((p) => ({ player: p, note: nation ? undefined : `시장가 ${won(valueOf(p, level, money))}` })),
  };
}

function dealLabel(d: Deal): string {
  const p = d.player;
  return `${p.spot} ${p.name} · ${p.age}세 · OVR ${p.ovr}`;
}

/** 지금 시장 화면을 game.scene에 만든다. title은 시장 이름이다. */
export function windowScene(g: Game, eyebrow: string): void {
  const w = g.window as TransferWindow;
  const nation = nationOf(g);
  const budget = g.job!.budget;
  const title = nation ? '대표팀 소집 명단' : w.kind === 'summer' ? '여름 이적시장' : '겨울 이적시장';
  const log: Block[] = w.log.length > 0 ? [{ kind: 'log', items: w.log.map((text) => ({ min: 0, text, tone: 'plain' as const })) }] : [];

  if (w.view === 'sell') {
    const { level, money } = stage(g);
    g.scene = {
      eyebrow, title: '이적 명단',
      blocks: [{ kind: 'text', text: `주전을 팔면 이적료가 들어오고, 빈자리는 2군에서 올라온 선수가 메운다(OVR ${Math.round(g.depth)} 안팎). 판매가는 시장가에 협상력이 더해진다. 주전을 팔면 라커룸 분위기가 조금 가라앉는다.` }],
      choices: [
        ...g.squad.map((p): Choice => ({
          id: `sell:${p.id}`, label: `${p.spot} ${p.name} 판매`, group: '주전',
          detail: `OVR ${p.ovr + p.temp} · ${p.age}세 · ${profileText(p)} · 예상 이적료 ${won(sellFee(g, p))} (시장가 ${won(valueOf(p, level, money))})`,
        })),
        { id: 'back', label: '목록으로', group: ' ' },
      ],
    };
    return;
  }

  const deal = w.view ? w.list.find((d) => d.id === w.view) : undefined;
  if (deal) {
    const p = deal.player;
    const current = weakest(g.squad, p.pos);
    const cut = round1(deal.price * 0.8);
    const blocks: Block[] = [
      { kind: 'card', player: p, price: nation ? undefined : deal.price > 0 ? `요구 이적료 ${won(deal.price)}` : '이적료 없음', compare: current, note: `${deal.tag} · ${potentialText(g, p)}` },
      { kind: 'text', text: ko`영입하면 지금 주전 ${current.name}(${current.spot}, OVR ${current.ovr})의 자리에 들어간다.${nation ? '' : ` 밀려난 선수는 시장가의 30%에 정리된다. 남은 예산 ${won(budget)}.`}` },
    ];
    const choices: Choice[] = [];
    if (nation) {
      choices.push({ id: 'buy', label: `${p.name} 발탁`, tone: 'primary', disabled: w.signed >= NATION_CHANGES, detail: w.signed >= NATION_CHANGES ? `이번 소집에서 바꿀 수 있는 ${NATION_CHANGES}자리를 다 썼다` : '소집 명단에 넣는다' });
    } else {
      choices.push({ id: 'buy', label: deal.price > 0 ? `요구액 ${won(deal.price)}에 영입` : '영입', tone: 'primary', disabled: deal.price > budget, detail: deal.price > budget ? '예산이 모자란다' : '바로 계약한다' });
      if (deal.price > 0) {
        const odds = haggleOdds(g, deal);
        choices.push({
          id: 'haggle', label: `${won(cut)}로 깎아서 제안`, disabled: cut > budget,
          detail: `협상 성공 가능성 ${odds >= 0.55 ? '높음' : odds >= 0.35 ? '보통' : '낮음'}. 실패하면 요구액이 오르거나 다른 구단으로 간다`,
        });
      }
    }
    choices.push({ id: 'back', label: '목록으로' });
    g.scene = { eyebrow, title: dealLabel(deal), blocks, choices };
    return;
  }

  const lines: string[] = [];
  if (nation) lines.push(`이번 소집에서 ${NATION_CHANGES - w.signed}자리를 더 바꿀 수 있다.`);
  else lines.push(`예산 ${won(budget)}. 이번 시장에서 영입 ${w.signed}명, 판매 ${w.sold}명.`);
  const blocks: Block[] = [{ kind: 'text', text: lines.join(' ') }, ...log, squadItems(g)];
  const choices: Choice[] = [];
  for (const b of w.bids) {
    const p = g.squad.find((x) => x.id === b.player);
    if (!p) continue;
    choices.push({ id: `bid:${b.id}:yes`, group: '들어온 제안', label: `${b.club}의 제안 수락: ${p.name}(${p.spot}) ${won(b.fee)}`, detail: `OVR ${p.ovr} · ${p.age}세. 빈자리는 2군 선수가 메운다` });
    choices.push({ id: `bid:${b.id}:no`, group: '들어온 제안', label: `${b.club}의 제안 거절`, detail: ko`${p.name}이 실망할 수도 있다` });
  }
  for (const d of w.list) {
    const current = weakest(g.squad, d.player.pos);
    const gain = d.player.ovr - current.ovr;
    choices.push({
      id: `view:${d.id}`, group: nation ? '발탁 후보' : '영입 후보', label: dealLabel(d),
      detail: `${d.tag} · ${profileText(d.player)}${nation ? '' : ` · ${d.price > 0 ? `요구액 ${won(d.price)}` : '이적료 없음'}`} · 주전 대비 ${gain > 0 ? `+${gain}` : gain}`,
    });
  }
  if (!nation) {
    choices.push({ id: 'sellmenu', group: '구단 운영', label: '주전 판매', detail: '이적 명단을 보고 선수를 판다' });
    if (!w.depthDone) {
      const price = depthPrice(g);
      choices.push({ id: 'depth', group: '구단 운영', label: '스쿼드 뎁스 보강', detail: `후보 선수 여럿을 데려와 스쿼드 뎁스 +3 · ${won(price)}`, disabled: price > budget });
    }
    if (w.scouted < SCOUT_TIMES) {
      const cost = round1(stage(g).money * SCOUT_COST);
      choices.push({ id: 'scout', group: '구단 운영', label: '스카우트 재파견', detail: `새 후보 명단을 받는다 · ${won(cost)} · ${SCOUT_TIMES - w.scouted}번 남음`, disabled: cost > budget });
    }
  }
  choices.push({
    id: 'done', group: ' ', tone: 'primary', label: nation ? '명단 확정' : '이적시장 마감',
    detail: nation ? (w.signed === 0 ? '손발을 맞춘 선수들을 믿는다. 전술 완성도 +5' : '이 명단으로 간다') : w.signed + w.sold === 0 ? '거래 없이 닫는다. 남은 예산은 시즌 끝에 절반이 이월된다' : '이 선수단으로 간다',
  });
  g.scene = { eyebrow, title, blocks, choices };
}

// ---------- 거래 ----------

const depthPrice = (g: Game): number => round1(stage(g).money * 0.3 * (1 - g.manager.attrs.deal * 0.015));
const sellFee = (g: Game, p: Player): number => {
  const { level, money } = stage(g);
  return round1(valueOf(p, level, money) * (0.85 + g.manager.attrs.deal * 0.015));
};
const haggleOdds = (g: Game, d: Deal): number => clamp(0.22 + g.manager.attrs.deal * 0.03 - d.tries * 0.15 + (d.tag === '베테랑' ? 0.1 : 0), 0.05, 0.85);

/** 주전 한 명을 내보내고 2군 선수로 채운다. */
function release(g: Game, p: Player, fee: number, why: string): void {
  const { region } = stage(g);
  const fill = makePlayer(g, p.pos, g.depth + g.season.depthMod + spread(g, -2, 2), int(g, 19, 26), region, nationOf(g), p.spot);
  g.squad = g.squad.map((q) => (q.id === p.id ? fill : q));
  g.job!.budget = round1(g.job!.budget + fee);
  // 주전이 떠나면 라커룸이 흔들린다. 에이스일수록 크다.
  const best = Math.max(...g.squad.map((q) => q.ovr), p.ovr);
  g.morale = clamp(g.morale - (p.ovr >= best ? 4 : 2), 0, 100);
  const line = ko`${why} ${fill.name}(${fill.spot}, OVR ${fill.ovr})이 2군에서 올라왔다.`;
  g.window!.log.push(line);
  g.season.notes.push(line);
  g.window!.sold++;
}

function sign(g: Game, d: Deal, price: number): void {
  const w = g.window as TransferWindow;
  const nation = nationOf(g);
  const out = addPlayer(g, d.player);
  w.list = w.list.filter((x) => x.id !== d.id);
  w.signed++;
  let line: string;
  if (nation) {
    line = ko`${d.player.name}이 처음 대표팀에 뽑혔다. ${out.name}은 명단에서 빠졌다.`;
  } else {
    const { level, money } = stage(g);
    const fee = round1(valueOf(out, level, money) * 0.3);
    g.job!.budget = round1(g.job!.budget - price + fee);
    line = price > 0
      ? ko`${d.player.name}(${d.player.spot})을 ${won(price)}에 영입했다. ${out.name}은 ${won(fee)}에 팀을 떠났다.`
      : ko`${d.player.name}(${d.player.spot})이 합류했다. ${out.name}은 팀을 떠났다.`;
  }
  w.log.push(line);
  g.season.notes.push(line);
}

/**
 * 시장에서 고른 일을 처리한다. 시장이 닫히면 true를 돌려준다.
 * 잘못된 선택은 무시한다.
 */
export function actWindow(g: Game, id: string): boolean {
  const w = g.window;
  if (!w) return true;
  const nation = nationOf(g);
  const deal = w.view ? w.list.find((d) => d.id === w.view) : undefined;
  if (id === 'back') {
    w.view = null;
    return false;
  }
  if (deal) {
    if (id === 'buy') {
      if (nation ? w.signed >= NATION_CHANGES : deal.price > g.job!.budget) return false;
      sign(g, deal, deal.price);
      w.view = null;
    } else if (id === 'haggle' && !nation && deal.price > 0) {
      const cut = round1(deal.price * 0.8);
      if (cut > g.job!.budget) return false;
      if (chance(g, haggleOdds(g, deal))) {
        sign(g, deal, cut);
        w.log.push('협상 끝에 요구액보다 20% 싸게 데려왔다.');
        w.view = null;
      } else if (chance(g, 0.3)) {
        w.list = w.list.filter((x) => x.id !== deal.id);
        w.log.push(ko`협상이 틀어졌다. ${deal.player.name}은 다른 구단과 계약했다.`);
        w.view = null;
      } else {
        deal.tries++;
        deal.price = round1(deal.price * 1.08);
        w.log.push(ko`${deal.player.name} 측이 제안을 거절했다. 요구액이 ${won(deal.price)}로 올랐다.`);
      }
    }
    return false;
  }
  if (w.view === 'sell') {
    const pid = id.startsWith('sell:') ? Number(id.slice(5)) : NaN;
    const p = g.squad.find((x) => x.id === pid);
    if (!p) return false;
    w.bids = w.bids.filter((b) => b.player !== p.id);
    release(g, p, sellFee(g, p), ko`${p.name}(${p.spot})을 ${won(sellFee(g, p))}에 팔았다.`);
    w.view = null;
    return false;
  }
  if (id.startsWith('view:')) {
    if (w.list.some((d) => d.id === id.slice(5))) w.view = id.slice(5);
    return false;
  }
  if (id.startsWith('bid:')) {
    const [, bidId, answer] = id.split(':');
    const bid = w.bids.find((b) => b.id === bidId);
    const p = bid && g.squad.find((x) => x.id === bid.player);
    if (!bid || !p) return false;
    w.bids = w.bids.filter((b) => b.id !== bidId);
    if (answer === 'yes') {
      release(g, p, bid.fee, ko`${bid.club}의 제안을 받아들여 ${p.name}을 ${won(bid.fee)}에 보냈다.`);
    } else if (chance(g, 0.35)) {
      p.temp -= 1;
      g.morale = clamp(g.morale - 2, 0, 100);
      w.log.push(ko`${bid.club}의 제안을 거절했다. 이적을 바랐던 ${p.name}이 불만을 드러냈다(이번 시즌 OVR -1).`);
    } else {
      w.log.push(ko`${bid.club}의 제안을 거절했다. ${p.name}은 남는 데 동의했다.`);
    }
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
      w.log.push('후보 선수들이 합류해 스쿼드 뎁스가 두꺼워졌다.');
      g.season.notes.push('후보 선수들이 합류해 스쿼드 뎁스가 두꺼워졌다.');
      return false;
    }
    case 'scout': {
      const cost = round1(stage(g).money * SCOUT_COST);
      if (w.scouted >= SCOUT_TIMES || cost > g.job!.budget) return false;
      w.scouted++;
      g.job!.budget = round1(g.job!.budget - cost);
      w.list = [...w.list.filter((d) => d.kind === 'youth'), ...scoutList(g, w.kind, w.scouted).filter((d) => d.kind !== 'youth')];
      w.log.push('스카우트를 다시 보내 새 후보 명단을 받았다.');
      return false;
    }
    case 'done':
      if (nation && w.signed === 0) g.cohesion = clamp(g.cohesion + 5, 0, 100);
      g.window = null;
      return true;
  }
  return false;
}

