// 감독이 되는 길: 자격증 → 구인 공고 → 지원(서류) → 면접 → 채용.
// 실제 과정을 줄였다. 자격 단계와 대기 기간은 대한축구협회(KFA) 규정을 따르고(감독은 한국인이라 KFA에서 강습을 받는다),
// 리그마다 필요한 자격은 각국 규정을 따른다. 출처와 줄인 내용은 RULES.md에 있다.
import { ko } from './josa.ts';
import { LEAGUES, NATION_REP } from './data.ts';
import { COUNTRIES, COUNTRY_IDS, countryOf, leaguesOf } from './countries.ts';
import type { CountryId } from './countries.ts';
import { chance, int, shuffle, spread } from './rng.ts';
import type { AttrId, Block, Choice, Club, Game, Hiring, Tone, Vacancy, WantId } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 한 번에 낼 수 있는 지원서 수. */
export const MAX_APPLY = 3;
/** 서류를 통과하는 점수. */
const SHORTLIST = 35;

// ---------- 자격증 ----------

/** 자격 이름. country를 주면 그 나라 이름으로(UEFA Pro, BEPF …). */
export const licenseName = (level: number, country: CountryId = 'kr'): string => COUNTRIES[country].licenses[clamp(level, 0, 4)] as string;

/** 단계별 강습. 기간이 0이면 비시즌에 끝난다(D·C급 4일+2주, B급 집중 과정). 1이면 한 시즌 내내 듣는다. */
const COURSE: Record<number, { length: number; desc: string }> = {
  1: { length: 0, desc: 'D급(4일)과 C급(2주) 과정을 이어서 듣는다' },
  2: { length: 0, desc: '비시즌 집중 과정' },
  3: { length: 1, desc: '한 시즌 동안 듣는다. 실제 팀을 지도하며 평가받는다' },
  4: { length: 1, desc: '선발 심사를 거쳐 한 시즌 동안 듣는다(8주 360시간 과정)' },
};

/** 다음 강습을 들으려면 이전 자격을 따고 기다려야 하는 해. 은퇴한 프로 선수는 B급 우선 과정(프로 50경기 이상)으로 기다리지 않는다. */
function waitFor(g: Game, level: number): number {
  if (level === 2) return g.manager.background === 'pro' ? 0 : 2;
  if (level === 3) return 1;
  if (level === 4) return 3;
  return 0;
}

/** P급 선발 심사 점수: 명성, 지휘한 시즌, 트로피. */
const selectionScore = (g: Game): number => Math.round(g.manager.rep + g.history.length * 2 + g.trophies.length * 3);
const SELECTION_PASS = 24;

export interface CourseStatus {
  level: number;
  ok: boolean;
  why: string;
}

/** 지금 신청할 수 있는 다음 강습. */
export function courseStatus(g: Game): CourseStatus {
  const m = g.manager;
  const level = m.license + 1;
  if (m.course) return { level: m.course.level, ok: false, why: `${licenseName(m.course.level)} 강습을 듣는 중이다. ${m.course.ends}년 시즌이 시작되기 전에 끝난다` };
  if (level > 4) return { level, ok: false, why: '가장 높은 자격(P급)을 가지고 있다' };
  const from = m.licensed[level - 1] ?? 0;
  const open = level === 1 ? g.year : from + waitFor(g, level);
  if (g.year < open) return { level, ok: false, why: `${licenseName(level - 1)}을 딴 뒤 ${waitFor(g, level)}년의 지도 경력이 필요하다. ${open}년부터 신청할 수 있다` };
  return { level, ok: true, why: COURSE[level]!.desc };
}

/** 강습 신청. P급은 선발 심사를 거친다. 결과 설명을 돌려준다. */
export function enroll(g: Game): string {
  const st = courseStatus(g);
  if (!st.ok) return st.why;
  const m = g.manager;
  if (st.level === 4) {
    const score = selectionScore(g);
    if (score < SELECTION_PASS && !chance(g, 0.35)) {
      m.licensed[4] = -1;
      return `P급 강습 선발 심사에서 떨어졌다(심사 점수 ${score}, 대개 ${SELECTION_PASS} 이상이 붙는다). 내년에 다시 지원할 수 있다.`;
    }
  }
  const length = COURSE[st.level]!.length;
  if (length === 0) {
    m.license = st.level;
    m.licensed[st.level] = g.year;
    return `${licenseName(st.level)} 강습을 마치고 자격증을 받았다.`;
  }
  m.course = { level: st.level, ends: g.year + length };
  return `${licenseName(st.level)} 강습에 등록했다. 이번 시즌 내내 듣고, 시즌이 끝나면 자격증이 나온다.`;
}

