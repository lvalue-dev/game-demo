// 선수단: 주전 일곱 명과 그 밖의 선수층. 선수는 나이에 따라 크고 지며, 너무 잘하면 큰 구단이 데려간다.
import { ko } from './josa.ts';
import { LEAGUES, LINEUP, POS_NAME, TRAIT_IDS, foreignName, koreanName, won } from './data.ts';
import { chance, int, pick, rand, spread } from './rng.ts';
import type { Club, ClubLeagueId, Game, MarketOption, Player, Pos } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function myClub(g: Game): Club {
  return g.clubs[g.job!.club] as Club;
}

/** 감독이 맡은 팀이 속한 무대의 수준과 돈 단위. 국가대표는 국내 1부의 돈 단위를 빌려 쓴다. */
export function stage(g: Game): { level: number; money: number; region: 'kr' | 'eu' } {
  const club = myClub(g);
  if (club.nation) return { level: (club.att + club.def) / 2, money: LEAGUES.kr1.money, region: 'kr' };
  const meta = LEAGUES[club.league as ClubLeagueId];
  return { level: meta.level, money: meta.money, region: meta.region };
}

export function makePlayer(g: Game, pos: Pos, ovr: number, age: number, region: 'kr' | 'eu', korean = false): Player {
  const foreign = !korean && (region === 'eu' ? chance(g, 0.95) : chance(g, 0.12));
  const name = foreign ? foreignName(rand(g), rand(g)) : koreanName(rand(g), rand(g), rand(g));
  const room = age <= 19 ? int(g, 6, 20) : age <= 21 ? int(g, 3, 14) : age <= 24 ? int(g, 0, 7) : 0;
  const value = Math.round(ovr);
  return {
    id: g.nextId++, name, pos, age, ovr: value, pot: Math.min(99, value + room),
    trait: chance(g, 0.35) ? pick(g, TRAIT_IDS) : null, years: 0, goals: 0, temp: 0, homegrown: false,
  };
}

/** 구단의 전력에 맞는 주전 일곱 명을 만든다. */
export function generateSquad(g: Game, club: Club, region: 'kr' | 'eu'): Player[] {
  const mid = (club.att + club.def) / 2;
  return LINEUP.map((pos) => {
    const base = pos === 'FW' ? club.att + 1 : pos === 'MF' ? mid : club.def + 1;
    return makePlayer(g, pos, base + spread(g, -4, 4), int(g, 19, 33), region, club.nation);
  });
}

const avg = (players: Player[], pos: Pos): number => {
  const list = players.filter((p) => p.pos === pos);
  return list.reduce((sum, p) => sum + p.ovr + p.temp, 0) / Math.max(1, list.length);
};

/** 주전과 선수층에서 팀의 공격력과 수비력을 낸다. */
export function ratings(squad: Player[], depth: number): { att: number; def: number; mid: number } {
  const mid = avg(squad, 'MF');
  return {
    att: 0.55 * avg(squad, 'FW') + 0.25 * mid + 0.2 * depth,
    def: 0.4 * avg(squad, 'DF') + 0.2 * avg(squad, 'GK') + 0.2 * mid + 0.2 * depth,
    mid,
  };
}

/** 선수의 몸값(백만 원). 리그 수준보다 잘할수록 가파르게 비싸고, 어리고 잠재력이 클수록 비싸다. */
export function valueOf(p: Player, level: number, money: number): number {
  const ageFactor = p.age <= 21 ? 1.2 + (p.pot - p.ovr) / 25 : p.age <= 28 ? 1 : p.age <= 31 ? 0.65 : 0.35;
  return Math.max(money * 0.05, money * 0.3 * Math.pow(1.25, p.ovr - level) * ageFactor);
}

/** 감독의 수완이 좋을수록 싸게 산다. */
export function priceFor(g: Game, p: Player): number {
  const { level, money } = stage(g);
  return Math.round(valueOf(p, level, money) * (1 - g.manager.attrs.deal * 0.015) * 10) / 10;
}

export function weakest(squad: Player[], pos: Pos): Player {
  return squad.filter((p) => p.pos === pos).sort((a, b) => a.ovr - b.ovr)[0] as Player;
}

