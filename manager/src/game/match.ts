// 직접 지휘하는 한 경기. 15분 여섯 토막으로 나눠 진행하고, 토막 사이에 감독이 결정한다.
// 경기 전(대형, 전술) → 30분(전술) → 하프타임(대화, 전술) → 60분(교체) → 75분(태세) → 종료
// 규칙의 근거는 TACTICS.md에 있다.
import { ko } from './josa.ts';
import { STYLES, STYLE_IDS } from './data.ts';
import { HALF, PER_MIN, TICKS, createLive, lineup, reshape, stepLive } from './live.ts';
import type { Entrant, LiveEnv, LiveEvent } from './live.ts';
import { LINE_SPOT, makeDetail } from './player.ts';
import { foreignCount, isForeign, quota } from './contract.ts';
import { baseSide, drilled, skill } from './power.ts';
import { chance, int, pick, poisson, rand, spread } from './rng.ts';
import { effOvr, lineAt, myClub, nameFor, randomNat, stage } from './squad.ts';
import { BASE, ROLES, SHAPES, SHAPE_IDS, advantage, bestCounter, dialEdge, fits, matchup, roleEdge, shapeEdge, tempoCost, usualShape, why } from './tactics.ts';
import type { Block, Choice, Club, Dials, Game, Pos, LeagueId, LiveHow, LiveState, LogLine, MatchState, Player, RoleId, ShapeId, StyleId, Tone, WeatherId } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface MatchSetup {
  kind: 'league' | 'knockout';
  ko: 'cup' | 'conti' | 'finals' | null;
  league: LeagueId | null;
  round: number;
  label: string;
  opp: { id: number; name: string; att: number; def: number; style: StyleId; shape: ShapeId };
  venue: 'home' | 'away' | 'neutral';
}

const WEATHER: Record<WeatherId, { name: string; note: string }> = {
  clear: { name: '맑음', note: '' },
  rain: { name: '비', note: '잔디가 미끄러워 짧은 패스가 끊긴다. 점유에 불리하다.' },
  wind: { name: '강풍', note: '긴 공과 크로스가 바람에 흔들린다. 롱볼과 측면 공격에 불리하다.' },
  heat: { name: '무더위', note: '체력이 평소보다 빨리 떨어진다.' },
};

/** 15분 동안 전술이 쓰는 체력. */
const COST: Record<StyleId, number> = { press: 12, possess: 8, counter: 6, direct: 7, wide: 8, park: 5 };

// 골 장면은 그때 쓰던 전술에서 나온다. 같은 문장이 되풀이되지 않게 여러 벌을 둔다.
const MY_GOAL: Record<StyleId, ((name: string) => string)[]> = {
  press: [
    (n) => ko`상대 진영에서 공을 빼앗았다. ${n}이 그대로 차 넣었다.`,
    (n) => ko`골키퍼의 패스를 ${n}이 가로챘다. 빈 골문이었다.`,
    (n) => ko`세 명이 한꺼번에 달려들어 공을 끊었고, ${n}이 마무리했다.`,
  ],
  possess: [
    (n) => ko`긴 패스 연결 끝에 수비가 벌어졌다. ${n}이 침착하게 마무리했다.`,
    (n) => ko`좌우로 흔들다 중앙이 열렸다. ${n}이 낮게 깔아 찼다.`,
    (n) => ko`2 대 1 패스로 수비 사이를 빠져나간 ${n}이 골키퍼까지 제쳤다.`,
  ],
  counter: [
    (n) => ko`역습. ${n}이 수비 뒷공간을 파고들어 골키퍼를 넘겼다.`,
    (n) => ko`코너킥을 걷어 낸 공이 한 번에 넘어갔다. ${n}이 혼자 달려가 넣었다.`,
    (n) => ko`끊자마자 세 번의 패스. ${n}이 빈 골문에 밀어 넣었다.`,
  ],
  direct: [
    (n) => ko`길게 넘어온 공이 떨어진 자리에서 ${n}이 발리로 때려 넣었다.`,
    (n) => ko`골킥이 그대로 최전방까지 갔다. ${n}이 수비와 몸싸움을 이기고 넣었다.`,
    (n) => ko`머리로 떨궈 준 공을 ${n}이 달려들며 찼다.`,
  ],
  wide: [
    (n) => ko`측면에서 올라온 크로스를 ${n}이 머리로 받아 넣었다.`,
    (n) => ko`풀백이 끝줄까지 파고들어 내준 공을 ${n}이 밀어 넣었다.`,
    (n) => ko`반대편으로 길게 넘긴 크로스. ${n}이 먼 쪽 골대 앞에서 발을 갖다 댔다.`,
  ],
  park: [
    (n) => ko`코너킥. ${n}이 수비 사이에서 솟구쳐 머리로 돌려놓았다.`,
    (n) => ko`먼 거리 프리킥을 ${n}이 직접 찼다. 수비벽을 넘어 구석에 꽂혔다.`,
    (n) => ko`오랜만에 넘어간 하프라인. ${n}이 한 번의 기회를 살렸다.`,
  ],
};

const THEIR_GOAL: Record<StyleId, string[]> = {
  press: ['우리 진영에서 공을 빼앗겼고, 그대로 실점했다.', '골키퍼의 짧은 패스가 끊겼다. 실점.', '상대 압박에 수비수가 넘어졌고, 공은 골문 안에 있었다.'],
  possess: ['상대가 패스로 수비를 끌어낸 뒤 빈 곳을 찔렀다. 실점.', '공을 한참 구경만 했다. 마지막 패스가 수비 사이를 갈랐다.', '좌우로 흔들리던 수비가 결국 벌어졌다. 실점.'],
  counter: ['공격하다 끊긴 공이 한 번에 넘어왔다. 역습에 실점.', '코너킥을 차러 올라간 사이 뒤가 비었다. 실점.', '수비 뒷공간으로 달린 상대 공격수를 아무도 잡지 못했다.'],
  direct: ['긴 공 경합에서 밀렸고, 떨어진 공을 상대가 밀어 넣었다.', '높이 뜬 공을 수비가 놓쳤다. 실점.', '상대 골킥 한 번에 수비 라인이 뚫렸다.'],
  wide: ['크로스를 막지 못했다. 문전에서 헤더를 내줬다.', '측면이 뚫렸고, 낮게 깔린 공이 문전을 지나 골이 됐다.', '먼 쪽 골대에 아무도 없었다. 크로스 한 번에 실점.'],
  park: ['세트피스 한 번에 당했다. 코너킥 실점.', '내려앉은 상대의 프리킥 한 방. 막을 수 없었다.', '상대의 유일한 공격이 골이 됐다.'],
};

const tired = (stamina: number): number => (stamina < 60 ? (60 - stamina) / 10 : 0);
const staminaText = (v: number): string => (v >= 75 ? '쌩쌩하다' : v >= 55 ? '괜찮다' : v >= 40 ? '지쳐 간다' : '바닥났다');