/** 시즌이 끝나 강습을 마친 자격을 준다. */
export function finishCourses(g: Game): string[] {
  const m = g.manager;
  if (m.licensed[4] === -1) m.licensed[4] = 0;
  if (!m.course || g.year < m.course.ends) return [];
  const level = m.course.level;
  m.license = Math.max(m.license, level);
  m.licensed[level] = m.course.ends - 1;
  m.course = null;
  return [`${licenseName(level)} 강습을 마치고 자격증을 받았다.`];
}

/** 출신에 따라 처음 가진 자격. 기록상 딴 해를 앞당겨 다음 강습 대기를 줄인다. */
export function startingLicense(background: Game['manager']['background'], year: number): { license: number; licensed: number[] } {
  const licensed = [0, 0, 0, 0, 0];
  const at: Record<string, number> = { pro: year - 1, teacher: year - 2, analyst: year - 1, scout: year - 1 };
  if (at[background] !== undefined) {
    licensed[1] = at[background] as number;
    return { license: 1, licensed };
  }
  return { license: 0, licensed };
}

// ---------- 지원 자격 ----------

export const requiredLicense = (club: Club): number => (club.nation ? 4 : LEAGUES[club.league]!.license);
const clubCountry = (club: Club): CountryId => (club.nation ? 'kr' : countryOf(club.league));
const leagueRep = (club: Club): number => (club.nation ? NATION_REP : LEAGUES[club.league]!.rep);

/** 잉글랜드 1~4부의 외국인 감독 워크퍼밋. 실제 기준(최근 상위 리그 지휘 경력)을 명성이나 최근 5시즌 중 2시즌 이상 수준 70 이상 리그 지휘로 줄였다. */
function coachPermit(g: Game, club: Club): string | null {
  if (club.nation || countryOf(club.league) !== 'eng' || LEAGUES[club.league]!.tier > 4) return null;
  const recent = g.history.slice(-5).filter((h) => h.lid && LEAGUES[h.lid] && LEAGUES[h.lid]!.level >= 70).length;
  if (g.manager.rep >= 55 || recent >= 2) return null;
  return '워크퍼밋(GBE) 기준 미달: 최근 5시즌 중 2시즌 이상 상위 리그(수준 70 이상)를 지휘했거나 명성 55 이상이어야 한다';
}

export interface Eligibility {
  ok: boolean;
  provisional: boolean;
  why: string;
}

/** 이 구단 감독직에 지원할 수 있는지. 자격증은 절대 조건이다. */
export function eligibility(g: Game, club: Club): Eligibility {
  const m = g.manager;
  const req = requiredLicense(club);
  const country = clubCountry(club);
  const need = `${licenseName(req, country)}${licenseName(req, country) === licenseName(req) ? '' : `(${licenseName(req)})`} 필요`;
  let provisional = false;
  if (m.license < req) {
    const studying = m.course?.level === req;
    const canStart = courseStatus(g).ok && courseStatus(g).level === req;
    if (req - m.license === 1 && COUNTRIES[country].provisional && !club.nation && (studying || canStart)) provisional = true;
    else return { ok: false, provisional: false, why: `${need}. 지금 ${licenseName(m.license)}` };
  }
  if (club.nation && m.rep < NATION_REP) return { ok: false, provisional: false, why: `대표팀은 명성 ${NATION_REP} 이상만 검토한다` };
  const permit = coachPermit(g, club);
  if (permit) return { ok: false, provisional: false, why: permit };
  return { ok: true, provisional, why: provisional ? `${need}. 한 단계 낮은 자격으로 강습 등록을 조건으로 지원한다` : need };
}

// ---------- 구인 공고 ----------

export const WANTS: Record<WantId, string> = {
  results: '당장의 성적', promotion: '승격', survival: '잔류', youth: '유소년 육성', budget: '재정 건전성', attack: '공격적인 축구', defense: '단단한 수비',
};

function wantsOf(g: Game, club: Club): WantId[] {
  const w: WantId[] = [];
  if (club.nation) return ['results', chance(g, 0.5) ? 'attack' : 'defense'];
  const meta = LEAGUES[club.league]!;
  const size = g.leagues[club.league]!.length;
  w.push(club.lastPos > size * 0.7 ? 'survival' : meta.up && club.lastPos <= size * 0.35 ? 'promotion' : 'results');
  if (club.wealth <= -2) w.push('budget');
  if (club.wealth <= 1 && chance(g, 0.45)) w.push('youth');
  if (chance(g, 0.6)) w.push(['press', 'possess', 'wide'].includes(club.style) ? 'attack' : 'defense');
  return [...new Set(w)].slice(0, 3);
}

