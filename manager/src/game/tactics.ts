// 전술과 대형의 상성. 근거는 TACTICS.md에 정리했다.
// 모든 보정은 "감독 팀" 쪽 공격력과 수비력에 더하는 값이다. 상대의 손해는 우리 이득으로 표현된다.
import type { ShapeId, StyleId } from './types.ts';

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
  desc: string;
}

export const SHAPES: Record<ShapeId, Shape> = {
  '442': { name: '4-4-2', cb: 2, cm: 2, cf: 2, fl: 4, guard: 0, desc: '투톱으로 상대 중앙 수비와 맞선다. 중원이 얇다' },
  '433': { name: '4-3-3', cb: 2, cm: 3, cf: 1, fl: 4, guard: 0, desc: '전방 셋이 압박을 시작한다. 중원 셋' },
  '4231': { name: '4-2-3-1', cb: 2, cm: 3, cf: 1, fl: 4, guard: 1, desc: '수비형 미드필더 둘이 역습과 롱볼을 막는다' },
  '352': { name: '3-5-2', cb: 3, cm: 3, cf: 2, fl: 2, guard: 0, desc: '중앙이 두껍고 측면이 얇다' },
  '541': { name: '5-4-1', cb: 3, cm: 2, cf: 1, fl: 4, guard: 1, desc: '가장 수비적인 대형. 원톱이 고립된다' },
};
export const SHAPE_IDS: ShapeId[] = ['442', '433', '4231', '352', '541'];

/** 전술과 잘 맞는 대형. */
const FIT: Record<StyleId, ShapeId[]> = {
  press: ['433'],
  possess: ['433', '4231', '352'],
  counter: ['442', '541', '4231'],
  direct: ['442', '352'],
  wide: ['442', '433', '4231'],
  park: ['541'],
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
