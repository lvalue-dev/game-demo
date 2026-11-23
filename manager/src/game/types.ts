// 감독 커리어 게임 "터치라인"의 자료 구조. 화면과 무관하며 전부 그대로 저장할 수 있는 값이다.

export type Pos = 'GK' | 'DF' | 'MF' | 'FW';
/** 세부 포지션. */
export type Spot = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST';
/** 주발: 오른발, 왼발, 양발. */
export type Foot = 'R' | 'L' | 'B';
/** 전술. 팀이 공을 가졌을 때와 잃었을 때 무엇을 하는지를 정한다. */
export type StyleId = 'press' | 'possess' | 'counter' | 'direct' | 'wide' | 'park';
export type ShapeId = '442' | '433' | '4231' | '4141' | '4312' | '352' | '343' | '541';
export type WeatherId = 'clear' | 'rain' | 'wind' | 'heat';
export type FocusId = 'attack' | 'defense' | 'fitness' | 'youth';
export type PlanId = 'allout' | 'steady' | 'rotate';
export type AttrId = 'tactics' | 'lead' | 'youth' | 'deal' | 'eye';
export type BackgroundId = 'pro' | 'teacher' | 'analyst' | 'scout' | 'sales';
/** 클럽 리그 번호: 나라 앞글자와 단계(kr1, eng3, jpn5 …). 목록은 countries.ts. */
export type ClubLeagueId = string;
/** intl은 국가대표 대회의 조별 리그에 쓰는 임시 리그다. */
export type LeagueId = string;
/** 구단이 새 감독에게 바라는 것. 구인 공고와 면접 질문을 정한다. */
export type WantId = 'results' | 'promotion' | 'survival' | 'youth' | 'budget' | 'attack' | 'defense';
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
  /** 이번 시즌 리그 득점. 직접 지휘한 리그 경기는 실제 득점자, 나머지는 결산에서 무작위로 나눈다. */
  goals: number;
  /** 이번 시즌 리그 출전 수(경기장에 한 번이라도 선 경기). 클럽 감독일 때만 센다. */
  apps: number;
  /** 이번 시즌 동안만 적용되는 실력 보정(불화, 부상 여파 등). */
  temp: number;
  homegrown: boolean;
  spot: Spot;
  foot: Foot;
  /** 약발(1~5). */
  weak: number;
  height: number;
  /** 같은 포지션 선수들과 견준 능력치 개인차(속도, 슈팅, 패스, 드리블, 수비, 피지컬). */
  dev: number[];
  /** 등번호. */
  no: number;
  /** 구단과 맺은 계약. 대표팀 선수나 상대 팀 선수는 없다. */
  contract: Contract | null;
  /** 약속이 깨졌거나 이적을 원해 불만이 있다. */
  unhappy: boolean;
  /** 국적. 외국인 쿼터에 쓴다. */
  nat: string;
  /** 잉글랜드 홈그로운: 21세 전에 잉글랜드 구단에서 3시즌 이상 훈련했다. */
  hg: boolean;
  /** 워크퍼밋 점수(GBE)가 모자라 ESC 예외 슬롯으로 등록했다. */
  esc: boolean;
  /** 임대 중이면 그 조건. in은 우리가 빌려 온 선수, out은 빌려준 선수. */
  loan: Loan | null;
}

export interface Loan {
  dir: 'in' | 'out';
  /** 상대 구단 이름. */
  club: string;
  /** 돌아가는(돌아오는) 때: 겨울 이적시장 또는 시즌 끝. */
  until: 'winter' | 'end';
  year: number;
  /** 연봉 중 빌린 쪽이 내는 비율(0~1). */
  share: number;
}

/** 출전 보장: 핵심 선수, 주전, 로테이션, 백업. */
export type PromiseId = 'star' | 'starter' | 'rotation' | 'backup';