function vacancy(g: Game, club: Club, approach: boolean): Vacancy {
  const el = eligibility(g, club);
  return {
    club: club.id, kind: club.nation ? 'nation' : 'club', approach, wants: wantsOf(g, club), provisional: el.provisional,
    state: 'open', doc: 0, docNotes: [], talk: 0, objective: 0, confidence: 0, note: '',
  };
}

/** 리그에서 감독 자리가 난 구단 하나. 대개 지난 시즌에 부진했던 팀이다. */
function openingIn(g: Game, league: string, taken: Set<number>): Club | null {
  const pool = (g.leagues[league] ?? []).map((id) => g.clubs[id] as Club).filter((c) => !taken.has(c.id)).sort((a, b) => b.lastPos - a.lastPos);
  if (pool.length === 0) return null;
  const club = pool[int(g, 0, Math.max(0, Math.ceil(pool.length * 0.6) - 1))] as Club;
  taken.add(club.id);
  return club;
}

/** 이번 비시즌의 구인 공고. 나라마다 닿을 만한 단계와 그 아래, 한국은 한 단계 위도 보여 준다. 먼저 연락해 오는 구단도 있다. */
export function makeVacancies(g: Game, keep: number): Vacancy[] {
  const rep = g.manager.rep;
  const taken = new Set<number>(keep >= 0 ? [keep] : []);
  const list: Vacancy[] = [];
  for (const country of COUNTRY_IDS) {
    const leagues = leaguesOf(country);
    let reach = leagues.findIndex((id) => LEAGUES[id]!.rep <= rep + 6);
    if (reach < 0) reach = leagues.length - 1;
    const picks = [reach - 1, reach, reach + 1];
    for (const i of [...new Set(picks)].filter((x) => x >= 0 && x < leagues.length)) {
      const club = openingIn(g, leagues[i] as string, taken);
      if (club) list.push(vacancy(g, club, false));
    }
  }
  // 성적이 좋으면 구단이 먼저 연락한다. 명성이 닿는 리그 가운데 지금보다 높은 곳에서.
  const job = g.job;
  const last = g.history[g.history.length - 1];
  const hot = !!last && (last.outcome === 'title' || last.outcome === 'up');
  const calls = (hot ? 1 : 0) + (chance(g, 0.35) ? 1 : 0);
  const here = job && !g.sacked ? (g.clubs[job.club] as Club) : null;
  const floor = here && !here.nation ? LEAGUES[here.league]!.level : 0;
  const near = Object.keys(LEAGUES).filter((id) => LEAGUES[id]!.rep <= rep + 2 && LEAGUES[id]!.rep >= rep - 18 && LEAGUES[id]!.level >= floor);
  for (const league of shuffle(g, near).slice(0, calls)) {
    const club = openingIn(g, league, taken);
    if (club && eligibility(g, club).ok) list.push({ ...vacancy(g, club, true) });
  }
  if (rep >= NATION_REP && job?.kind !== 'nation' && g.manager.license >= 4 && chance(g, g.year % 4 === 3 ? 0.45 : 0.15)) {
    const nation = g.clubs.find((c) => c.nation) as Club;
    list.push(vacancy(g, nation, true));
  }
  return list;
}

// ---------- 서류 ----------

