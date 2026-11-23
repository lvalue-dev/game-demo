// 전술과 대형의 상성. 근거는 TACTICS.md에 정리했다.
// 모든 보정은 "감독 팀" 쪽 공격력과 수비력에 더하는 값이다. 상대의 손해는 우리 이득으로 표현된다.
import type { Dials, Level, Pos, RoleId, ShapeId, Spot, StyleId } from './types.ts';

export interface Delta {
  att: number;
  def: number;
}

/** 전술 자체의 성향. 감독의 전술 능력치가 높을수록 더 크게 발휘된다. */
export const BASE: Record<StyleId, Delta> = {
  press: { att: 1.5, def: 1 },
  possess: { att: 1, def: 1 },
  counter: { att: 0.5, def: 1.5 },
  direct: { att: 1.2, def: 0.8 },
  wide: { att: 2.2, def: 0 },
  park: { att: -3, def: 3.5 },
};

/** MATCHUP[우리][상대]: 상대 전술에 따른 추가 보정. */
const MATCHUP: Record<StyleId, Record<StyleId, [number, number]>> = {
  press: { press: [0, 0], possess: [2, 0.5], counter: [1, -2], direct: [0, -2], wide: [1, 0], park: [1, 0] },
  possess: { press: [-2, -1], possess: [0, 0], counter: [0.5, -1.5], direct: [0.5, 1], wide: [0, 0.5], park: [0.5, 2] },
  counter: { press: [2.5, 0], possess: [2, 0], counter: [0, 0], direct: [0, 0.5], wide: [1.5, 0], park: [-2, 0] },
  direct: { press: [2, 0.5], possess: [0, -1], counter: [0, 0], direct: [0, 0], wide: [0, 0], park: [-1.5, 0] },
  wide: { press: [0.5, 0], possess: [0, 0], counter: [0, -1.5], direct: [0, 0], wide: [0, 0], park: [1.5, 0] },
  park: { press: [-1, 1], possess: [0, 1.5], counter: [0, 2], direct: [0, 1.5], wide: [0, -1], park: [0, 0] },
};

/**
 * 상대 전술에 따른 보정. 전방 압박과 점유의 싸움은 중원의 기술이 가른다:
 * 점유하는 쪽 미드필더가 2 이상 좋으면 압박이 벗겨져 결과가 뒤집힌다.
 * midEdge는 우리 미드필더 실력에서 상대 수준을 뺀 값이다.
 */
export function matchup(mine: StyleId, theirs: StyleId, midEdge: number): Delta {
  if (mine === 'possess' && theirs === 'press' && midEdge >= 2) return { att: 2, def: 0.5 };
  if (mine === 'press' && theirs === 'possess' && midEdge <= -2) return { att: -1, def: -1.5 };
  const [att, def] = MATCHUP[mine][theirs];
  return { att, def };
}

/** 우리 전술이 상대 전술에 얼마나 유리한지. 양수면 유리하다. */
export function advantage(mine: StyleId, theirs: StyleId, midEdge = 0): number {
  const a = matchup(mine, theirs, midEdge);
  const b = matchup(theirs, mine, -midEdge);
  return a.att + a.def - (b.att + b.def);
}

/** 상대 전술을 가장 잘 받아치는 전술. */
export function bestCounter(theirs: StyleId, midEdge = 0, exclude: StyleId[] = []): StyleId {
  const ids = (Object.keys(BASE) as StyleId[]).filter((id) => !exclude.includes(id));
  return ids.sort((x, y) => advantage(y, theirs, midEdge) - advantage(x, theirs, midEdge))[0] as StyleId;
}

export interface Shape {
  name: string;
  /** 중앙 수비, 중앙 미드필더, 중앙 공격수, 측면 인원. */
  cb: number;
  cm: number;
  cf: number;
  fl: number;
  /** 수비형 미드필더가 지키는 정도. 역습과 롱볼을 막는다. */
  guard: number;
  /** 대형 자체가 공격에 더하는 값. 앞에 사람을 많이 두면 양수, 원톱이 고립되면 음수다. */
  lift?: number;
  desc: string;
}

export const SHAPES: Record<ShapeId, Shape> = {
  '442': { name: '4-4-2', cb: 2, cm: 2, cf: 2, fl: 4, guard: 0, desc: '투톱으로 상대 중앙 수비와 맞선다. 중원이 얇다' },
  '433': { name: '4-3-3', cb: 2, cm: 3, cf: 1, fl: 4, guard: 0, desc: '전방 셋이 압박을 시작한다. 중원 셋' },
  '4231': { name: '4-2-3-1', cb: 2, cm: 3, cf: 1, fl: 4, guard: 1, desc: '수비형 미드필더 둘이 역습과 롱볼을 막는다' },
  '4141': { name: '4-1-4-1', cb: 2, cm: 3, cf: 1, fl: 4, guard: 2, lift: -0.8, desc: '포백 앞에 앵커 하나를 세운다. 역습에 가장 단단하고 원톱이 외롭다' },
  '4312': { name: '4-3-1-2', cb: 2, cm: 4, cf: 2, fl: 2, guard: 1, lift: -0.4, desc: '다이아몬드 중원. 가운데를 장악하고 측면은 풀백 혼자 맡는다' },
  '352': { name: '3-5-2', cb: 3, cm: 3, cf: 2, fl: 2, guard: 0, desc: '중앙이 두껍고 측면이 얇다' },
  '343': { name: '3-4-3', cb: 3, cm: 2, cf: 2, fl: 4, guard: 0, lift: 0.4, desc: '전방 셋과 윙백으로 몰아친다. 중원 둘이 버텨야 한다' },
  '541': { name: '5-4-1', cb: 3, cm: 2, cf: 1, fl: 4, guard: 1, desc: '가장 수비적인 대형. 원톱이 고립된다' },
};
export const SHAPE_IDS: ShapeId[] = ['442', '433', '4231', '4141', '4312', '352', '343', '541'];

