export type Role = 'loot' | 'cover' | 'escape' | 'tech';

/** 덱에 들어 있는 카드 한 장. 같은 종류라도 uid로 구분한다. */
export interface CardInst {
  uid: number;
  id: string;
}

export interface HeistState {
  drawPile: CardInst[];
  hand: CardInst[];
  discard: CardInst[];
  loot: number;
  heat: number;
  escape: number;
  energy: number;
  turn: number;
  playedThisTurn: number;
  /** 이번 작전에서 낸 기술 카드 수. 은행 금고를 여는 데 쓴다. */
  techPlayed: number;
  nextLootNoHeat: boolean;
  nextLootDouble: boolean;
  ignorePatrol: boolean;
}

export interface ShopOffer {
  id: string;
  price: number;
  sold: boolean;
}

export interface ShopState {
  offers: ShopOffer[];
  /** 돈을 내지 않고 영입할 수 있는 남은 횟수. */
  freePicks: number;
}

export type Phase = 'heist' | 'shop' | 'won' | 'busted';

export interface HeistResult {
  location: string;
  loot: number;
  quota: number;
  kept: number;
  turns: number;
}

export interface GameState {
  version: number;
  rng: number;
  phase: Phase;
  deck: CardInst[];
  money: number;
  heistIndex: number;
  heist: HeistState | null;
  shop: ShopState | null;
  nextUid: number;
  message: string;
  lastResult: HeistResult | null;
}

export interface LocationDef {
  name: string;
  quota: number;
  escapeNeeded: number;
  /** 1턴의 순찰 값. 이후 PATROL_STEP_TURNS턴마다 1씩 오른다. */
  patrol: number;
  /** 금고: 기술 카드를 이만큼 내기 전까지 털이 수익이 절반. 0이면 금고 없음. */
  vaultTech: number;
}