/** 서류 평가. 명성과 구단 기대의 차이, 경력, 최근 성적, 처음 가는 나라, 구단이 바라는 것과 감독 역량. */
export function screen(g: Game, v: Vacancy): void {
  const club = g.clubs[v.club] as Club;
  const m = g.manager;
  const notes: string[] = [];
  let score = 40;
  const gap = clamp((m.rep - leagueRep(club)) * 1.5, -30, 20);
  score += gap;
  notes.push(`명성 ${Math.round(m.rep)} · 구단 기대 ${leagueRep(club)} (${gap >= 0 ? '+' : ''}${Math.round(gap)})`);
  const seasons = g.history.length + m.idle * 0.5;
  if (seasons > 0) {
    score += Math.min(8, seasons) * 2;
    notes.push(`지도 경력 ${g.history.length}시즌${m.idle ? `, 코치 ${m.idle}년` : ''} (+${Math.round(Math.min(8, seasons) * 2)})`);
  }
  const recent = g.history.slice(-4);
  const good = recent.filter((h) => h.outcome === 'title' || h.outcome === 'up').length;
  if (good) {
    score += good * 5;
    notes.push(`최근 우승·승격 ${good}번 (+${good * 5})`);
  }
  if (recent[recent.length - 1]?.outcome === 'sacked') {
    score -= 8;
    notes.push('지난 시즌 경질 (-8)');
  }
  const country = clubCountry(club);
  if (!club.nation && country !== 'kr' && !m.countries.includes(country) && m.rep < leagueRep(club) + 10) {
    score -= 10;
    notes.push(`${COUNTRIES[country].name}에서 일한 적이 없다: 언어와 인맥 (-10)`);
  }
  const extra = m.license - requiredLicense(club);
  if (extra > 0) {
    score += extra * 3;
    notes.push(`요구보다 높은 자격 (+${extra * 3})`);
  }
  if (v.provisional) {
    score -= 6;
    notes.push('자격 미달, 강습 등록 조건 (-6)');
  }
  const attrFor: Partial<Record<WantId, AttrId>> = { youth: 'youth', budget: 'deal', attack: 'tactics', defense: 'tactics' };
  for (const w of v.wants) {
    const a = attrFor[w];
    if (!a) continue;
    const plus = Math.round((m.attrs[a] - 8) * 1.5);
    if (plus !== 0) {
      score += plus;
      notes.push(`${WANTS[w]}: ${a === 'youth' ? '유소년 지도' : a === 'deal' ? '협상력' : '전술 이해도'} ${m.attrs[a]} (${plus > 0 ? '+' : ''}${plus})`);
    }
  }
  v.doc = Math.round(score);
  v.docNotes = notes;
}

// ---------- 면접 ----------

interface Answer {
  id: string;
  text: string;
  /** 구단이 바라는 것에 맞을 때의 점수. any는 늘 더한다. */
  fit: Partial<Record<WantId | 'any', number>>;
  /** 이 대답을 뒷받침하는 감독 역량. 높을수록 설득력이 있다. */
  attr?: AttrId;
  /** 뽑히면 목표 순위와 첫 신뢰에 붙는 보정. */
  objective?: number;
  confidence?: number;
}

interface Question {
  id: string;
  ask: (club: Club) => string;
  answers: Answer[];
}