export interface Contract {
  /** 연봉(백만 원, 한 시즌). 아마추어 리그는 0이다. */
  wage: number;
  /** 남은 계약 기간(시즌). 1이면 이번 시즌이 마지막이다. */
  years: number;
  promise: PromiseId;
  /** 바이아웃(백만 원). 이 금액을 내는 구단에는 이적을 막을 수 없다. */
  clause: number | null;
  /** 셀온 조항: 다시 팔 때 이적료의 이만큼을 전 소속 구단에 준다. */
  sellOn: number;
  /** 서명한 해. */
  since: number;
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
  /** 이전 버전에서 고른 출발 무대. 지금은 쓰지 않는다. */
  start?: ClubLeagueId;
  /** 감독 자격 단계(0 없음, 1 C급, 2 B급, 3 A급, 4 P급). */
  license: number;
  /** 단계마다 자격을 딴 해. 아직 못 땄으면 0. */
  licensed: number[];
  /** 듣고 있는 강습. ends 해의 시즌이 끝나면 자격이 나온다. */
  course: { level: number; ends: number } | null;
  /** 감독 자리 없이 보낸 시즌 수(유소년·아마추어 코치). */
  idle: number;
  /** 감독을 맡아 본 나라. 처음 가는 나라는 서류에서 불리하다. */
  countries: string[];
}

/** 구인 공고 하나와 그 진행. */
export interface Vacancy {
  club: number;
  kind: 'club' | 'nation';
  /** 구단이 먼저 연락해 왔다. 서류 심사 없이 면접을 본다. */
  approach: boolean;
  wants: WantId[];
  /** 한 단계 낮은 자격으로 지원한다. 뽑히면 강습 등록이 조건이다. */
  provisional: boolean;
  state: 'open' | 'applied' | 'short' | 'rejected' | 'offer' | 'failed';
  /** 서류 점수와 그 내역, 면접 점수. */
  doc: number;
  docNotes: string[];
  talk: number;
  /** 면접에서 한 약속: 목표 순위 보정과 첫 신뢰 보정. */
  objective: number;
  confidence: number;
  /** 결과 설명. */
  note: string;
}

export interface Hiring {
  step: 'browse' | 'review' | 'interview' | 'decide';
  list: Vacancy[];
  /** 면접 중인 공고(list 번호)와 질문들, 지금 질문 번호. */
  talk: { at: number; qs: string[]; i: number } | null;
  /** 지금 구단에 남을 수 있는지와, 없다면 그 이유. */
  stay: boolean;
  stayNote: string;
  /** 이번에 강습에서 생긴 일. */
  notes: string[];
}

export interface Job {
  kind: 'club' | 'nation';
  club: number;
  /** 이사회(또는 협회)의 신뢰 0~100. */
  confidence: number;
  /** 구단이 요구하는 최종 순위. 국가대표는 대회별 목표를 따로 쓴다. */
  objective: number;
  /** 이적 예산(백만 원). */
  budget: number;
  /** 한 시즌 연봉 총액의 상한(백만 원). */
  wageBudget: number;
  /** 분할 지급으로 남은 이적료. due 시즌이 시작될 때 이적 예산에서 나간다. */
  debts: { amount: number; due: number; what: string }[];
  seasons: number;
  /** 면접에서 약속한 목표 보정(첫 시즌 목표 순위에 더한다). 음수면 더 높은 순위를 약속했다. */
  promise?: number;
  /** 지금 라이벌과의 통산 상대 전적. 라이벌이 바뀌면 0부터 다시 센다. 국가대표는 쓰지 않는다(늘 null). */
  rivalry: Rivalry | null;
}

export interface Rivalry {
  club: number;
  w: number;
  d: number;
  l: number;
  /** 지난 맞대결 스코어 [우리, 상대]. 아직 없으면 null. */
  last: [number, number] | null;
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
  /** 실시간으로 지휘한 리그 경기에서 득점자가 정해진 우리 팀 골 수. 결산의 무작위 분배에서 뺀다. */
  liveGoals: number;
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
  /** 리그 번호(대표팀은 intl). 예전 기록에는 없다. */
  lid?: string;
}

export interface Offer {
  club: number;
  kind: 'club' | 'nation';
  /** 지금 팀에 남는 선택이면 true. */
  stay: boolean;
  pitch: string;
}

/** 개인 조건 제안서. 금액은 모두 백만 원 단위다. */
export interface Terms {
  wage: number;
  years: number;
  promise: PromiseId;
  /** 바이아웃 금액. 0이면 조항이 없다. */
  clause: number;
  /** 계약금(서명 보너스) 금액. */
  bonus: number;
  /** 에이전트 수수료율(%). 이적료(자유계약이면 연봉) 기준이다. */
  agent: number;
}