/** 전술과 잘 맞는 대형. */
const FIT: Record<StyleId, ShapeId[]> = {
  press: ['433', '343', '4141'],
  possess: ['433', '4231', '352', '4312'],
  counter: ['442', '541', '4231', '4141'],
  direct: ['442', '352', '4312'],
  wide: ['442', '433', '4231', '343'],
  park: ['541', '4141'],
};

export const fits = (style: StyleId, shape: ShapeId): boolean => FIT[style].includes(shape);

/** 그 전술을 쓰는 감독이 흔히 세우는 대형. */
export const usualShape = (style: StyleId, pick: number): ShapeId => FIT[style][pick % FIT[style].length] as ShapeId;

/** 대형끼리의 구역별 수적 우위가 만드는 보정. */
export function shapeEdge(mine: ShapeId, theirs: ShapeId, myStyle: StyleId, theirStyle: StyleId): Delta {
  const a = SHAPES[mine];
  const b = SHAPES[theirs];
  let att = 0;
  let def = 0;
  // 중원: 숫자가 많은 쪽이 주도권을 쥔다. 공을 쥐거나 빼앗으려는 전술일수록 중요하다.
  const mid = (a.cm - b.cm) * (myStyle === 'possess' || myStyle === 'press' ? 1.5 : 1);
  att += mid * 0.8;
  def += mid * 0.6;
  // 측면: 어느 쪽이든 측면 공격을 쓰면 인원 차이가 크게 드러난다.
  const flank = (a.fl - b.fl) / 2;
  att += flank * (myStyle === 'wide' ? 1.2 : 0.3);
  def += flank * (theirStyle === 'wide' ? 1.2 : 0.3);
  // 문전: 중앙 수비가 상대 공격수보다 한 명 많아야 본전이다.
  def += (a.cb - b.cf - 1) * 0.8;
  att += (1 - (b.cb - a.cf)) * 0.8;
  if (theirStyle === 'counter' || theirStyle === 'direct') def += a.guard * 0.8;
  att += (a.lift ?? 0) - (b.lift ?? 0) * 0.5;
  def -= Math.max(0, a.lift ?? 0) * 0.5;
  if (fits(myStyle, mine)) {
    att += 0.5;
    def += 0.5;
  }
  return { att, def };
}

/** 지금의 전술 구도가 왜 유리하거나 불리한지를 한 문장으로. 뚜렷하지 않으면 null. */
export function why(mine: StyleId, theirs: StyleId, midEdge: number): { text: string; good: boolean } | null {
  const adv = advantage(mine, theirs, midEdge);
  if (Math.abs(adv) < 1.5) return null;
  const flipped = (mine === 'possess' && theirs === 'press' && midEdge >= 2) || (mine === 'press' && theirs === 'possess' && midEdge <= -2);
  const key = `${mine}>${theirs}`;
  const texts: Record<string, string> = {
    'press>possess': flipped ? '압박이 헛돌고 뒷공간이 열린다. 상대 미드필더의 기술이 한 수 위다' : '전방 압박이 상대의 빌드업을 끊고 있다',
    'possess>press': flipped ? '짧은 패스로 상대 압박을 벗겨 내고 있다' : '상대 압박에 빌드업이 막혀 공을 자꾸 잃는다',
    'press>counter': '높이 올라간 수비 뒤로 상대 역습이 날카롭다',
    'counter>press': '상대가 올라온 뒷공간으로 역습이 통한다',
    'press>direct': '상대의 긴 패스가 우리 압박을 건너뛴다',
    'direct>press': '긴 패스로 상대 압박을 건너뛰고 있다',
    'possess>counter': '공을 돌리다 끊기면 곧바로 역습을 맞는다',
    'counter>possess': '상대가 공을 돌리는 사이 빈 공간으로 치고 나간다',
    'possess>park': '공을 쥐고 상대를 자기 진영에 가둬 두고 있다',
    'park>possess': '촘촘한 두 줄 수비가 상대의 패스 길을 막는다. 대신 공을 잡을 일이 없다',
    'counter>park': '상대가 내려앉아 역습할 공간이 없다',
    'park>counter': '내려앉은 수비 앞에서 상대 역습이 설 자리가 없다',
    'direct>park': '긴 공은 상대 장신 수비에 번번이 걸린다',
    'park>direct': '높이 띄운 공을 수비가 모두 걷어 낸다',
    'wide>park': '측면을 넓게 벌려 상대의 밀집 수비를 흔들고 있다',
    'park>wide': '측면에서 올라오는 크로스에 수비가 흔들린다',
    'wide>counter': '풀백이 올라간 자리로 상대 역습이 들어온다',
    'counter>wide': '올라온 상대 풀백 뒤가 비어 있다',
    'possess>direct': '상대의 긴 공을 받아 내고 다시 경기를 쥔다',
    'direct>possess': '긴 공이 자꾸 상대에게 넘어가 점유를 내준다',
    'press>park': '상대를 자기 진영에 묶어 두었다. 다만 뚫을 공간이 좁다',
    'park>press': '상대 압박에 갇혀 하프라인을 넘기 어렵다',
    'press>wide': '측면으로 가는 패스를 미리 끊고 있다',
    'wide>press': '상대 압박에 측면 전개가 끊긴다',
  };
  return { text: texts[key] ?? (adv > 0 ? '전술 싸움에서 앞서고 있다' : '전술 싸움에서 밀리고 있다'), good: adv > 0 };
}

