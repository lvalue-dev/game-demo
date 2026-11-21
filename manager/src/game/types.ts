// 감독 커리어 게임 "터치라인"의 자료 구조. 화면과 무관하며 전부 그대로 저장할 수 있는 값이다.

export type Pos = 'GK' | 'DF' | 'MF' | 'FW';
/** 전술. 팀이 공을 가졌을 때와 잃었을 때 무엇을 하는지를 정한다. */
export type StyleId = 'press' | 'possess' | 'counter' | 'direct' | 'wide' | 'park';
export type ShapeId = '442' | '433' | '4231' | '352' | '541';
export type WeatherId = 'clear' | 'rain' | 'wind' | 'heat';
export type FocusId = 'attack' | 'defense' | 'fitness' | 'youth';
export type PlanId = 'allout' | 'steady' | 'rotate';
export type AttrId = 'tactics' | 'lead' | 'youth' | 'deal' | 'eye';
export type BackgroundId = 'pro' | 'teacher' | 'analyst' | 'scout' | 'sales';
export type ClubLeagueId = 'kr5' | 'kr4' | 'kr3' | 'kr2' | 'kr1' | 'eu2' | 'eu1';
/** intl은 국가대표 대회의 조별 리그에 쓰는 임시 리그다. */
export type LeagueId = ClubLeagueId | 'intl';
export type TraitId = 'leader' | 'glass' | 'clutch' | 'rebel' | 'grinder';
export type Tone = 'good' | 'bad' | 'plain';

export interface Player {
  id: number;
  name: string;
  pos: Pos;
  age: number;
  /** 현재 실력과 잠재력. 리그 수준과 같은 눈금이다(동네 리그 30대, 유럽 1부 80대). */
  ovr: number;
  pot: number;
  trait: TraitId | null;
  /** 이 팀에서 보낸 시즌 수. */
  years: number;
  goals: number;
  /** 이번 시즌 동안만 적용되는 실력 보정(불화, 부상 여파 등). */
  temp: number;
  homegrown: boolean;
}

export interface Club {
  id: number;
  name: string;
  league: LeagueId;
  att: number;
  def: number;
  style: StyleId;
  shape: ShapeId;
  /** 재정 형편. -5(가난)에서 +5(부자). */
  wealth: number;
  lastPos: number;
  /** 문장(배지)에 쓰는 두 색과 무늬 번호. */
  colors: [string, string];
  pattern: number;
  /** 지난 시즌 성적으로 대륙 클럽 대회 출전권을 땄는지. */
  conti: boolean;
  /** 국가대표팀이면 true. */
  nation: boolean;
  asia: boolean;
}

export interface Row {
  club: number;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  form: ('W' | 'D' | 'L')[];
}

export interface MatchLine {
  label: string;
  opp: string;
  home: boolean;
  gf: number;
  ga: number;
  result: 'W' | 'D' | 'L';
  note?: string;
}

export interface Knockout {
  name: string;
  rounds: string[];
  /** 다음에 치를 라운드 번호. */
  next: number;
  alive: boolean;
  won: boolean;
  lines: MatchLine[];
}

export interface Manager {
  name: string;
  age: number;
  background: BackgroundId;
  attrs: Record<AttrId, number>;
  /** 평판 0~100. 어느 구단이 불러 주는지를 정한다. */
  rep: number;
  peakRep: number;
}

export interface Job {
  kind: 'club' | 'nation';
  club: number;
  /** 이사회(또는 협회)의 신뢰 0~100. */
  confidence: number;
  /** 구단이 요구하는 최종 순위. 국가대표는 대회별 목표를 따로 쓴다. */
  objective: number;
  budget: number;
  seasons: number;
}

export type NationYear = 'asia' | 'q2' | 'q3' | 'wc' | 'friendly';

export interface SeasonState {
  /** 지금 치르는 절반(1 전반기, 2 후반기). */
  half: 1 | 2;
  /** 올 시즌 직접 지휘하는 라이벌전의 상대. 없으면 -1. */
  rival: number;
  /** 자동 진행에서 빼 두고 직접 치를 리그 경기. */
  pending: { league: LeagueId; round: number; home: boolean; opp: number } | null;
  /** 이번 절반의 경기 기록이 lines의 몇 번째부터인지. */
  halfStart: number;
  style: StyleId;
  focus: FocusId;
  plan: PlanId;
  lines: MatchLine[];
  cup: Knockout | null;
  conti: Knockout | null;
  /** 국가대표 해의 종류와 본선(토너먼트) 진행. */
  nationYear: NationYear | null;
  finals: Knockout | null;
  groupPassed: boolean;
  half1Pos: number;
  notes: string[];
  /** 이번 시즌 선수단에 붙은 한시적 전력 보정. */
  attMod: number;
  defMod: number;
  depthMod: number;
}

export interface Trophy {
  year: number;
  name: string;
  club: string;
  weight: number;
}