/** 이적 시장에 나온 영입 후보와 협상 진행 상태. */
export interface Deal {
  id: string;
  kind: 'sign' | 'youth' | 'free' | 'renew' | 'loan';
  player: Player;
  /** 판매 구단의 요구 이적료(백만 원). 자유계약과 유스, 재계약, 임대는 0. */
  price: number;
  /** 판매(임대) 구단 이름. 자유계약이면 '무소속'. */
  from: string;
  /** 후보의 성격: 즉시 전력, 유망주, 베테랑, 자유계약, 유스, 재계약, 임대. */
  tag: string;
  /** 협상 단계: 이적료 협상, 개인 조건 협상, 임대 조건 협상. */
  stage: 'fee' | 'terms' | 'loan';
  /** 우리가 쓰고 있는 이적료 제안(금액, 셀온 비율, 분할 지급 시즌 수). */
  draft: { fee: number; sellOn: number; inst: number };
  /** 합의한 이적료와 조건. */
  fee: number;
  sellOn: number;
  inst: number;
  /** 선수의 요구: 연봉, 기대하는 출전 시간, 원하는 계약 기간, 에이전트 수수료율. */
  ask: { wage: number; promise: PromiseId; years: number; agent: number };
  /** 지금 우리가 쓰고 있는 제안서. */
  offer: Terms;
  /** 임대 조건: 기간, 우리가 낼 연봉 비율, 임대료. ask는 원 소속 구단의 요구. */
  loan: { until: 'winter' | 'end'; share: number; fee: number; askShare: number; askFee: number } | null;
  /** 이적료 협상과 개인 조건 협상에서 거절당한 횟수. */
  tries: number;
  talks: number;
}

/** 다른 구단이 우리 선수에게 낸 이적 제안. clause면 바이아웃 발동이다. */
export interface Bid {
  id: string;
  player: number;
  club: string;
  fee: number;
  clause: boolean;
  /** 우리가 역제안을 한 번 했는지. */
  countered: boolean;
}

/** 열려 있는 이적 시장. */
export interface TransferWindow {
  kind: 'summer' | 'winter';
  list: Deal[];
  bids: Bid[];
  /** 지금 보고 있는 화면: null은 목록, 'sell'은 판매·방출 명단, 그 밖에는 후보 id. */
  view: string | null;
  /** 이번 시장에서 있었던 일. */
  log: string[];
  signed: number;
  /** 이번 시장에 새로 데려온 비EU 선수 수(세리에 A 규정). */
  nonEu?: number;
  sold: number;
  scouted: number;
  depthDone: boolean;
  /** 판매 화면의 희망가와 선수별 판매 시도 횟수. */
  sale: { price: number; tries: Record<number, number> };
  /** 임대 보내기 화면의 조건: 기간, 상대가 낼 연봉 비율, 임대료. */
  lend: { until: 'winter' | 'end'; share: number; fee: number };
}

/** 선수 개인에게 주는 역할. base는 그 자리의 기본 역할이다. 자리(세부 포지션)마다 고를 수 있는 역할이 다르다. */
export type RoleId =
  | 'base' | 'sweeper'
  | 'stopper' | 'mark' | 'libero'
  | 'wing' | 'invert' | 'stay'
  | 'hold' | 'maker' | 'runner' | 'hunter' | 'shadow'
  | 'inside' | 'hug' | 'track'
  | 'link' | 'target' | 'drift' | 'poach' | 'harry';

/** 세 단계 지시의 값. */
export type Level = -1 | 0 | 1;

/** 전술과 별개로 조절하는 팀 지시. -1, 0, 1의 세 단계다. */
export interface Dials {
  /** 수비 라인: -1 내림, 1 올림. */
  line: Level;
  /** 좌우 폭: -1 좁게, 1 넓게. */
  width: Level;
  /** 템포: -1 느리게, 1 빠르게. */
  tempo: Level;
  /** 풀백 오버래핑. */
  overlap: boolean;
  /** 압박: -1 기다린다, 1 달려든다. */
  press: Level;
  /** 패스: -1 짧게, 1 길게. */
  pass: Level;
  /** 공격 방향: -1 왼쪽, 1 오른쪽. */
  flank: Level;
  /** 마무리: -1 만들어 넣는다, 1 보이면 쏜다. */
  final: Level;
  /** 공을 잃은 직후: -1 물러선다, 1 즉시 압박. */
  lose: Level;
  /** 공을 따낸 직후: -1 지킨다, 1 바로 역습. */
  win: Level;
  /** 수비 블록의 폭: -1 좁게, 1 넓게. */
  block: Level;
}

