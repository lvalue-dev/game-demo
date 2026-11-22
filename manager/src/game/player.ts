// 선수의 세부 정보: 세부 포지션, 주발과 약발, 키, 능력치 여섯 가지.
// 능력치는 오버롤(OVR)에 포지션별 기본 차이와 선수 개인차를 더해 낸다. 그래서 선수가 크거나 지면
// 능력치도 함께 오르내리고, 경기 엔진은 개인차(dev)만 쓰므로 팀 전체의 득점 수준은 흔들리지 않는다.
import { int, rand, spread } from './rng.ts';
import type { Rng } from './rng.ts';
import type { Foot, Player, Pos, Spot } from './types.ts';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 필드 플레이어 능력치. 골키퍼는 같은 자리에 다른 이름을 쓴다(다이빙, 핸들링, 킥, 반응속도, 스피드, 위치선정). */
export const STAT_NAMES = ['속도', '슈팅', '패스', '드리블', '수비', '피지컬'];
export const STAT_SHORT = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
export const GK_STAT_NAMES = ['다이빙', '핸들링', '킥', '반응속도', '스피드', '위치선정'];
export const GK_STAT_SHORT = ['DIV', 'HAN', 'KIC', 'REF', 'SPD', 'POS'];

export const SPOTS: Record<Spot, { pos: Pos; name: string; side: -1 | 0 | 1 }> = {
  GK: { pos: 'GK', name: '골키퍼', side: 0 },
  CB: { pos: 'DF', name: '센터백', side: 0 },
  LB: { pos: 'DF', name: '레프트백', side: -1 },
  RB: { pos: 'DF', name: '라이트백', side: 1 },
  CDM: { pos: 'MF', name: '수비형 미드필더', side: 0 },
  CM: { pos: 'MF', name: '중앙 미드필더', side: 0 },
  CAM: { pos: 'MF', name: '공격형 미드필더', side: 0 },
  LM: { pos: 'MF', name: '왼쪽 미드필더', side: -1 },
  RM: { pos: 'MF', name: '오른쪽 미드필더', side: 1 },
  LW: { pos: 'FW', name: '왼쪽 윙어', side: -1 },
  RW: { pos: 'FW', name: '오른쪽 윙어', side: 1 },
  ST: { pos: 'FW', name: '스트라이커', side: 0 },
};

/** 포지션마다 오버롤과 능력치의 기본 차이(속도, 슈팅, 패스, 드리블, 수비, 피지컬 순). */
const PROFILE: Record<Spot, number[]> = {
  GK: [1, 0, -8, 2, -25, 1],
  CB: [-6, -22, -8, -12, 6, 6],
  LB: [5, -16, -2, -2, 3, -2],
  RB: [5, -16, -2, -2, 3, -2],
  CDM: [-5, -10, 2, -4, 5, 4],
  CM: [-3, -3, 5, 2, -4, 0],
  CAM: [0, 2, 6, 6, -18, -6],
  LM: [6, -3, 3, 3, -12, -4],
  RM: [6, -3, 3, 3, -12, -4],
  LW: [8, 1, -1, 6, -24, -6],
  RW: [8, 1, -1, 6, -24, -6],
  ST: [2, 6, -4, 2, -22, 2],
};

const SPOT_ODDS: Record<Pos, [Spot, number][]> = {
  GK: [['GK', 1]],
  DF: [['CB', 0.55], ['LB', 0.22], ['RB', 0.23]],
  MF: [['CDM', 0.2], ['CM', 0.35], ['CAM', 0.2], ['LM', 0.12], ['RM', 0.13]],
  FW: [['ST', 0.6], ['LW', 0.2], ['RW', 0.2]],
};

export const FOOT_NAME: Record<Foot, string> = { R: '오른발', L: '왼발', B: '양발' };

/** 외국인 선수의 국적 후보. 유럽 무대는 잉글랜드 선수도 섞인다. */
export const NATIONS_KR = ['브라질', '브라질', '일본', '호주', '콜롬비아', '세르비아', '아르헨티나', '나이지리아', '포르투갈', '스페인', '우즈베키스탄', '크로아티아'];
export const NATIONS_EU = ['잉글랜드', '잉글랜드', '잉글랜드', '프랑스', '스페인', '포르투갈', '브라질', '네덜란드', '독일', '이탈리아', '벨기에', '아르헨티나', '덴마크', '노르웨이', '세네갈', '미국'];

const RANK: Record<Pos, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };

