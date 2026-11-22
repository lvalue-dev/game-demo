// 선수단: 주전 일곱 명과 그 밖의 선수층. 선수는 나이에 따라 크고 지며, 너무 잘하면 큰 구단이 데려간다.
import { ko } from './josa.ts';
import { LEAGUES, LINEUP, TRAIT_IDS, foreignName, koreanName, won } from './data.ts';
import { chance, int, pick, rand, spread } from './rng.ts';
import { NATIONS_EU, NATIONS_KR, makeDetail, posPenalty } from './player.ts';
import type { Club, ClubLeagueId, Game, Player, Pos, Spot } from './types.ts';

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

export function makePlayer(g: Game, pos: Pos, ovr: number, age: number, region: 'kr' | 'eu', korean = false, spot?: Spot): Player {
  const foreign = !korean && (region === 'eu' ? chance(g, 0.95) : chance(g, 0.12));
  const name = foreign ? foreignName(rand(g), rand(g)) : koreanName(rand(g), rand(g), rand(g));
  const room = age <= 19 ? int(g, 6, 20) : age <= 21 ? int(g, 3, 14) : age <= 24 ? int(g, 0, 7) : 0;
  const value = Math.round(ovr);
  return {
    id: g.nextId++, name, pos, age, ovr: value, pot: Math.min(99, value + room),
    trait: chance(g, 0.35) ? pick(g, TRAIT_IDS) : null, years: 0, goals: 0, temp: 0, homegrown: false,
    ...makeDetail(g, pos, spot), no: 0, contract: null, unhappy: false, loan: null,
    nat: foreign ? pick(g, region === 'eu' ? NATIONS_EU : NATIONS_KR) : '대한민국',
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

/** 선발 일곱 자리의 포지션. g.squad의 순서가 곧 자리다. */
export const lineAt = (i: number): Pos => (LINEUP[i] ?? 'MF') as Pos;

/** 선발에서 이 선수가 맡은 줄. 선발이 아니면 본래 포지션. */
export function lineOf(g: Game, p: Player): Pos {
  const i = g.squad.findIndex((q) => q.id === p.id);
  return i >= 0 ? lineAt(i) : p.pos;
}

/** 그 줄에서 내는 OVR. 자기 포지션이 아니면 깎인다. */
export const effOvr = (p: Player, line: Pos): number => p.ovr + p.temp - posPenalty(p.spot, line);

const avg = (players: Player[], pos: Pos): number => {
  const list = players.map((p, i) => ({ p, line: lineAt(i) })).filter((x) => x.line === pos);
  return list.reduce((sum, x) => sum + effOvr(x.p, x.line), 0) / Math.max(1, list.length);
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

/** 그 줄의 선발 중 가장 약한 선수(자리 기준). 선발 명단을 넘겨야 한다. */
export function weakest(squad: Player[], pos: Pos): Player {
  return squad.map((p, i) => ({ p, line: lineAt(i) })).filter((x) => x.line === pos)
    .sort((a, b) => (a.p.ovr - posPenalty(a.p.spot, a.line)) - (b.p.ovr - posPenalty(b.p.spot, b.line)))[0]!.p;
}

/** 잠재력을 감독의 안목만큼만 알려 준다. */
export function potentialText(g: Game, p: Player): string {
  const room = p.pot - p.ovr;
  if (p.age > 24) return '전성기 선수';
  if (g.manager.attrs.eye >= 12) return `POT ${p.pot}`;
  if (g.manager.attrs.eye >= 8) return room >= 12 ? '특급 유망주' : room >= 5 ? '성장 여지 있음' : '성장 거의 끝';
  return '포텐셜 미확인';
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
  for (const p of [...g.squad, ...g.reserves, ...g.loaned]) {
    let delta = 0;
    if (p.age <= 23) {
      // 임대 가서 꾸준히 뛴 어린 선수는 더 큰다.
      const rate = spread(g, 0.12, 0.3) * (1 + attrs.youth / 25) * (g.season.focus === 'youth' ? 1.4 : 1) * (p.loan?.dir === 'out' ? 1.3 : 1);
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
      gone = ko`OVR ${p.ovr}의 ${p.name}을 빅클럽이 이적료 ${won(fee)}에 데려갔다.`;
    } else if (club.nation && p.age >= 33 && chance(g, 0.5)) {
      gone = ko`${p.age}세 ${p.name}이 대표팀 은퇴를 선언했다.`;
    }
    if (!gone) continue;
    lines.push(`${gone} ${fillSlot(g, p, nextLevel, region)}`);
  }
  // 후보 중 노장은 은퇴한다.
  for (const p of [...g.reserves]) {
    if (p.age >= 36 || (p.age >= 34 && chance(g, 0.4))) {
      g.reserves = g.reserves.filter((q) => q.id !== p.id);
      lines.push(ko`후보 ${p.age}세 ${p.name}이 유니폼을 벗었다.`);
    }
  }
  return { income, lines };
}

/**
 * 선발 한 자리가 비었다. 같은 포지션 후보 중 가장 좋은 선수가 올라가고, 없으면 새 선수가 온다.
 * 대표팀은 늘 새 선수를 부른다. 설명 한 줄을 돌려준다.
 */
export function fillSlot(g: Game, out: Player, level: number, region: 'kr' | 'eu'): string {
  const club = myClub(g);
  const target = level + spread(g, -4, 1);
  const line = lineOf(g, out);
  const bench = club.nation ? undefined : g.reserves.filter((q) => q.pos === line && !q.loan).sort((a, b) => b.ovr - a.ovr)[0];
  // 후보가 새로 데려올 선수만큼 좋으면 후보를 올리고, 아니면 새 선수를 데려온다.
  if (bench && bench.ovr >= target - 1) {
    g.reserves = g.reserves.filter((q) => q.id !== bench.id);
    g.squad = g.squad.map((q) => (q.id === out.id ? bench : q));
    return ko`후보 ${bench.name}(${bench.spot}, OVR ${bench.ovr})이 선발로 올라섰다.`;
  }
  const fill = makePlayer(g, line, target, int(g, 20, 27), region, club.nation, line === out.pos ? out.spot : undefined);
  if (!club.nation) {
    fill.contract = { wage: 0, years: int(g, 2, 3), promise: 'starter', clause: null, sellOn: 0, since: g.year };
  }
  g.squad = g.squad.map((q) => (q.id === out.id ? fill : q));
  return ko`빈자리는 OVR ${fill.ovr}의 ${fill.name}(${fill.spot})이 맡는다.`;
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