function myMidEdge(g: Game, m: MatchState): number {
  return baseSide(g, g.season.half).mid - (m.oppAtt + m.oppDef) / 2;
}

/** 우리 전술이 상대 전술에 유리한지 한 낱말로. */
function hint(g: Game, m: MatchState, mine: StyleId, theirs: StyleId): string {
  const adv = advantage(mine, theirs, myMidEdge(g, m));
  return adv >= 1.5 ? '유리' : adv <= -1.5 ? '불리' : '비슷';
}

function scorer(g: Game): Player {
  const weights: number[] = g.squad.map((p) => (p.pos === 'FW' ? 6 : p.pos === 'MF' ? 2.5 : p.pos === 'DF' ? 0.6 : 0));
  let at = rand(g) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    at -= weights[i] as number;
    if (at <= 0) return g.squad[i] as Player;
  }
  return g.squad[g.squad.length - 1] as Player;
}

function say(m: MatchState, min: number, text: string, tone: Tone): void {
  m.log.push({ min, text, tone });
}

export interface Ratings {
  att: number;
  def: number;
  oAtt: number;
  oDef: number;
}

/**
 * 지금 이 순간 두 팀의 전력. 전술과 대형의 상성, 팀 지시, 개인 역할, 체력, 교체, 태세, 퇴장, 날씨,
 * 점수 상황이 모두 여기서 더해진다. minute은 경기 시간(분)이다.
 */
export function ratingsNow(g: Game, m: MatchState, minute: number): Ratings {
  const base = baseSide(g, g.season.half);
  const familiar = m.me.style === g.season.style ? 1 : 0.5;
  const edge = myMidEdge(g, m);
  const k = skill(g);
  let att = base.att + BASE[m.me.style].att * k * familiar + drilled(g) * familiar;
  let def = base.def + BASE[m.me.style].def * k * familiar + drilled(g) * familiar;
  let oAtt = m.oppAtt;
  let oDef = m.oppDef;

  const mu = matchup(m.me.style, m.opp.style, edge);
  const se = shapeEdge(m.me.shape, m.opp.shape, m.me.style, m.opp.style);
  const de = dialEdge(m.dials, m.me.style, m.opp.style);
  const level = (m.oppAtt + m.oppDef) / 2;
  const re = roleEdge(
    g.squad.filter((p) => m.roles[p.id] && m.roles[p.id] !== 'base')
      .map((p) => ({ pos: p.pos, role: m.roles[p.id] as RoleId, scale: clamp(1 + (p.ovr + p.temp - level) / 20, 0.5, 1.5) })),
    m.me.style, m.opp.style, m.dials,
  );
  att += mu.att + se.att + de.att + re.att + m.subAtt;
  def += mu.def + se.def + de.def + re.def + m.subDef;
  oAtt += re.oAtt;

  // 체력: 지친 팀은 공수가 함께 무너진다. 수비 쪽이 더 크게 무너진다.
  att -= tired(m.me.stamina);
  def -= tired(m.me.stamina) * 1.2;
  oAtt -= tired(m.opp.stamina);
  oDef -= tired(m.opp.stamina) * 1.2;

  if (minute >= 45) {
    att += m.talk;
    def += m.talk;
  }
  if (m.confusion > 0) {
    // 전술을 바꾼 직후에는 선수들이 헷갈린다. 전술 능력치가 높을수록 덜하다.
    const mess = 1.5 * (1 - g.manager.attrs.tactics / 25);
    att -= mess;
    def -= mess;
  }
  if (m.me.push === 1) {
    att += 3;
    def -= 2.5;
  } else if (m.me.push === -1) {
    def += 3;
    att -= 2.5;
  }
  if (m.opp.push === 1) {
    oAtt += 3;
    oDef -= 2.5;
  } else if (m.opp.push === -1) {
    oDef += 3;
    oAtt -= 2.5;
  }
  // 60분 이후에는 뒤진 쪽이 득점에서 유리해진다.
  const lead = m.score[0] - m.score[1];
  if (minute >= 60 && lead < 0) att += 0.8;
  if (minute >= 60 && lead > 0) oAtt += 0.8;
  if (m.me.red) {
    att -= 2.5;
    def -= 3;
  }
  if (m.opp.red) {
    oAtt -= 2.5;
    oDef -= 3;
  }
  if (m.weather === 'rain') {
    if (m.me.style === 'possess') att -= 1.2;
    if (m.opp.style === 'possess') oAtt -= 1.2;
  } else if (m.weather === 'wind') {
    if (m.me.style === 'direct' || m.me.style === 'wide') att -= 1;
    if (m.opp.style === 'direct' || m.opp.style === 'wide') oAtt -= 1;
  }
  return { att, def, oAtt, oDef };
}

/** 15분 한 토막을 치른다. */
function playSegment(g: Game, m: MatchState): void {
  const i = m.seg;
  const from = i * 15;
  const edge = myMidEdge(g, m);
  const { att, def, oAtt, oDef } = ratingsNow(g, m, from);
  if (m.confusion > 0) m.confusion--;

  // 마지막 15분에는 골이 더 많이 난다. 첫 15분은 탐색전이다.
  const tempo = (i === 5 ? 1.15 : i === 0 ? 0.9 : 1) / 6;
  const mine = m.venue === 'home' ? 1.5 : m.venue === 'away' ? 1.15 : 1.3;
  const theirs = m.venue === 'home' ? 1.15 : m.venue === 'away' ? 1.5 : 1.3;
  const scored = poisson(g, clamp(mine * Math.exp((att - oDef) * 0.05), 0.15, 5) * tempo);
  const conceded = poisson(g, clamp(theirs * Math.exp((oAtt - def) * 0.05), 0.15, 5) * tempo);

  const moments: LogLine[] = [];
  for (let n = 0; n < scored; n++) moments.push({ min: from + int(g, 1, 15), text: pick(g, MY_GOAL[m.me.style])(scorer(g).name), tone: 'good' });
  for (let n = 0; n < conceded; n++) moments.push({ min: from + int(g, 1, 15), text: pick(g, THEIR_GOAL[m.opp.style]), tone: 'bad' });
  m.score = [m.score[0] + scored, m.score[1] + conceded];

  if (moments.length === 0) {
    // 골이 없으면 흐름을 한 줄로 전한다. 전술 구도가 뚜렷하면 그 이유를 말한다.
    const reason = why(m.me.style, m.opp.style, edge);
    const flow = att - oDef - (oAtt - def);
    if (reason) moments.push({ min: from + 15, text: `${reason.text}.`, tone: reason.good ? 'good' : 'bad' });
    else if (flow > 3) moments.push({ min: from + 15, text: '우리가 몰아붙였지만 마지막 패스가 맞지 않았다.', tone: 'plain' });
    else if (flow < -3) moments.push({ min: from + 15, text: '밀리는 시간이 길었다. 골키퍼가 두 번 막아 냈다.', tone: 'plain' });
    else moments.push({ min: from + 15, text: '팽팽한 공방이 이어졌다.', tone: 'plain' });
  }
  // 퇴장. 전방 압박은 거친 파울이 조금 더 잦다.
  if (!m.me.red && chance(g, 0.012 + (m.me.style === 'press' ? 0.008 : 0))) {
    m.me.red = true;
    moments.push({ min: from + int(g, 1, 15), text: '거친 태클에 주심이 레드카드를 꺼냈다. 남은 시간을 열 명으로 버텨야 한다.', tone: 'bad' });
  }
  if (!m.opp.red && chance(g, 0.015)) {
    m.opp.red = true;
    moments.push({ min: from + int(g, 1, 15), text: '상대 선수가 두 번째 경고로 퇴장당했다. 수적 우위다.', tone: 'good' });
  }
  moments.sort((a, b) => a.min - b.min);
  m.log.push(...moments);

  const hot = m.weather === 'heat' ? 1.3 : 1;
  m.me.stamina = clamp(m.me.stamina - COST[m.me.style] * hot * tempoCost(m.dials) * (g.season.focus === 'fitness' ? 0.8 : 1), 0, 100);
  m.opp.stamina = clamp(m.opp.stamina - COST[m.opp.style] * hot, 0, 100);
  m.seg++;
}