// ---------- 팀 지시와 개인 역할 ----------

/** 아무 지시도 없는 상태. */
export const NEUTRAL: Dials = { line: 0, width: 0, tempo: 0, overlap: false, press: 0, pass: 0, flank: 0, final: 0, lose: 0, win: 0, block: 0 };

/** 지시가 걸리는 국면: 공을 가졌을 때, 공이 없을 때, 공의 주인이 바뀌는 순간. */
export type DialPhase = 'att' | 'def' | 'turn';
export const PHASES: { id: DialPhase; name: string; desc: string }[] = [
  { id: 'att', name: '공격 시', desc: '우리가 공을 가졌을 때' },
  { id: 'def', name: '수비 시', desc: '상대가 공을 가졌을 때' },
  { id: 'turn', name: '전환', desc: '공의 주인이 바뀌는 순간' },
];

export type DialId = Exclude<keyof Dials, 'overlap'>;

/** 세 단계 지시들의 이름과 설명. 화면의 순서이기도 하다. */
export const DIALS: { id: DialId; phase: DialPhase; name: string; steps: [string, string, string]; desc: string }[] = [
  { id: 'tempo', phase: 'att', name: '템포', steps: ['느리게', '보통', '빠르게'], desc: '빠르면 공격이 날카롭고 체력이 빨리 닳는다' },
  { id: 'pass', phase: 'att', name: '패스', steps: ['짧게', '섞어서', '길게'], desc: '길게 차면 압박과 높은 라인을 건너뛰지만 밀집 수비에 걸린다' },
  { id: 'width', phase: 'att', name: '공격 폭', steps: ['좁게', '보통', '넓게'], desc: '넓히면 좁은 수비가 벌어지고, 잃었을 때 가운데가 헐겁다' },
  { id: 'flank', phase: 'att', name: '공격 방향', steps: ['왼쪽', '고루', '오른쪽'], desc: '잘하는 선수가 선 쪽으로 몰면 통한다. 상대도 그쪽을 막는다' },
  { id: 'final', phase: 'att', name: '마무리', steps: ['만들어 넣는다', '보통', '보이면 쏜다'], desc: '보이면 쏘면 밀집 수비를 두드리고, 만들어 넣으면 슈팅은 줄고 질이 오른다' },
  { id: 'line', phase: 'def', name: '수비 라인', steps: ['내린다', '보통', '올린다'], desc: '올리면 높은 곳에서 되찾지만 뒷공간이 열린다' },
  { id: 'press', phase: 'def', name: '압박', steps: ['기다린다', '보통', '달려든다'], desc: '달려들면 짧은 패스를 끊지만 긴 공에 약하고 체력이 빨리 닳는다' },
  { id: 'block', phase: 'def', name: '수비 폭', steps: ['좁게', '보통', '넓게'], desc: '좁히면 가운데가 단단하고 측면을 내준다. 넓히면 그 반대다' },
  { id: 'lose', phase: 'turn', name: '공을 잃으면', steps: ['물러선다', '보통', '즉시 압박'], desc: '즉시 압박은 점유하는 팀을 묶지만, 한 번 벗겨지면 역습을 맞는다' },
  { id: 'win', phase: 'turn', name: '공을 따내면', steps: ['지킨다', '보통', '바로 역습'], desc: '바로 역습은 올라온 상대의 뒤를 찌르고, 내려앉은 상대에게는 공만 돌려준다' },
];

/** 지시 하나를 말로. 예: "수비 라인 올린다". */
export const dialText = (id: DialId, level: Level): string => {
  const x = DIALS.find((q) => q.id === id) as (typeof DIALS)[number];
  return `${x.name} ${x.steps[level + 1]}`;
};

/**
 * 수비 라인, 폭, 템포, 풀백 오버래핑, 압박, 패스 길이가 만드는 보정. 어느 것이나 얻는 게 있으면 내주는 게 있고,
 * 상대 전술에 따라 손익이 달라진다. 공격 방향은 선수 구성에 달렸으므로 flankEdge가 따로 계산한다.
 */
