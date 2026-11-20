// 감독 커리어의 진행. 화면은 game.scene에 담긴 글과 선택지를 그리기만 하고,
// 선택지를 누르면 act()가 다음 장면을 만든다. 한 시즌은 다음 순서로 흐른다:
// 전술 → 훈련 → 여름 시장 → 전반기 → 사건 → 겨울 시장 → 후반기 운영 → 결산 → 성장 → 제안
import { ko } from './josa.ts';
import {
  ATTRS, ATTR_IDS, BACKGROUNDS, CLUB_LEAGUES, FOCUSES, FOCUS_IDS, LEAGUES, NATION_REP, PLANS, PLAN_IDS, POS_NAME,
  RETIRE_AGE, START_AGE, START_YEAR, STYLES, STYLE_IDS, TRAITS, won,
} from './data.ts';
import { eventById, pickEvent } from './events.ts';
import { chance, int, pick, shuffle, spread } from './rng.ts';
import {
  addPlayer, departures, develop, generateSquad, marketOptions, myClub, ratings, shareGoals, stage, valueOf,
} from './squad.ts';
import { legacyTitle, reactions } from './talk.ts';
import type { Mood } from './talk.ts';
import {
  applyMoves, createClubs, evolveClubs, playRound, playTie, positionOf, sortTable, startGroup, startLeagues, zone,
} from './world.ts';
import type { Side } from './world.ts';
import type {
  AttrId, BackgroundId, Block, Choice, Club, ClubLeagueId, FocusId, Game, Knockout, MatchLine, NationYear, Offer,
  PlanId, Player, Row, SeasonState, StyleId, Tone,
} from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** 평범한 감독이 팀에 더하는 전력. */
const AVERAGE_MANAGER = 3.5;

const ASIA_CLUBS = ['FC 요코하라', '알 사파 SC', '시드니 하버 FC', '상하이 드래곤', '방콕 타이거스', '테헤란 스타즈', '도하 SC', '멜버른 코스트'];
const EURO_CLUBS = ['FC 발렌토', '노르트하펜 SV', 'AC 몬테비앙카', '레알 카스텔로', '올림피크 마르소', '로열 켄싱턴', '디나모 벨그라브', '스포르팅 리베이라'];

function blankSeason(): SeasonState {
  return {
    style: 'possess', focus: 'attack', plan: 'steady', lines: [], cup: null, conti: null, nationYear: null, finals: null,
    groupPassed: false, half1Pos: 0, notes: [], attMod: 0, defMod: 0, depthMod: 0,
  };
}

export function createGame(seed: number, name: string, background: BackgroundId): Game {
  const attrs: Record<AttrId, number> = { tactics: 6, lead: 6, youth: 6, deal: 6, eye: 6 };
  for (const [key, value] of Object.entries(BACKGROUNDS[background].bonus)) attrs[key as AttrId] += value as number;
  const g: Game = {
    rng: seed | 0, version: 1, year: START_YEAR, nextId: 1,
    manager: { name: name.trim() || '김감독', age: START_AGE, background, attrs, rep: 2, peakRep: 2 },
    clubs: [],
    leagues: { kr5: [], kr4: [], kr3: [], kr2: [], kr1: [], eu2: [], eu1: [], intl: [] },
    tables: { kr5: [], kr4: [], kr3: [], kr2: [], kr1: [], eu2: [], eu1: [], intl: [] },
    fixtures: { kr5: [], kr4: [], kr3: [], kr2: [], kr1: [], eu2: [], eu1: [], intl: [] },
    round: 0, job: null, squad: [], depth: 0, morale: 60, cohesion: 25, season: blankSeason(), lastStyle: null,
    phase: 'offers', scene: { eyebrow: '', title: '', blocks: [], choices: [] }, eventId: null, offers: [], market: [],
    wcTicket: false, sacked: false, points: 0, history: [], trophies: [], promotions: 0,
  };
  createClubs(g);
  startLeagues(g);
  enterOffers(g);
  return g;
}

// ---------- 전력 ----------