/** 상대 감독의 결정. 우리 전술에 밀리면 맞춤 전술로 바꾸고, 막판에는 점수에 따라 태세를 바꾼다. */
function opponentMoves(g: Game, m: MatchState): void {
  const minute = m.seg * 15;
  const lead = m.score[1] - m.score[0];
  if (minute >= 75) {
    m.opp.push = lead < 0 && chance(g, 0.8) ? 1 : lead > 0 && chance(g, 0.7) ? -1 : 0;
    if (m.opp.push === 1) say(m, minute, '상대가 수비수를 빼고 공격수를 넣었다. 총공세다.', 'plain');
    if (m.opp.push === -1) say(m, minute, '상대가 수비수를 한 명 더 넣고 내려앉는다.', 'plain');
    return;
  }
  const edge = myMidEdge(g, m);
  const adv = advantage(m.me.style, m.opp.style, edge);
  let p = m.oppIq * (adv > 1.5 ? 0.7 : adv > 0 ? 0.3 : 0.08);
  if (minute === 45 && lead < 0) p += 0.25;
  if (!chance(g, p)) return;
  const next = lead > 0 && minute >= 60 && chance(g, 0.5) ? 'counter' : bestCounter(m.me.style, edge, lead < 0 ? ['park'] : []);
  if (next === m.opp.style) return;
  m.opp.style = next;
  if (minute >= 45 && chance(g, 0.4)) m.opp.shape = usualShape(next, int(g, 0, 5));
  m.read = chance(g, readChance(g));
  say(m, minute, m.read ? ko`상대 벤치가 움직였다. ${STYLES[next].name}으로 바꿨다.` : '상대의 움직임이 달라졌다. 무엇을 바꿨는지는 아직 읽히지 않는다.', 'plain');
}

const readChance = (g: Game): number => clamp(0.45 + g.manager.attrs.eye * 0.02 + g.manager.attrs.tactics * 0.015, 0.3, 0.97);

export function beginMatch(g: Game, setup: MatchSetup): void {
  const level = (setup.opp.att + setup.opp.def) / 2;
  const iq = clamp(0.35 + (level - 30) / 100, 0.3, 0.9);
  // 수준 높은 상대일수록 우리를 분석해 평소와 다른 전술을 들고 나온다.
  const surprise = chance(g, 0.1 + iq * 0.25);
  const style = surprise ? bestCounter(g.season.style) : setup.opp.style;
  const weather: WeatherId = chance(g, 0.6) ? 'clear' : pick(g, ['rain', 'wind', 'heat'] as WeatherId[]);
  g.match = {
    kind: setup.kind, ko: setup.ko, league: setup.league, round: setup.round, label: setup.label,
    oppId: setup.opp.id, oppName: setup.opp.name, oppAtt: setup.opp.att, oppDef: setup.opp.def, oppUsual: setup.opp.style, oppIq: iq,
    venue: setup.venue, weather, step: 'shape', seg: 0, score: [0, 0],
    me: { style: g.season.style, shape: usualShape(g.season.style, 0), stamina: 100, push: 0, red: false },
    opp: { style, shape: surprise ? usualShape(style, int(g, 0, 5)) : setup.opp.shape, stamina: 100, push: 0, red: false },
    read: false, subs: 3, talk: 0, confusion: 0, subAtt: 0, subDef: 0, log: [], logStart: 0, pens: null, auto: false,
    dials: { line: 0, width: 0, tempo: 0, overlap: false }, roles: {}, live: null,
  };
  g.phase = 'match';
  scene(g);
}

function scoreBlock(g: Game, m: MatchState): Block {
  const mine = (g.clubs[g.job!.club] as { name: string }).name;
  const home = m.venue !== 'away';
  return {
    kind: 'score', home: home ? mine : m.oppName, away: home ? m.oppName : mine, clubs: home ? [g.job!.club, m.oppId] : [m.oppId, g.job!.club],
    score: home ? [m.score[0], m.score[1]] : [m.score[1], m.score[0]], mine: home ? 0 : 1,
    minute: m.seg === 0 ? '경기 전' : m.seg === 3 && m.step !== 'm60' ? '전반 종료' : m.seg >= 6 ? '경기 종료' : `${m.seg * 15}분`,
  };
}

function statusBlock(m: MatchState): Block {
  return {
    kind: 'stats', rows: [
      { label: '우리', value: `${STYLES[m.me.style].name} · ${SHAPES[m.me.shape].name}` },
      { label: '상대', value: `${m.read ? STYLES[m.opp.style].name : '전술 미상'} · ${SHAPES[m.opp.shape].name}` },
      { label: '우리 체력', value: `${Math.round(m.me.stamina)} · ${staminaText(m.me.stamina)}`, tone: m.me.stamina < 45 ? 'bad' : 'plain' },
      { label: '상대 체력', value: staminaText(m.opp.stamina) },
      { label: '남은 교체', value: `${m.subs}명` },
    ],
  };
}

function readBlock(g: Game, m: MatchState): Block {
  if (!m.read) return { kind: 'note', text: '상대의 의도가 뚜렷이 읽히지 않는다. 대형만 보인다.', tone: 'plain' };
  const reason = why(m.me.style, m.opp.style, myMidEdge(g, m));
  return {
    kind: 'note', tone: reason ? (reason.good ? 'good' : 'bad') : 'plain',
    text: ko`상대는 지금 ${STYLES[m.opp.style].name}을 쓴다.${reason ? ` ${reason.text}.` : ' 어느 쪽도 뚜렷이 앞서지 못한다.'}`,
  };
}

