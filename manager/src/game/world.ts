// 리그와 경기. 모든 구단의 경기를 실제로 돌려 순위표를 만든다.
import { CLUB_LEAGUES, CLUB_SEEDS, LEAGUES, NATIONS, STYLE_IDS } from './data.ts';
import { chance, int, pick, poisson, shuffle, spread } from './rng.ts';
import type { Club, ClubLeagueId, Game, LeagueId, MatchLine, Row } from './types.ts';

export interface Side {
  att: number;
  def: number;
}

export const emptyRow = (club: number): Row => ({ club, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] });

/** 모든 팀이 서로 한 번(또는 홈과 원정 두 번) 만나는 일정. 팀 수가 홀수면 라운드마다 한 팀이 쉰다. */
export function roundRobin(ids: number[], double: boolean): [number, number][][] {
  const REST = -1;
  const ring = ids.length % 2 === 0 ? [...ids] : [...ids, REST];
  const n = ring.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ring[i] as number;
      const b = ring[n - 1 - i] as number;
      if (a === REST || b === REST) continue;
      // 홈과 원정이 한쪽으로 몰리지 않게 번갈아 배정한다.
      round.push((i === 0 ? r % 2 === 0 : i % 2 === 0) ? [a, b] : [b, a]);
    }
    rounds.push(round);
    ring.splice(1, 0, ring.pop() as number);
  }
  return double ? [...rounds, ...rounds.map((round) => round.map(([a, b]): [number, number] => [b, a]))] : rounds;
}

/** 승점, 골 득실, 다득점 순. */
export function sortTable(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || a.club - b.club);
}

export function positionOf(g: Game, league: LeagueId, club: number): number {
  return sortTable(g.tables[league]).findIndex((r) => r.club === club) + 1;
}

/** 한 팀이 한 경기에 넣는 골. 공격과 상대 수비의 차이가 10이면 기대 득점이 약 1.6배가 된다. */
export function goals(g: Game, att: number, def: number, venue: 'home' | 'away' | 'neutral'): number {
  const base = venue === 'home' ? 1.5 : venue === 'away' ? 1.15 : 1.3;
  const lambda = Math.min(5, Math.max(0.15, base * Math.exp((att - def) * 0.05)));
  return poisson(g, lambda);
}

function apply(row: Row, gf: number, ga: number): void {
  row.p++;
  row.gf += gf;
  row.ga += ga;
  const result = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  if (result === 'W') {
    row.w++;
    row.pts += 3;
  } else if (result === 'D') {
    row.d++;
    row.pts += 1;
  } else {
    row.l++;
  }
  row.form.push(result);
  if (row.form.length > 5) row.form.shift();
}

const PALETTE: [string, string][] = [
  ['#1f5fa8', '#ffffff'], ['#c62828', '#ffffff'], ['#1b7a46', '#f2c200'], ['#f08a1c', '#1a1a1a'], ['#5b2a86', '#f2c200'],
  ['#0f8f8f', '#12325c'], ['#1a1a1a', '#e0b400'], ['#8a1c3a', '#9fd3ea'], ['#2c3e75', '#e23b3b'], ['#3d7d1f', '#ffffff'],
  ['#c7a03a', '#1c2d6e'], ['#e04b8a', '#1a1a1a'],
];