/** 감독 팀이 이번 경기에 내는 전력. 전술, 숙련도, 사기, 훈련, 후반기 운영이 모두 여기서 더해진다. */
function side(g: Game, opp: Side, half: 1 | 2, cup: boolean): Side {
  const s = g.season;
  const r = ratings(g.squad, g.depth + s.depthMod);
  const tactics = g.manager.attrs.tactics;
  const k = 0.6 + tactics / 15;
  // 다른 구단의 전력에는 평범한 감독의 몫이 이미 들어 있다. 그만큼을 빼고 시작해,
  // 전술과 숙련도와 사기로 그 이상을 끌어내야 이름값을 한다.
  let att = r.att + s.attMod - AVERAGE_MANAGER;
  let def = r.def + s.defMod - AVERAGE_MANAGER;
  if (s.style === 'attack') {
    att += 3 * k;
    def -= 2;
  } else if (s.style === 'defend') {
    def += 3 * k;
    att -= 2;
  } else if (s.style === 'possess') {
    const good = r.mid >= stage(g).level;
    att += good ? 1.5 * k : -1;
    def += good ? 1.5 * k : -1;
  } else if (s.style === 'counter') {
    const stronger = (opp.att + opp.def) / 2 > (att + def) / 2 + 1;
    att += stronger ? 3 * k : -1.5;
    def += stronger ? k : 0;
  } else if (half === 1) {
    att += 2 * k;
    def += 2 * k;
  } else {
    att += s.focus === 'fitness' ? k : -1.5;
    def += s.focus === 'fitness' ? k : -1.5;
  }
  const drilled = (g.cohesion / 100) * (1 + tactics / 6);
  const mood = (g.morale - 55) / 15;
  att += drilled + mood + (s.focus === 'attack' ? 1.5 : 0) + (s.focus === 'fitness' && half === 2 ? 1 : 0);
  def += drilled + mood + (s.focus === 'defense' ? 1.5 : 0) + (s.focus === 'fitness' && half === 2 ? 1 : 0);
  if (half === 2) {
    if (s.plan === 'allout') {
      att += 2.5;
      def -= 1.5;
    } else if (s.plan === 'steady') {
      def += 2.5;
      att -= 1.5;
    } else {
      att += cup ? 2 : -1;
      def += cup ? 2 : -1;
    }
  }
  return { att, def };
}

// ---------- 토너먼트 ----------

function newKnockout(name: string, rounds: string[]): Knockout {
  return { name, rounds, next: 0, alive: true, won: false, lines: [] };
}

/** 토너먼트를 count 라운드만큼 치른다. 지면 거기서 끝난다. */
function runKnockout(g: Game, ko: Knockout | null, count: number, half: 1 | 2, opponent: (round: number) => { name: string; side: Side }): void {
  if (!ko) return;
  const nerve = g.squad.filter((p) => p.trait === 'clutch').length;
  for (let i = 0; i < count && ko.alive; i++) {
    const opp = opponent(ko.next);
    const tie = playTie(g, side(g, opp.side, half, true), opp.side, clamp(0.5 + (g.manager.attrs.lead - 8) * 0.012 + nerve * 0.03, 0.3, 0.75));
    ko.lines.push({
      label: ko.rounds[ko.next] as string, opp: opp.name, home: true, gf: tie.gf, ga: tie.ga, result: tie.win ? 'W' : 'L',
      note: tie.pens ? (tie.win ? '승부차기 승' : '승부차기 패') : undefined,
    });
    if (!tie.win) {
      ko.alive = false;
    } else if (++ko.next >= ko.rounds.length) {
      ko.alive = false;
      ko.won = true;
    }
  }
}

function cupOpponent(g: Game, round: number): { name: string; side: Side } {
  const me = myClub(g);
  const region = stage(g).region;
  const pool = CLUB_LEAGUES.filter((l) => LEAGUES[l].region === region).flatMap((l) => g.leagues[l]).filter((id) => id !== me.id)
    .map((id) => g.clubs[id] as Club).sort((a, b) => b.att + b.def - (a.att + a.def));
  // 라운드가 올라갈수록 강한 팀만 남는다.
  const keep = [1, 0.7, 0.5, 0.3, 0.15][round] ?? 0.15;
  const club = pool[int(g, 0, Math.max(0, Math.floor(pool.length * keep) - 1))] as Club;
  return { name: `${club.name} (${LEAGUES[club.league as ClubLeagueId].short})`, side: { att: club.att, def: club.def } };
}

