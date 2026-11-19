import { ALL_CARD_IDS, RECRUIT_IDS, cardDef } from './cards.ts';
import type { PlayApi } from './cards.ts';
import { eul } from './josa.ts';
import { LOCATIONS } from './locations.ts';
import { shuffle } from './rng.ts';
import type { CardInst, GameState, HeistState, LocationDef } from './types.ts';

export const STATE_VERSION = 3;
export const HEAT_LIMIT = 10;
export const ENERGY_PER_TURN = 3;
export const HAND_SIZE = 5;
export const MAX_HAND = 10;
export const SHOP_OFFERS = 3;
export const REROLL_COST = 2;
export const REMOVE_COST = 5;
export const MIN_DECK = 6;
/** 순찰은 이 턴 수마다 1씩 세진다. 오래 버틸수록 위험해지게 하는 장치다. */
export const PATROL_STEP_TURNS = 3;
/** 작전을 마치면 상점에서 이만큼은 돈을 내지 않고 영입한다. */
export const FREE_PICKS = 1;

export function newGame(seed: number): GameState {
  const g: GameState = {
    version: STATE_VERSION,
    rng: seed | 0,
    phase: 'heist',
    deck: [],
    money: 0,
    heistIndex: 0,
    heist: null,
    shop: null,
    nextUid: 1,
    message: '',
    lastResult: null,
  };
  for (const id of ALL_CARD_IDS) {
    for (let i = 0; i < cardDef(id).starter; i++) addCardToDeck(g, id);
  }
  startHeist(g);
  return g;
}

export function addCardToDeck(g: GameState, id: string): CardInst {
  const card: CardInst = { uid: g.nextUid++, id };
  g.deck.push(card);
  return card;
}

export function currentLocation(g: GameState): LocationDef {
  return LOCATIONS[g.heistIndex]!;
}

export function patrolAt(loc: LocationDef, turn: number): number {
  return loc.patrol + Math.floor((turn - 1) / PATROL_STEP_TURNS);
}

/** 지금 턴을 끝내면 오를 경보. */
export function pendingPatrol(g: GameState): number {
  const h = g.heist;
  if (!h || h.ignorePatrol) return 0;
  return patrolAt(currentLocation(g), h.turn);
}

export function vaultLocked(g: GameState): boolean {
  const h = g.heist;
  const loc = currentLocation(g);
  return !!h && loc.vaultTech > 0 && h.techPlayed < loc.vaultTech;
}

function startHeist(g: GameState): void {
  const loc = currentLocation(g);
  g.phase = 'heist';
  g.shop = null;
  g.heist = {
    drawPile: shuffle(g, g.deck.map((c) => ({ ...c }))),
    hand: [],
    discard: [],
    loot: 0,
    heat: 0,
    escape: 0,
    energy: 0,
    turn: 0,
    playedThisTurn: 0,
    techPlayed: 0,
    nextLootNoHeat: false,
    nextLootDouble: false,
    ignorePatrol: false,
  };
  g.message = `${loc.name}: 수익 ${loc.quota} 이상을 챙기고 도주 준비 ${loc.escapeNeeded} 이상을 채워 빠져나가라.`;
  startTurn(g);
}

function startTurn(g: GameState): void {
  const h = g.heist!;
  h.turn += 1;
  h.energy = ENERGY_PER_TURN;
  h.playedThisTurn = 0;
  h.nextLootNoHeat = false;
  h.nextLootDouble = false;
  h.ignorePatrol = false;
  drawCards(g, HAND_SIZE);
}

function drawCards(g: GameState, n: number): void {
  const h = g.heist!;
  for (let i = 0; i < n; i++) {
    if (h.hand.length >= MAX_HAND) return;
    if (h.drawPile.length === 0) {
      if (h.discard.length === 0) return;
      h.drawPile = shuffle(g, h.discard);
      h.discard = [];
    }
    h.hand.push(h.drawPile.pop()!);
  }
}

function makeApi(g: GameState): PlayApi {
  const h = g.heist!;
  const api: PlayApi = {
    steal(base, heat) {
      let gain = base;
      if (h.nextLootDouble) gain *= 2;
      if (vaultLocked(g)) gain = Math.floor(gain / 2);
      const heatGain = h.nextLootNoHeat ? 0 : heat;
      h.nextLootDouble = false;
      h.nextLootNoHeat = false;
      api.addLoot(gain);
      api.addHeat(heatGain);
    },
    addLoot(n) {
      h.loot = Math.max(0, h.loot + n);
    },
    addHeat(n) {
      h.heat = Math.max(0, h.heat + n);
    },
    addEscape(n) {
      h.escape += n;
    },
    addEnergy(n) {
      h.energy += n;
    },
    draw(n) {
      drawCards(g, n);
    },
  };
  return api;
}

export function canPlay(g: GameState, uid: number): boolean {
  const h = g.heist;
  if (g.phase !== 'heist' || !h) return false;
  const card = h.hand.find((c) => c.uid === uid);
  if (!card) return false;
  const def = cardDef(card.id);
  if (def.cost > h.energy) return false;
  return def.canPlay ? def.canPlay(h) : true;
}