/** 경기마다 들고 나가는 기본 지시. 구단 관리 화면에서 정해 두면 킥오프 때 그대로 걸린다. */
export interface Plan {
  dials: Dials;
  /** 선수 id별 개인 역할. */
  roles: Record<number, RoleId>;
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
  spot: Spot;
  foot: Foot;
  dev: number[];
  /** 우리 선수(후보 포함)의 선수 번호. 얼굴과 정보 연결에 쓴다. 상대와 2군은 없다. */
  pid?: number;
  /** 국적. 얼굴 그림에 쓴다. */
  nat?: string;
  /** 경기장에 들어온 틱(선발은 0). 선수별 체력 표시에 쓴다. */
  on?: number;
  /** 이 경기의 개인 기록. */
  rec?: { goals: number; shots: number; onTarget: number; steals: number; fouls: number };
}

/** 대형의 한 자리(live.ts의 Slot과 같은 모양). */
export interface SlotLike {
  line: Pos;
  u: number;
  v: number;
  wide: boolean;
  fb: boolean;
  wb: boolean;
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
  /** 슈팅이면 그 슈팅의 기대 득점. */
  xg?: number;
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
  /** 최근 중계 문구. 화면 아래 자막으로 보여 준다. */
  calls: { tick: number; text: string; tone: Tone }[];
  /** 이미 교체로 들어간 후보들의 이름. */
  subbed?: string[];
  /** 교체로 나간 우리 선수의 선수 번호와 그 경기 골. 리그 출전과 득점 집계에 쓴다(pid가 없으면 -1). */
  gone?: { pid: number; goals: number }[];
  /** 우리 팀이 손으로 옮긴 대형 자리(대형별). 없으면 기본 자리. */
  custom?: Partial<Record<ShapeId, SlotLike[]>>;
  /** 이 경기만 벤치에 앉힌 2군 선수들. 후보가 모자라도 벤치가 일곱 자리가 되게 한다. */
  youth?: Player[];
  halfTimeDone: boolean;
  /** 하프타임 대화를 마쳤는지. 마치기 전에는 후반이 시작되지 않는다. */
  talked: boolean;
  /** 지시를 바꾼 뒤의 혼선이 끝나는 틱. */
  confusedUntil: number;
  /** 지시를 바꾼 순간들(최근 몇 개). */
  marks?: LiveMark[];
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
  /** 공이 없을 때 서는 대형. 없으면 공격 대형 그대로 선다. */
  shapeDef?: ShapeId;
}

/** 지시를 바꾼 순간의 경기 기록. 바꾼 뒤에 무엇이 달라졌는지 견주는 데 쓴다. */
export interface LiveMark {
  tick: number;
  text: string;
  shots: [number, number];
  xg: [number, number];
  poss: [number, number];
  score: [number, number];
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
  /** 경기 소개에 덧붙이는 한 줄(라이벌전 통산 전적 등). 예전 저장에는 없다. */
  intro?: string;
  dials: Dials;
  /** 상대의 팀 지시. 상대 감독이 경기 중에 바꾼다. 예전 저장에는 없다(모두 보통). */
  oppDials?: Dials;
  /** 벤치가 읽어 낸 상대의 지시. 상대가 바꾼 것을 아직 못 읽었으면 예전 것이 남아 있다. */
  oppSeen?: Dials;
  /** 상대 감독이 마지막으로 손을 쓴 때(분)와 지금까지 쓴 횟수. */
  oppMoved?: number;
  oppMoves?: number;
  /** 아직 읽지 못한 상대의 변화. at분이 되면 드러난다. */
  oppNews?: { at: number; text: string };
  /** 주전 선수 id별 개인 역할. 적혀 있지 않으면 기본 역할이다. */
  roles: Record<number, RoleId>;
  live: LiveState | null;
}

