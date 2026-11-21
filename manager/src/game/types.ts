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

/** 선수 개인에게 주는 역할. base는 포지션의 기본 역할이다. */
export type RoleId = 'base' | 'link' | 'target' | 'drift' | 'hold' | 'maker' | 'runner' | 'stopper' | 'mark' | 'sweeper';

/** 전술과 별개로 조절하는 팀 지시. -1, 0, 1의 세 단계다. */
export interface Dials {
  /** 수비 라인: -1 내림, 1 올림. */
  line: -1 | 0 | 1;
  /** 좌우 폭: -1 좁게, 1 넓게. */
  width: -1 | 0 | 1;
  /** 템포: -1 느리게, 1 빠르게. */
  tempo: -1 | 0 | 1;
  /** 풀백 오버래핑. */
  overlap: boolean;
}

/** 실시간 경기 화면의 선수 한 명. 좌표는 미터(가로 105, 세로 68)다. */
export interface LivePlayer {
  /** 등번호. */
  n: number;
  name: string;
  /** 본래 포지션. 지금 서는 자리는 대형의 slot이 정한다. */
  line: Pos;
  slot: number;
  /** 주전 선수면 그 선수의 id, 후보나 상대 선수면 -1. */
  key: number;
  ovr: number;
  x: number;
  y: number;
  /** 한 틱 전의 위치. 화면에서 부드럽게 이어 그리는 데 쓴다. */
  px: number;
  py: number;
  /** 퇴장당해 경기장에 없다. */
  off: boolean;
}

export interface LiveTeam {
  players: LivePlayer[];
  shots: number;
  onTarget: number;
  /** 슈팅마다의 득점 확률을 더한 기대 득점. */
  xg: number;
  passes: number;
  passesOk: number;
  possession: number;
}

/** 골이 어떻게 만들어졌는지. 골 장면을 글로 옮길 때 쓴다. */
export type LiveHow = 'pass' | 'long' | 'cross' | 'press' | 'counter' | 'set' | 'pen';

export interface LiveFlight {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  end: number;
  kind: 'pass' | 'long' | 'cross' | 'shot';
  /** 공을 찬 팀과 선수. */
  side: 0 | 1;
  by: number;
  /** 도착했을 때 공을 잡는 팀과 선수. 슛이나 빗나간 크로스는 결과가 result에 있다. */
  team: 0 | 1;
  to: number;
  result: 'goal' | 'save' | 'corner' | 'off' | null;
  how: LiveHow;
}

/** 실시간 경기의 상태. 1800틱이 90분이고, 한 틱에 선수는 3미터쯤 움직인다. */
export interface LiveState {
  tick: number;
  /** 0은 감독 팀(오른쪽으로 공격), 1은 상대. */
  teams: [LiveTeam, LiveTeam];
  ball: { x: number; y: number; px: number; py: number };
  /** 공을 가진 팀과 선수. 공이 날아가는 중이거나 멈춰 있으면 null. */
  owner: { team: 0 | 1; i: number } | null;
  flight: LiveFlight | null;
  /** 지금 선수가 공을 잡고 있었던 틱 수. */
  held: number;
  /** 공을 되찾은 뒤 지난 틱 수와, 되찾은 자리(공격 방향으로 0~105). */
  sinceWin: number;
  winU: number;
  /** 멈춘 경기가 다시 시작되기까지 남은 틱과, 그때 공을 잡을 선수. */
  wait: number;
  restart: 'kick' | 'corner' | 'goalkick' | 'free' | null;
  next: { team: 0 | 1; i: number; x: number; y: number } | null;
  /** 세트피스 중인지: 0 아님, 1 코너킥, 2 프리킥, 3 페널티킥. */
  set: 0 | 1 | 2 | 3;
  lastKind: 'pass' | 'long' | 'cross';
  halfTimeDone: boolean;
  /** 하프타임 대화를 마쳤는지. 마치기 전에는 후반이 시작되지 않는다. */
  talked: boolean;
  /** 지시를 바꾼 뒤의 혼선이 끝나는 틱. */
  confusedUntil: number;
  over: boolean;
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
  step: 'shape' | 'plan' | 'mode' | 'live' | 'm30' | 'talk' | 'ht' | 'm60' | 'm75' | 'done';
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
  dials: Dials;
  /** 주전 선수 id별 개인 역할. 적혀 있지 않으면 기본 역할이다. */
  roles: Record<number, RoleId>;
  live: LiveState | null;
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