export function dialEdge(d: Dials, myStyle: StyleId, theirStyle: StyleId): Delta {
  let att = 0;
  let def = 0;
  const behind = theirStyle === 'direct' || theirStyle === 'counter';
  if (d.line === 1) {
    // 라인을 올리면 높은 곳에서 공을 되찾지만 뒷공간이 열린다.
    att += 0.8;
    def += behind ? -1.8 : theirStyle === 'possess' ? 0.6 : -0.6;
  } else if (d.line === -1) {
    att -= 0.8;
    def += behind ? 1.6 : theirStyle === 'wide' ? -0.6 : 0.8;
  }
  if (d.width === 1) {
    att += myStyle === 'wide' || myStyle === 'possess' ? 0.6 : 0.2;
    def -= theirStyle === 'counter' ? 1 : 0.5;
  } else if (d.width === -1) {
    att -= 0.3;
    def += theirStyle === 'wide' ? -0.8 : 0.6;
  }
  if (d.tempo === 1) att += 0.6;
  if (d.tempo === -1) {
    att -= 0.4;
    def += 0.3;
  }
  if (d.overlap) {
    att += myStyle === 'wide' ? 1 : 0.6;
    def -= theirStyle === 'counter' ? 1.1 : 0.5;
  }
  if (d.press === 1) {
    // 달려들면 짧은 패스로 풀어 나오는 팀을 끊는다. 긴 공과 역습은 압박을 건너뛴다.
    def += theirStyle === 'possess' ? 1.1 : behind ? -1.1 : 0.2;
    att += myStyle === 'press' ? 0.5 : 0.2;
  } else if (d.press === -1) {
    def += behind ? 0.9 : theirStyle === 'possess' ? -0.9 : 0.1;
    att -= 0.3;
  }
  if (d.pass === 1) {
    // 긴 패스는 상대 압박을 건너뛰고, 내려앉은 수비에는 걸린다.
    att += (theirStyle === 'press' ? 1 : theirStyle === 'park' ? -0.9 : 0) + (myStyle === 'direct' || myStyle === 'counter' ? 0.3 : myStyle === 'possess' ? -0.5 : 0);
  } else if (d.pass === -1) {
    att += (theirStyle === 'park' ? 0.7 : theirStyle === 'press' ? -0.9 : 0.1) + (myStyle === 'possess' ? 0.3 : myStyle === 'direct' ? -0.5 : 0);
    def += 0.2;
  }
  if (d.final === 1) {
    // 보이면 쏜다: 내려앉은 수비는 중거리로 두드려야 열린다. 다른 상대에게는 좋은 기회를 버린다.
    att += theirStyle === 'park' ? 0.8 : -0.3;
  } else if (d.final === -1) {
    att += (myStyle === 'possess' ? 0.6 : 0.1) - (theirStyle === 'press' ? 0.5 : 0);
  }
  if (d.lose === 1) {
    // 잃자마자 달려든다: 풀어 나오려는 팀은 묶이고, 한 번에 넘기는 팀에게는 뒤를 내준다.
    def += theirStyle === 'possess' ? 1 : behind ? -1 : 0.2;
    att += 0.4;
  } else if (d.lose === -1) {
    def += behind ? 1 : theirStyle === 'possess' ? -0.5 : 0.2;
    att -= 0.3;
  }
  if (d.win === 1) {
    // 따내면 바로 나간다: 올라온 팀의 뒤가 비어 있다. 내려앉은 팀에게는 공을 돌려줄 뿐이다.
    att += theirStyle === 'press' || theirStyle === 'possess' ? 1 : theirStyle === 'park' ? -0.8 : 0.2;
    def -= 0.3;
  } else if (d.win === -1) {
    att += theirStyle === 'park' ? 0.4 : theirStyle === 'press' ? -0.6 : 0;
    def += 0.5;
  }
  if (d.block === -1) def += theirStyle === 'wide' ? -0.9 : 0.7;
  else if (d.block === 1) def += theirStyle === 'wide' ? 0.9 : theirStyle === 'possess' || theirStyle === 'direct' ? -0.6 : -0.1;
  return { att, def };
}

/**
 * 한 팀의 공격 지시(a)가 상대의 수비 지시(d)를 만나서 얻는 공격 보정. 양 팀에 한 번씩 쓴다:
 * 우리 공격 대 상대 수비는 우리 공격력에, 상대 공격 대 우리 수비는 상대 공격력에 더한다.
 * 가위바위보다. 높은 라인은 긴 패스와 역습에, 달려드는 압박은 긴 패스에, 좁은 수비는 넓은 공격에 진다.
 */
