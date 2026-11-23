// 감독 커리어의 진행. 화면은 game.scene에 담긴 글과 선택지를 그리기만 하고,
// 선택지를 누르면 act()가 다음 장면을 만든다. 한 시즌은 다음 순서로 흐른다:
// 전술 → 훈련 → 여름 시장 → 전반기 → 사건 → 겨울 시장 → 후반기 운영 → 결산 → 성장 → 제안
import { ko } from './josa.ts';
import {
  ATTRS, ATTR_IDS, BACKGROUNDS, CLUB_LEAGUES, CLUB_SEEDS, FOCUSES, FOCUS_IDS, LEAGUES, NATION_REP, PLANS, PLAN_IDS, POS_NAME,
  RETIRE_AGE, START_AGE, START_YEAR, STYLES, STYLE_IDS, TRAITS, won,
} from './data.ts';
import { eventById, pickEvent } from './events.ts';
import { COUNTRIES, CONTI_NAME, CONTI_WEIGHT, countryOf, leaguesOf } from './countries.ts';
import { autoLineup } from './manage.ts';
import { actHiring, enroll, finishCourses, hiringScene, licenseName, openHiring, requiredLicense, startingLicense, courseStatus } from './hiring.ts';
import type { Vacancy } from './types.ts';
import { chance, int, pick, shuffle, spread } from './rng.ts';
import {
  departures, develop, generateSquad, linesOf, makePlayer, myClub, ratings, shareGoals,
} from './squad.ts';
import { ensureDetail, guessNat } from './player.ts';
import { assignNumber, checkPromises, depthOf, enforceQuota, existingContract, expireContracts, relegationCut, settle, totalWages, wageBudgetFor } from './contract.ts';
import { actWindow, openWindow, returnLoans, windowScene } from './transfer.ts';
import { legacyTitle, reactions } from './talk.ts';
import type { Mood } from './talk.ts';
import { actMatch, beginMatch } from './match.ts';
import { autoSide } from './power.ts';
import type { Side } from './power.ts';
import { NEUTRAL, usualShape } from './tactics.ts';
import {
  addLeagues, applyMoves, applyResult, createClubs, dropCount, evolveClubs, playRound, playTie, positionOf, sortTable, startGroup, startLeagues, zone,
} from './world.ts';
import type {
  AttrId, BackgroundId, Block, Choice, Club, ClubLeagueId, FocusId, Game, Knockout, LeagueId, MatchLine, MatchState, NationYear,
  PlanId, Player, Pos, Rivalry, Row, SeasonState, ShapeId, StyleId, Tone,
} from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

// 대륙 대회에서 만나는 상대 가운데 게임 세계에 없는 리그의 구단. 이름만 빌려 쓰고 전력은 라운드에 따라 정한다.
// 게임에 있는 리그(한국·일본 1부, 유럽 5대 리그 1부)의 구단은 실제 전력으로 나온다.
const ASIA_CLUBS = ['알힐랄', '알나스르', '알아흘리', '알사드', '조호르 다룰 탁짐', '부리람 유나이티드', '상하이 하이강', '멜버른 시티'];
const EURO_CLUBS = ['벤피카', '포르투', '스포르팅', '아약스', 'PSV', '페예노르트', '셀틱', '갈라타사라이', '클루브 브뤼허'];

function blankSeason(): SeasonState {
  return {
    half: 1, rival: -1, pending: null, halfStart: 0, style: 'possess', focus: 'attack', plan: 'steady', lines: [], cup: null, conti: null, nationYear: null, finals: null,
    groupPassed: false, half1Pos: 0, notes: [], attMod: 0, defMod: 0, depthMod: 0, liveGoals: 0,
  };
}

export const SAVE_VERSION = 12;

/**
 * 새 커리어. 감독은 출신에 따라 자격증을 가지고(없을 수도 있다) 구직부터 시작한다.
 * start는 시험과 시뮬레이션용 지름길이다: 그 리그에 맞는 자격과 명성을 주고 그 리그 구단이 먼저 연락하게 한다.
 */
export function createGame(seed: number, name: string, background: BackgroundId, start?: ClubLeagueId): Game {
  const attrs: Record<AttrId, number> = { tactics: 6, lead: 6, youth: 6, deal: 6, eye: 6 };
  for (const [key, value] of Object.entries(BACKGROUNDS[background].bonus)) attrs[key as AttrId] += value as number;
  const lic = startingLicense(background, START_YEAR);
  const rep = start ? LEAGUES[start]!.rep + 2 : 2;
  const g: Game = {
    rng: seed | 0, version: SAVE_VERSION, year: START_YEAR, nextId: 1,
    manager: {
      name: name.trim() || '김감독', age: START_AGE, background, attrs, rep, peakRep: rep,
      license: start ? Math.max(lic.license, LEAGUES[start]!.license) : lic.license, licensed: lic.licensed, course: null, idle: 0, countries: [],
    },
    clubs: [], leagues: { intl: [] }, tables: { intl: [] }, fixtures: { intl: [] },
    round: 0, job: null, squad: [], reserves: [], loaned: [], depth: 0, morale: 60, cohesion: 25, season: blankSeason(), match: null, lastStyle: null,
    phase: 'career', scene: { eyebrow: '', title: '', blocks: [], choices: [] }, eventId: null, offers: [], hiring: null, window: null,
    wcTicket: false, sacked: false, points: 0, history: [], trophies: [], promotions: 0,
  };
  for (const id of CLUB_LEAGUES) {
    g.leagues[id] = [];
    g.tables[id] = [];
    g.fixtures[id] = [];
  }
  createClubs(g);
  startLeagues(g);
  enterCareer(g, start);
  return g;
}

// ---------- 토너먼트 ----------

function newKnockout(name: string, rounds: string[]): Knockout {
  return { name, rounds, next: 0, alive: true, won: false, lines: [] };
}

interface Rival {
  id: number;
  name: string;
  side: Side;
  style: StyleId | null;
  shape: ShapeId;
}

/** 토너먼트의 결과 한 줄을 적고 다음 라운드로 넘긴다. */
function settleKnockout(ko: Knockout, opp: string, gf: number, ga: number, win: boolean, pens: boolean, note?: string): void {
  ko.lines.push({
    label: ko.rounds[ko.next] as string, opp, home: true, gf, ga, result: win ? 'W' : 'L',
    note: [pens ? (win ? '승부차기 승' : '승부차기 패') : '', note ?? ''].filter(Boolean).join(' · ') || undefined,
  });
  if (!win) {
    ko.alive = false;
  } else if (++ko.next >= ko.rounds.length) {
    ko.alive = false;
    ko.won = true;
  }
}

/** 토너먼트 한 라운드를 자동으로 치른다. */
function autoKnockout(g: Game, ko: Knockout, opp: Rival): void {
  const nerve = g.squad.filter((p) => p.trait === 'clutch').length;
  const tie = playTie(g, autoSide(g, opp.side, opp.style, g.season.half, true), opp.side, clamp(0.5 + (g.manager.attrs.lead - 8) * 0.012 + nerve * 0.03, 0.3, 0.75));
  settleKnockout(ko, opp.name, tie.gf, tie.ga, tie.win, tie.pens);
}

function cupOpponent(g: Game, round: number): Rival {
  const me = myClub(g);
  const pool = leaguesOf(countryOf(me.league)).flatMap((l) => g.leagues[l] ?? []).filter((id) => id !== me.id)
    .map((id) => g.clubs[id] as Club).sort((a, b) => b.att + b.def - (a.att + a.def));
  // 라운드가 올라갈수록 강한 팀만 남는다.
  const keep = [1, 0.7, 0.5, 0.3, 0.15][round] ?? 0.15;
  const club = pool[int(g, 0, Math.max(0, Math.floor(pool.length * keep) - 1))] as Club;
  return { id: club.id, name: `${club.name} (${LEAGUES[club.league]!.short})`, side: { att: club.att, def: club.def }, style: club.style, shape: club.shape };
}

/** 대륙 대회 상대: 같은 대륙에서 게임에 있는 다른 나라 1부 구단(실제 전력) 또는 게임 밖 리그의 구단(라운드에 따른 전력). */
function contiOpponent(g: Game, round: number): Rival {
  const me = myClub(g);
  const confed = COUNTRIES[countryOf(me.league)].confed;
  const euro = confed === 'uefa';
  const tops = Object.keys(LEAGUES).filter((id) => LEAGUES[id]!.tier === 1 && COUNTRIES[LEAGUES[id]!.country].confed === confed && id !== me.league);
  const real = tops.flatMap((l) => g.leagues[l] ?? []).map((id) => g.clubs[id] as Club).sort((a, b) => b.att + b.def - (a.att + a.def));
  if (real.length > 0 && chance(g, euro ? 0.75 : 0.5)) {
    const keep = [0.5, 0.3, 0.2, 0.1][round] ?? 0.1;
    const club = real[int(g, 0, Math.max(0, Math.floor(real.length * keep) - 1))] as Club;
    return { id: club.id, name: `${club.name} (${COUNTRIES[LEAGUES[club.league]!.country].name})`, side: { att: club.att, def: club.def }, style: club.style, shape: club.shape };
  }
  const level = (euro ? 80 : 68) + round * (euro ? 2.5 : 3) + spread(g, -3, 3);
  const style = pick(g, STYLE_IDS);
  return { id: -1, name: pick(g, euro ? EURO_CLUBS : ASIA_CLUBS), side: { att: level, def: level }, style, shape: usualShape(style, int(g, 0, 5)) };
}