/** 전술을 고르는 선택지들. 상대 전술이 읽히면 유불리를 함께 적는다. */
function styleChoices(g: Game, m: MatchState, against: StyleId | null, keepLabel: string | null): Choice[] {
  const list: Choice[] = [];
  if (keepLabel) list.push({ id: 'keep', label: keepLabel, detail: against ? `지금 전술 · 상대 전술에 ${hint(g, m, m.me.style, against)}` : '지금 전술을 유지한다', tone: 'primary' });
  for (const id of STYLE_IDS) {
    if (keepLabel && id === m.me.style) continue;
    const notes = [STYLES[id].desc];
    if (id === g.season.style) notes.push('몸에 밴 전술');
    if (fits(id, m.me.shape)) notes.push(`${SHAPES[m.me.shape].name}과 잘 맞음`);
    if (against) notes.push(`상대 전술에 ${hint(g, m, id, against)}`);
    list.push({ id, label: STYLES[id].name, detail: notes.join(' · ') });
  }
  return list;
}

/** 지금 단계의 장면을 만든다. */
function scene(g: Game): void {
  const m = g.match as MatchState;
  const eyebrow = m.label;
  const recent: Block[] = m.log.length > m.logStart ? [{ kind: 'log', items: m.log.slice(m.logStart) }] : [];
  if (m.step === 'shape') {
    const where = m.venue === 'home' ? '홈 경기' : m.venue === 'away' ? '원정 경기' : '중립 구장';
    const weather = WEATHER[m.weather];
    g.scene = {
      eyebrow, title: ko`${m.oppName}과 맞붙는다`,
      blocks: [
        { kind: 'text', text: ko`${where}, 날씨는 ${weather.name}.${weather.note ? ` ${weather.note}` : ''} 분석팀 보고에 따르면 상대는 평소 ${STYLES[m.oppUsual].name}을 쓰고, 오늘은 ${SHAPES[m.opp.shape].name}으로 나왔다. ${SHAPES[m.opp.shape].desc}.` },
        { kind: 'text', text: '먼저 대형을 고른다. 경기 중에는 교체로만 바꿀 수 있다.' },
      ],
      choices: [
        ...SHAPE_IDS.map((id): Choice => {
          const a = SHAPES[id];
          const b = SHAPES[m.opp.shape];
          const notes = [a.desc];
          if (a.cm !== b.cm) notes.push(a.cm > b.cm ? '중원 수적 우위' : '중원 수적 열세');
          if (a.cb - b.cf >= 2) notes.push('문전에 수비 여유');
          if (a.cb - b.cf <= 0) notes.push('문전 일대일');
          if (fits(g.season.style, id)) notes.push(`${STYLES[g.season.style].name}과 잘 맞음`);
          return { id, label: a.name, detail: notes.join(' · ') };
        }),
        { id: 'auto', label: '수석 코치에게 맡긴다', detail: '이 경기를 지켜보기만 한다. 몸에 밴 전술로 자동 진행된다' },
      ],
    };
  } else if (m.step === 'plan') {
    g.scene = {
      eyebrow, title: '어떤 축구로 나설까요?',
      blocks: [{ kind: 'text', text: ko`대형은 ${SHAPES[m.me.shape].name}. 몸에 밴 전술은 ${STYLES[g.season.style].name}이고, 다른 전술은 전술 완성도의 절반만 나온다. 아래 유불리는 상대의 평소 전술 기준이다. 상대가 오늘 다르게 나올 수도 있다.` }],
      choices: styleChoices(g, m, m.oppUsual, null),
    };
  } else if (m.step === 'mode') {
    g.scene = {
      eyebrow, title: '어떻게 지휘할까요?',
      blocks: [
        ...recent,
        { kind: 'text', text: '경기를 보면서 지휘하면 언제든 멈추고 전술, 수비 라인과 템포 같은 팀 지시, 선수 개인의 역할, 교체를 바꿀 수 있다. 빠른 진행은 30분, 하프타임, 60분, 75분에만 결정한다.' },
      ],
      choices: [
        { id: 'live', label: '경기를 보면서 지휘한다', detail: '위에서 본 경기장 · 3~5분', tone: 'primary' },
        { id: 'text', label: '빠르게 진행한다', detail: '글로 진행 · 1분' },
      ],
    };
  } else if (m.step === 'live') {
    g.scene = {
      eyebrow, title: '경기 중',
      blocks: [scoreBlock(g, m)],
      choices: [{ id: 'skip', label: '남은 경기를 건너뛴다', detail: '지금 지시 그대로 끝까지 진행한다' }],
    };
  } else if (m.step === 'm30' || m.step === 'ht') {
    g.scene = {
      eyebrow, title: m.step === 'm30' ? '30분, 벤치의 판단' : '후반은 어떻게 갈까요?',
      blocks: [scoreBlock(g, m), ...recent, readBlock(g, m), statusBlock(m), { kind: 'text', text: '전술을 바꾸면 15분 동안 혼선이 생긴다.' }],
      choices: styleChoices(g, m, m.read ? m.opp.style : null, ko`${STYLES[m.me.style].name}을 그대로 간다`),
    };
  } else if (m.step === 'talk') {
    const lead = m.score[0] - m.score[1];
    g.scene = {
      eyebrow, title: '하프타임 라커룸',
      blocks: [scoreBlock(g, m), ...recent, { kind: 'text', text: lead > 0 ? '앞선 채로 들어왔다. 선수들이 감독을 본다.' : lead < 0 ? '뒤진 채로 들어왔다. 라커룸이 조용하다.' : '팽팽한 채로 들어왔다. 선수들이 감독을 본다.' }],
      choices: [
        { id: 'praise', label: '잘하고 있다고 다독인다', detail: '장악력 판정. 비기거나 한 골 뒤질 때 잘 통한다' },
        { id: 'blast', label: '물병을 걷어찬다', detail: '장악력 판정. 통하면 크게 살아나고, 안 통하면 얼어붙는다' },
        { id: 'calm', label: '후반 계획만 짚는다', detail: '확실한 작은 효과. 전술 혼선이 줄어든다' },
      ],
    };
  } else if (m.step === 'm60') {
    const trailing = m.score[0] < m.score[1];
    g.scene = {
      eyebrow, title: '60분, 교체 카드',
      blocks: [scoreBlock(g, m), ...recent, readBlock(g, m), statusBlock(m), { kind: 'text', text: trailing ? '뒤지고 있다. 교체는 지금이 가장 효과가 크다.' : '교체로 흐름을 바꾸거나 지킬 수 있다.' }],
      choices: [
        { id: 'fw', label: '공격수를 넣는다', detail: `공격이 오르고 수비가 내려간다${trailing ? ' · 뒤질 때 효과가 더 크다' : ''}` },
        { id: 'mf', label: '미드필더를 넣는다', detail: '공수가 조금씩 오르고 체력이 조금 돌아온다' },
        { id: 'df', label: '수비수를 넣는다', detail: '수비가 오르고 공격이 내려간다' },
        { id: 'legs', label: '지친 선수 둘을 바꾼다', detail: '교체 두 장으로 체력을 크게 되찾는다', disabled: m.subs < 2 },
        { id: 'none', label: '교체 없이 간다', detail: '카드를 아낀다' },
      ],
    };
  } else if (m.step === 'm75') {
    g.scene = {
      eyebrow, title: '75분, 마지막 15분',
      blocks: [scoreBlock(g, m), ...recent, readBlock(g, m), statusBlock(m), { kind: 'text', text: '골이 가장 많이 나는 시간이다.' }],
      choices: [
        { id: 'allout', label: '총공세', detail: '수비수를 빼고 올린다. 넣거나 먹거나', disabled: m.subs < 1 },
        { id: 'hold', label: '이대로 간다', detail: '균형을 지킨다' },
        { id: 'lock', label: '잠근다', detail: '수비수를 넣고 내려앉는다. 골은 포기한다', disabled: m.subs < 1 },
      ],
    };
  } else {
    const [a, b] = m.score;
    const verdict = m.pens ? (m.pens === 'won' ? '승부차기 끝에 이겼다' : '승부차기에서 졌다') : a > b ? '이겼다' : a < b ? '졌다' : '비겼다';
    const blocks: Block[] = [scoreBlock(g, m)];
    if (m.auto) blocks.push({ kind: 'note', text: '수석 코치가 지휘했다.', tone: 'plain' });
    // 끝난 뒤에는 경기 전체를 처음부터 돌아본다.
    blocks.push({ kind: 'log', items: m.log });
    if (m.pens) blocks.push({ kind: 'note', text: m.pens === 'won' ? '120분으로도 가리지 못했다. 승부차기에서 골키퍼가 두 개를 막았다.' : '120분으로도 가리지 못했다. 승부차기 다섯 번째 키커의 공이 골대를 넘어갔다.', tone: m.pens === 'won' ? 'good' : 'bad' });
    g.scene = { eyebrow, title: `${a}:${b}, ${verdict}`, blocks, choices: [{ id: 'next', label: '계속', tone: 'primary' }] };
  }
}