/** 잠재력을 감독의 안목만큼만 알려 준다. */
export function potentialText(g: Game, p: Player): string {
  const room = p.pot - p.ovr;
  if (p.age > 24) return '완성된 선수';
  if (g.manager.attrs.eye >= 12) return `잠재력 ${p.pot}`;
  if (g.manager.attrs.eye >= 8) return room >= 12 ? '크게 될 재목' : room >= 5 ? '더 클 여지가 있음' : '거의 다 큼';
  return '잠재력은 지켜봐야 앎';
}

function describe(g: Game, p: Player): string {
  const trait = p.trait ? ` · ${{ leader: '리더', glass: '유리몸', clutch: '강심장', rebel: '말썽꾼', grinder: '성실' }[p.trait]}` : '';
  return `${POS_NAME[p.pos]} · ${p.age}세 · 실력 ${p.ovr} · ${potentialText(g, p)}${trait}`;
}

/** 이적 시장에 나온 선택지. 여름에는 후보가 더 많다. */
export function marketOptions(g: Game, window: 'summer' | 'winter'): MarketOption[] {
  const { level, money, region } = stage(g);
  const { attrs } = g.manager;
  const nation = myClub(g).nation;
  const options: MarketOption[] = [];
  const count = (window === 'summer' ? 2 : 1) + (attrs.eye >= 12 ? 1 : 0);
  const needs = [...g.squad].sort((a, b) => a.ovr - b.ovr).map((p) => p.pos);
  for (let i = 0; i < count; i++) {
    const pos = i === 0 ? (needs[0] as Pos) : pick(g, LINEUP);
    const current = weakest(g.squad, pos);
    // 안목이 좋을수록 더 좋은 후보를 찾아낸다.
    // 대표팀은 그 나라 선수층의 한계를 넘는 선수를 부를 수 없다.
    const found = level + spread(g, -4, 4) + (attrs.eye - 6) / 4;
    const ovr = Math.round(nation ? Math.min(level + 4, Math.max(current.ovr + 1, found)) : Math.max(current.ovr + 1, found));
    const player = makePlayer(g, pos, ovr, int(g, 19, 31), region, nation);
    const price = nation ? 0 : priceFor(g, player);
    options.push({
      id: `sign${i}`, kind: 'sign', player, price,
      label: nation ? `${player.name} 발탁` : `${player.name} 영입`,
      detail: `${describe(g, player)}\n${current.name}(실력 ${current.ovr}) 대신 주전${nation ? '' : ` · ${won(price)}`}`,
    });
  }
  if (!nation && window === 'summer') {
    const oldest = [...g.squad].sort((a, b) => b.age - a.age)[0] as Player;
    const pos = oldest.pos;
    const current = weakest(g.squad, pos);
    const kid = makePlayer(g, pos, level - int(g, 3, 8), int(g, 17, 18), region, region === 'kr');
    kid.pot = Math.min(99, kid.ovr + int(g, 8, 16) + Math.round(attrs.youth / 2));
    kid.homegrown = true;
    options.push({
      id: 'youth', kind: 'youth', player: kid, price: 0,
      label: `유소년 ${kid.name} 승격`,
      detail: `${describe(g, kid)}\n${current.name}(실력 ${current.ovr}) 대신 주전 · 무료`,
    });
  }
  if (!nation) {
    const price = Math.round(money * 0.3 * (1 - attrs.deal * 0.015) * 10) / 10;
    options.push({ id: 'depth', kind: 'depth', price, label: '선수층 보강', detail: `후보 선수 여럿을 데려와 선수층 +3 · ${won(price)}` });
  }
  options.push({
    id: 'skip', kind: 'skip', price: 0,
    label: nation ? '지금 명단 그대로' : '이번엔 넘어간다',
    detail: nation ? '손발을 맞춘 선수들을 믿는다. 전술 숙련도 +5' : '돈을 아낀다. 남은 예산의 절반이 다음 시즌으로 넘어간다',
  });
  return options;
}

