// 감독 커리어 게임 "터치라인"의 자료 구조. 화면과 무관하며 전부 그대로 저장할 수 있는 값이다.

export type Pos = 'GK' | 'DF' | 'MF' | 'FW';
export type StyleId = 'attack' | 'defend' | 'possess' | 'counter' | 'press';
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
  /** 재정 형편. -5(가난)에서 +5(부자). */
  wealth: number;
  lastPos: number;
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

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'note'; text: string; tone: Tone }
  | { kind: 'stats'; rows: { label: string; value: string; tone?: Tone }[] }
  | { kind: 'matches'; items: MatchLine[] }
  | { kind: 'table'; league: LeagueId }
  | { kind: 'players'; items: { name: string; pos: Pos; age: number; ovr: number; delta?: number; note?: string }[] }
  | { kind: 'feed'; items: { who: string; where: string; text: string; tone: Tone }[] };

export interface Choice {
  id: string;
  label: string;
  detail?: string;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
}

export type Phase =
  | 'offers' | 'style' | 'focus' | 'market' | 'half1' | 'event' | 'outcome'
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
  /** 지금까지 치른 라운드 수. */
  round: number;
  job: Job | null;
  squad: Player[];
  /** 주전 일곱 명을 뺀 나머지 선수층의 수준. */
  depth: number;
  morale: number;
  /** 전술 숙련도 0~100. 같은 전술을 오래 쓸수록 오른다. */
  cohesion: number;
  season: SeasonState;
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