function contiOpponent(g: Game, round: number): { name: string; side: Side } {
  const euro = stage(g).region === 'eu';
  const level = (euro ? 82 : 68) + round * (euro ? 2.5 : 3) + spread(g, -3, 3);
  const names = (euro ? EURO_CLUBS : ASIA_CLUBS).filter((n) => n !== myClub(g).name);
  return { name: pick(g, names), side: { att: level, def: level } };
}

function nationOpponent(g: Game, round: number): { name: string; side: Side } {
  const asia = g.season.nationYear === 'asia';
  const pool = g.clubs.filter((c) => c.nation && c.id !== g.job!.club && (asia ? c.asia : true))
    .sort((a, b) => b.att - a.att);
  const keep = asia ? [0.6, 0.35, 0.2][round] ?? 0.2 : [0.75, 0.45, 0.25, 0.12][round] ?? 0.12;
  const club = pool[int(g, 0, Math.max(0, Math.floor(pool.length * keep) - 1))] as Club;
  return { name: club.name, side: { att: club.att, def: club.def } };
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
  g.season.nationYear = kind;
  if (kind === 'asia') g.season.finals = newKnockout('아시안컵', ['8강', '4강', '결승']);
  if (kind === 'wc') g.season.finals = newKnockout('월드컵', ['16강', '8강', '4강', '결승']);
}

function beginSeason(g: Game): void {
  const job = g.job!;
  const club = myClub(g);
  g.season = blankSeason();
  if (club.nation) {
    setupNation(g);
    job.objective = 0;
  } else {
    const meta = LEAGUES[club.league as ClubLeagueId];
    const r = ratings(g.squad, g.depth);
    club.att = r.att;
    club.def = r.def;
    const ids = g.leagues[club.league];
    const power = (id: number): number => (g.clubs[id] as Club).att + (g.clubs[id] as Club).def;
    const rank = 1 + ids.filter((id) => id !== club.id && power(id) > power(club.id)).length;
    job.objective = clamp(rank - (club.wealth >= 3 ? 1 : 0), 1, ids.length - 2);
    job.budget = round1(job.budget + meta.money * (1 + club.wealth * 0.12));
    g.season.cup = newKnockout(meta.region === 'kr' ? '전국 컵' : '리그 컵', ['32강', '16강', '8강', '4강', '결승']);
    if (club.conti) g.season.conti = newKnockout(meta.region === 'kr' ? '아시아 챔피언스컵' : '유럽 챔피언스컵', ['16강', '8강', '4강', '결승']);
  }
  enterStyle(g);
}

// ---------- 장면 만들기 ----------