/** 리더십 판정. bonus가 클수록 잘 통한다. */
const sway = (g: Game, bonus: number): boolean => chance(g, clamp(0.2 + g.manager.attrs.lead * 0.04 + bonus, 0.1, 0.95));

function finish(g: Game, m: MatchState): void {
  if (m.kind === 'knockout' && m.score[0] === m.score[1]) {
    const nerve = g.squad.filter((p) => p.trait === 'clutch').length;
    m.pens = chance(g, clamp(0.5 + (g.manager.attrs.lead - 8) * 0.012 + nerve * 0.03, 0.3, 0.75)) ? 'won' : 'lost';
  }
  m.step = 'done';
}

/** 하프타임 라커룸 대화. 리더십 판정에 따라 후반 전력이 오르내린다. */
function teamTalk(g: Game, m: MatchState, id: string): void {
  const lead = m.score[0] - m.score[1];
  if (id === 'praise') {
    m.talk = sway(g, lead === 0 || lead === -1 ? 0.2 : 0) ? 1 : 0;
    say(m, 45, m.talk > 0 ? '다독이는 말에 선수들의 어깨가 펴졌다.' : '좋은 말이었지만 라커룸 분위기는 그대로였다.', m.talk > 0 ? 'good' : 'plain');
  } else if (id === 'blast') {
    m.talk = sway(g, lead < 0 ? 0.1 : -0.2) ? 1.8 : -1;
    say(m, 45, m.talk > 0 ? '물병이 벽에 부딪혔다. 선수들의 눈빛이 달라졌다.' : '고함이 지나쳤다. 선수들이 고개를 숙인 채 나갔다.', m.talk > 0 ? 'good' : 'bad');
  } else {
    m.talk = 0.4;
    say(m, 45, '전술판 앞에서 후반 계획을 다시 짚었다.', 'plain');
  }
}

/** 수석 코치가 처음부터 끝까지 지휘한다. */
function autoplay(g: Game, m: MatchState): void {
  m.auto = true;
  m.read = false;
  while (m.seg < 6) {
    if (m.seg === 5) {
      const lead = m.score[0] - m.score[1];
      m.me.push = lead < 0 ? 1 : lead > 0 ? -1 : 0;
    }
    if (m.seg >= 2) opponentMoves(g, m);
    playSegment(g, m);
  }
  finish(g, m);
}

/**
 * 경기 중 선택을 처리한다. 경기가 끝나고 '계속'을 누르면 true를 돌려준다.
 * 그때 결과는 game.match에 남아 있다.
 */
export function actMatch(g: Game, id: string): boolean {
  const m = g.match as MatchState;
  m.logStart = m.log.length;
  switch (m.step) {
    case 'shape':
      if (id === 'auto') {
        autoplay(g, m);
        break;
      }
      m.me.shape = id as ShapeId;
      m.step = 'plan';
      break;
    case 'plan':
      m.me.style = id as StyleId;
      m.read = chance(g, readChance(g));
      if (m.opp.style !== m.oppUsual && m.read) say(m, 0, ko`킥오프 직후 알아챘다. 상대가 평소와 달리 ${STYLES[m.opp.style].name}으로 나왔다. 우리를 분석하고 온 것이다.`, 'plain');
      m.step = 'mode';
      break;
    case 'mode':
      if (id === 'live') {
        startLive(g, m);
        m.step = 'live';
      } else if (id === 'text') {
        playSegment(g, m);
        playSegment(g, m);
        opponentMoves(g, m);
        m.step = 'm30';
      } else return false;
      break;
    case 'live':
      if (id !== 'skip') return false;
      // 지금 지시 그대로 끝까지 돌린다. 하프타임 대화는 계획만 짚는 것으로 한다.
      for (let guard = 0; m.step === 'live' && guard < TICKS + 50; guard++) {
        if (m.live && m.live.halfTimeDone && !m.live.talked) liveCommand(g, 'talk:calm');
        liveTick(g);
      }
      return false;
    case 'm30':
    case 'ht':
      if (id !== 'keep') {
        m.me.style = id as StyleId;
        // 하프타임에 계획을 차분히 짚어 두었다면 혼선 없이 바꾼다.
        m.confusion = m.confusion < 0 ? 0 : 1;
      } else if (m.confusion < 0) {
        m.confusion = 0;
      }
      if (m.step === 'm30') {
        playSegment(g, m);
        m.step = 'talk';
      } else {
        opponentMoves(g, m);
        playSegment(g, m);
        opponentMoves(g, m);
        m.read = m.read || chance(g, readChance(g));
        m.step = 'm60';
      }
      break;
    case 'talk':
      teamTalk(g, m, id);
      m.read = m.read || chance(g, readChance(g));
      m.step = 'ht';
      if (id === 'calm') m.confusion = -1;
      break;
    case 'm60': {
      const trailing = m.score[0] < m.score[1];
      if (id === 'fw') {
        m.subAtt += trailing ? 2.2 : 1.5;
        m.subDef -= 1;
        m.subs--;
        say(m, 60, '공격수를 넣었다.', 'plain');
      } else if (id === 'mf') {
        m.subAtt += 0.6;
        m.subDef += 0.6;
        m.me.stamina = clamp(m.me.stamina + 8, 0, 100);
        m.subs--;
        say(m, 60, '미드필더를 넣어 중원에 힘을 보탰다.', 'plain');
      } else if (id === 'df') {
        m.subDef += 1.5;
        m.subAtt -= 1;
        m.subs--;
        say(m, 60, '수비수를 넣었다.', 'plain');
      } else if (id === 'legs') {
        m.me.stamina = clamp(m.me.stamina + 22, 0, 100);
        m.subs -= 2;
        say(m, 60, '지친 선수 둘을 바꿨다. 다리가 다시 움직인다.', 'plain');
      }
      playSegment(g, m);
      opponentMoves(g, m);
      m.read = m.read || chance(g, readChance(g));
      m.step = 'm75';
      break;
    }
    case 'm75':
      m.me.push = id === 'allout' ? 1 : id === 'lock' ? -1 : 0;
      if (id !== 'hold') m.subs--;
      // 늦은 교체는 60분 교체보다 효과가 작다. 그래도 지친 다리는 조금 살아난다.
      if (id !== 'hold') m.me.stamina = clamp(m.me.stamina + 5, 0, 100);
      playSegment(g, m);
      finish(g, m);
      break;
    case 'done':
      return true;
  }
  scene(g);
  return false;
}