function hash(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export function createClubs(g: Game): void {
  for (const league of CLUB_LEAGUES) {
    const meta = LEAGUES[league];
    const seeds = CLUB_SEEDS[league];
    const ranked = [...seeds].sort((a, b) => b.edge - a.edge);
    g.leagues[league] = seeds.map((seed) => {
      const h = hash(seed.name);
      const club: Club = {
        id: g.clubs.length, name: seed.name, league,
        att: meta.level + seed.edge + spread(g, -1.5, 1.5), def: meta.level + seed.edge + spread(g, -1.5, 1.5),
        style: pick(g, STYLE_IDS), wealth: Math.max(-5, Math.min(5, Math.round(seed.edge * 0.7 + spread(g, -1, 1)))),
        lastPos: ranked.indexOf(seed) + 1, colors: seed.colors ?? (PALETTE[h % PALETTE.length] as [string, string]),
        pattern: seed.pattern ?? (seed.colors ? 0 : (h >>> 8) % 6), conti: false, nation: false, asia: false,
      };
      // 지난 시즌 상위 팀은 첫 시즌부터 대륙 대회에 나간다.
      club.conti = club.lastPos <= meta.conti;
      g.clubs.push(club);
      return club.id;
    });
  }
  g.leagues.intl = [];
  for (const nation of NATIONS) {
    const h = hash(nation.name);
    g.clubs.push({
      id: g.clubs.length, name: nation.name, league: 'intl', att: nation.level, def: nation.level,
      style: pick(g, STYLE_IDS), wealth: 0, lastPos: 0, colors: PALETTE[h % PALETTE.length] as [string, string], pattern: 0,
      conti: false, nation: true, asia: nation.asia,
    });
  }
}

/** 새 시즌의 순위표와 일정을 만든다. */
export function startLeagues(g: Game): void {
  for (const league of CLUB_LEAGUES) {
    g.tables[league] = g.leagues[league].map(emptyRow);
    g.fixtures[league] = roundRobin(shuffle(g, [...g.leagues[league]]), true);
  }
  g.round = 0;
}

/** 조별 리그 하나를 임시 리그(intl)에 차린다. */
export function startGroup(g: Game, clubs: number[], double: boolean): void {
  g.leagues.intl = clubs;
  g.tables.intl = clubs.map(emptyRow);
  g.fixtures.intl = roundRobin(clubs, double);
}

/**
 * 한 리그의 한 라운드를 치른다. mine은 감독이 맡은 팀 번호이고, side는 그 팀이 상대에 따라 내는 전력이다.
 * 감독 팀의 경기는 줄글로 돌려준다.
 */
export function playRound(
  g: Game, league: LeagueId, round: number, mine: number, side: (opp: Club, home: boolean) => Side, neutral = false,
): MatchLine | null {
  const fixtures = g.fixtures[league][round];
  if (!fixtures) return null;
  let line: MatchLine | null = null;
  for (const [h, a] of fixtures) {
    const home = g.clubs[h] as Club;
    const away = g.clubs[a] as Club;
    const hs = h === mine ? side(away, true) : { att: home.att, def: home.def };
    const as = a === mine ? side(home, false) : { att: away.att, def: away.def };
    const hg = goals(g, hs.att, as.def, neutral ? 'neutral' : 'home');
    const ag = goals(g, as.att, hs.def, neutral ? 'neutral' : 'away');
    apply(g.tables[league].find((r) => r.club === h) as Row, hg, ag);
    apply(g.tables[league].find((r) => r.club === a) as Row, ag, hg);
    if (h === mine || a === mine) {
      const isHome = h === mine;
      const gf = isHome ? hg : ag;
      const ga = isHome ? ag : hg;
      line = {
        label: `${round + 1}R`, opp: (isHome ? away : home).name, home: isHome, gf, ga,
        result: gf > ga ? 'W' : gf === ga ? 'D' : 'L',
      };
    }
  }
  return line;
}

/** 단판 승부. 비기면 승부차기로 가른다. penalty는 승부차기에서 이길 확률이다. */
export function playTie(g: Game, me: Side, opp: Side, penalty: number): { gf: number; ga: number; win: boolean; pens: boolean } {
  const gf = goals(g, me.att, opp.def, 'neutral');
  const ga = goals(g, opp.att, me.def, 'neutral');
  if (gf !== ga) return { gf, ga, win: gf > ga, pens: false };
  return { gf, ga, win: chance(g, penalty), pens: true };
}

/** 시즌이 끝난 뒤 구단들의 전력이 조금씩 변한다. 리그 수준과 재정 형편 쪽으로 끌려간다. */
export function evolveClubs(g: Game, skip: number): void {
  for (const league of CLUB_LEAGUES) {
    const meta = LEAGUES[league];
    for (const id of g.leagues[league]) {
      const club = g.clubs[id] as Club;
      if (chance(g, 0.12)) club.wealth = Math.max(-5, Math.min(5, club.wealth + int(g, -1, 1)));
      if (id === skip) continue;
      const target = meta.level + club.wealth * 1.2;
      club.att += (target - club.att) * 0.2 + spread(g, -2, 2);
      club.def += (target - club.def) * 0.2 + spread(g, -2, 2);
      if (chance(g, 0.1)) club.style = pick(g, STYLE_IDS);
    }
  }
}

export interface Move {
  club: number;
  from: ClubLeagueId;
  to: ClubLeagueId;
}

/** 한 리그에서 강등되는 팀 수. 아랫리그에서 올라오는 수와 같다. */
export function dropCount(league: ClubLeagueId): number {
  const down = LEAGUES[league].down;
  return down ? LEAGUES[down].promote : 0;
}

/** 승격과 강등: 위아래로 이어진 리그끼리 정해진 수만큼 자리를 바꾼다. */
export function applyMoves(g: Game): Move[] {
  const moves: Move[] = [];
  const order: Record<string, number[]> = {};
  for (const league of CLUB_LEAGUES) {
    order[league] = sortTable(g.tables[league]).map((r) => r.club);
    order[league]!.forEach((id, i) => {
      const club = g.clubs[id] as Club;
      club.lastPos = i + 1;
      club.conti = i < LEAGUES[league].conti;
    });
  }
  for (const league of CLUB_LEAGUES) {
    const meta = LEAGUES[league];
    if (!meta.up) continue;
    const lower = order[league] as number[];
    const upper = order[meta.up] as number[];
    for (const id of lower.slice(0, meta.promote)) moves.push({ club: id, from: league, to: meta.up });
    for (const id of upper.slice(-meta.promote)) moves.push({ club: id, from: meta.up, to: league });
  }
  for (const move of moves) {
    const club = g.clubs[move.club] as Club;
    const rising = LEAGUES[move.to].level > LEAGUES[move.from].level;
    g.leagues[move.from] = g.leagues[move.from].filter((id) => id !== move.club);
    g.leagues[move.to].push(move.club);
    club.league = move.to;
    club.att += rising ? 2 : -2;
    club.def += rising ? 2 : -2;
  }
  return moves;
}

/** 승격권(1), 강등권(-1), 그 밖(0). 순위표의 색띠와 시즌 결과 판정에 쓴다. */
export function zone(league: LeagueId, pos: number, size: number): 1 | 0 | -1 {
  if (league === 'intl') return pos <= 2 ? 1 : 0;
  const meta = LEAGUES[league];
  if (pos <= Math.max(meta.promote, meta.conti)) return 1;
  if (pos > size - dropCount(league)) return -1;
  return 0;
}