export function attackVs(a: Dials, d: Dials): { value: number; notes: string[] } {
  let value = 0;
  const notes: string[] = [];
  const add = (v: number, text: string): void => {
    value += v;
    notes.push(text);
  };
  if (d.line === 1) {
    if (a.pass === 1) add(0.9, '긴 패스가 높은 라인의 뒤로 떨어진다');
    if (a.win === 1) add(0.9, '역습이 높은 라인의 뒷공간을 판다');
    if (a.final === -1) add(0.4, '높은 라인 사이로 찔러 넣는다');
  } else if (d.line === -1) {
    if (a.pass === 1) add(-0.5, '긴 패스가 내려앉은 수비 머리에 걸린다');
    if (a.win === 1) add(-0.5, '역습할 뒷공간이 없다');
    if (a.final === 1) add(0.5, '내려앉은 수비 앞에서 중거리를 때린다');
    else if (a.final === -1) add(-0.4, '박스 안이 꽉 차 만들 틈이 없다');
  }
  if (d.press === 1) {
    if (a.pass === -1) add(-0.8, '짧은 패스가 압박에 걸린다');
    else if (a.pass === 1) add(0.6, '긴 패스로 압박을 건너뛴다');
    if (a.tempo === -1) add(-0.5, '천천히 돌리다 압박에 잡힌다');
  } else if (d.press === -1) {
    if (a.pass === -1) add(0.5, '기다리는 수비 앞에서 편하게 돌린다');
    if (a.tempo === 1) add(-0.3, '서둘러도 기다리는 수비는 흔들리지 않는다');
  }
  if (d.block === -1) {
    if (a.width === 1) add(0.8, '넓은 공격이 좁은 수비의 바깥을 돈다');
    else if (a.width === -1) add(-0.7, '좁은 공격이 좁은 수비에 막힌다');
  } else if (d.block === 1) {
    if (a.width === 1) add(-0.7, '넓은 수비가 측면을 미리 막는다');
    else if (a.width === -1) add(0.7, '벌어진 수비 사이 가운데를 뚫는다');
  }
  if (d.lose === 1) {
    if (a.win === 1) add(0.7, '달려드는 상대를 한 번에 벗기고 나간다');
    else if (a.win === -1) add(-0.6, '지키려다 즉시 압박에 다시 뺏긴다');
  } else if (d.lose === -1 && a.win === 1) add(-0.5, '물러선 수비 앞에서 역습이 멈춘다');
  return { value: Math.max(-2.5, Math.min(2.5, value)), notes };
}

type Need =
  | { dial: DialId; is: Level }
  | { overlap: true }
  | { flank: true }
  | { role: RoleId }
  | { noRole: RoleId[] };

/** 지시와 역할이 맞물려 생기는 효과. good이 false면 서로 어긋나는 조합이다. */
export interface Combo {
  id: string;
  name: string;
  text: string;
  att: number;
  def: number;
  /** 체력 소모 배수. */
  cost?: number;
  good: boolean;
  needs: Need[];
}

const is = (dial: DialId, level: Level): Need => ({ dial, is: level });

export const COMBOS: Combo[] = [
  { id: 'gegen', name: '게겐프레싱', text: '높은 라인에서 잃자마자 덮친다. 상대가 숨 쉴 틈이 없다', att: 1, def: 1.5, cost: 1.08, good: true, needs: [is('line', 1), is('press', 1), is('lose', 1)] },
  { id: 'lowcounter', name: '선수비 후역습', text: '내려앉아 끌어들인 뒤 긴 패스 한 번으로 뒤집는다', att: 1.5, def: 0.5, good: true, needs: [is('line', -1), is('win', 1), is('pass', 1)] },
  { id: 'break', name: '속공', text: '따내는 순간 모두가 빠르게 치고 나간다', att: 0.8, def: -0.3, cost: 1.04, good: true, needs: [is('win', 1), is('tempo', 1)] },
  { id: 'tiki', name: '티키타카', text: '공을 지키며 완벽한 기회까지 돌린다. 상대는 공을 구경만 한다', att: 1, def: 1, good: true, needs: [is('pass', -1), is('final', -1), is('win', -1)] },
  { id: 'overload', name: '측면 과부하', text: '한쪽 측면에 숫자를 몰아 2대1을 만든다', att: 1.4, def: -0.4, good: true, needs: [is('width', 1), { overlap: true }, { flank: true }] },
  { id: 'underlap', name: '언더래핑', text: '안으로 좁힌 자리 바깥을 풀백이 돌아 나간다', att: 0.8, def: 0, good: true, needs: [is('width', -1), { overlap: true }] },
  { id: 'longtarget', name: '타깃 롱볼', text: '긴 공을 타깃이 떨궈 주고 둘째 공을 줍는다', att: 1.2, def: 0, good: true, needs: [is('pass', 1), { role: 'target' }] },
  { id: 'trap', name: '압박 함정', text: '안쪽으로 몰아넣고 볼 위너가 끊는다', att: 0.3, def: 1, good: true, needs: [is('block', -1), is('press', 1), { role: 'hunter' }] },
  { id: 'bus', name: '두 줄 수비', text: '두 줄로 박스 앞을 잠근다. 뚫기 어렵지만 나갈 길도 멀다', att: -1, def: 1.5, good: true, needs: [is('line', -1), is('block', -1), is('press', -1)] },
  { id: 'highloose', name: '헐거운 높은 라인', text: '라인은 높은데 아무도 공을 쫓지 않는다. 뒷공간으로 편하게 찔린다', att: 0, def: -2, good: false, needs: [is('line', 1), is('press', -1)] },
  { id: 'deeprush', name: '끊어진 간격', text: '라인은 내렸는데 앞에서는 달려든다. 가운데가 뻥 뚫린다', att: 0, def: -1.2, good: false, needs: [is('line', -1), is('press', 1)] },
  { id: 'presslow', name: '혼자 뛰는 압박', text: '잃자마자 달려드는데 뒤는 멀리 있다. 한 번 벗겨지면 중원이 빈다', att: 0, def: -1, good: false, needs: [is('line', -1), is('lose', 1)] },
  { id: 'exposed', name: '비어 있는 뒤', text: '풀백도 라인도 올라갔는데 뒤를 지키는 선수가 없다. 홀딩이나 수비 전념을 한 명 두면 풀린다', att: 0, def: -1, good: false, needs: [is('line', 1), { overlap: true }, { noRole: ['hold', 'stay'] }] },
  { id: 'longslow', name: '느린 롱볼', text: '길게 차 놓고 천천히 따라간다. 떨어지는 공을 아무도 줍지 못한다', att: -1, def: 0, good: false, needs: [is('pass', 1), is('tempo', -1)] },
  { id: 'rushcraft', name: '급한 세공', text: '서두르면서 완벽한 기회를 기다린다. 손발이 어긋난다', att: -0.8, def: 0, good: false, needs: [is('tempo', 1), is('final', -1)] },
];