const QUESTIONS: Record<string, Question> = {
  goal: {
    id: 'goal', ask: (c) => ko`${c.name}에서의 첫 시즌 목표를 말씀해 주십시오.`,
    answers: [
      { id: 'bold', text: '우승이든 승격이든, 위를 보고 싸우겠습니다.', fit: { results: 10, promotion: 12, survival: -4, any: 2 }, objective: -2, confidence: 4 },
      { id: 'steady', text: '현실적으로 시작하겠습니다. 구단이 정한 순위를 지키는 것이 먼저입니다.', fit: { survival: 10, budget: 6, any: 4 } },
      { id: 'build', text: '첫해는 팀의 틀을 세우고, 2~3년 안에 결과를 내겠습니다.', fit: { youth: 10, budget: 6, results: -8, promotion: -6, any: 2 }, objective: 1, confidence: -3 },
    ],
  },
  style: {
    id: 'style', ask: () => '어떤 축구를 하실 생각입니까?',
    answers: [
      { id: 'press', text: '높은 위치에서 압박하고 공을 오래 갖는 축구입니다.', fit: { attack: 12, defense: -4, any: 3 }, attr: 'tactics' },
      { id: 'solid', text: '수비 조직부터 세우고 역습으로 이기는 축구입니다.', fit: { defense: 12, survival: 8, attack: -4, any: 3 }, attr: 'tactics' },
      { id: 'adapt', text: '선수 구성과 상대에 맞춰 바꾸겠습니다.', fit: { any: 6 }, attr: 'tactics' },
    ],
  },
  youth: {
    id: 'youth', ask: () => '유소년 출신과 어린 선수들은 어떻게 쓰실 겁니까?',
    answers: [
      { id: 'trust', text: '매 경기 두 명 이상 기회를 주겠습니다. 실수도 성장의 일부입니다.', fit: { youth: 12, results: -3 }, attr: 'youth' },
      { id: 'compete', text: '나이와 상관없이 실력으로 경쟁시키겠습니다.', fit: { results: 5, youth: -2, any: 3 } },
      { id: 'loan', text: '임대로 경기 경험을 쌓게 한 뒤 불러들이겠습니다.', fit: { youth: 6, budget: 4, any: 2 } },
    ],
  },
  budget: {
    id: 'budget', ask: () => '올해 이적 예산이 거의 없습니다. 선수단은 어떻게 채우실 겁니까?',
    answers: [
      { id: 'free', text: '자유계약과 임대로 채우고, 있는 선수를 키우겠습니다.', fit: { budget: 12, any: 3 }, attr: 'deal' },
      { id: 'sell', text: '팔 선수를 팔아 재원을 만들겠습니다.', fit: { budget: 6, results: -2, any: 2 }, attr: 'deal' },
      { id: 'ask', text: '최소한의 보강 예산은 이사회에 요청하겠습니다.', fit: { budget: -8, results: 4 }, confidence: -4 },
    ],
  },
  squad: {
    id: 'squad', ask: () => '지금 선수단으로 목표를 이룰 수 있습니까?',
    answers: [
      { id: 'yes', text: '충분합니다. 지금 선수들로 해내겠습니다.', fit: { results: 8, promotion: 8 }, confidence: 3, attr: 'lead' },
      { id: 'two', text: '핵심 포지션 두 곳만 보강하면 됩니다. 후보 명단은 이미 봐 뒀습니다.', fit: { results: 6, promotion: 6, budget: -4, any: 4 }, attr: 'eye' },
      { id: 'time', text: '솔직히 시간이 필요합니다.', fit: { results: -8, promotion: -6, youth: 4 }, objective: 1 },
    ],
  },
  survival: {
    id: 'survival', ask: () => '강등권에서 시즌을 시작합니다. 첫 열 경기는 어떻게 치르실 겁니까?',
    answers: [
      { id: 'calm', text: '실점부터 줄이겠습니다. 지지 않는 경기가 쌓이면 분위기가 바뀝니다.', fit: { survival: 12, defense: 4 }, attr: 'lead' },
      { id: 'attack', text: '이기는 경기를 하겠습니다. 공격으로 분위기를 바꿉니다.', fit: { survival: -4, attack: 6 } },
      { id: 'honest', text: '쉽지 않지만 잔류는 충분히 가능합니다.', fit: { survival: 8, any: 3 } },
    ],
  },
  abroad: {
    id: 'abroad', ask: (c) => ko`${c.name}이 있는 리그와 이 나라 축구 문화를 얼마나 아십니까?`,
    answers: [
      { id: 'study', text: '언어를 배우고 있고, 현지 코치를 수석코치로 두겠습니다.', fit: { any: 10 }, attr: 'lead' },
      { id: 'universal', text: '축구는 어디서나 같습니다.', fit: { any: 0 } },
      { id: 'staff', text: '통역과 분석 인력을 붙여 주시면 빠르게 적응하겠습니다.', fit: { any: 5 } },
    ],
  },
};

function questionsFor(g: Game, v: Vacancy): string[] {
  const club = g.clubs[v.club] as Club;
  const qs = ['goal', 'style'];
  const special = v.wants.find((w) => w === 'youth' || w === 'budget' || w === 'survival');
  qs.push(special ?? 'squad');
  const country = clubCountry(club);
  if (!club.nation && country !== 'kr' && !g.manager.countries.includes(country)) qs.push('abroad');
  return qs;
}

/** 대답 하나의 점수. */
function answerScore(g: Game, v: Vacancy, a: Answer): number {
  let pts = a.fit.any ?? 0;
  for (const w of v.wants) pts += a.fit[w] ?? 0;
  if (a.attr) pts += (g.manager.attrs[a.attr] - 8) * 0.8;
  return pts;
}

/** 지금 면접 질문의 대답별 점수(시뮬레이션 봇이 쓴다. 화면에는 보여 주지 않는다). */
export function answerScores(g: Game): Record<string, number> {
  const h = g.hiring;
  if (!h?.talk) return {};
  const v = h.list[h.talk.at] as Vacancy;
  const q = QUESTIONS[h.talk.qs[h.talk.i] as string] as Question;
  return Object.fromEntries(q.answers.map((a) => [`a:${a.id}`, answerScore(g, v, a)]));
}