/** 옆 줄로 가도 어색하지 않은 포지션(수비형 미드필더의 수비 가담, 윙어의 측면 미드필더 등). */
const BRIDGE: Partial<Record<Spot, Pos>> = { CDM: 'DF', CB: 'MF', LB: 'MF', RB: 'MF', CAM: 'FW', LM: 'FW', RM: 'FW', LW: 'MF', RW: 'MF', ST: 'MF' };

/** 자기 포지션이 아닌 줄에 세웠을 때 깎이는 OVR. */
export function posPenalty(spot: Spot, line: Pos): number {
  const nat = SPOTS[spot].pos;
  if (nat === line) return 0;
  if (nat === 'GK' || line === 'GK') return 25;
  const dist = Math.abs(RANK[nat] - RANK[line]);
  if (dist === 1) return BRIDGE[spot] === line ? 2 : 5;
  return 10;
}

/** 그 줄의 대표 세부 포지션. 포지션 밖에 세운 선수가 경기장에서 서는 자리다. */
export const LINE_SPOT: Record<Pos, Spot> = { GK: 'GK', DF: 'CB', MF: 'CM', FW: 'ST' };

export interface Detail {
  spot: Spot;
  foot: Foot;
  /** 약발(1~5). */
  weak: number;
  height: number;
  /** 같은 포지션 선수들과 견준 개인차. 여섯 능력치 순서. */
  dev: number[];
}

/** 포지션에 맞는 세부 정보를 지어낸다. spot을 주면 그 포지션으로 만든다. */
export function makeDetail(r: Rng, pos: Pos, spot?: Spot): Detail {
  let s = spot;
  if (!s) {
    let roll = rand(r);
    s = (SPOT_ODDS[pos][SPOT_ODDS[pos].length - 1] as [Spot, number])[0];
    for (const [id, p] of SPOT_ODDS[pos]) {
      roll -= p;
      if (roll <= 0) {
        s = id;
        break;
      }
    }
  }
  const side = SPOTS[s].side;
  const q = rand(r);
  // 왼쪽 측면 선수는 왼발잡이가 많다. 양발잡이는 드물다.
  const foot: Foot = q < 0.05 ? 'B' : side === -1 ? (q < 0.72 ? 'L' : 'R') : q < 0.22 ? 'L' : 'R';
  const weak = foot === 'B' ? int(r, 4, 5) : int(r, 1, 4);
  const height = s === 'GK' ? int(r, 184, 198) : s === 'CB' ? int(r, 180, 195) : s === 'ST' ? int(r, 172, 192) : int(r, 166, 186);
  const dev = PROFILE[s].map(() => Math.round(spread(r, -6, 6)));
  // 키가 크면 피지컬이, 작으면 드리블이 조금 낫다.
  dev[5] = (dev[5] as number) + Math.round((height - 180) / 5);
  dev[3] = (dev[3] as number) - Math.round((height - 180) / 8);
  return { spot: s, foot, weak, height, dev };
}

/** 이전 버전에서 넘어온 선수에게 세부 정보를 채워 준다. 선수 번호로 정하므로 몇 번을 불러도 같다. */
export function ensureDetail(p: Player): void {
  if (p.spot) return;
  const d = makeDetail({ rng: Math.imul(p.id + 1, 2654435761) | 0 }, p.pos);
  Object.assign(p, d);
}

/** 이름에 띄어쓰기가 있으면 외국 이름으로 지은 선수다. 이전 저장에서 국적을 채울 때 쓴다. */
export function guessNat(p: Player, region: 'kr' | 'eu'): string {
  if (!p.name.includes(' ')) return '대한민국';
  const list = region === 'eu' ? NATIONS_EU : NATIONS_KR;
  return list[p.id % list.length] as string;
}

/** 화면에 보여 줄 능력치 여섯 개. */
export function statsOf(p: { ovr: number; temp?: number; spot: Spot; dev: number[] }): number[] {
  const base = p.ovr + (p.temp ?? 0);
  return PROFILE[p.spot].map((d, k) => clamp(Math.round(base + d + (p.dev[k] ?? 0)), 15, 99));
}

export const statNames = (spot: Spot): { names: string[]; short: string[] } =>
  spot === 'GK' ? { names: GK_STAT_NAMES, short: GK_STAT_SHORT } : { names: STAT_NAMES, short: STAT_SHORT };

/** 짧은 소개: "ST · 왼발 · 183cm". */
export const profileText = (p: { spot: Spot; foot: Foot; height: number }): string => `${p.spot} · ${FOOT_NAME[p.foot]} · ${p.height}cm`;