function nationOpponent(g: Game, round: number): Rival {
  const asia = g.season.nationYear === 'asia';
  const pool = g.clubs.filter((c) => c.nation && c.id !== g.job!.club && (asia ? c.asia : true))
    .sort((a, b) => b.att - a.att);
  const keep = asia ? [0.6, 0.35, 0.2][round] ?? 0.2 : [0.75, 0.45, 0.25, 0.12][round] ?? 0.12;
  const club = pool[int(g, 0, Math.max(0, Math.floor(pool.length * keep) - 1))] as Club;
  return { id: club.id, name: club.name, side: { att: club.att, def: club.def }, style: club.style, shape: club.shape };
}

// ---------- 시즌 시작 ----------

function nationKind(g: Game): NationYear {
  const y = g.year % 4;
  return y === 3 ? 'asia' : y === 0 ? 'q2' : y === 1 ? 'q3' : g.wcTicket ? 'wc' : 'friendly';
}

const NATION_LABEL: Record<NationYear, { name: string; goal: string }> = {
  asia: { name: '아시안컵', goal: '4강 진출' },
  q2: { name: '월드컵 2차 예선', goal: '조 2위 이내로 통과' },
  q3: { name: '월드컵 최종 예선', goal: '조 2위 이내로 본선 진출' },
  wc: { name: '월드컵 본선', goal: '16강 진출' },
  friendly: { name: '평가전의 해', goal: '본선에 못 나갔다. 다음을 준비한다' },
};

function setupNation(g: Game): void {
  const me = g.job!.club;
  const kind = nationKind(g);
  const others = g.clubs.filter((c) => c.nation && c.id !== me);
  const from = (list: Club[], n: number): number[] => shuffle(g, [...list]).slice(0, n).map((c) => c.id);
  let group: number[];
  if (kind === 'asia') group = from(others.filter((c) => c.asia), 3);
  else if (kind === 'q2') group = from(others.filter((c) => c.asia && c.att < 69), 3);
  else if (kind === 'q3') group = from(others.filter((c) => c.asia && c.att >= 66), 5);
  else if (kind === 'wc') group = [...from(others.filter((c) => !c.asia && c.att >= 84), 1), ...from(others.filter((c) => !c.asia && c.att < 84), 2)];
  else group = from(others, 3);
  startGroup(g, shuffle(g, [me, ...group]), kind === 'q2' || kind === 'q3');
  // 조에서 가장 강한 상대와의 경기는 직접 지휘한다.
  g.season.rival = [...group].sort((a, b) => (g.clubs[b] as Club).att - (g.clubs[a] as Club).att)[0] as number;
  g.season.nationYear = kind;
  if (kind === 'asia') g.season.finals = newKnockout('아시안컵', ['8강', '4강', '결승']);
  if (kind === 'wc') g.season.finals = newKnockout('월드컵', ['16강', '8강', '4강', '결승']);
}

/** 새 시즌을 차린다: 목표, 라이벌, 예산, 토너먼트. 시험에서도 부른다. */
export function beginSeason(g: Game): void {
  const job = g.job!;
  const club = myClub(g);
  g.season = blankSeason();
  if (club.nation) {
    setupNation(g);
    job.objective = 0;
  } else {
    const meta = LEAGUES[club.league]!;
    const r = ratings(g, depthOf(g));
    club.att = r.att;
    club.def = r.def;
    const ids = g.leagues[club.league];
    const power = (id: number): number => (g.clubs[id] as Club).att + (g.clubs[id] as Club).def;
    const rank = 1 + ids.filter((id) => id !== club.id && power(id) > power(club.id)).length;
    job.objective = clamp(rank - (club.wealth >= 3 ? 1 : 0) + (job.seasons === 0 ? job.promise ?? 0 : 0), 1, ids.length - Math.max(1, dropCount(club.league as ClubLeagueId)));
    // 전력이 가장 비슷한 팀이 라이벌이다. 그 팀과의 두 경기는 직접 지휘한다.
    // 지난 라이벌이 같은 리그에서 여전히 전력이 가장 가까운 3팀 안에 있으면 그대로 두고 전적을 이어 간다.
    const near = ids.filter((id) => id !== club.id).sort((a, b) => Math.abs(power(a) - power(club.id)) - Math.abs(power(b) - power(club.id)));
    const old = job.rivalry;
    const keep = !!old && !!g.clubs[old.club] && (g.clubs[old.club] as Club).league === club.league && near.slice(0, 3).includes(old.club);
    if (keep) {
      g.season.rival = old!.club;
    } else {
      g.season.rival = near[0] as number;
      job.rivalry = { club: g.season.rival, w: 0, d: 0, l: 0, last: null };
      g.season.notes.push(`새 라이벌: ${(g.clubs[g.season.rival] as Club).name}`);
    }
    job.budget = round1(job.budget + meta.money * (1 + club.wealth * 0.12));
    // 분할 지급으로 남은 이적료 중 올해 몫을 낸다.
    const due = job.debts.filter((d) => d.due <= g.year);
    if (due.length) {
      const sum = round1(due.reduce((s, d) => s + d.amount, 0));
      job.budget = round1(job.budget - sum);
      job.debts = job.debts.filter((d) => d.due > g.year);
      g.season.notes.push(`분할 지급 이적료 ${won(sum)}을 냈다.`);
    }
    // 외국인 선발 한도를 넘으면(승격 등) 맞춘다.
    for (const line of enforceQuota(g)) g.season.notes.push(line);
    // 연봉 예산. 이미 맺은 계약을 감당할 만큼은 늘 준다.
    settle(g);
    job.wageBudget = round1(Math.max(wageBudgetFor(g), totalWages(g) * 1.15));
    const country = COUNTRIES[meta.country];
    g.season.cup = newKnockout(country.cup, ['32강', '16강', '8강', '4강', '결승']);
    if (club.conti) g.season.conti = newKnockout(CONTI_NAME[country.confed], ['16강', '8강', '4강', '결승']);
  }
  enterStyle(g);
}

// ---------- 장면 만들기 ----------

function squadBlock(g: Game): Block {
  return {
    kind: 'players',
    items: g.squad.map((p) => ({
      player: p,
      note: [p.trait ? TRAITS[p.trait].name : '', p.age <= 23 && g.manager.attrs.eye >= 8 && p.pot - p.ovr >= 5 ? '유망주' : ''].filter(Boolean).join(' · ') || undefined,
    })),
  };
}

function statusRows(g: Game): { label: string; value: string; tone?: Tone }[] {
  const job = g.job!;
  const club = myClub(g);
  const rows: { label: string; value: string; tone?: Tone }[] = [];
  if (!club.nation) rows.push({ label: '예산', value: won(job.budget) });
  rows.push({ label: club.nation ? '협회 신뢰' : '이사회 신뢰', value: `${Math.round(job.confidence)}`, tone: job.confidence < 30 ? 'bad' : job.confidence >= 65 ? 'good' : 'plain' });
  rows.push({ label: '라커룸 분위기', value: `${Math.round(g.morale)}` });
  rows.push({ label: '전술 완성도', value: `${Math.round(g.cohesion)}` });
  return rows;
}

function seasonLabel(g: Game): string {
  const club = myClub(g);
  return `${g.year} · ${club.name} · ${club.nation ? NATION_LABEL[g.season.nationYear as NationYear].name : LEAGUES[club.league as ClubLeagueId].name}`;
}

function enterStyle(g: Game): void {
  const job = g.job!;
  const club = myClub(g);
  g.phase = 'style';
  const blocks: Block[] = [];
  if (club.nation) {
    const label = NATION_LABEL[g.season.nationYear as NationYear];
    blocks.push({ kind: 'text', text: `${g.year}년, ${club.name} 대표팀의 일정은 ${label.name}. 협회의 요구는 "${label.goal}"이다.` });
  } else {
    const meta = LEAGUES[club.league as ClubLeagueId];
    blocks.push({ kind: 'text', text: ko`${g.year} 시즌. ${club.name}은 ${meta.name}(${meta.short})에서 뛴다. ${meta.blurb}. 구단의 요구는 ${job.objective}위 이내.${g.season.conti ? ` 올해는 ${g.season.conti.name}에도 나간다.` : ''}` });
  }
  blocks.push({ kind: 'stats', rows: statusRows(g) }, squadBlock(g));
  g.scene = {
    eyebrow: seasonLabel(g), title: '어떤 축구를 할까요?', blocks,
    choices: STYLE_IDS.map((id): Choice => ({
      id, label: STYLES[id].name,
      detail: `${STYLES[id].desc}${g.lastStyle === id ? ' · 지난 시즌과 같음, 전술 완성도 +10' : g.lastStyle ? ' · 바꾸면 전술 완성도가 크게 깎임' : ''}`,
      tone: g.lastStyle === id ? 'primary' : undefined,
    })),
  };
}