export type Block =
  | { kind: 'score'; home: string; away: string; score: [number, number]; minute: string; mine: 0 | 1; clubs?: [number, number] }
  | { kind: 'log'; items: LogLine[] }
  | { kind: 'text'; text: string }
  | { kind: 'note'; text: string; tone: Tone }
  | { kind: 'stats'; rows: { label: string; value: string; tone?: Tone }[] }
  | { kind: 'matches'; items: MatchLine[] }
  | { kind: 'table'; league: LeagueId }
  | { kind: 'players'; items: { player: Player; delta?: number; note?: string }[] }
  | { kind: 'card'; player: Player; price?: string; compare?: Player; note?: string }
  /** 이적시장: 탭으로 나눈 선수 카드들. */
  | { kind: 'market'; tabs: MarketTab[] }
  /** 협상 테이블: 선수 요약, 상대 요구와 우리 제안의 비교, 합의 가능성. 선택지는 화면 아래에 붙는다. */
  | { kind: 'deal'; player: Player; note: string; gain?: number; side: string; rows: DealRow[]; odds: number | null; oddsLabel: string; money: { label: string; value: string; tone?: Tone }[] }
  /** 칩을 눌러 고르는 양식. 계약 제안서에 쓴다. 칩의 id는 선택지 id처럼 act()로 간다. */
  | { kind: 'form'; title: string; rows: FormRow[] }
  | { kind: 'feed'; items: { who: string; where: string; text: string; tone: Tone }[] };

/**
 * 양식의 한 줄. options는 칩(누르면 그 id로 act), range는 슬라이더와 숫자 입력(바꾸면 "id=값"으로 act)이다.
 * unit은 값을 보여 주는 방식: money(백만 원), pct(0~1 비율), pct100(%), years.
 */
export interface FormRow {
  label: string;
  note?: string;
  options?: { id: string; label: string; on: boolean; disabled?: boolean }[];
  range?: { id: string; min: number; max: number; step: number; value: number; unit: 'money' | 'pct' | 'pct100' | 'years' };
}

export interface MarketCard {
  /** 카드를 누르면 고르는 선택지. 장면의 선택지에는 숨김으로 들어 있다. */
  act: string | null;
  player: Player;
  /** 소속이나 출처. */
  from: string;
  /** 카드에 크게 적는 금액이나 조건. */
  price: string;
  /** 같은 포지션 가장 약한 선발 대비 OVR. */
  gain?: number;
  tags: string[];
  status?: { text: string; tone: Tone };
  /** 카드 아래 버튼들(내 선수, 들어온 제안). */
  actions?: { act: string; label: string; tone?: 'primary' | 'danger'; disabled?: boolean }[];
}

export interface MarketTab {
  id: string;
  label: string;
  hint: string;
  cards: MarketCard[];
}

export interface DealRow {
  label: string;
  /** 상대가 바라는 것. */
  ask: string;
  /** 지금 우리 제안. */
  offer: string;
  /** 우리 제안이 상대 요구에 비해 어떤지: good 맞춰 줌, bad 모자람. */
  tone: Tone;
}

export interface Choice {
  id: string;
  /** 구단을 고르는 선택지면 그 구단 번호. 문장을 함께 보여 준다. */
  club?: number;
  label: string;
  detail?: string;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
  /** 선택지 묶음의 제목. 앞 선택지와 다르면 화면에 제목을 넣는다. */
  group?: string;
  /** 고를 수는 있지만 선택지 목록에는 그리지 않는다(카드나 표 안의 버튼으로 고른다). */
  hidden?: boolean;
}

export type Phase =
  | 'offers' | 'career' | 'style' | 'focus' | 'market' | 'match' | 'half1' | 'event' | 'outcome'
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
  /** 후보 명단. 선발 열한 명 밖의 등록 선수들. */
  reserves: Player[];
  /** 다른 구단에 임대 보낸 선수들. 등록 인원에 세지 않는다. */
  loaned: Player[];
  /** 선발 열한 명의 대형. 자리마다의 줄(GK, DF, MF, FW)이 여기서 나온다. 예전 저장에는 없다. */
  formation?: ShapeId;
  /** 대형별로 손으로 옮긴 자리 좌표(u: 자기 골문에서 앞으로, v: 왼쪽에서). 없으면 대형의 기본 자리. */
  tweaks?: Partial<Record<ShapeId, { u: number; v: number }[]>>;
  /** 경기마다 들고 나가는 팀 지시와 개인 역할. 예전 저장에는 없다. */
  plan?: Plan;
  /** 주전 열한 명을 뺀 나머지 선수층의 수준. */
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
  /** 감독 구직: 구인 공고, 지원, 면접. 시즌과 시즌 사이에만 있다. */
  hiring: Hiring | null;
  window: TransferWindow | null;
  /** 다음 월드컵 본선 진출을 확정했는지. */
  wcTicket: boolean;
  sacked: boolean;
  /** 성장 단계에서 쓸 수 있는 능력치 점수. */
  points: number;
  history: SeasonRecord[];
  trophies: Trophy[];
  promotions: number;
}