function squadBlock(g: Game): Block {
  return {
    kind: 'players',
    items: g.squad.map((p) => ({
      name: p.name, pos: p.pos, age: p.age, ovr: p.ovr + p.temp,
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
  rows.push({ label: '사기', value: `${Math.round(g.morale)}` });
  rows.push({ label: '전술 숙련도', value: `${Math.round(g.cohesion)}` });
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
      detail: `${STYLES[id].desc}${g.lastStyle === id ? ' · 지난 시즌과 같음, 숙련도 +10' : g.lastStyle ? ' · 바꾸면 숙련도가 크게 깎임' : ''}`,
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
  const nation = myClub(g).nation;
  g.phase = window === 'summer' ? 'market' : 'winter';
  g.market = marketOptions(g, window);
  g.scene = {
    eyebrow: seasonLabel(g),
    title: nation ? '누구를 부를까요?' : window === 'summer' ? '여름 이적 시장' : '겨울 이적 시장',
    blocks: [
      { kind: 'text', text: nation ? '소집 명단을 정한다. 한 자리만 바꿀 수 있다.' : `한 가지만 할 수 있다. 쓸 수 있는 돈은 ${won(g.job!.budget)}.` },
      squadBlock(g),
    ],
    choices: g.market.map((o): Choice => ({ id: o.id, label: o.label, detail: o.detail, disabled: o.price > g.job!.budget })),
  };
}

function applyMarket(g: Game, id: string): void {
  const option = g.market.find((o) => o.id === id);
  if (!option) return;
  const job = g.job!;
  const nation = myClub(g).nation;
  if (option.player) {
    const out = addPlayer(g, option.player);
    job.budget = round1(job.budget - option.price);
    if (!nation) {
      const { level, money } = stage(g);
      const fee = round1(valueOf(out, level, money) * 0.3);
      job.budget = round1(job.budget + fee);
      g.season.notes.push(fee >= 0.1 ? ko`${option.player.name}이 합류했고, ${out.name}은 ${won(fee)}에 팀을 떠났다.` : ko`${option.player.name}이 합류했고, ${out.name}은 팀을 떠났다.`);
    } else {
      g.season.notes.push(ko`${option.player.name}이 처음 대표팀에 뽑혔다. ${out.name}은 명단에서 빠졌다.`);
    }
  } else if (option.kind === 'depth') {
    g.depth += 3;
    job.budget = round1(job.budget - option.price);
    g.season.notes.push('후보 선수들이 합류해 선수층이 두꺼워졌다.');
  } else if (nation) {
    g.cohesion = clamp(g.cohesion + 5, 0, 100);
  }
}

function recordOf(lines: MatchLine[]): { w: number; d: number; l: number; text: string } {
  const w = lines.filter((l) => l.result === 'W').length;
  const d = lines.filter((l) => l.result === 'D').length;
  const l = lines.filter((x) => x.result === 'L').length;
  return { w, d, l, text: `${w}승 ${d}무 ${l}패` };
}

/** 전반기 또는 후반기를 치른다. */
function playHalf(g: Game, half: 1 | 2): MatchLine[] {
  const club = myClub(g);
  const mine: MatchLine[] = [];
  const from = half === 1 ? 0 : 9;
  for (let r = from; r < from + 9; r++) {
    for (const league of CLUB_LEAGUES) {
      const line = playRound(g, league, r, club.nation ? -1 : club.id, (opp) => side(g, opp, half, false));
      if (line) mine.push(line);
    }
  }
  g.round = from + 9;
  if (club.nation) {
    const total = g.fixtures.intl.length;
    const kind = g.season.nationYear as NationYear;
    const split = total <= 3 ? total : total / 2;
    const start = half === 1 ? 0 : split;
    const end = half === 1 ? split : total;
    const neutral = kind !== 'q2' && kind !== 'q3';
    for (let r = start; r < end; r++) {
      const line = playRound(g, 'intl', r, club.id, (opp) => side(g, opp, half, false), neutral);
      if (line) mine.push({ ...line, label: neutral ? `조별 ${r + 1}차전` : `${r + 1}차전` });
    }
    if (half === 1 && total <= 3) g.season.groupPassed = positionOf(g, 'intl', club.id) <= 2;
    if (half === 2 && g.season.finals) {
      if (g.season.groupPassed) runKnockout(g, g.season.finals, g.season.finals.rounds.length, 2, (round) => nationOpponent(g, round));
      else g.season.finals.alive = false;
    }
  } else {
    runKnockout(g, g.season.cup, half === 1 ? 3 : 2, half, (round) => cupOpponent(g, round));
    runKnockout(g, g.season.conti, 2, half, (round) => contiOpponent(g, round));
  }
  g.season.lines.push(...mine);
  // 결과에 따라 사기가 움직이고, 같은 전술로 뛴 만큼 숙련도가 쌓인다.
  const rec = recordOf(mine);
  const leaders = g.squad.filter((p) => p.trait === 'leader').length;
  const swing = (rec.w - rec.l) * 2.2;
  g.morale = clamp(g.morale + (swing < 0 ? swing * (1 - leaders * 0.2) : swing) + (g.manager.attrs.lead - 8) * 0.4, 5, 100);
  g.cohesion = clamp(g.cohesion + 8 + g.manager.attrs.tactics / 2, 0, 100);
  return mine;
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
  const lines = playHalf(g, 1);
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
    job.confidence = clamp(job.confidence + clamp(gap * 2, -10, 10), 0, 100);
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
  const s = g.season;
  const blocks: Block[] = [];
  let repBonus = 0;

  if (!midSack) {
    if (title) addTrophy(g, `${meta.name} 우승`, meta.weight);
    if (s.cup?.won) addTrophy(g, `${s.cup.name} 우승`, meta.region === 'kr' ? 8 : 15);
    if (s.conti?.won) addTrophy(g, `${s.conti.name} 우승`, meta.region === 'kr' ? 25 : 60);
    if (promoted) g.promotions++;
    const cupRounds = (s.cup?.next ?? 0) + (s.conti?.next ?? 0) * 2;
    const delta = clamp(gap * 7, -30, 30) + (title ? 25 : 0) + (promoted ? 20 : 0) - (relegated ? 35 : 0) + (s.cup?.won ? 15 : 0) + (s.conti?.won ? 25 : 0) + Math.max(0, cupRounds - 2) * 2;
    job.confidence = clamp(job.confidence + delta, 0, 100);
    g.sacked = job.confidence < 22 || (relegated && job.confidence < 45);
    repBonus = (title ? 3 : 0) + (promoted ? 2 : 0) + (s.cup?.won ? 3 : 0) + (s.conti?.won ? 8 : 0) + Math.max(0, cupRounds - 3) * 0.5 - (g.sacked ? 4 : 0);
  } else {
    g.sacked = true;
    repBonus = -5;
  }
  bumpRep(g, meta.rep + ((size - pos) / (size - 1)) * 16 - 4, repBonus);
  shareGoals(g, row.gf);
  const scorer = [...g.squad].sort((a, b) => b.goals - a.goals)[0] as Player;

  const outcome = title ? 'title' : g.sacked ? 'sacked' : promoted ? 'up' : relegated ? 'down' : 'plain';
  const mood: Mood = g.sacked ? 'sacked' : title ? 'title' : promoted ? 'promoted' : relegated ? 'relegated' : gap >= 2 ? 'over' : gap >= -1 ? 'par' : 'under';
  const cupText = [knockoutNote(s.cup), knockoutNote(s.conti)].filter(Boolean).join(' · ');
  const lead = midSack
    ? ko`시즌 도중 ${club.name}은 감독 교체를 발표했다. 팀은 결국 ${pos}위로 시즌을 마쳤다.`
    : title ? ko`${club.name}이 ${meta.name} 정상에 올랐다. ${row.w}승 ${row.d}무 ${row.l}패, 승점 ${row.pts}.`
    : promoted ? ko`${pos}위로 시즌을 마쳤다. ${club.name}은 다음 시즌 ${LEAGUES[meta.up as ClubLeagueId].name}에서 뛴다.`
    : relegated ? ko`${pos}위. ${club.name}은 ${LEAGUES[meta.down as ClubLeagueId].name}으로 내려간다.`
    : `${row.w}승 ${row.d}무 ${row.l}패, ${pos}위로 시즌을 마쳤다. 목표는 ${job.objective}위 이내였다.`;
  blocks.push({ kind: 'text', text: lead });
  if (g.sacked && !midSack) blocks.push({ kind: 'note', text: ko`시즌이 끝나고 ${club.name}은 계약 해지를 통보했다.`, tone: 'bad' });
  if (!g.sacked && (title || gap >= 4)) blocks.push({ kind: 'note', text: `${g.manager.name} 감독이 ${meta.name} 올해의 감독상을 받았다.`, tone: 'good' });
  blocks.push({
    kind: 'stats', rows: [
      { label: '최종 순위', value: `${pos}위 / ${size}팀`, tone: gap >= 0 ? 'good' : 'bad' },
      { label: '성적', value: `${row.w}승 ${row.d}무 ${row.l}패 · ${row.gf}득점 ${row.ga}실점` },
      ...(cupText ? [{ label: '컵 대회', value: cupText }] : []),
      { label: '팀 내 최다 득점', value: `${scorer.name} ${scorer.goals}골` },
      { label: '이사회 신뢰', value: `${Math.round(job.confidence)}`, tone: (job.confidence < 30 ? 'bad' : 'plain') as Tone },
      { label: '평판', value: `${Math.round(g.manager.rep)}` },
    ],
  });
  blocks.push({ kind: 'table', league }, reactions(g, mood, club.name, league === 'kr5' || league === 'kr4'));

  if (!g.sacked) {
    const nextLevel = LEAGUES[promoted ? (meta.up as ClubLeagueId) : relegated ? (meta.down as ClubLeagueId) : league].level;
    const changes = develop(g);
    if (changes.length > 0) {
      blocks.push({ kind: 'text', text: '한 시즌 사이 선수들이 달라졌다.' });
      blocks.push({ kind: 'players', items: changes.map((c) => ({ name: c.player.name, pos: c.player.pos, age: c.player.age, ovr: c.player.ovr, delta: c.delta })) });
    }
    const moves = departures(g, nextLevel);
    for (const text of moves.lines) blocks.push({ kind: 'note', text, tone: 'plain' });
    job.budget = round1((job.budget + moves.income) * 0.5);
    g.depth += (nextLevel - 2 + club.wealth * 0.8 - g.depth) * 0.3;
    for (const p of g.squad) p.goals = 0;
  }
  g.history.push({
    year: g.year, age: g.manager.age, club: club.name, league: meta.short, pos, size,
    record: `${row.w}승 ${row.d}무 ${row.l}패`, cup: cupText, note: g.sacked ? '경질' : title ? '우승' : promoted ? '승격' : relegated ? '강등' : '', outcome,
  });
  g.points = 1 + (!g.sacked && (title || promoted || gap >= 3) ? 1 : 0);
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
      { label: '평판', value: `${Math.round(g.manager.rep)}` },
    ],
  });
  blocks.push({ kind: 'matches', items: s.lines }, { kind: 'table', league: 'intl' }, reactions(g, mood, `${club.name} 대표팀`, false));
  if (!g.sacked) {
    const changes = develop(g);
    if (changes.length > 0) blocks.push({ kind: 'players', items: changes.map((c) => ({ name: c.player.name, pos: c.player.pos, age: c.player.age, ovr: c.player.ovr, delta: c.delta })) });
    for (const text of departures(g, (club.att + club.def) / 2 - 1).lines) blocks.push({ kind: 'note', text, tone: 'plain' });
  }
  g.history.push({
    year: g.year, age: g.manager.age, club: `${club.name} 대표팀`, league: label.name, pos, size: g.leagues.intl.length, record: rec.text,
    cup: knockoutNote(s.finals), note: g.sacked ? '경질' : won0 ? '우승' : '', outcome: won0 ? 'title' : g.sacked ? 'sacked' : 'plain',
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
    blocks: [{ kind: 'text', text: `능력치를 ${g.points}번 올릴 수 있다. 좋은 시즌을 보내면 두 번 오른다.` }],
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

// ---------- 제안과 은퇴 ----------

const wealthText = (w: number): string => (w >= 3 ? '재정 넉넉함' : w <= -3 ? '재정 빠듯함' : '재정 보통');

function buildOffers(g: Game): Offer[] {
  const offers: Offer[] = [];
  const rep = g.manager.rep;
  const job = g.job;
  const first = g.history.length === 0;
  const taken = new Set<number>();
  if (job && !g.sacked) {
    const club = g.clubs[job.club] as Club;
    taken.add(club.id);
    offers.push({
      club: club.id, kind: job.kind, stay: true,
      pitch: club.nation ? '대표팀과 다음 대회를 준비한다' : `${LEAGUES[club.league as ClubLeagueId].name}에서 ${job.seasons + 1}번째 시즌을 맞는다`,
    });
  } else if (job) {
    taken.add(job.club);
  }
  const eligible = CLUB_LEAGUES.filter((l) => LEAGUES[l].rep <= rep + 2);
  const last = g.history[g.history.length - 1];
  const hot = last && (last.outcome === 'title' || last.outcome === 'up');
  let count = first ? 3 : g.sacked || !job ? 2 : int(g, 0, 1) + (hot ? 1 : 0) + (chance(g, 0.4) ? 1 : 0);
  if (eligible.length === 0) eligible.push('kr5');
  for (let tries = 0; count > 0 && tries < 30; tries++) {
    // 평판이 닿는 가장 높은 리그에서 주로 연락이 온다. 경질된 감독에게는 한 단계 아래에서 온다.
    const drop = g.sacked ? int(g, 1, 2) : chance(g, 0.6) ? 0 : chance(g, 0.7) ? 1 : 2;
    const league = eligible[Math.max(0, eligible.length - 1 - drop)] as ClubLeagueId;
    const pool = g.leagues[league].map((id) => g.clubs[id] as Club).filter((c) => !taken.has(c.id));
    if (pool.length === 0) continue;
    // 감독 자리가 나는 곳은 대개 지난 시즌에 부진했던 팀이다.
    pool.sort((a, b) => b.lastPos - a.lastPos);
    const club = pool[int(g, 0, Math.min(pool.length - 1, first ? pool.length - 1 : 5))] as Club;
    taken.add(club.id);
    offers.push({ club: club.id, kind: 'club', stay: false, pitch: `${LEAGUES[league].name}(${LEAGUES[league].short}) · 지난 시즌 ${club.lastPos}위 · ${wealthText(club.wealth)}` });
    count--;
  }
  if (rep >= NATION_REP && job?.kind !== 'nation' && chance(g, g.year % 4 === 3 ? 0.8 : 0.35)) {
    const nation = g.clubs.find((c) => c.nation) as Club;
    offers.push({ club: nation.id, kind: 'nation', stay: false, pitch: `${nation.name} 축구 국가대표팀 감독. 다음 일정은 ${NATION_LABEL[nationKind(g)].name}` });
  }
  return offers;
}

function enterOffers(g: Game): void {
  if (g.manager.age >= RETIRE_AGE) {
    retire(g, '정년');
    return;
  }
  g.phase = 'offers';
  g.offers = buildOffers(g);
  const first = g.history.length === 0;
  const blocks: Block[] = [];
  if (first) {
    blocks.push({ kind: 'text', text: `${g.manager.name}, ${g.manager.age}세. ${BACKGROUNDS[g.manager.background].name}. 지도자 자격증을 따고 처음 받은 연락은 동네 리그 팀 세 곳이다. 월급은 없고, 회식비는 회비에서 나온다.` });
  } else if (g.sacked) {
    blocks.push({ kind: 'text', text: '짐을 싸서 나왔다. 그래도 전화는 온다.' });
  } else {
    blocks.push({ kind: 'text', text: g.offers.length > 1 ? '시즌이 끝나자 전화가 왔다. 남을 수도, 떠날 수도 있다.' : '올해는 다른 구단에서 연락이 없었다.' });
  }
  blocks.push({ kind: 'stats', rows: [{ label: '평판', value: `${Math.round(g.manager.rep)}` }, { label: '나이', value: `${g.manager.age}세` }] });
  const choices = g.offers.map((o, i): Choice => {
    const club = g.clubs[o.club] as Club;
    return { id: `offer${i}`, label: o.stay ? `${club.name}에 남는다` : `${club.name}${o.kind === 'nation' ? ' 대표팀' : ''}`, detail: o.pitch, tone: o.stay ? 'primary' : undefined };
  });
  if (!first && g.manager.age >= 45) choices.push({ id: 'retire', label: '지휘봉을 내려놓는다', detail: '커리어를 마치고 기록을 남긴다', tone: 'danger' });
  g.scene = { eyebrow: `${g.year} · 새 시즌을 앞두고`, title: first ? '첫 팀을 고르세요' : '어디에서 지휘할까요?', blocks, choices };
}

function takeOffer(g: Game, offer: Offer): void {
  if (!offer.stay) {
    const club = g.clubs[offer.club] as Club;
    const region = club.nation ? 'kr' : LEAGUES[club.league as ClubLeagueId].region;
    g.job = { kind: offer.kind, club: club.id, confidence: 50 + g.manager.attrs.deal / 2, objective: 0, budget: 0, seasons: 0 };
    g.squad = generateSquad(g, club, region);
    g.depth = (club.att + club.def) / 2 - 2;
    g.cohesion = 25;
    g.morale = 60;
    g.lastStyle = null;
  }
  g.sacked = false;
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
          { label: '최고 평판', value: `${Math.round(g.manager.peakRep)}` },
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
  const choice = g.scene.choices.find((c) => c.id === id);
  if (!choice || choice.disabled) return;
  const nation = g.job ? myClub(g).nation : false;
  switch (g.phase) {
    case 'offers': {
      if (id === 'retire') {
        retire(g, '은퇴');
        return;
      }
      const offer = g.offers[Number(id.replace('offer', ''))];
      if (offer) takeOffer(g, offer);
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
      applyMarket(g, id);
      enterHalf1(g);
      return;
    case 'half1':
      // 전반기 성적이 처참하면 시즌 도중에 잘린다.
      if (!nation && g.job!.confidence < 10) {
        const club = myClub(g);
        for (let r = 9; r < 18; r++) for (const league of CLUB_LEAGUES) playRound(g, league, r, -1, () => ({ att: club.att, def: club.def }));
        g.round = 18;
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
      applyMarket(g, id);
      enterPlan(g);
      return;
    case 'plan':
      g.season.plan = id as PlanId;
      playHalf(g, 2);
      if (nation) finishNationYear(g);
      else finishClubSeason(g, false);
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
      enterOffers(g);
      return;
    case 'retired':
      return;
  }
}

export { POS_NAME, sortTable };