function enterFocus(g: Game): void {
  g.phase = 'focus';
  g.scene = {
    eyebrow: seasonLabel(g), title: '훈련의 중심을 어디에 둘까요?',
    blocks: [{ kind: 'text', text: `전술은 ${STYLES[g.season.style].name}. 프리시즌 훈련 계획을 짤 차례다.` }],
    choices: FOCUS_IDS.map((id): Choice => ({ id, label: FOCUSES[id].name, detail: FOCUSES[id].desc })),
  };
}

function enterMarket(g: Game, window: 'summer' | 'winter'): void {
  g.phase = window === 'summer' ? 'market' : 'winter';
  openWindow(g, window);
  windowScene(g, seasonLabel(g));
}

/** 이전 버전의 저장을 지금 버전에 맞춘다. 맞출 수 없으면 false. */
export function migrate(g: Game): boolean {
  if (g.version < 3 || g.version > SAVE_VERSION) return false;
  let reopen = false;
  for (const p of g.squad) ensureDetail(p);
  if (g.version === 3) {
    g.version = 4;
    delete (g as unknown as { market?: unknown }).market;
    g.window = null;
    const L = g.match?.live;
    if (L) {
      L.calls = [];
      for (const team of L.teams) for (const p of team.players) Object.assign(p, { spot: p.spot ?? 'CM', foot: p.foot ?? 'R', dev: p.dev ?? [0, 0, 0, 0, 0, 0] });
    }
  }
  if (g.version === 4) {
    // 계약 개편: 기존 선수들에게 계약과 등번호를 주고, 후보 명단과 연봉 예산을 만든다.
    g.version = 5;
    g.reserves = [];
    g.window = null;
    for (const p of g.squad) Object.assign(p, { no: 0, contract: null, unhappy: false });
    if (g.job) {
      g.job.wageBudget = 0;
      if (!myClub(g).nation) {
        for (const p of g.squad) p.contract = existingContract(g, p, true, 1 + (p.id % 3));
        g.job.wageBudget = round1(Math.max(wageBudgetFor(g), totalWages(g) * 1.08));
      }
      for (const p of g.squad) assignNumber(g, p);
    }
    // 이적 시장 한가운데서 저장했다면 새 시장으로 다시 연다.
    reopen = true;
  }
  if (g.version === 5) {
    // 국적, 임대, 분할 지급이 생겼다.
    g.version = 6;
    g.loaned = [];
    const region = g.job && !myClub(g).nation && myClub(g).league.startsWith('eu') ? 'eu' : 'kr';
    for (const p of [...g.squad, ...g.reserves]) Object.assign(p, { nat: p.nat ?? guessNat(p, region), loan: p.loan ?? null });
    if (g.job) g.job.debts = g.job.debts ?? [];
    reopen = true;
  }
  if (g.version === 6) {
    // 잉글랜드 워크퍼밋과 홈그로운이 생겼다. 잉글랜드 국적 선수를 홈그로운으로 본다.
    g.version = 7;
    for (const p of [...g.squad, ...g.reserves, ...g.loaned]) Object.assign(p, { hg: p.hg ?? p.nat === '잉글랜드', esc: p.esc ?? false });
    reopen = true;
  }
  if (g.version === 7) {
    migrateWorld(g);
    reopen = true;
  }
  if (g.version === 8) {
    // 선발이 일곱 명에서 열한 명이 됐다. 대형을 정하고, 후보에서 빈자리를 채우고(모자라면 새 선수), 가장 강한 배치로 세운다.
    g.version = 9;
    if (g.job) migrateEleven(g);
    reopen = true;
  }
  if (g.version === 9) {
    // 라이벌 상대 전적이 생겼다. 진행 중인 시즌의 라이벌(g.season.rival)은 그대로 두고, 전적은 다음 시즌 라이벌부터 센다.
    g.version = 10;
    if (g.job) g.job.rivalry = null;
  }
  if (g.version === 10) {
    // 전술 개편: 압박, 패스, 공격 방향 지시가 생겼다. 진행 중인 경기의 지시에 보통 값을 채운다.
    g.version = 11;
    if (g.match) g.match.dials = { ...NEUTRAL, ...g.match.dials };
  }
  if (g.version === 11) {
    // 리그 출전 수와 실시간 경기 득점 집계가 생겼다. 시즌 도중이면 출전은 0부터 세고, 이미 치른 경기의 골은 결산 분배에 맡긴다.
    g.version = 12;
    for (const p of [...g.squad, ...g.reserves, ...g.loaned, ...(g.window?.list.map((d) => d.player) ?? [])]) p.apps = p.apps ?? 0;
    g.season.liveGoals = g.season.liveGoals ?? 0;
  }
  // 구단 유니폼 색이 새로 생기거나 바뀌었으면 저장된 구단에도 입힌다.
  const seeds = new Map(CLUB_LEAGUES.flatMap((l) => CLUB_SEEDS[l] ?? []).filter((x) => x.colors).map((x) => [x.name, x]));
  for (const c of g.clubs) {
    const seed = seeds.get(c.name);
    if (seed?.colors) {
      c.colors = seed.colors;
      c.pattern = seed.pattern ?? 0;
    }
  }
  // 이적 시장 한가운데서 저장했다면, 모든 변환을 마친 뒤 새 시장으로 다시 연다.
  if (reopen && (g.phase === 'market' || g.phase === 'winter')) enterMarket(g, g.phase === 'market' ? 'summer' : 'winter');
  return true;
}

/**
 * 버전 7 → 8: 세계 리그와 감독 자격.
 * 잉글랜드 1·2부(eu1, eu2)는 eng1, eng2가 되고, 새 나라와 리그의 구단이 생긴다. 지금 맡은 리그에 필요한 자격은 가진 것으로 본다.
 * 시즌 도중이면 새 리그들은 다음 절반부터 경기를 치른다.
 */
function migrateWorld(g: Game): void {
  g.version = 8;
  const rename: Record<string, string> = { eu1: 'eng1', eu2: 'eng2' };
  for (const [from, to] of Object.entries(rename)) {
    for (const key of ['leagues', 'tables', 'fixtures'] as const) {
      const rec = g[key] as Record<string, unknown>;
      if (rec[from] !== undefined) {
        rec[to] = rec[from];
        delete rec[from];
      }
    }
  }
  for (const c of g.clubs) if (rename[c.league]) c.league = rename[c.league] as string;
  for (const h of g.history) h.league = h.league.replace('잉글랜드 1부', '프리미어리그').replace('잉글랜드 2부', '챔피언십');
  if (g.season.pending && rename[g.season.pending.league]) g.season.pending.league = rename[g.season.pending.league] as string;
  if (g.match?.league && rename[g.match.league]) g.match.league = rename[g.match.league] as string;
  // 새 리그의 구단을 만들고 일정을 짠다.
  const missing = CLUB_LEAGUES.filter((id) => !g.leagues[id]);
  addLeagues(g, missing);
  const job = g.job ? (g.clubs[g.job.club] as Club) : null;
  const need = job ? requiredLicense(job) : 0;
  const lic = startingLicense(g.manager.background, START_YEAR);
  const level = Math.max(lic.license, need);
  const licensed = [0, 0, 0, 0, 0].map((_, i) => (i > 0 && i <= level ? Math.min(g.year - 1, START_YEAR - 1) : 0));
  Object.assign(g.manager, { license: level, licensed, course: null, idle: 0, countries: job && !job.nation ? [countryOf(job.league)] : [] });
  g.hiring = null;
  if (g.phase === 'offers') enterCareer(g);
}

/** 버전 8 → 9: 선발 열한 명. */
function migrateEleven(g: Game): void {
  const club = myClub(g);
  g.formation = usualShape(g.lastStyle ?? club.style, club.id);
  const need = linesOf(g).length;
  const pool = [...g.squad, ...g.reserves].filter((p) => !p.loan || p.loan.dir === 'in');
  const where = club.nation ? 'kr1' : club.league;
  // 모자란 줄부터 채운다: 대형에서 필요한 줄 수와 지금 있는 선수의 줄 수를 견준다.
  const lines = linesOf(g);
  while (pool.length < need + 3) {
    const short = (['GK', 'DF', 'MF', 'FW'] as Pos[]).find((pos) => pool.filter((p) => p.pos === pos).length < lines.filter((l) => l === pos).length + (pos === 'GK' ? 1 : 0)) ?? 'MF';
    const p = makePlayer(g, short, g.depth + spread(g, -1, 2), int(g, 20, 29), where, club.nation);
    if (!club.nation) p.contract = existingContract(g, p, false, int(g, 1, 3));
    assignNumber(g, p);
    pool.push(p);
    g.reserves.push(p);
  }
  g.squad = pool.slice(0, need);
  g.reserves = pool.slice(need);
  autoLineup(g);
}