/** 면접 결과: 서류 점수의 절반 + 면접 점수 + 발표력(선수단 장악력)과 다른 후보들과의 비교. */
function decide(g: Game, v: Vacancy): void {
  const club = g.clubs[v.club] as Club;
  const m = g.manager;
  const total = v.doc * 0.5 + v.talk + (m.attrs.lead - 8) * 1.2 + spread(g, -4, 4);
  const bar = 42 + clamp(leagueRep(club) - m.rep, -10, 25) * 0.8 - (v.approach ? 10 : 0) + spread(g, -4, 4);
  const grade = v.talk >= 28 ? '좋았다' : v.talk >= 15 ? '무난했다' : '아쉬웠다';
  if (total >= bar) {
    v.state = 'offer';
    v.note = `면접은 ${grade}. ${club.nation ? '협회' : '구단'}가 감독직을 제안했다.`;
  } else {
    v.state = 'failed';
    v.note = `면접은 ${grade}. ${club.nation ? '협회' : '구단'}는 다른 후보를 골랐다.`;
  }
}

// ---------- 장면 ----------

/** 이번 비시즌 구직을 시작한다. stay는 지금 구단에 남을 수 있는지와 그 설명. */
export function openHiring(g: Game, stay: boolean, stayNote: string, notes: string[]): void {
  const keep = g.job ? g.job.club : -1;
  g.hiring = { step: 'browse', list: makeVacancies(g, keep), talk: null, stay, stayNote, notes };
}

const applied = (h: Hiring): Vacancy[] => h.list.filter((v) => v.state === 'applied');

function vacancyLine(g: Game, v: Vacancy): string {
  const club = g.clubs[v.club] as Club;
  if (club.nation) return `대한민국 국가대표팀 · 요구 ${licenseName(4)} · 바라는 것: ${v.wants.map((w) => WANTS[w]).join(', ')}`;
  const meta = LEAGUES[club.league]!;
  const wealth = club.wealth >= 3 ? '재정 넉넉함' : club.wealth <= -3 ? '재정 빠듯함' : '재정 보통';
  return `${meta.name} · 지난 시즌 ${club.lastPos}위 · ${wealth} · 요구 ${licenseName(meta.license, meta.country)} · 바라는 것: ${v.wants.map((w) => WANTS[w]).join(', ')}`;
}

function licenseBlock(g: Game): Block {
  const m = g.manager;
  const st = courseStatus(g);
  return {
    kind: 'stats', rows: [
      { label: '지도자 자격', value: licenseName(m.license), tone: m.license >= 4 ? 'good' : 'plain' },
      { label: '다음 강습', value: m.course ? `${licenseName(m.course.level)} 수강 중` : st.level > 4 ? '없음' : `${licenseName(st.level)} · ${st.ok ? '지금 신청 가능' : st.why}` },
      { label: '명성', value: `${Math.round(m.rep)}` },
      { label: '나이', value: `${m.age}세` },
    ],
  };
}