export interface SeasonRecord {
  year: number;
  age: number;
  club: string;
  league: string;
  pos: number;
  size: number;
  record: string;
  cup: string;
  note: string;
  outcome: 'title' | 'up' | 'down' | 'sacked' | 'plain';
}

export interface Offer {
  club: number;
  kind: 'club' | 'nation';
  /** 지금 팀에 남는 선택이면 true. */
  stay: boolean;
  pitch: string;
}

export interface MarketOption {
  id: string;
  kind: 'sign' | 'youth' | 'depth' | 'skip';
  player?: Player;
  price: number;
  label: string;
  detail: string;
}

export interface LogLine {
  min: number;
  text: string;
  tone: Tone;
}

export interface MatchTeam {
  style: StyleId;
  shape: ShapeId;
  /** 체력 0~100. 15분마다 줄고, 낮으면 공수가 함께 떨어진다. */
  stamina: number;
  /** 75분 이후의 태세. 1 총공세, -1 잠그기. */
  push: -1 | 0 | 1;
  red: boolean;
}

/** 직접 지휘하는 한 경기. 15분 여섯 토막으로 진행된다. */
export interface MatchState {
  kind: 'league' | 'knockout';
  ko: 'cup' | 'conti' | 'finals' | null;
  league: LeagueId | null;
  round: number;
  label: string;
  oppId: number;
  oppName: string;
  /** 상대의 평소 전력과, 평소 쓰는 전술. */
  oppAtt: number;
  oppDef: number;
  oppUsual: StyleId;
  /** 상대 감독이 우리 전술에 대응하는 정도(0~1). 상위 리그일수록 높다. */
  oppIq: number;
  venue: 'home' | 'away' | 'neutral';
  weather: WeatherId;
  step: 'shape' | 'plan' | 'm30' | 'talk' | 'ht' | 'm60' | 'm75' | 'done';
  /** 지금까지 치른 토막 수(0~6). */
  seg: number;
  score: [number, number];
  me: MatchTeam;
  opp: MatchTeam;
  /** 지금 상대의 전술이 읽히는지. */
  read: boolean;
  subs: number;
  /** 하프타임 대화가 후반에 주는 보정. */
  talk: number;
  /** 전술을 바꾼 직후의 혼선이 남은 토막 수. */
  confusion: number;
  /** 교체로 바뀐 공수 보정. */
  subAtt: number;
  subDef: number;
  log: LogLine[];
  /** 지난 결정 이후의 기록이 log의 몇 번째부터인지. */
  logStart: number;
  pens: 'won' | 'lost' | null;
  auto: boolean;
}

export type Block =
  | { kind: 'score'; home: string; away: string; score: [number, number]; minute: string; mine: 0 | 1 }
  | { kind: 'log'; items: LogLine[] }
  | { kind: 'text'; text: string }
  | { kind: 'note'; text: string; tone: Tone }
  | { kind: 'stats'; rows: { label: string; value: string; tone?: Tone }[] }
  | { kind: 'matches'; items: MatchLine[] }
  | { kind: 'table'; league: LeagueId }
  | { kind: 'players'; items: { name: string; pos: Pos; age: number; ovr: number; delta?: number; note?: string }[] }
  | { kind: 'feed'; items: { who: string; where: string; text: string; tone: Tone }[] };

export interface Choice {
  id: string;
  /** 구단을 고르는 선택지면 그 구단 번호. 문장을 함께 보여 준다. */
  club?: number;
  label: string;
  detail?: string;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
}

export type Phase =
  | 'offers' | 'style' | 'focus' | 'market' | 'match' | 'half1' | 'event' | 'outcome'
  | 'winter' | 'plan' | 'end' | 'growth' | 'retired';

export interface Scene {
  eyebrow: string;
  title: string;
  blocks: Block[];
  choices: Choice[];
}

export interface Game {
  rng: number;
  version: number;
  year: number;
  nextId: number;
  manager: Manager;
  clubs: Club[];
  /** 리그별 소속 구단 번호. */
  leagues: Record<LeagueId, number[]>;
  tables: Record<LeagueId, Row[]>;
  fixtures: Record<LeagueId, [number, number][][]>;
  /** 이번 시즌에 치른 절반의 수(0, 1, 2). */
  round: number;
  job: Job | null;
  squad: Player[];
  /** 주전 일곱 명을 뺀 나머지 선수층의 수준. */
  depth: number;
  morale: number;
  /** 전술 숙련도 0~100. 같은 전술을 오래 쓸수록 오른다. */
  cohesion: number;
  season: SeasonState;
  /** 직접 지휘하고 있는 경기. 없으면 null. */
  match: MatchState | null;
  lastStyle: StyleId | null;
  phase: Phase;
  scene: Scene;
  eventId: string | null;
  offers: Offer[];
  market: MarketOption[];
  /** 다음 월드컵 본선 진출을 확정했는지. */
  wcTicket: boolean;
  sacked: boolean;
  /** 성장 단계에서 쓸 수 있는 능력치 점수. */
  points: number;
  history: SeasonRecord[];
  trophies: Trophy[];
  promotions: number;
}