function recordOf(lines: MatchLine[]): { w: number; d: number; l: number; text: string } {
  const w = lines.filter((l) => l.result === 'W').length;
  const d = lines.filter((l) => l.result === 'D').length;
  const l = lines.filter((x) => x.result === 'L').length;
  return { w, d, l, text: `${w}승 ${d}무 ${l}패` };
}

/** "3승 1무 2패"처럼 쓰되 0인 항목은 뺀다. 모두 0이면 "경기 없음". */
function tallyText(w: number, d: number, l: number): string {
  return [w ? `${w}승` : '', d ? `${d}무` : '', l ? `${l}패` : ''].filter(Boolean).join(' ') || '경기 없음';
}

/** 라이벌전 직전 화면의 한 줄: "통산 3승 1무 2패 · 지난 맞대결 1:2 패", 처음이면 "첫 맞대결". */
function rivalryLine(r: Rivalry): string {
  if (r.w + r.d + r.l === 0 || !r.last) return '첫 맞대결';
  const [gf, ga] = r.last;
  return `통산 ${tallyText(r.w, r.d, r.l)} · 지난 맞대결 ${gf}:${ga} ${gf > ga ? '승' : gf === ga ? '무' : '패'}`;
}

/** 올 시즌 라이벌과 치른 리그 경기. playRound가 라이벌전을 건너뛰므로 여기 있는 것은 모두 settleMatch가 적은 경기다. */
function rivalLinesThisSeason(g: Game): MatchLine[] {
  const rival = g.clubs[g.season.rival];
  return rival ? g.season.lines.filter((l) => l.opp === rival.name) : [];
}

/** 시즌 결산의 라이벌전 보너스: 한 경기 이상 치러 모두 이겼으면 신뢰 +2. 경기 수는 정해 두지 않는다. */
export function rivalSweepBonus(lines: MatchLine[]): number {
  return lines.length > 0 && lines.every((l) => l.result === 'W') ? 2 : 0;
}

/**
 * 전반기 또는 후반기를 시작한다. 리그 경기를 자동으로 돌리되, 라이벌전 한 경기는 빼 두었다가
 * 감독이 직접 지휘한다. 이어서 토너먼트를 치르고, 다 끝나면 결산으로 넘어간다.
 */
function startHalf(g: Game, half: 1 | 2): void {
  const club = myClub(g);
  const s = g.season;
  s.half = half;
  s.halfStart = s.lines.length;
  s.pending = null;
  const range = (total: number): [number, number] => {
    const split = total <= 3 ? total : Math.ceil(total / 2);
    return half === 1 ? [0, split] : [split, total];
  };
  const mine = (league: LeagueId, r: number): [number, number] | undefined =>
    g.fixtures[league][r]!.find(([h, a]) => (h === club.id && a === s.rival) || (a === club.id && h === s.rival));
  // 리그마다 팀 수가 달라 라운드 수도 다르다. 각 리그의 일정을 절반씩 치른다.
  for (const league of CLUB_LEAGUES) {
    const [from, to] = range(g.fixtures[league].length);
    for (let r = from; r < to; r++) {
      const fixture = club.nation ? undefined : mine(league, r);
      if (fixture) s.pending = { league, round: r, home: fixture[0] === club.id, opp: s.rival };
      const line = playRound(g, league, r, club.nation ? -1 : club.id, (opp) => autoSide(g, opp, opp.style, half, false), false, s.rival);
      if (line) {
        s.lines.push(line);
        // 자동으로 치른 우리 리그 경기: 지금 선발 열한 명이 출전한 것으로 센다. 골은 결산에서 나눈다.
        for (const p of g.squad) p.apps++;
      }
    }
  }
  if (club.nation) {
    const kind = s.nationYear as NationYear;
    const neutral = kind !== 'q2' && kind !== 'q3';
    const [from, to] = range(g.fixtures.intl.length);
    for (let r = from; r < to; r++) {
      const fixture = mine('intl', r);
      if (fixture) s.pending = { league: 'intl', round: r, home: fixture[0] === club.id, opp: s.rival };
      const line = playRound(g, 'intl', r, club.id, (opp) => autoSide(g, opp, opp.style, half, false), neutral, s.rival);
      if (line) s.lines.push({ ...line, label: neutral ? `조별 ${r + 1}차전` : `${r + 1}차전` });
    }
  }
  g.round = half;
  advance(g);
}

interface Bracket {
  ko: Knockout;
  kind: 'cup' | 'conti' | 'finals';
  until: number;
  opponent: (round: number) => Rival;
}

/** 이번 절반에 치를 토너먼트와, 각각 몇 라운드까지 가는지. */
function knockoutsNow(g: Game): Bracket[] {
  const s = g.season;
  const list: Bracket[] = [];
  if (s.cup) list.push({ ko: s.cup, kind: 'cup', until: s.half === 1 ? 3 : 5, opponent: (r) => cupOpponent(g, r) });
  if (s.conti) list.push({ ko: s.conti, kind: 'conti', until: s.half === 1 ? 2 : 4, opponent: (r) => contiOpponent(g, r) });
  if (s.finals && s.half === 2) list.push({ ko: s.finals, kind: 'finals', until: s.finals.rounds.length, opponent: (r) => nationOpponent(g, r) });
  return list;
}

/** 감독이 직접 지휘하는 토너먼트 경기: 컵 결승, 대륙 대회 4강부터, 대표팀 토너먼트 전부. */
function handsOn(kind: 'cup' | 'conti' | 'finals', ko: Knockout): boolean {
  if (kind === 'finals') return true;
  return ko.next >= ko.rounds.length - (kind === 'conti' ? 2 : 1);
}

/** 남은 일을 순서대로 처리한다. 직접 지휘할 경기를 만나면 거기서 멈춘다. */
function advance(g: Game): void {
  const s = g.season;
  const club = myClub(g);
  if (s.pending) {
    const p = s.pending;
    s.pending = null;
    const opp = g.clubs[p.opp] as Club;
    const neutral = club.nation && s.nationYear !== 'q2' && s.nationYear !== 'q3';
    const rivalry = club.nation ? null : g.job!.rivalry;
    beginMatch(g, {
      kind: 'league', ko: null, league: p.league, round: p.round,
      label: club.nation ? `${seasonLabel(g)} · ${p.round + 1}차전` : `${seasonLabel(g)} · ${p.round + 1}R 라이벌전`,
      opp: { id: opp.id, name: opp.name, att: opp.att, def: opp.def, style: opp.style, shape: opp.shape },
      venue: neutral ? 'neutral' : p.home ? 'home' : 'away',
      ...(rivalry && rivalry.club === opp.id ? { intro: rivalryLine(rivalry) } : {}),
    });
    return;
  }
  if (club.nation && s.half === 1 && g.fixtures.intl.length <= 3) s.groupPassed = positionOf(g, 'intl', club.id) <= 2;
  if (s.finals && s.half === 2 && !s.groupPassed) s.finals.alive = false;
  for (const { ko, kind, until, opponent } of knockoutsNow(g)) {
    while (ko.alive && ko.next < until) {
      const opp = opponent(ko.next);
      if (handsOn(kind, ko)) {
        beginMatch(g, {
          kind: 'knockout', ko: kind, league: null, round: ko.next, label: `${ko.name} ${ko.rounds[ko.next]}`,
          opp: { id: opp.id, name: opp.name, att: opp.side.att, def: opp.side.def, style: opp.style ?? 'possess', shape: opp.shape },
          venue: 'neutral',
        });
        return;
      }
      autoKnockout(g, ko, opp);
    }
  }
  // 결과에 따라 사기가 움직이고, 같은 전술로 뛴 만큼 숙련도가 쌓인다.
  const rec = recordOf(s.lines.slice(s.halfStart));
  const leaders = g.squad.filter((p) => p.trait === 'leader').length;
  const swing = (rec.w - rec.l) * 2.2;
  g.morale = clamp(g.morale + (swing < 0 ? swing * (1 - leaders * 0.2) : swing) + (g.manager.attrs.lead - 8) * 0.4, 5, 100);
  g.cohesion = clamp(g.cohesion + 8 + g.manager.attrs.tactics / 2, 0, 100);
  if (s.half === 1) enterHalf1(g);
  else if (club.nation) finishNationYear(g);
  else finishClubSeason(g, false);
}

/**
 * 직접 지휘한 클럽 리그 경기의 출전과 골을 선수 기록에 더한다.
 * 실시간 경기면 경기장에 선 선수(교체로 나간 선수 포함)마다 출전 1과 그 경기 골을 준다. 2군처럼 등록 명단에 없는 선수의 골은 아무에게도 가지 않지만 liveGoals에는 들어간다.
 * 실시간이 아니면 득점자를 모르므로 선발 열한 명에게 출전만 주고 골은 결산 분배에 맡긴다.
 */