export function playCard(g: GameState, uid: number): boolean {
  if (!canPlay(g, uid)) return false;
  const h = g.heist!;
  const index = h.hand.findIndex((c) => c.uid === uid);
  const card = h.hand.splice(index, 1)[0]!;
  const def = cardDef(card.id);
  h.energy -= def.cost;
  h.playedThisTurn += 1;
  if (def.role === 'tech') h.techPlayed += 1;
  def.play(h, makeApi(g));
  h.discard.push(card);
  g.message = `${def.name}: ${def.text}`;
  if (h.heat >= HEAT_LIMIT) bust(g);
  return true;
}

export interface Preview {
  loot: number;
  heat: number;
  escape: number;
  energy: number;
  cards: number;
  bust: boolean;
}

/** 카드를 지금 내면 수치가 어떻게 바뀌는지 실제 상태를 건드리지 않고 계산한다. */
export function previewPlay(g: GameState, uid: number): Preview | null {
  if (!canPlay(g, uid)) return null;
  const before = g.heist!;
  const copy = structuredClone(g);
  playCard(copy, uid);
  const after = copy.heist!;
  return {
    loot: after.loot - before.loot,
    heat: after.heat - before.heat,
    escape: after.escape - before.escape,
    energy: after.energy - before.energy,
    cards: after.hand.length - (before.hand.length - 1),
    bust: copy.phase === 'busted',
  };
}

export function endTurn(g: GameState): void {
  const h = g.heist;
  if (g.phase !== 'heist' || !h) return;
  const patrol = pendingPatrol(g);
  h.discard.push(...h.hand);
  h.hand = [];
  h.heat += patrol;
  if (h.heat >= HEAT_LIMIT) {
    bust(g);
    return;
  }
  g.message = patrol > 0 ? `순찰이 지나갔다. 경보 +${patrol}.` : '순찰을 따돌렸다.';
  startTurn(g);
}

function bust(g: GameState): void {
  g.phase = 'busted';
  g.message = '경보가 한계를 넘었다. 경찰이 도착했다.';
}

export function canEscape(g: GameState): boolean {
  const h = g.heist;
  if (g.phase !== 'heist' || !h) return false;
  const loc = currentLocation(g);
  return h.escape >= loc.escapeNeeded && h.loot >= loc.quota;
}

export function escapeHeist(g: GameState): boolean {
  if (!canEscape(g)) return false;
  const h = g.heist!;
  const loc = currentLocation(g);
  const kept = h.loot - loc.quota;
  g.money += kept;
  g.lastResult = { location: loc.name, loot: h.loot, quota: loc.quota, kept, turns: h.turn };
  g.heist = null;
  if (g.heistIndex >= LOCATIONS.length - 1) {
    g.phase = 'won';
    g.message = '마지막 상납까지 끝냈다. 빚은 없다.';
    return true;
  }
  g.phase = 'shop';
  g.shop = { offers: rollOffers(g), freePicks: FREE_PICKS };
  g.message = `${loc.name}에서 빠져나왔다. 상납하고 남은 내 몫은 ${kept}.`;
  return true;
}

function rollOffers(g: GameState): { id: string; price: number; sold: boolean }[] {
  const pool = shuffle(g, [...RECRUIT_IDS]).slice(0, SHOP_OFFERS);
  return pool.map((id) => ({ id, price: cardDef(id).price, sold: false }));
}

export function buyOffer(g: GameState, index: number): boolean {
  const offer = g.phase === 'shop' ? g.shop?.offers[index] : undefined;
  if (!offer || offer.sold) return false;
  const shop = g.shop!;
  if (shop.freePicks > 0) shop.freePicks -= 1;
  else if (g.money >= offer.price) g.money -= offer.price;
  else return false;
  offer.sold = true;
  addCardToDeck(g, offer.id);
  g.message = `${eul(cardDef(offer.id).name)} 영입했다.`;
  return true;
}

export function rerollShop(g: GameState): boolean {
  if (g.phase !== 'shop' || !g.shop || g.money < REROLL_COST) return false;
  g.money -= REROLL_COST;
  g.shop.offers = rollOffers(g);
  g.message = '새 후보를 불러왔다.';
  return true;
}

export function canRemove(g: GameState): boolean {
  return g.phase === 'shop' && g.money >= REMOVE_COST && g.deck.length > MIN_DECK;
}

export function removeCard(g: GameState, uid: number): boolean {
  if (!canRemove(g)) return false;
  const index = g.deck.findIndex((c) => c.uid === uid);
  if (index < 0) return false;
  const [card] = g.deck.splice(index, 1);
  g.money -= REMOVE_COST;
  g.message = `${eul(cardDef(card!.id).name)} 내보냈다.`;
  return true;
}

export function nextHeist(g: GameState): boolean {
  if (g.phase !== 'shop') return false;
  g.heistIndex += 1;
  startHeist(g);
  return true;
}

/** 저장된 상태가 지금 규칙으로 이어서 할 수 있는 것인지 확인한다. */
export function isUsableState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const g = value as Partial<GameState>;
  if (g.version !== STATE_VERSION || !Array.isArray(g.deck)) return false;
  if (typeof g.heistIndex !== 'number' || !LOCATIONS[g.heistIndex]) return false;
  const piles = g.heist ? [...g.heist.drawPile, ...g.heist.hand, ...g.heist.discard] : [];
  const offers = g.shop ? g.shop.offers : [];
  return [...g.deck, ...piles, ...offers].every((c) => ALL_CARD_IDS.includes(c.id));
}

export function heistOf(g: GameState): HeistState {
  if (!g.heist) throw new Error('진행 중인 작전이 없다');
  return g.heist;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