// ---------- 실시간 경기 ----------
// 선수들의 움직임과 판정은 live.ts가, 전력 계산과 감독의 지시와 기록은 여기서 맡는다.

const NEUTRAL: Dials = { line: 0, width: 0, tempo: 0, overlap: false };

const LIVE_GOAL: Record<LiveHow, ((name: string) => string)[]> = {
  pass: [(n) => ko`패스 연결 끝에 수비가 벌어졌다. ${n}이 침착하게 마무리했다.`, (n) => ko`수비 사이로 들어온 패스를 ${n}이 낮게 깔아 찼다.`],
  long: [(n) => ko`길게 넘어온 공을 ${n}이 잡아 그대로 때려 넣었다.`, (n) => ko`한 번에 넘어온 긴 패스. ${n}이 수비와 몸싸움을 이기고 넣었다.`],
  cross: [(n) => ko`측면에서 올라온 크로스를 ${n}이 머리로 받아 넣었다.`, (n) => ko`크로스가 올라왔고, ${n}이 수비 사이에서 솟구쳤다.`],
  press: [(n) => ko`상대 진영에서 공을 빼앗았다. ${n}이 그대로 차 넣었다.`, (n) => ko`압박에 상대가 공을 흘렸고, ${n}이 놓치지 않았다.`],
  counter: [(n) => ko`역습. ${n}이 수비 뒷공간을 파고들어 골키퍼를 넘겼다.`, (n) => ko`끊자마자 앞으로 나갔다. ${n}이 빈 곳에 밀어 넣었다.`],
  set: [(n) => ko`세트피스. ${n}이 골망을 흔들었다.`, (n) => ko`멈춘 공 한 번에 승부가 났다. ${n}의 골.`],
  pen: [(n) => ko`페널티킥. ${n}이 침착하게 성공시켰다.`],
};

const LIVE_CONCEDED: Record<LiveHow, string[]> = {
  pass: ['상대가 패스로 수비를 끌어낸 뒤 빈 곳을 찔렀다. 실점.', '마지막 패스가 수비 사이를 갈랐다. 실점.'],
  long: ['긴 공 한 번에 수비 라인이 뚫렸다. 실점.', '높이 뜬 공을 수비가 놓쳤다. 실점.'],
  cross: ['크로스를 막지 못했다. 문전에서 헤더를 내줬다.', '먼 쪽 골대에 아무도 없었다. 크로스 한 번에 실점.'],
  press: ['우리 진영에서 공을 빼앗겼고, 그대로 실점했다.', '상대 압박에 공을 흘렸다. 실점.'],
  counter: ['공격하다 끊긴 공이 한 번에 넘어왔다. 역습에 실점.', '수비 뒷공간으로 달린 상대 공격수를 아무도 잡지 못했다.'],
  set: ['세트피스 한 번에 당했다. 실점.', '멈춘 공을 막지 못했다. 실점.'],
  pen: ['페널티킥을 내줬고, 골키퍼는 반대로 뛰었다.'],
};

/** 실시간 경기를 시작한다. 주전 일곱 명에 후보 넷을 보태 열한 명을 세우고, 상대 열한 명을 만든다. */
function startLive(g: Game, m: MatchState): void {
  const club = myClub(g);
  const { where } = stage(g);
  const depth = g.depth + g.season.depthMod;
  // 선발은 감독이 정한 자리(줄)에서 뛴다. 자기 포지션이 아니면 그 줄의 대표 자리에 서고 OVR이 깎인다.
  const keys: Entrant[] = g.squad.map((p, i) => {
    const line = lineAt(i);
    return { name: p.name, pos: line, ovr: effOvr(p, line), key: p.id, spot: p.pos === line ? p.spot : LINE_SPOT[line], foot: p.foot, dev: p.dev, no: p.no };
  });
  // 남는 네 자리는 후보 명단에서 그 자리에 맞는 선수부터 쓴다. 외국인 출전 한도를 넘지 않게 한다. 후보가 모자라면 2군 선수가 뛴다.
  const limit = quota(g).pitch;
  let foreign = foreignCount(g, g.squad);
  const bench = [...g.reserves].filter((r) => !r.loan || r.loan.dir === 'in').sort((a, b) => b.ovr - a.ovr);
  const mine = lineup(m.me.shape, keys, (pos, spot) => {
    const ok = (r: Player): boolean => limit === null || !isForeign(g, r) || foreign < limit;
    const pickIdx = [bench.findIndex((r) => r.spot === spot && ok(r)), bench.findIndex((r) => r.pos === pos && ok(r))].find((i) => i >= 0) ?? -1;
    if (pickIdx >= 0 && isForeign(g, bench[pickIdx] as Player)) foreign++;
    if (pickIdx >= 0) {
      const r = bench.splice(pickIdx, 1)[0] as Player;
      return { name: r.name, pos: r.pos, ovr: r.ovr + r.temp, key: -1, spot: r.spot, foot: r.foot, dev: r.dev, no: r.no };
    }
    const d = makeDetail(g, pos, spot);
    return { name: nameFor(g, club.nation ? '대한민국' : randomNat(g, where)), pos, ovr: Math.round(depth + spread(g, -2, 2)), key: -1, ...d };
  });
  // 상대 선수 이름: 대표팀은 그 나라 이름, 구단은 그 구단 리그의 국적 비율대로. 이름만 빌린 대륙 대회 상대는 우리 리그 기준.
  const opp = g.clubs[m.oppId] as Club | undefined;
  const oppNat = (): string => (opp?.nation ? opp.name : randomNat(g, opp && !opp.nation ? opp.league : where));
  const theirs = lineup(m.opp.shape, [], (pos, spot) => {
    const base = pos === 'FW' ? m.oppAtt + 1 : pos === 'MF' ? (m.oppAtt + m.oppDef) / 2 : m.oppDef + 1;
    const d = makeDetail(g, pos, spot);
    return { name: nameFor(g, oppNat()), pos, ovr: Math.round(base + spread(g, -4, 4)), key: -1, ...d };
  });
  m.live = createLive(mine, theirs, [m.me.shape, m.opp.shape]);
}