function countLeagueMatch(g: Game, m: MatchState): void {
  const L = m.live;
  if (!L) {
    for (const p of g.squad) p.apps++;
    return;
  }
  const byPid = new Map<number, number>();
  let total = 0;
  const add = (pid: number, goals: number): void => {
    byPid.set(pid, (byPid.get(pid) ?? 0) + goals);
    total += goals;
  };
  for (const lp of L.teams[0].players) add(lp.pid ?? -1, lp.rec?.goals ?? 0);
  for (const x of L.gone ?? []) add(x.pid, x.goals);
  for (const p of [...g.squad, ...g.reserves]) {
    const goals = byPid.get(p.id);
    if (goals === undefined) continue;
    p.apps++;
    p.goals += goals;
  }
  g.season.liveGoals += Math.min(total, m.score[0]);
}

/** 직접 지휘한 경기의 결과를 순위표나 토너먼트에 반영한다. */
function settleMatch(g: Game): void {
  const m = g.match as MatchState;
  const club = myClub(g);
  const [gf, ga] = m.score;
  if (m.kind === 'league' && m.league) {
    applyResult(g.tables[m.league].find((r) => r.club === club.id) as Row, gf, ga);
    applyResult(g.tables[m.league].find((r) => r.club === m.oppId) as Row, ga, gf);
    g.season.lines.push({
      label: club.nation ? `${m.round + 1}차전` : `${m.round + 1}R`, opp: m.oppName, home: m.venue !== 'away', gf, ga,
      result: gf > ga ? 'W' : gf === ga ? 'D' : 'L', note: m.auto ? '라이벌전' : '직접 지휘',
    });
    // 라이벌전은 직접 지휘했든 수석 코치에게 맡겼든 똑같이 전적에 쌓이고, 이사회 신뢰가 조금 움직인다.
    const rivalry = g.job!.rivalry;
    if (!club.nation && rivalry && m.oppId === rivalry.club) {
      if (gf > ga) rivalry.w++;
      else if (gf === ga) rivalry.d++;
      else rivalry.l++;
      rivalry.last = [gf, ga];
      g.job!.confidence = clamp(g.job!.confidence + (gf > ga ? 2 : gf < ga ? -2 : 0), 0, 100);
    }
    if (!club.nation) countLeagueMatch(g, m);
  } else {
    const ko = (m.ko === 'cup' ? g.season.cup : m.ko === 'conti' ? g.season.conti : g.season.finals) as Knockout;
    settleKnockout(ko, m.oppName, gf, ga, m.pens ? m.pens === 'won' : gf > ga, !!m.pens, m.auto ? undefined : '직접 지휘');
  }
  // 큰 경기의 결과는 라커룸에 오래 남는다.
  const won = m.pens ? m.pens === 'won' : gf > ga;
  g.morale = clamp(g.morale + (won ? 4 : gf === ga && !m.pens ? 0 : -4), 5, 100);
  g.match = null;
}

function knockoutNote(ko: Knockout | null): string {
  if (!ko || ko.lines.length === 0) return '';
  const last = ko.lines[ko.lines.length - 1] as MatchLine;
  if (ko.won) return `${ko.name} 우승`;
  if (ko.alive) return `${ko.name} ${ko.rounds[ko.next]} 진출`;
  return `${ko.name} ${last.label} 탈락`;
}

function enterHalf1(g: Game): void {
  const job = g.job!;
  const club = myClub(g);
  const lines = g.season.lines.slice(g.season.halfStart);
  const league = club.nation ? 'intl' : club.league;
  const pos = positionOf(g, league, club.id);
  g.season.half1Pos = pos;
  g.phase = 'half1';
  const rec = recordOf(lines);
  const blocks: Block[] = g.season.notes.map((text): Block => ({ kind: 'note', text, tone: 'plain' }));
  g.season.notes = [];
  if (club.nation) {
    const kind = g.season.nationYear as NationYear;
    const done = g.fixtures.intl.length <= 3;
    blocks.push({ kind: 'text', text: done
      ? (g.season.groupPassed ? `조별 리그 ${rec.text}, 조 ${pos}위로 통과했다. 이제부터는 지면 끝이다.` : `조별 리그 ${rec.text}, 조 ${pos}위. ${kind === 'friendly' ? '평가전 일정이 절반 지났다.' : '여기서 짐을 싼다.'}`)
      : `예선 절반을 치렀다. ${rec.text}, 조 ${pos}위.` });
  } else {
    const gap = job.objective - pos;
    job.confidence = clamp(job.confidence + clamp((gap * 20) / g.leagues[club.league].length, -10, 10), 0, 100);
    blocks.push({ kind: 'text', text: `시즌의 절반이 지났다. ${rec.text}, 리그 ${pos}위. 목표는 ${job.objective}위 이내${gap >= 0 ? '이고, 지금까지는 순조롭다.' : '인데 뒤처져 있다.'}` });
    const cups = [knockoutNote(g.season.cup), knockoutNote(g.season.conti)].filter(Boolean);
    if (cups.length > 0) blocks.push({ kind: 'note', text: cups.join(' · '), tone: 'plain' });
  }
  blocks.push({ kind: 'matches', items: lines }, { kind: 'table', league }, { kind: 'stats', rows: statusRows(g) });
  g.scene = { eyebrow: seasonLabel(g), title: club.nation ? '대회 중간 점검' : '전반기 결산', blocks, choices: [{ id: 'next', label: '계속', tone: 'primary' }] };
}

function enterEvent(g: Game): void {
  const event = pickEvent(g);
  g.eventId = event.id;
  g.phase = 'event';
  g.scene = {
    eyebrow: seasonLabel(g), title: event.title(g), blocks: [{ kind: 'text', text: event.text(g) }],
    choices: event.choices(g).map((c): Choice => ({ id: c.id, label: c.label, detail: c.detail })),
  };
}

function resolveEvent(g: Game, id: string): void {
  const event = eventById(g.eventId as string);
  const choice = event.choices(g).find((c) => c.id === id);
  if (!choice) return;
  const outcome = choice.run(g);
  g.phase = 'outcome';
  const blocks: Block[] = [{ kind: 'text', text: outcome.text }];
  if (outcome.effects.length > 0) blocks.push({ kind: 'note', text: outcome.effects.join(' · '), tone: outcome.tone });
  g.scene = { eyebrow: seasonLabel(g), title: event.title(g), blocks, choices: [{ id: 'next', label: '계속', tone: 'primary' }] };
}

function enterPlan(g: Game): void {
  const club = myClub(g);
  g.phase = 'plan';
  const league = club.nation ? 'intl' : club.league;
  const pos = positionOf(g, league, club.id);
  const alive = [g.season.cup, g.season.conti, g.season.finals].filter((k) => k?.alive).map((k) => k!.name);
  const blocks: Block[] = g.season.notes.map((text): Block => ({ kind: 'note', text, tone: 'plain' }));
  g.season.notes = [];
  blocks.push({ kind: 'text', text: club.nation
    ? `남은 일정을 어떻게 치를지 정한다.${alive.length > 0 && g.season.groupPassed ? ' 토너먼트가 기다린다.' : ''}`
    : `리그 ${pos}위, 목표는 ${g.job!.objective}위 이내.${alive.length > 0 ? ` ${alive.join(', ')}에도 아직 살아 있다.` : ''} 후반기를 어떻게 치를지 정한다.` });
  g.scene = {
    eyebrow: seasonLabel(g), title: '후반기 운영', blocks,
    choices: PLAN_IDS.filter((id) => id !== 'rotate' || alive.length > 0)
      .map((id): Choice => ({ id, label: PLANS[id].name, detail: id === 'rotate' && club.nation ? '토너먼트에 맞춰 몸을 만든다. 남은 조별 경기는 조금 손해 본다' : PLANS[id].desc })),
  };
}

// ---------- 시즌 결산 ----------

function addTrophy(g: Game, name: string, weight: number): void {
  g.trophies.push({ year: g.year, name, club: myClub(g).name, weight });
}

function bumpRep(g: Game, target: number, bonus: number): void {
  const m = g.manager;
  m.rep = clamp(m.rep + (target > m.rep ? (target - m.rep) * 0.35 : (target - m.rep) * 0.15) + bonus, 0, 100);
  m.peakRep = Math.max(m.peakRep, m.rep);
}