/** 새 선수를 주전에 넣고, 밀려난 선수를 돌려준다. */
export function addPlayer(g: Game, player: Player): Player {
  const out = weakest(g.squad, player.pos);
  g.squad = g.squad.map((p) => (p.id === out.id ? player : p));
  return out;
}

export interface Change {
  player: Player;
  delta: number;
  note: string;
}

/** 시즌이 끝난 뒤 선수들이 크고 진다. */
export function develop(g: Game): Change[] {
  const { attrs } = g.manager;
  const changes: Change[] = [];
  for (const p of g.squad) {
    let delta = 0;
    if (p.age <= 23) {
      const rate = spread(g, 0.12, 0.3) * (1 + attrs.youth / 25) * (g.season.focus === 'youth' ? 1.4 : 1);
      delta = Math.round((p.pot - p.ovr) * rate + spread(g, -0.5, 1));
    } else if (p.age <= 29) {
      delta = Math.min(p.pot - p.ovr, int(g, -1, 1));
    } else {
      const slow = (p.trait === 'grinder' ? 1 : 0) + (g.season.focus === 'fitness' ? 1 : 0);
      delta = -Math.max(0, int(g, 0, 3) + (p.age >= 33 ? 1 : 0) - slow);
    }
    delta = clamp(delta, -5, Math.max(0, p.pot - p.ovr));
    p.ovr += delta;
    p.age++;
    p.years++;
    p.temp = 0;
    if (delta !== 0) changes.push({ player: p, delta, note: '' });
  }
  return changes;
}

/**
 * 시즌이 끝나면 리그 수준을 한참 넘어선 선수는 큰 구단이 데려가고, 노장은 은퇴한다.
 * 빈자리는 평범한 선수가 채운다. 생긴 이적료와 설명을 돌려준다.
 */
export function departures(g: Game, nextLevel: number): { income: number; lines: string[] } {
  const { money, region } = stage(g);
  const club = myClub(g);
  let income = 0;
  const lines: string[] = [];
  for (const p of [...g.squad]) {
    let gone = '';
    if (p.age >= 36 || (p.age >= 34 && chance(g, 0.4))) {
      gone = ko`${p.age}세 ${p.name}이 유니폼을 벗었다.`;
    } else if (!club.nation && p.ovr >= nextLevel + 7 && chance(g, 0.6 - g.manager.attrs.deal * 0.02)) {
      const fee = Math.round(valueOf(p, nextLevel, money) * (1 + g.manager.attrs.deal * 0.015));
      income += fee;
      gone = ko`실력 ${p.ovr}의 ${p.name}을 더 큰 구단이 ${won(fee)}에 데려갔다.`;
    } else if (club.nation && p.age >= 33 && chance(g, 0.5)) {
      gone = ko`${p.age}세 ${p.name}이 대표팀 은퇴를 선언했다.`;
    }
    if (!gone) continue;
    const fill = makePlayer(g, p.pos, nextLevel + spread(g, -4, 1), int(g, 20, 27), region, club.nation);
    g.squad = g.squad.map((q) => (q.id === p.id ? fill : q));
    lines.push(ko`${gone} 빈자리는 실력 ${fill.ovr}의 ${fill.name}이 맡는다.`);
  }
  return { income, lines };
}

/** 팀 득점을 주전들에게 나눠 준다. 시즌 기록에 이야깃거리를 만든다. */
export function shareGoals(g: Game, total: number): void {
  const weights = g.squad.map((p) => (p.pos === 'FW' ? 6 : p.pos === 'MF' ? 2.5 : p.pos === 'DF' ? 0.6 : 0) * (0.6 + (p.ovr + p.temp) / 100));
  const sum = weights.reduce((a, b) => a + b, 0);
  // 주전 일곱 명이 팀 득점의 약 80%를 넣는다.
  for (let i = 0; i < Math.round(total * 0.8); i++) {
    let roll = rand(g) * sum;
    for (let k = 0; k < weights.length; k++) {
      roll -= weights[k] as number;
      if (roll <= 0) {
        (g.squad[k] as Player).goals++;
        break;
      }
    }
  }
}