/** 교체로 들어갈 후보. 경기장에 없는 같은 포지션 후보 중 가장 좋은 선수, 없으면 2군 선수. */
function bench(g: Game, L: LiveState, pos: Pos, fallback: string): string {
  const used = new Set([...L.teams[0].players.map((p) => p.name), ...(L.subbed ?? [])]);
  const r = g.reserves.filter((p) => p.pos === pos && !used.has(p.name)).sort((a, b) => b.ovr - a.ovr)[0];
  if (!r) return `2군 ${fallback}`;
  (L.subbed ??= []).push(r.name);
  call(L, `교체: ${r.no}번 ${r.name} 투입`, 'plain');
  return `${r.no}번 ${r.name}`;
}

/** 중계 자막. 최근 여섯 줄만 남긴다. */
function call(L: LiveState, text: string, tone: Tone): void {
  L.calls.push({ tick: L.tick, text, tone });
  if (L.calls.length > 6) L.calls.shift();
}

/** "9번 배규력" 또는 "상대 9번 실바". */
function who(L: LiveState, t: 0 | 1, i: number): string {
  const p = L.teams[t].players[i];
  return p ? `${t === 1 ? '상대 ' : ''}${p.n}번 ${p.name}` : '';
}

/** 골과 퇴장 말고도 경기 흐름을 자막으로 전한다. */
function narrate(L: LiveState, events: LiveEvent[]): void {
  const shotCorner = events.some((e) => e.kind === 'shot' && e.result === 'corner');
  for (const e of events) {
    if (e.kind === 'goal') call(L, ko`골! ${who(L, e.team, e.by)}의 득점`, e.team === 0 ? 'good' : 'bad');
    else if (e.kind === 'shot') {
      const by = who(L, e.team, e.by);
      if (e.result === 'save') call(L, e.xg >= 0.25 ? ko`결정적 기회! ${by}의 슈팅을 골키퍼가 막아 냈다` : ko`${by}의 슈팅, 골키퍼 정면`, 'plain');
      else if (e.result === 'corner') call(L, ko`${by}의 슈팅이 수비 몸에 맞고 코너킥`, 'plain');
      else call(L, e.xg >= 0.25 ? ko`${by}, 결정적 기회를 놓쳤다` : ko`${by}의 슈팅이 골문을 벗어났다`, 'plain');
    } else if (e.kind === 'foul') {
      const victim = who(L, (1 - e.team) as 0 | 1, e.victim);
      if (e.pen) call(L, ko`페널티킥! ${victim}이 박스 안에서 넘어졌다`, e.team === 1 ? 'good' : 'bad');
      else call(L, ko`${who(L, e.team, e.by)}의 파울. ${victim}이 프리킥을 얻었다`, 'plain');
    } else if (e.kind === 'offside') call(L, ko`${who(L, e.team, e.by)} 오프사이드`, 'plain');
    else if (e.kind === 'steal') call(L, ko`${who(L, e.team, e.by)}이 높은 곳에서 공을 빼앗았다`, e.team === 0 ? 'good' : 'plain');
    else if (e.kind === 'corner' && !shotCorner) call(L, e.team === 0 ? '우리 코너킥' : '상대 코너킥', 'plain');
    else if (e.kind === 'red') call(L, ko`레드카드! ${who(L, e.team, e.by)} 퇴장`, e.team === 0 ? 'bad' : 'good');
    else if (e.kind === 'half') call(L, '전반 종료', 'plain');
    else if (e.kind === 'full') call(L, '경기 종료', 'plain');
  }
}

function liveEnv(g: Game, m: MatchState, L: LiveState): LiveEnv {
  // 퇴장의 효과는 열 명으로 뛰는 것 자체에서 나오므로, 전력에서는 다시 빼지 않는다.
  const red = [m.me.red, m.opp.red];
  m.me.red = false;
  m.opp.red = false;
  const r = ratingsNow(g, m, L.tick / PER_MIN);
  m.me.red = red[0] as boolean;
  m.opp.red = red[1] as boolean;
  const mine = m.venue === 'home' ? 1.5 : m.venue === 'away' ? 1.15 : 1.3;
  const theirs = m.venue === 'home' ? 1.15 : m.venue === 'away' ? 1.5 : 1.3;
  const roles: Record<number, RoleId> = {};
  L.teams[0].players.forEach((p, i) => {
    const role = p.key >= 0 ? m.roles[p.key] : undefined;
    if (role && role !== 'base') roles[i] = role;
  });
  return {
    sides: [
      { style: m.me.style, shape: m.me.shape, push: m.me.push, red: m.me.red, tired: m.me.stamina < 45, dials: m.dials, roles, edge: r.att - r.oDef, venue: mine / 1.3 },
      { style: m.opp.style, shape: m.opp.shape, push: m.opp.push, red: m.opp.red, tired: m.opp.stamina < 45, dials: NEUTRAL, roles: {}, edge: r.oAtt - r.def, venue: theirs / 1.3 },
    ],
  };
}

/** 상대 감독이 움직인다. 대형을 바꿨으면 경기장의 선수들도 자리를 옮긴다. */
function benchMoves(g: Game, m: MatchState, L: LiveState): void {
  const shape = m.opp.shape;
  opponentMoves(g, m);
  m.read = m.read || chance(g, readChance(g));
  if (m.opp.shape !== shape) reshape(L.teams[1], m.opp.shape);
}