function finishClubSeason(g: Game, midSack: boolean): void {
  const job = g.job!;
  const club = myClub(g);
  const league = club.league as ClubLeagueId;
  const meta = LEAGUES[league];
  const size = g.leagues[league].length;
  const pos = positionOf(g, league, club.id);
  const row = g.tables[league].find((r) => r.club === club.id) as Row;
  const z = zone(league, pos, size);
  const title = pos === 1 && !midSack;
  const promoted = z === 1 && !!meta.up;
  const relegated = z === -1;
  const gap = job.objective - pos;
  // 팀이 많은 리그에서는 한두 계단 차이가 덜 무겁다. 10팀 리그 기준으로 환산한다.
  const rel = (gap * 10) / size;
  const s = g.season;
  const blocks: Block[] = [];
  let repBonus = 0;
  // 올 시즌 라이벌전. 경기 수를 정해 두지 않고, 한 경기 이상 치러 모두 이겼으면 결산에서 신뢰를 더 준다.
  const rivalry = job.rivalry && job.rivalry.club === s.rival ? job.rivalry : null;
  const rivalLines = rivalry ? rivalLinesThisSeason(g) : [];
  const rivalRec = recordOf(rivalLines);
  const rivalSweep = rivalSweepBonus(rivalLines) > 0;

  if (!midSack) {
    if (title) addTrophy(g, `${meta.name} 우승`, meta.weight);
    if (s.cup?.won) addTrophy(g, `${s.cup.name} 우승`, COUNTRIES[meta.country].cupWeight);
    if (s.conti?.won) addTrophy(g, `${s.conti.name} 우승`, CONTI_WEIGHT[COUNTRIES[meta.country].confed]);
    if (promoted) g.promotions++;
    const cupRounds = (s.cup?.next ?? 0) + (s.conti?.next ?? 0) * 2;
    const delta = clamp(rel * 7, -30, 30) + (title ? 25 : 0) + (promoted ? 20 : 0) - (relegated ? 35 : 0) + (s.cup?.won ? 15 : 0) + (s.conti?.won ? 25 : 0) + Math.max(0, cupRounds - 2) * 2 + rivalSweepBonus(rivalLines);
    job.confidence = clamp(job.confidence + delta, 0, 100);
    g.sacked = job.confidence < 22 || (relegated && job.confidence < 45);
    repBonus = (title ? 3 : 0) + (promoted ? 2 : 0) + (s.cup?.won ? 3 : 0) + (s.conti?.won ? 8 : 0) + Math.max(0, cupRounds - 3) * 0.5 - (g.sacked ? 4 : 0);
  } else {
    g.sacked = true;
    repBonus = -5;
  }
  bumpRep(g, meta.rep + ((size - pos) / (size - 1)) * 16 - 4, repBonus);
  // 실시간으로 지휘한 리그 경기의 골은 이미 득점자에게 갔다. 나머지 골만 무작위로 나눈다.
  shareGoals(g, Math.max(0, row.gf - s.liveGoals));
  // 골 수가 같으면 출전이 적은 선수가 앞선다.
  const scorer = [...g.squad].sort((a, b) => b.goals - a.goals || a.apps - b.apps)[0] as Player;

  const outcome = title ? 'title' : g.sacked ? 'sacked' : promoted ? 'up' : relegated ? 'down' : 'plain';
  const mood: Mood = g.sacked ? 'sacked' : title ? 'title' : promoted ? 'promoted' : relegated ? 'relegated' : rel >= 2 ? 'over' : rel >= -1 ? 'par' : 'under';
  const cupText = [knockoutNote(s.cup), knockoutNote(s.conti)].filter(Boolean).join(' · ');
  const lead = midSack
    ? ko`시즌 도중 ${club.name}은 감독 교체를 발표했다. 팀은 결국 ${pos}위로 시즌을 마쳤다.`
    : title ? ko`${club.name}이 ${meta.name} 정상에 올랐다. ${row.w}승 ${row.d}무 ${row.l}패, 승점 ${row.pts}.`
    : promoted ? ko`${pos}위로 시즌을 마쳤다. ${club.name}은 다음 시즌 ${LEAGUES[meta.up as ClubLeagueId].name}에서 뛴다.`
    : relegated ? ko`${pos}위. ${club.name}은 ${LEAGUES[meta.down as ClubLeagueId].name}으로 내려간다.`
    : `${row.w}승 ${row.d}무 ${row.l}패, ${pos}위로 시즌을 마쳤다. 목표는 ${job.objective}위 이내였다.`;
  blocks.push({ kind: 'text', text: lead });
  if (g.sacked && !midSack) blocks.push({ kind: 'note', text: ko`시즌이 끝나고 ${club.name}은 계약 해지를 통보했다.`, tone: 'bad' });
  if (!g.sacked && (title || rel >= 4)) blocks.push({ kind: 'note', text: `${g.manager.name} 감독이 ${meta.name} 올해의 감독상을 받았다.`, tone: 'good' });
  blocks.push({
    kind: 'stats', rows: [
      { label: '최종 순위', value: `${pos}위 / ${size}팀`, tone: gap >= 0 ? 'good' : 'bad' },
      { label: '성적', value: `${row.w}승 ${row.d}무 ${row.l}패 · ${row.gf}득점 ${row.ga}실점` },
      ...(cupText ? [{ label: '컵 대회', value: cupText }] : []),
      ...(rivalry ? [{
        label: `라이벌 ${(g.clubs[rivalry.club] as Club).name}`,
        value: `올 시즌 ${tallyText(rivalRec.w, rivalRec.d, rivalRec.l)} · 통산 ${tallyText(rivalry.w, rivalry.d, rivalry.l)}`,
        tone: (rivalSweep ? 'good' : 'plain') as Tone,
      }] : []),
      { label: '팀 내 최다 득점', value: `${scorer.name} ${scorer.goals}골` },
      { label: '이사회 신뢰', value: `${Math.round(job.confidence)}`, tone: (job.confidence < 30 ? 'bad' : 'plain') as Tone },
      { label: '명성', value: `${Math.round(g.manager.rep)}` },
    ],
  });
  blocks.push({ kind: 'table', league }, reactions(g, mood, club.name, league === 'kr5'));

  if (!g.sacked) {
    const nextLevel = LEAGUES[promoted ? (meta.up as ClubLeagueId) : relegated ? (meta.down as ClubLeagueId) : league].level;
    const changes = develop(g);
    // 임대가 끝난 선수들이 오가고 나서 계약 만료를 따진다.
    const loans = returnLoans(g, 'end');
    if (changes.length > 0) {
      blocks.push({ kind: 'text', text: '한 시즌 사이 선수들이 달라졌다.' });
      blocks.push({ kind: 'players', items: changes.map((c) => ({ player: c.player, delta: c.delta })) });
    }
    for (const text of loans) blocks.push({ kind: 'note', text, tone: 'plain' });
    // 계약 기간이 한 시즌 줄고, 끝난 선수는 자유계약으로 떠난다. 그다음 은퇴와 빅클럽 이적이 있다.
    for (const text of expireContracts(g, nextLevel)) blocks.push({ kind: 'note', text, tone: 'plain' });
    const moves = departures(g, nextLevel);
    for (const text of moves.lines) blocks.push({ kind: 'note', text, tone: 'plain' });
    // 출전 보장을 어긴 선수는 불만을 품는다.
    for (const text of checkPromises(g)) blocks.push({ kind: 'note', text, tone: 'plain' });
    if (relegated) {
      const text = relegationCut(g, meta.down as ClubLeagueId);
      if (text) blocks.push({ kind: 'note', text, tone: 'plain' });
    }
    job.budget = round1((job.budget + moves.income) * 0.5);
    g.depth += (nextLevel - 2 + club.wealth * 0.8 - g.depth) * 0.3;
    for (const p of [...g.squad, ...g.reserves]) {
      p.goals = 0;
      p.apps = 0;
    }
  }
  g.history.push({
    year: g.year, age: g.manager.age, club: club.name, league: meta.short, pos, size,
    record: `${row.w}승 ${row.d}무 ${row.l}패`, cup: cupText, note: g.sacked ? '경질' : title ? '우승' : promoted ? '승격' : relegated ? '강등' : '', outcome, lid: league,
  });
  g.points = 1 + (!g.sacked && (title || promoted || rel >= 3) ? 1 : 0);
  g.phase = 'end';
  g.scene = { eyebrow: seasonLabel(g), title: title ? '우승!' : g.sacked ? '경질' : promoted ? '승격!' : relegated ? '강등' : '시즌 결산', blocks, choices: [{ id: 'next', label: '계속', tone: 'primary' }] };
}