/** 지금 단계의 장면을 만든다. */
export function hiringScene(g: Game, first: boolean, intro: string): void {
  const h = g.hiring as Hiring;
  const blocks: Block[] = [];
  const choices: Choice[] = [];
  const eyebrow = `${g.year} · ${g.manager.name} · 감독 구직`;
  if (h.step === 'browse') {
    if (intro) blocks.push({ kind: 'text', text: intro });
    for (const text of h.notes) blocks.push({ kind: 'note', text, tone: 'plain' });
    if (h.stayNote) blocks.push({ kind: 'note', text: h.stayNote, tone: h.stay ? 'plain' : 'bad' });
    blocks.push(licenseBlock(g));
    blocks.push({ kind: 'text', text: `구인 공고에 지원서를 낸다(최대 ${MAX_APPLY}곳). 자격증은 절대 조건이고, 서류(명성·경력·성적)를 통과하면 면접을 본다. 먼저 연락해 온 구단은 서류 없이 면접을 본다.` });
    const st = courseStatus(g);
    if (st.ok) choices.push({ id: 'course', label: `${licenseName(st.level)} 강습 신청`, detail: st.why, tone: 'primary', group: '지도자 강습' });
    const n = applied(h).length;
    // 자격이 안 되는 공고는 선택지 대신 한눈에 보이는 표로 모은다. 앞으로 갈 길을 보여 준다.
    const closed = h.list.filter((v) => !eligibility(g, g.clubs[v.club] as Club).ok);
    if (closed.length) {
      blocks.push({ kind: 'text', text: '자격이 모자라 지원할 수 없는 공고:' });
      blocks.push({
        kind: 'stats', rows: closed.map((v) => {
          const club = g.clubs[v.club] as Club;
          return { label: `${club.name}${club.nation ? ' 대표팀' : ''}`, value: `${club.nation ? '국가대표' : LEAGUES[club.league]!.short} · ${eligibility(g, club).why}`, tone: 'bad' as Tone };
        }),
      });
    }
    h.list.forEach((v, i) => {
      const club = g.clubs[v.club] as Club;
      const el = eligibility(g, club);
      if (!el.ok) return;
      const on = v.state === 'applied';
      const group = v.approach ? '먼저 연락해 온 곳' : `구인 공고 · ${COUNTRIES[clubCountry(club)].name}`;
      const label = `${club.name}${club.nation ? ' 대표팀' : ''} ${v.approach ? (on ? '· 면접 가기로 함' : '· 면접 제안') : on ? '· 지원함' : ''}`.trim();
      choices.push({
        id: `v${i}`, club: club.id, label, group,
        detail: `${vacancyLine(g, v)}${el.provisional ? ` · ${el.why}` : ''}`,
        disabled: !on && !v.approach && n >= MAX_APPLY,
        tone: on ? 'primary' : undefined,
      });
    });
    choices.push({ id: 'submit', label: n > 0 ? `지원서 보내기 (${n}곳)` : '지원서 보내기', detail: '고른 곳에 지원서를 내고 결과를 기다린다', disabled: n === 0, tone: 'primary', group: '결정' });
    if (h.stay && g.job) choices.push({ id: 'stay', label: `${(g.clubs[g.job.club] as Club).name}에 남는다`, detail: '지원하지 않고 다음 시즌을 준비한다', group: '결정' });
    if (!h.stay) choices.push({ id: 'idle', label: '올해는 코치로 지낸다', detail: '유소년·아마추어 팀 코치로 한 시즌을 보낸다. 지도 경력은 쌓이지만 명성은 조금 떨어진다', group: '결정' });
    if (!first && g.manager.age >= 45) choices.push({ id: 'retire', label: '지휘봉을 내려놓는다', detail: '커리어를 마치고 기록을 남긴다', tone: 'danger', group: '결정' });
    g.scene = { eyebrow, title: first ? '감독이 되는 길' : '다음 시즌, 어디에서 지휘할까요?', blocks, choices };
    return;
  }
  if (h.step === 'review') {
    blocks.push({ kind: 'text', text: '지원서 결과가 나왔다.' });
    for (const v of h.list.filter((x) => x.state === 'short' || x.state === 'rejected')) {
      const club = g.clubs[v.club] as Club;
      const pass = v.state === 'short';
      blocks.push({
        kind: 'note', tone: pass ? 'good' : 'bad',
        text: `${club.name}${club.nation ? ' 대표팀' : ''}: ${v.approach ? '면접 일정이 잡혔다(먼저 연락해 온 곳).' : pass ? `서류 통과, 면접 대상에 올랐다(서류 ${v.doc}점).` : `서류에서 떨어졌다(서류 ${v.doc}점, 통과선 ${SHORTLIST}점).`}${v.approach ? '' : ` ${v.docNotes.join(' · ')}`}`,
      });
    }
    choices.push({ id: 'next', label: h.list.some((v) => v.state === 'short') ? '면접 보러 간다' : '계속', tone: 'primary' });
    g.scene = { eyebrow, title: '서류 심사 결과', blocks, choices };
    return;
  }
  if (h.step === 'interview' && h.talk) {
    const v = h.list[h.talk.at] as Vacancy;
    const club = g.clubs[v.club] as Club;
    const q = QUESTIONS[h.talk.qs[h.talk.i] as string] as Question;
    blocks.push({ kind: 'text', text: ko`${club.name}${club.nation ? ' 대표팀' : ''} 면접 (${h.talk.i + 1}/${h.talk.qs.length}). ${club.nation ? '기술위원회' : '단장과 이사진'}이 질문한다. 이 구단이 바라는 것: ${v.wants.map((w) => WANTS[w]).join(', ')}.` });
    blocks.push({ kind: 'note', text: `"${q.ask(club)}"`, tone: 'plain' });
    for (const a of q.answers) choices.push({ id: `a:${a.id}`, label: a.text });
    g.scene = { eyebrow, title: '면접', blocks, choices };
    return;
  }
  // decide
  const offers = h.list.map((v, i) => ({ v, i })).filter((x) => x.v.state === 'offer');
  const failed = h.list.filter((v) => v.state === 'failed');
  for (const v of failed) blocks.push({ kind: 'note', text: `${(g.clubs[v.club] as Club).name}: ${v.note}`, tone: 'bad' as Tone });
  for (const { v } of offers) blocks.push({ kind: 'note', text: `${(g.clubs[v.club] as Club).name}: ${v.note}${v.provisional ? ' 조건: 이번 시즌 강습 등록.' : ''}`, tone: 'good' as Tone });
  if (offers.length === 0) blocks.push({ kind: 'text', text: h.stay ? '이번에는 옮길 곳이 없다. 지금 구단에서 다음 시즌을 맞는다.' : '이번에는 감독 자리를 얻지 못했다.' });
  for (const { v, i } of offers) {
    const club = g.clubs[v.club] as Club;
    choices.push({ id: `take${i}`, club: club.id, label: `${club.name}${club.nation ? ' 대표팀' : ''} 감독직 수락`, detail: vacancyLine(g, v), tone: 'primary' });
  }
  if (h.stay && g.job) choices.push({ id: 'stay', label: `${(g.clubs[g.job.club] as Club).name}에 남는다`, detail: offers.length ? '제안을 거절하고 남는다' : '다음 시즌을 준비한다' });
  if (!h.stay) choices.push({ id: 'idle', label: '올해는 코치로 지낸다', detail: '유소년·아마추어 팀 코치로 한 시즌을 보내고 다시 지원한다' });
  g.scene = { eyebrow, title: offers.length ? '제안이 왔다' : '구직 결과', blocks, choices };
}