const ROLE_LABEL: Partial<Record<RoleId, string>> = { target: '타깃', hunter: '볼 위너', hold: '홀딩', stay: '수비 전념' };

function unmet(need: Need, d: Dials, roles: RoleId[]): string | null {
  if ('dial' in need) return d[need.dial] === need.is ? null : dialText(need.dial, need.is);
  if ('overlap' in need) return d.overlap ? null : '풀백 오버래핑';
  if ('flank' in need) return d.flank !== 0 ? null : '공격 방향을 한쪽으로';
  if ('role' in need) return roles.includes(need.role) ? null : `${ROLE_LABEL[need.role] ?? need.role} 역할`;
  return need.noRole.some((r) => roles.includes(r)) ? '' : null;
}

export interface ComboState {
  /** 지금 걸린 조합. */
  on: Combo[];
  /** 하나만 더 맞추면 완성되는 좋은 조합과, 모자란 그 하나. */
  near: { combo: Combo; missing: string; fix?: { dial: DialId | 'overlap'; level: Level } }[];
}

/** 지금 지시와 역할(경기장에 선 선수들의 역할 목록)로 걸리는 조합들. */
export function comboState(d: Dials, roles: RoleId[]): ComboState {
  const on: Combo[] = [];
  const near: ComboState['near'] = [];
  for (const combo of COMBOS) {
    const open = combo.needs.filter((need) => unmet(need, d, roles) !== null);
    const miss = open.map((need) => unmet(need, d, roles) as string);
    if (miss.length === 0) on.push(combo);
    // 지시를 둘 이상 맞춰 둔 조합만 권한다. 하나짜리는 아무 지시에나 걸려 시끄럽다.
    else if (combo.good && miss.length === 1 && miss[0] && combo.needs.length >= 2 && (combo.needs.length >= 3 || !('role' in (combo.needs[1] as Need)) || roles.length > 0)) {
      // 지시 하나로 채워지는 것이면 화면에서 바로 누를 수 있게 그 지시를 함께 준다.
      const need = open[0] as Need;
      const fix = 'dial' in need ? { dial: need.dial, level: need.is } : 'overlap' in need ? { dial: 'overlap' as const, level: 1 as Level } : undefined;
      near.push(fix ? { combo, missing: miss[0], fix } : { combo, missing: miss[0] });
    }
  }
  return { on, near };
}

/** 걸린 조합들의 보정 합. */
export function comboEdge(d: Dials, roles: RoleId[]): Delta {
  let att = 0;
  let def = 0;
  for (const c of comboState(d, roles).on) {
    att += c.att;
    def += c.def;
  }
  return { att, def };
}

/** 한 전술이 평소 들고 나오는 지시. 수준 높은 감독일수록 조합을 끝까지 맞춘다. */
export function presetDials(style: StyleId, iq: number): Dials {
  const full = iq >= 0.55;
  const d: Dials = { ...NEUTRAL };
  if (style === 'press') Object.assign(d, { line: 1, press: 1 }, full ? { lose: 1, tempo: 1 } : {});
  else if (style === 'possess') Object.assign(d, { pass: -1, final: -1 }, full ? { win: -1, width: 1 } : {});
  else if (style === 'counter') Object.assign(d, { line: -1, win: 1 }, full ? { pass: 1, press: -1 } : {});
  else if (style === 'direct') Object.assign(d, { pass: 1, final: 1 }, full ? { tempo: 1 } : {});
  else if (style === 'wide') Object.assign(d, { width: 1, overlap: true }, full ? { block: 1 } : {});
  else Object.assign(d, { line: -1, block: -1 }, full ? { press: -1 } : {});
  return d;
}

/** 두 지시의 차이를 말로. 달라진 것이 없으면 빈 배열. */
export function dialChanges(from: Dials, to: Dials): string[] {
  const out = DIALS.filter((x) => from[x.id] !== to[x.id]).map((x) => dialText(x.id, to[x.id]));
  if (from.overlap !== to.overlap) out.push(to.overlap ? '풀백 오버래핑' : '풀백 자리 지킴');
  return out;
}