function finishNationYear(g: Game): void {
  const job = g.job!;
  const club = myClub(g);
  const s = g.season;
  const kind = s.nationYear as NationYear;
  const label = NATION_LABEL[kind];
  const pos = positionOf(g, 'intl', club.id);
  const reached = s.finals?.next ?? 0;
  const won0 = !!s.finals?.won;
  let delta = 0;
  let rep = 0;
  let lead = '';
  let mood: Mood = 'par';
  if (kind === 'asia') {
    delta = !s.groupPassed ? -25 : won0 ? 30 : [-10, 5, 15][reached] ?? 15;
    rep = won0 ? 6 : reached >= 2 ? 2 : 0;
    lead = !s.groupPassed ? '아시안컵 조별 리그에서 탈락했다.' : won0 ? '아시안컵 정상에 섰다. 수십 년을 기다린 우승이다.' : `아시안컵 ${s.finals!.lines[s.finals!.lines.length - 1]!.label}에서 멈췄다.`;
    mood = won0 ? 'title' : delta > 0 ? 'over' : delta > -15 ? 'under' : 'relegated';
    if (won0) addTrophy(g, '아시안컵 우승', 50);
  } else if (kind === 'q2' || kind === 'q3') {
    const passed = pos <= 2;
    delta = passed ? (kind === 'q3' ? 15 : 5) : kind === 'q3' ? -45 : -40;
    rep = passed ? (kind === 'q3' ? 2 : 0) : -4;
    lead = passed ? (kind === 'q3' ? `조 ${pos}위. 월드컵 본선행을 확정했다.` : `조 ${pos}위로 최종 예선에 올랐다.`) : `조 ${pos}위. ${kind === 'q3' ? '월드컵 본선 진출에 실패했다.' : '2차 예선에서 탈락했다.'}`;
    mood = passed ? (kind === 'q3' ? 'promoted' : 'par') : 'relegated';
    if (kind === 'q3') g.wcTicket = passed;
  } else if (kind === 'wc') {
    delta = !s.groupPassed ? -8 : won0 ? 60 : [10, 25, 40, 50][reached] ?? 50;
    rep = !s.groupPassed ? 0 : won0 ? 20 : [3, 7, 11, 14][reached] ?? 14;
    lead = !s.groupPassed ? '월드컵 조별 리그에서 탈락했다. 세계의 벽은 높았다.' : won0 ? '월드컵 우승. 축구 역사가 다시 쓰였다.' : `월드컵 ${s.finals!.lines[s.finals!.lines.length - 1]!.label}에서 여정이 끝났다.`;
    mood = won0 ? 'title' : !s.groupPassed ? 'under' : reached >= 1 ? 'over' : 'par';
    if (won0) addTrophy(g, '월드컵 우승', 200);
    else if (reached >= 2) addTrophy(g, `월드컵 ${reached >= 3 ? '준우승' : '4강'}`, reached >= 3 ? 80 : 45);
    g.wcTicket = false;
  } else {
    delta = -5;
    lead = '본선에 나가지 못한 해. 평가전으로 다음을 준비했다.';
    mood = 'under';
  }
  job.confidence = clamp(job.confidence + delta, 0, 100);
  g.sacked = job.confidence < 25;
  if (g.sacked) mood = 'sacked';
  bumpRep(g, Math.max(g.manager.rep, NATION_REP + 4), rep - (g.sacked ? 3 : 0));
  const rec = recordOf(s.lines);
  const blocks: Block[] = [{ kind: 'text', text: lead }];
  if (g.sacked) blocks.push({ kind: 'note', text: '협회는 감독 교체를 발표했다.', tone: 'bad' });
  blocks.push({
    kind: 'stats', rows: [
      { label: label.name, value: lead.replace(/\..*$/, ''), tone: delta >= 0 ? 'good' : 'bad' },
      { label: '올해 성적', value: rec.text },
      { label: '협회 신뢰', value: `${Math.round(job.confidence)}` },
      { label: '명성', value: `${Math.round(g.manager.rep)}` },
    ],
  });
  blocks.push({ kind: 'matches', items: s.lines }, { kind: 'table', league: 'intl' }, reactions(g, mood, `${club.name} 대표팀`, false));
  if (!g.sacked) {
    const changes = develop(g);
    if (changes.length > 0) blocks.push({ kind: 'players', items: changes.map((c) => ({ player: c.player, delta: c.delta })) });
    for (const text of departures(g, (club.att + club.def) / 2 - 1).lines) blocks.push({ kind: 'note', text, tone: 'plain' });
  }
  g.history.push({
    year: g.year, age: g.manager.age, club: `${club.name} 대표팀`, league: label.name, pos, size: g.leagues.intl.length, record: rec.text,
    cup: knockoutNote(s.finals), note: g.sacked ? '경질' : won0 ? '우승' : '', outcome: won0 ? 'title' : g.sacked ? 'sacked' : 'plain', lid: 'intl',
  });
  g.points = 1 + (won0 || (kind === 'wc' && reached >= 2) ? 1 : 0);
  g.phase = 'end';
  g.scene = { eyebrow: seasonLabel(g), title: won0 ? '우승!' : g.sacked ? '경질' : `${label.name} 결산`, blocks, choices: [{ id: 'next', label: '계속', tone: 'primary' }] };
}

function enterGrowth(g: Game): void {
  g.phase = 'growth';
  const a = g.manager.attrs;
  g.scene = {
    eyebrow: `${g.manager.name} · ${g.manager.age}세`, title: '한 해 동안 무엇을 배웠나요?',
    blocks: [{ kind: 'text', text: `지도자 역량을 ${g.points}번 올릴 수 있다. 좋은 시즌을 보내면 두 번 오른다.` }],
    choices: ATTR_IDS.map((id): Choice => ({ id, label: `${ATTRS[id].name} ${a[id]} → ${a[id] + 1}`, detail: ATTRS[id].desc, disabled: a[id] >= 20 })),
  };
}

/** 한 해가 넘어간다: 승격과 강등이 반영되고 새 일정이 짜인다. */
function rollover(g: Game): void {
  const keep = g.job && !g.sacked && g.job.kind === 'club' ? g.job.club : -1;
  evolveClubs(g, keep);
  applyMoves(g);
  startLeagues(g);
  g.year++;
  g.manager.age++;
  if (g.job) g.job.seasons++;
}

// ---------- 구직과 은퇴 ----------

/**
 * 시즌과 시즌 사이: 강습을 마친 자격을 받고, 지금 구단에 남을 수 있는지 따진 뒤 구인 공고를 연다.
 * 승격으로 요구 자격이 올라갔는데 자격이 모자라면, 나라 규정에 따라 강습을 받으며 한 시즌 더 지휘하거나 물러난다.
 */
function enterCareer(g: Game, start?: string): void {
  if (g.manager.age >= RETIRE_AGE) {
    retire(g, '정년');
    return;
  }
  g.phase = 'career';
  const notes = finishCourses(g);
  const first = g.history.length === 0 && g.manager.idle === 0 && !g.job;
  const { stay, note: stayNote } = reviewJob(g, notes);
  openHiring(g, stay, stayNote, notes);  if (start) {
    // 시험과 시뮬레이션용 지름길: 고른 리그의 하위권 구단 세 곳이 바로 감독직을 제안한다.
    const pool = (g.leagues[start] ?? []).map((id) => g.clubs[id] as Club).sort((x, y) => y.lastPos - x.lastPos);
    const half = start === 'kr5' ? pool : pool.slice(0, Math.max(3, Math.floor(pool.length / 2)));
    g.hiring!.list = shuffle(g, [...half]).slice(0, 3).map((club) => ({
      club: club.id, kind: 'club' as const, approach: true, wants: ['results' as const], provisional: false, state: 'offer' as const,
      doc: 0, docNotes: [], talk: 0, objective: 0, confidence: 0, note: '먼저 연락해 와 감독직을 제안했다.',
    }));
    g.hiring!.step = 'decide';
  }
  hiringScene(g, first, introText(g, first, stay));
}

/**
 * 지금 구단에 남을 수 있는지 따진다. 승격 등으로 요구 자격이 올라갔으면, 나라 규정이 허락하는 경우 강습에 등록하고 한 시즌 더 지휘한다.
 * 남을 수 없으면 감독직을 내려놓는다. 강습 결과는 notes에 더한다.
 */
export function reviewJob(g: Game, notes: string[]): { stay: boolean; note: string } {
  let stay = false;
  let stayNote = '';
  const job = g.job;
  if (job && !g.sacked) {
    const club = g.clubs[job.club] as Club;
    const req = requiredLicense(club);
    const m = g.manager;
    const country = club.nation ? 'kr' : countryOf(club.league);
    if (m.license >= req || m.course?.level === req) {
      stay = true;
    } else if (!club.nation && COUNTRIES[country].grace && req - m.license === 1 && courseStatus(g).ok && courseStatus(g).level === req) {
      notes.push(enroll(g));
      stay = m.license >= req || m.course?.level === req;
      stayNote = stay ? ko`${LEAGUES[club.league]!.name}는 ${licenseName(req, country)}이 필요하다. ${COUNTRIES[country].name} 규정상 강습을 받는 동안 한 시즌은 지휘할 수 있다.` : '';
    }
    if (!stay) {
      stayNote = ko`${club.nation ? '대표팀' : LEAGUES[club.league]!.name}은 ${licenseName(req, country)} 이상이 필요하다. 자격이 모자라 ${club.name}을 떠난다. 실적은 이력에 남는다.`;
    }
  }
  if (!stay && job) {
    g.job = null;
    g.squad = [];
    g.reserves = [];
    g.loaned = [];
  }
  return { stay, note: stayNote };
}

