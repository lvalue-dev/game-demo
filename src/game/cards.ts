import type { HeistState, Role } from './types.ts';

/** 카드 효과가 작전 상태를 바꿀 때 쓰는 창구. 엔진이 구현한다. */
export interface PlayApi {
  /** 털이 카드의 수익과 경보. 2배, 경보 무시, 금고 절반 규칙이 여기서 적용된다. */
  steal(base: number, heat: number): void;
  addLoot(n: number): void;
  addHeat(n: number): void;
  addEscape(n: number): void;
  addEnergy(n: number): void;
  draw(n: number): void;
}

export interface CardDef {
  id: string;
  name: string;
  role: Role;
  cost: number;
  text: string;
  /** 상점 가격. 시작 카드는 0. */
  price: number;
  /** 시작 덱에 들어가는 장수. */
  starter: number;
  /** 상황에 따라 결과가 달라지는 카드. 화면에 "지금 내면" 미리보기를 보여준다. */
  dynamic?: boolean;
  canPlay?: (h: HeistState) => boolean;
  play: (h: HeistState, api: PlayApi) => void;
}

export const ROLE_NAMES: Record<Role, string> = {
  loot: '털이',
  cover: '은폐',
  escape: '도주',
  tech: '기술',
};

const defs: CardDef[] = [
  // 시작 덱
  {
    id: 'thief', name: '좀도둑', role: 'loot', cost: 1, price: 0, starter: 4,
    text: '수익 +3, 경보 +1',
    play: (_h, api) => api.steal(3, 1),
  },
  {
    id: 'lookout', name: '망꾼', role: 'cover', cost: 1, price: 0, starter: 3,
    text: '경보 −2',
    play: (_h, api) => api.addHeat(-2),
  },
  {
    id: 'driver', name: '운전수', role: 'escape', cost: 1, price: 0, starter: 2,
    text: '도주 준비 +1',
    play: (_h, api) => api.addEscape(1),
  },
  {
    id: 'rookie', name: '눈치 빠른 막내', role: 'tech', cost: 0, price: 0, starter: 1,
    text: '카드 1장 뽑기',
    play: (_h, api) => api.draw(1),
  },

  // 털이
  {
    id: 'pickpocket', name: '소매치기', role: 'loot', cost: 0, price: 5, starter: 0,
    text: '수익 +2',
    play: (_h, api) => api.steal(2, 0),
  },
  {
    id: 'safecracker', name: '금고털이', role: 'loot', cost: 2, price: 7, starter: 0,
    text: '수익 +8, 경보 +2',
    play: (_h, api) => api.steal(8, 2),
  },
  {
    id: 'demolition', name: '폭파 전문가', role: 'loot', cost: 2, price: 8, starter: 0,
    text: '수익 +14, 경보 +5',
    play: (_h, api) => api.steal(14, 5),
  },
  {
    id: 'gambler', name: '한탕주의자', role: 'loot', cost: 1, price: 7, starter: 0, dynamic: true,
    text: '경보가 7 이상이면 수익 +10, 아니면 수익 +2. 경보 +1',
    play: (h, api) => api.steal(h.heat >= 7 ? 10 : 2, 1),
  },
  {
    id: 'sweeper', name: '싹쓸이', role: 'loot', cost: 1, price: 8, starter: 0, dynamic: true,
    text: '이번 턴에 낸 카드 1장당 수익 +2 (이 카드 포함). 경보 +1',
    play: (h, api) => api.steal(2 * h.playedThisTurn, 1),
  },

  // 은폐
  {
    id: 'decoy', name: '바람잡이', role: 'cover', cost: 1, price: 5, starter: 0,
    text: '경보 −3',
    play: (_h, api) => api.addHeat(-3),
  },
  {
    id: 'bribe', name: '뇌물', role: 'cover', cost: 0, price: 5, starter: 0,
    text: '수익 −3, 경보 −3. 수익이 3 이상일 때만 낼 수 있다',
    canPlay: (h) => h.loot >= 3,
    play: (_h, api) => {
      api.addLoot(-3);
      api.addHeat(-3);
    },
  },
  {
    id: 'disguise', name: '변장의 달인', role: 'cover', cost: 1, price: 7, starter: 0, dynamic: true,
    text: '경보 −1. 그 뒤 경보가 3 이하이면 행동력 +1',
    play: (h, api) => {
      api.addHeat(-1);
      if (h.heat <= 3) api.addEnergy(1);
    },
  },
  {
    id: 'insider', name: '내부자', role: 'cover', cost: 2, price: 8, starter: 0,
    text: '이번 턴 끝의 순찰을 무시한다. 카드 1장 뽑기',
    play: (h, api) => {
      h.ignorePatrol = true;
      api.draw(1);
    },
  },

  // 도주
  {
    id: 'vetdriver', name: '베테랑 운전수', role: 'escape', cost: 1, price: 6, starter: 0,
    text: '도주 준비 +2',
    play: (_h, api) => api.addEscape(2),
  },
  {
    id: 'backdoor', name: '뒷문 담당', role: 'escape', cost: 1, price: 6, starter: 0,
    text: '도주 준비 +1, 경보 −1',
    play: (_h, api) => {
      api.addEscape(1);
      api.addHeat(-1);
    },
  },
  {
    id: 'routeplanner', name: '도주로 설계자', role: 'escape', cost: 2, price: 9, starter: 0, dynamic: true,
    text: '도주 준비 +2. 그 뒤 도주 준비 1당 수익 +1',
    play: (h, api) => {
      api.addEscape(2);
      api.addLoot(h.escape);
    },
  },

  // 기술
  {
    id: 'hacker', name: '해커', role: 'tech', cost: 1, price: 7, starter: 0,
    text: '이번 턴에 다음으로 내는 털이 카드는 경보가 오르지 않는다',
    play: (h) => {
      h.nextLootNoHeat = true;
    },
  },
  {
    id: 'strategist', name: '작전 참모', role: 'tech', cost: 1, price: 9, starter: 0,
    text: '이번 턴에 다음으로 내는 털이 카드의 수익이 2배',
    play: (h) => {
      h.nextLootDouble = true;
    },
  },
  {
    id: 'planner', name: '설계자', role: 'tech', cost: 1, price: 7, starter: 0,
    text: '카드 2장 뽑기',
    play: (_h, api) => api.draw(2),
  },
  {
    id: 'mastermind', name: '배후', role: 'tech', cost: 1, price: 10, starter: 0,
    text: '행동력 +2',
    play: (_h, api) => api.addEnergy(2),
  },
];

export const CARDS: Record<string, CardDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const ALL_CARD_IDS: string[] = defs.map((d) => d.id);
export const RECRUIT_IDS: string[] = defs.filter((d) => d.starter === 0).map((d) => d.id);

export function cardDef(id: string): CardDef {
  const def = CARDS[id];
  if (!def) throw new Error(`알 수 없는 카드: ${id}`);
  return def;
}