/**
 * 공격 방향을 한쪽으로 몰았을 때의 보정. diff는 그쪽 측면 선수들의 평균 OVR에서 반대쪽 평균을 뺀 값이다.
 * 좋은 선수가 선 쪽으로 몰면 통하고, 상대가 읽기 쉬워지는 만큼은 손해다.
 */
export function flankEdge(d: Dials, diff: number, myStyle: StyleId): Delta {
  if (d.flank === 0) return { att: 0, def: 0 };
  return { att: Math.max(-1.2, Math.min(1.4, diff * 0.22)) - 0.3 + (myStyle === 'wide' ? 0.2 : 0), def: 0 };
}

/** 템포와 압박이 체력 소모에 주는 배수. */
export const tempoCost = (d: Dials): number =>
  (d.tempo === 1 ? 1.15 : d.tempo === -1 ? 0.9 : 1) * (d.press === 1 ? 1.12 : d.press === -1 ? 0.93 : 1) * (d.lose === 1 ? 1.06 : d.lose === -1 ? 0.97 : 1)
  * comboState(d, []).on.reduce((k, c) => k * (c.cost ?? 1), 1);

/** 공격 대형과 수비 대형을 따로 쓸 때 오가는 부담(수비 보정에서 빼고, 공격 보정에서는 그 0.4배를 뺀다). 두 대형이 많이 다를수록 크다. */
export function shiftCost(att: ShapeId, def: ShapeId | undefined): number {
  if (!def || def === att) return 0;
  const a = SHAPES[att];
  const b = SHAPES[def];
  return Math.min(1.5, 0.3 + 0.25 * (Math.abs(a.cb - b.cb) + Math.abs(a.cm - b.cm) + Math.abs(a.cf - b.cf)));
}

export interface Role {
  id: RoleId;
  name: string;
  desc: string;
}

const mk = (id: RoleId, name: string, desc: string): Role => ({ id, name, desc });

const R_STOPPER = mk('stopper', '전진 수비', '앞으로 나가 끊는다. 짧은 패스에 강하고 뒷공간에 약하다');
const R_MARK = mk('mark', '대인 마크', '상대 에이스를 따라다닌다. 수비 대형은 조금 흐트러진다');
const R_HOLD = mk('hold', '홀딩', '수비 앞을 지킨다. 역습을 막고 공격 가담이 준다');
const R_MAKER = mk('maker', '플레이메이커', '공이 이 선수를 거친다. 잘할수록 효과가 크고, 압박의 표적이 된다');
const R_RUNNER = mk('runner', '침투', '박스 안으로 뛰어든다. 뒤가 빈다');
const R_HUNTER = mk('hunter', '볼 위너', '공을 쫓아가 빼앗는다. 점유하는 팀에 강하고 긴 공에는 헛돈다');
const FULLBACK: Role[] = [
  mk('base', '풀백', '기본. 수비를 먼저 보고 틈이 나면 올라간다'),
  mk('wing', '공격형 풀백', '윙어처럼 높이 올라간다. 측면 공격이 살고 뒤가 빈다'),
  mk('invert', '인버티드 풀백', '공을 잡으면 중원으로 들어온다. 점유와 역습 대비에 좋고 측면 폭은 준다'),
  mk('stay', '수비 전념', '하프라인을 넘지 않는다. 측면과 역습을 막고 공격 숫자가 준다'),
];
const WIDE = (base: string): Role[] => [
  mk('base', base, '기본. 측면을 오르내린다'),
  mk('inside', '안으로 좁힌다', '공격 때 가운데로 파고든다. 잘할수록 효과가 크고, 밀집 수비에는 막힌다'),
  mk('hug', '터치라인', '끝까지 벌려 선다. 밀집 수비를 벌리고 측면 공격과 잘 맞는다'),
  mk('track', '수비 가담', '풀백 앞까지 내려와 막는다. 상대 측면 공격을 막고 역습 숫자가 준다'),
];

/** 자리(세부 포지션)마다 고를 수 있는 역할. 첫째가 기본 역할이다. */
export const ROLES: Record<Spot, Role[]> = {
  GK: [
    mk('base', '골문을 지킨다', '기본'),
    mk('sweeper', '스위퍼 키퍼', '라인을 올렸을 때 뒷공간을 지운다. 가끔 실수한다'),
  ],
  CB: [
    mk('base', '커버', '기본. 자리를 지킨다'),
    R_STOPPER, R_MARK,
    mk('libero', '리베로', '공을 잡으면 중원까지 올라가 숫자를 보탠다. 점유에 좋고 역습에 약하다'),
  ],
  LB: FULLBACK,
  RB: FULLBACK,
  CDM: [mk('base', '수비형 미드필더', '기본. 수비 앞에서 공을 받아 준다'), R_HOLD, R_MAKER, R_HUNTER],
  CM: [mk('base', '박스 투 박스', '기본. 공수를 오간다'), R_HOLD, R_MAKER, R_RUNNER, R_HUNTER],
  CAM: [
    mk('base', '공격형 미드필더', '기본. 공격수 뒤에서 받는다'),
    R_MAKER, R_RUNNER,
    mk('shadow', '섀도 스트라이커', '공격수처럼 최전방에 선다. 잘할수록 효과가 크고 중원이 빈다'),
  ],
  LM: WIDE('측면 미드필더'),
  RM: WIDE('측면 미드필더'),
  LW: WIDE('윙어'),
  RW: WIDE('윙어'),
  ST: [
    mk('base', '침투', '기본. 수비 뒷공간을 노린다'),
    mk('link', '내려와 연계', '중원에 숫자를 보탠다. 박스 안이 빈다'),
    mk('target', '타깃', '공중볼을 따낸다. 롱볼, 측면 공격과 잘 맞는다'),
    mk('drift', '측면으로 빠진다', '수비를 벌린다. 밀집 수비에 통한다'),
    mk('poach', '포처', '수비 사이에 서서 골만 노린다. 역습, 롱볼과 잘 맞고 수비 가담이 없다'),
    mk('harry', '압박 공격수', '상대 수비수가 공을 잡으면 달려든다. 점유하는 팀에 통하고 문전 힘이 조금 빠진다'),
  ],
};