/** 실시간 경기를 한 틱 진행한다. 화면이 배속에 맞춰 되풀이해 부른다. */
export function liveTick(g: Game): void {
  const m = g.match;
  const L = m?.live;
  if (!m || !L || m.step !== 'live' || (L.halfTimeDone && !L.talked)) return;
  if (m.confusion > 0 && L.tick >= L.confusedUntil) m.confusion = 0;
  if (m.confusion < 0 && L.tick > HALF + 5 * PER_MIN) m.confusion = 0;

  const events = stepLive(L, liveEnv(g, m, L), g);
  narrate(L, events);
  const minute = Math.min(90, Math.ceil(L.tick / PER_MIN));
  const hot = m.weather === 'heat' ? 1.3 : 1;
  const perTick = 1 / (15 * PER_MIN);
  m.me.stamina = clamp(m.me.stamina - COST[m.me.style] * perTick * hot * tempoCost(m.dials) * (g.season.focus === 'fitness' ? 0.8 : 1), 0, 100);
  m.opp.stamina = clamp(m.opp.stamina - COST[m.opp.style] * perTick * hot, 0, 100);
  if (!L.over) m.seg = Math.min(5, Math.floor(L.tick / (15 * PER_MIN)));

  for (const e of events) {
    if (e.kind === 'goal') {
      m.score = e.team === 0 ? [m.score[0] + 1, m.score[1]] : [m.score[0], m.score[1] + 1];
      const p = L.teams[e.team].players[e.by];
      if (e.team === 0) say(m, minute, pick(g, LIVE_GOAL[e.how])(p ? p.name : '공격수'), 'good');
      else say(m, minute, `${pick(g, LIVE_CONCEDED[e.how])}${p ? ` (상대 ${p.n}번 ${p.name})` : ''}`, 'bad');
    } else if (e.kind === 'red') {
      if (e.team === 0) {
        m.me.red = true;
        say(m, minute, '거친 태클에 주심이 레드카드를 꺼냈다. 남은 시간을 열 명으로 버텨야 한다.', 'bad');
      } else {
        m.opp.red = true;
        say(m, minute, '상대 선수가 퇴장당했다. 수적 우위다.', 'good');
      }
    } else if (e.kind === 'half') {
      m.seg = 3;
      say(m, 45, '전반이 끝났다.', 'plain');
      benchMoves(g, m, L);
    } else if (e.kind === 'full') {
      m.seg = 6;
      finish(g, m);
      scene(g);
    }
  }
  // 상대 감독은 30분, 60분, 75분에 판단한다. 하프타임의 판단은 위에서 했다.
  if (!L.over && (L.tick === 30 * PER_MIN || L.tick === 60 * PER_MIN || L.tick === 75 * PER_MIN)) benchMoves(g, m, L);
}

/**
 * 실시간 경기 중 감독의 지시. "종류:값" 꼴이다.
 * style:press, shape:433, line:1, width:-1, tempo:0, overlap:1, role:선수id:역할, push:1, sub:fw, talk:calm
 */
export function liveCommand(g: Game, cmd: string): void {
  const m = g.match;
  const L = m?.live;
  if (!m || !L || m.step !== 'live') return;
  const [verb, a = '', b = ''] = cmd.split(':');
  const minute = Math.min(90, Math.ceil(L.tick / PER_MIN));
  // 지시를 바꾸면 선수들이 익히는 동안 잠깐 흐트러진다.
  const confuse = (minutes: number): void => {
    m.confusion = 1;
    L.confusedUntil = Math.max(L.confusedUntil, L.tick + minutes * PER_MIN);
  };
  const level = a === '1' ? 1 : a === '-1' ? -1 : 0;
  switch (verb) {
    case 'talk':
      if (!L.halfTimeDone || L.talked) return;
      teamTalk(g, m, a);
      L.talked = true;
      // 계획을 차분히 짚었으면 후반 초반의 전술 변경은 혼선 없이 먹힌다.
      m.confusion = a === 'calm' ? -1 : 0;
      L.confusedUntil = 0;
      return;
    case 'style':
      if (!STYLE_IDS.includes(a as StyleId) || a === m.me.style) return;
      m.me.style = a as StyleId;
      if (m.confusion < 0) m.confusion = 0;
      else confuse(15);
      say(m, minute, ko`${STYLES[m.me.style].name}으로 바꿨다.`, 'plain');
      return;
    case 'shape':
      if (!SHAPE_IDS.includes(a as ShapeId) || a === m.me.shape || m.subs < 1) return;
      m.me.shape = a as ShapeId;
      m.subs--;
      reshape(L.teams[0], m.me.shape);
      confuse(8);
      say(m, minute, ko`교체 카드를 써서 대형을 ${SHAPES[m.me.shape].name}으로 바꿨다.`, 'plain');
      return;
    case 'line':
    case 'width':
    case 'tempo':
      if (m.dials[verb] === level) return;
      m.dials = { ...m.dials, [verb]: level };
      confuse(4);
      return;
    case 'overlap':
      if (m.dials.overlap === (a === '1')) return;
      m.dials = { ...m.dials, overlap: a === '1' };
      confuse(4);
      return;
    case 'role': {
      const p = g.squad.find((x) => x.id === Number(a));
      if (!p || !ROLES[p.pos].some((r) => r.id === b) || (m.roles[p.id] ?? 'base') === b) return;
      if (b === 'base') delete m.roles[p.id];
      else m.roles[p.id] = b as RoleId;
      confuse(3);
      return;
    }
    case 'push':
      m.me.push = level;
      return;
    case 'sub': {
      const cost = a === 'legs' ? 2 : 1;
      if (m.subs < cost || !['fw', 'mf', 'df', 'legs'].includes(a)) return;
      // 새로 들어온 선수의 값어치는 뛰던 선수가 얼마나 지쳤느냐에 달렸다. 막판 교체는 효과를 낼 시간이 짧다.
      const fresh = clamp((100 - m.me.stamina) / 30, 0.25, 1) * (minute >= 70 ? 0.7 : 1);
      const trailing = m.score[0] < m.score[1];
      m.subs -= cost;
      if (a === 'fw') {
        m.subAtt += (trailing ? 2.2 : 1.5) * fresh;
        m.subDef -= fresh;
        say(m, minute, ko`${bench(g, L, 'FW', '공격수')}을 넣었다.`, 'plain');
      } else if (a === 'mf') {
        m.subAtt += 0.6 * fresh;
        m.subDef += 0.6 * fresh;
        m.me.stamina = clamp(m.me.stamina + 8, 0, 100);
        say(m, minute, ko`${bench(g, L, 'MF', '미드필더')}을 넣어 중원에 힘을 보탰다.`, 'plain');
      } else if (a === 'df') {
        m.subDef += 1.5 * fresh;
        m.subAtt -= fresh;
        say(m, minute, ko`${bench(g, L, 'DF', '수비수')}을 넣었다.`, 'plain');
      } else {
        m.me.stamina = clamp(m.me.stamina + 22, 0, 100);
        say(m, minute, '지친 선수 둘을 바꿨다. 다리가 다시 움직인다.', 'plain');
      }
      return;
    }
  }
}

/** 실시간 경기 화면에 보여 줄 벤치의 판단: 상대 전술이 읽혔는지, 지금 전술과 다른 전술들의 유불리. */
export function liveAdvice(g: Game): { text: string; tone: Tone; hints: Partial<Record<StyleId, string>> } {
  const m = g.match as MatchState;
  const block = readBlock(g, m) as { text: string; tone: Tone };
  const hints: Partial<Record<StyleId, string>> = {};
  if (m.read) for (const id of STYLE_IDS) hints[id] = hint(g, m, id, m.opp.style);
  return { text: block.text, tone: block.tone, hints };
}

export { staminaText, readChance };