export type HiringResult = { kind: 'take'; vacancy: Vacancy } | { kind: 'stay' } | { kind: 'idle' } | { kind: 'retire' } | null;

/** 지원자가 고른 행동. 장면 안에서 끝나는 일이면 null을 돌려주고, 커리어가 이어받을 일이면 그 종류를 돌려준다. */
export function actHiring(g: Game, id: string): HiringResult {
  const h = g.hiring as Hiring;
  if (id === 'retire') return { kind: 'retire' };
  if (id === 'stay' && h.stay) return { kind: 'stay' };
  if (id === 'idle' && !h.stay) return { kind: 'idle' };
  if (h.step === 'browse') {
    if (id === 'course') {
      h.notes = [enroll(g)];
      // 자격이 바뀌었으니 조건부 지원 여부를 다시 따진다.
      for (const v of h.list) v.provisional = eligibility(g, g.clubs[v.club] as Club).provisional;
      return null;
    }
    if (id.startsWith('v')) {
      const v = h.list[Number(id.slice(1))];
      if (!v) return null;
      if (v.state === 'applied') v.state = 'open';
      else if (eligibility(g, g.clubs[v.club] as Club).ok && (v.approach || applied(h).filter((x) => !x.approach).length < MAX_APPLY)) v.state = 'applied';
      return null;
    }
    if (id === 'submit' && applied(h).length > 0) {
      for (const v of applied(h)) {
        v.provisional = eligibility(g, g.clubs[v.club] as Club).provisional;
        if (v.approach) {
          v.state = 'short';
          continue;
        }
        screen(g, v);
        v.state = v.doc >= SHORTLIST ? 'short' : 'rejected';
      }
      h.step = 'review';
    }
    return null;
  }
  if (h.step === 'review' && id === 'next') {
    nextInterview(g);
    return null;
  }
  if (h.step === 'interview' && h.talk && id.startsWith('a:')) {
    const v = h.list[h.talk.at] as Vacancy;
    const q = QUESTIONS[h.talk.qs[h.talk.i] as string] as Question;
    const a = q.answers.find((x) => x.id === id.slice(2));
    if (!a) return null;
    v.talk += answerScore(g, v, a);
    v.objective += a.objective ?? 0;
    v.confidence += a.confidence ?? 0;
    if (++h.talk.i >= h.talk.qs.length) {
      v.talk = Math.round(v.talk);
      decide(g, v);
      nextInterview(g);
    }
    return null;
  }
  if (h.step === 'decide' && id.startsWith('take')) {
    const v = h.list[Number(id.slice(4))];
    if (v && v.state === 'offer') return { kind: 'take', vacancy: v };
  }
  return null;
}

/** 다음 면접으로. 남은 면접이 없으면 결정 단계. */
function nextInterview(g: Game): void {
  const h = g.hiring as Hiring;
  const at = h.list.findIndex((v) => v.state === 'short');
  if (at < 0) {
    h.step = 'decide';
    h.talk = null;
    return;
  }
  // 면접 중인 공고는 applied로 표시해 두고, 끝나면 decide가 offer나 failed로 바꾼다.
  const v = h.list[at] as Vacancy;
  v.state = 'applied';
  v.talk = 0;
  h.step = 'interview';
  h.talk = { at, qs: questionsFor(g, v), i: 0 };
}