/** 그 자리에서 그 역할을 맡길 수 있는지. */
export const roleFits = (spot: Spot, id: string): id is RoleId => ROLES[spot].some((r) => r.id === id);

/** 그 자리에서 그 역할의 이름. 기본 역할의 이름은 자리마다 다르다. */
export const roleName = (spot: Spot, id: RoleId): string => (ROLES[spot].find((r) => r.id === id) ?? (ROLES[spot][0] as Role)).name;

export interface RoleInput {
  pos: Pos;
  role: RoleId;
  /** 선수가 이 무대 수준보다 얼마나 잘하는지에 따른 배수(0.5~1.5). */
  scale: number;
}

/** 개인 역할들이 만드는 보정. oAtt는 상대 공격력에 더하는 값(대인 마크면 음수)이다. */
export function roleEdge(list: RoleInput[], myStyle: StyleId, theirStyle: StyleId, d: Dials): Delta & { oAtt: number } {
  let att = 0;
  let def = 0;
  let oAtt = 0;
  const behind = theirStyle === 'direct' || theirStyle === 'counter';
  for (const { role, scale } of list) {
    if (role === 'sweeper') def += d.line === 1 ? 0.7 : -0.2;
    else if (role === 'stopper') def += behind ? -0.7 : 0.6 * scale;
    else if (role === 'mark') {
      oAtt -= scale;
      def -= 0.3;
    } else if (role === 'hold') {
      def += 0.7 + (theirStyle === 'counter' ? 0.5 : 0);
      att -= 0.4;
    } else if (role === 'maker') att += 0.7 * scale - (theirStyle === 'press' ? 0.5 : 0);
    else if (role === 'runner') {
      att += 0.6;
      def -= 0.5;
    } else if (role === 'link') {
      att += myStyle === 'possess' ? 0.6 : 0.1;
      def += 0.3;
    } else if (role === 'target') att += myStyle === 'direct' || myStyle === 'wide' ? 0.8 * scale : -0.2;
    else if (role === 'drift') att += theirStyle === 'park' ? 0.7 : -0.1;
    else if (role === 'libero') {
      att += myStyle === 'possess' ? 0.7 * scale : 0.3;
      def -= behind ? 0.8 : 0.2;
    } else if (role === 'wing') {
      att += myStyle === 'wide' ? 0.9 : 0.5;
      def -= theirStyle === 'counter' ? 0.9 : 0.4;
    } else if (role === 'invert') {
      att += myStyle === 'possess' ? 0.5 : myStyle === 'wide' ? -0.5 : 0.1;
      def += theirStyle === 'counter' ? 0.6 : 0.2;
    } else if (role === 'stay') {
      def += theirStyle === 'wide' || theirStyle === 'counter' ? 0.8 : 0.4;
      att -= 0.4;
    } else if (role === 'hunter') {
      def += theirStyle === 'possess' ? 0.8 * scale : theirStyle === 'direct' ? -0.4 : 0.3;
      att -= 0.2;
    } else if (role === 'shadow') {
      att += 0.8 * scale;
      def -= 0.5;
    } else if (role === 'inside') att += 0.7 * scale - (theirStyle === 'park' ? 0.7 : 0);
    else if (role === 'hug') att += theirStyle === 'park' ? 0.8 : myStyle === 'wide' ? 0.6 : 0.1;
    else if (role === 'track') {
      def += theirStyle === 'wide' ? 0.9 : 0.5;
      att -= 0.5;
    } else if (role === 'poach') {
      att += myStyle === 'counter' || myStyle === 'direct' ? 0.8 * scale : 0.3;
      def -= 0.4;
    } else if (role === 'harry') {
      def += theirStyle === 'possess' ? 0.7 : 0.3;
      att += myStyle === 'press' ? 0.3 : -0.2;
    }
  }
  // 역할을 여럿 겹쳐도 팀 전체로는 3점까지만 움직인다.
  const cap = (x: number): number => Math.max(-3, Math.min(3, x));
  return { att: cap(att), def: cap(def), oAtt };
}