function introText(g: Game, first: boolean, stay: boolean): string {
  const m = g.manager;
  if (first) {
    return `${m.name}, ${m.age}세. ${BACKGROUNDS[m.background].name}. ${m.license > 0 ? `${licenseName(m.license)} 지도자 자격증이 있다.` : '아직 지도자 자격증이 없다. 감독을 하려면 강습부터 들어야 한다.'} 리그마다 감독에게 요구하는 자격이 다르다. K5리그는 C급, K리그는 P급, 유럽 1부는 UEFA Pro가 필요하다.`;
  }
  if (g.sacked) return '짐을 싸서 나왔다. 다시 지원서를 쓴다.';
  if (!g.job && !stay) return '감독 자리가 없다. 공고를 보고 지원서를 낸다.';
  return '시즌이 끝났다. 남을 수도 있고, 다른 구단에 지원할 수도 있다.';
}

/** 감독 자리 없이 한 시즌을 보낸다: 세계의 리그는 그대로 돌아간다. */
function idleYear(g: Game): void {
  for (const league of CLUB_LEAGUES) {
    for (let r = 0; r < g.fixtures[league]!.length; r++) playRound(g, league, r, -1, () => ({ att: 0, def: 0 }));
  }
  g.job = null;
  g.sacked = false;
  g.squad = [];
  g.reserves = [];
  g.loaned = [];
  g.manager.idle++;
  g.manager.rep = Math.max(0, g.manager.rep - 1.5);
  evolveClubs(g, -1);
  applyMoves(g);
  startLeagues(g);
  g.year++;
  g.manager.age++;
  enterCareer(g);
}

/** 감독직을 맡는다. 면접에서 한 약속이 목표와 첫 신뢰에 붙는다. 조건부 채용이면 강습에 등록한다. */
function startJob(g: Game, v: Vacancy): void {
  const club = g.clubs[v.club] as Club;
  const where = club.nation ? 'kr1' : club.league;
  if (v.provisional && !g.manager.course) enroll(g);
  if (!club.nation) {
    const c = countryOf(club.league);
    if (!g.manager.countries.includes(c)) g.manager.countries.push(c);
  }
  g.job = { kind: v.kind, club: club.id, confidence: clamp(50 + g.manager.attrs.deal / 2 + v.confidence, 20, 90), objective: 0, budget: 0, wageBudget: 0, debts: [], seasons: 0, promise: v.objective, rivalry: null };
  g.loaned = [];
  // 선발 대형은 구단이 해 오던 전술에 어울리는 것으로 시작한다. 구단 관리 탭에서 바꿀 수 있다.
  g.formation = usualShape(club.style, club.id);
  g.squad = generateSquad(g, club, where);
  g.depth = (club.att + club.def) / 2 - 2;
  g.reserves = [];
  if (!club.nation) {
    // 후보 명단: 포지션마다 한 명씩, 스쿼드 뎁스 수준의 선수들.
    for (const pos of ['GK', 'DF', 'DF', 'MF', 'MF', 'FW'] as Pos[]) g.reserves.push(makePlayer(g, pos, g.depth + spread(g, -2, 2), int(g, 18, 31), where));
    // 원래 있던 선수들은 대개 로테이션 계약이다. 가장 잘하는 두 명만 주전을 약속받았다.
    const top = [...g.squad].sort((a, b) => b.ovr - a.ovr).slice(0, 2);
    for (const p of g.squad) p.contract = existingContract(g, p, top.includes(p), int(g, 1, 4));
    for (const p of g.reserves) p.contract = existingContract(g, p, false, int(g, 1, 3));
  }
  for (const p of [...g.squad, ...g.reserves]) assignNumber(g, p);
  g.cohesion = 25;
  g.morale = 60;
  g.lastStyle = null;
  g.sacked = false;
  g.hiring = null;
  beginSeason(g);
}

export function legacyScore(g: Game): number {
  return Math.round(g.trophies.reduce((sum, t) => sum + t.weight, 0) + g.promotions * 2 + g.manager.peakRep / 2);
}

function retire(g: Game, why: string): void {
  g.phase = 'retired';
  const score = legacyScore(g);
  const clubs = [...new Set(g.history.map((h) => h.club))];
  const best = [...g.trophies].sort((a, b) => b.weight - a.weight)[0];
  g.scene = {
    eyebrow: `${START_YEAR}–${g.year} · ${g.manager.name}`, title: legacyTitle(score),
    blocks: [
      { kind: 'text', text: `${g.manager.age}세, ${why === '정년' ? '마지막 시즌을 마치고' : '스스로'} 지휘봉을 내려놓았다. ${g.history.length}시즌 동안 ${clubs.length}개 팀을 이끌었다.${best ? ` 가장 빛난 순간은 ${best.year}년 ${best.club}의 ${best.name}.` : ' 트로피는 없었지만, 주말 아침 운동장에는 늘 그가 있었다.'}` },
      {
        kind: 'stats', rows: [
          { label: '커리어 점수', value: `${score}`, tone: 'good' },
          { label: '트로피', value: `${g.trophies.length}개` },
          { label: '승격', value: `${g.promotions}회` },
          { label: '최고 명성', value: `${Math.round(g.manager.peakRep)}` },
          { label: '경질', value: `${g.history.filter((h) => h.outcome === 'sacked').length}회` },
        ],
      },
    ],
    choices: [{ id: 'new', label: '새 커리어 시작', tone: 'primary' }],
  };
}

// ---------- 선택 처리 ----------

/** 지금 장면에서 선택지 하나를 고른다. 없는 선택지이거나 고를 수 없으면 아무 일도 일어나지 않는다. */
export function act(g: Game, id: string): void {
  // 선택지 말고도 양식(계약 제안서)의 칩도 고를 수 있다.
  const rows = g.scene.blocks.flatMap((b) => (b.kind === 'form' ? b.rows : []));
  // 슬라이더는 "id=값"으로 온다. 범위 안의 값만 받는다.
  const [rid, raw] = id.split('=');
  const range = raw !== undefined ? rows.find((r) => r.range?.id === rid)?.range : undefined;
  const okRange = !!range && Number(raw) >= range.min - 1e-9 && Number(raw) <= range.max + 1e-9;
  const choice = g.scene.choices.find((c) => c.id === id) ?? rows.flatMap((r) => r.options ?? []).find((o) => o.id === id);
  if (!okRange && (!choice || choice.disabled)) return;
  const nation = g.job ? myClub(g).nation : false;
  switch (g.phase) {
    case 'offers':
    case 'career': {
      const res = actHiring(g, id);
      if (!res) {
        hiringScene(g, g.history.length === 0 && g.manager.idle === 0 && !g.job, '');
        return;
      }
      if (res.kind === 'retire') retire(g, '은퇴');
      else if (res.kind === 'idle') idleYear(g);
      else if (res.kind === 'take') startJob(g, res.vacancy);
      else {
        g.hiring = null;
        g.sacked = false;
        beginSeason(g);
      }
      return;
    }
    case 'style':
      g.season.style = id as StyleId;
      g.cohesion = g.lastStyle === id ? clamp(g.cohesion + 10, 0, 100) : g.lastStyle ? Math.max(20, g.cohesion * 0.4) : g.cohesion;
      g.lastStyle = id as StyleId;
      enterFocus(g);
      return;
    case 'focus':
      g.season.focus = id as FocusId;
      enterMarket(g, 'summer');
      return;
    case 'market':
      if (actWindow(g, id)) startHalf(g, 1);
      else windowScene(g, seasonLabel(g));
      return;
    case 'match':
      if (actMatch(g, id)) {
        settleMatch(g);
        advance(g);
      }
      return;
    case 'half1':
      // 전반기 성적이 처참하면 시즌 도중에 잘린다.
      if (!nation && g.job!.confidence < 10) {
        const club = myClub(g);
        for (const league of CLUB_LEAGUES) {
          const total = g.fixtures[league].length;
          for (let r = Math.ceil(total / 2); r < total; r++) playRound(g, league, r, -1, () => ({ att: club.att, def: club.def }));
        }
        g.round = 2;
        finishClubSeason(g, true);
        return;
      }
      enterEvent(g);
      return;
    case 'event':
      resolveEvent(g, id);
      return;
    case 'outcome':
      if (nation) enterPlan(g);
      else enterMarket(g, 'winter');
      return;
    case 'winter':
      if (actWindow(g, id)) enterPlan(g);
      else windowScene(g, seasonLabel(g));
      return;
    case 'plan':
      g.season.plan = id as PlanId;
      startHalf(g, 2);
      return;
    case 'end':
      enterGrowth(g);
      return;
    case 'growth':
      g.manager.attrs[id as AttrId] = Math.min(20, g.manager.attrs[id as AttrId] + 1);
      if (--g.points > 0) {
        enterGrowth(g);
        return;
      }
      rollover(g);
      enterCareer(g);
      return;
    case 'retired':
      return;
  }
}

export { POS_NAME, sortTable };
