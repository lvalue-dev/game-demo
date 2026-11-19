// 간단한 봇으로 여러 판을 돌려 난이도 수치를 점검한다.
// 사용법: npm run sim -- [판 수]
import { cardDef } from '../src/game/cards.ts';
import {
  buyOffer, canEscape, canPlay, currentLocation, endTurn, escapeHeist, newGame, nextHeist,
  pendingPatrol, previewPlay, playCard, HEAT_LIMIT,
} from '../src/game/engine.ts';
import { LOCATIONS } from '../src/game/locations.ts';
import type { GameState } from '../src/game/types.ts';

const BUY_ORDER = [
  'strategist', 'safecracker', 'decoy', 'vetdriver', 'planner', 'mastermind', 'hacker', 'sweeper',
  'backdoor', 'pickpocket', 'routeplanner', 'insider', 'gambler', 'demolition', 'disguise', 'bribe',
];

/** greed: 상납금을 채운 뒤 턴 종료 시 경보가 이 값 이하로 예상되면 더 머문다. 음수면 바로 철수. */
function scorePlay(g: GameState, uid: number): number {
  const h = g.heist!;
  const loc = currentLocation(g);
  const card = h.hand.find((c) => c.uid === uid)!;
  const def = cardDef(card.id);
  const p = previewPlay(g, uid);
  if (!p || p.bust) return -Infinity;
  const patrol = def.id === 'insider' ? 0 : pendingPatrol(g);
  const endHeat = h.heat + p.heat + patrol;
  const needEscape = Math.max(0, loc.escapeNeeded - h.escape);
  const needLoot = Math.max(0, loc.quota - h.loot);
  const lootInHand = h.hand.some(
    (c) => c.uid !== uid && cardDef(c.id).role === 'loot' && cardDef(c.id).cost <= h.energy - def.cost,
  );

  let score = 0;
  score += p.loot * (needLoot > 0 ? 1 : 0.6);
  score += Math.min(p.escape, needEscape) * 4;
  if (p.heat > 0) {
    if (endHeat >= HEAT_LIMIT) return -Infinity;
    score -= p.heat * (endHeat >= 7 ? 2.5 : 1);
  } else if (p.heat < 0) {
    const pressure = h.heat + patrol;
    score += -p.heat * (pressure >= 7 ? 3 : pressure >= 4 ? 1.2 : 0.4);
  }
  if (p.cards > 0) score += p.cards * 1.5;
  if (p.energy > 0) score += p.energy * 2;
  if (def.id === 'hacker' || def.id === 'strategist') score += lootInHand ? 4 : -1;
  if (def.id === 'insider') score += patrol * 2;
  return score;
}

function playHeist(g: GameState, greed: number): void {
  while (g.phase === 'heist') {
    const h = g.heist!;
    let best = -Infinity;
    let bestUid = -1;
    for (const c of h.hand) {
      if (!canPlay(g, c.uid)) continue;
      const s = scorePlay(g, c.uid);
      if (s > best) {
        best = s;
        bestUid = c.uid;
      }
    }
    if (bestUid >= 0 && best > 0) {
      playCard(g, bestUid);
      continue;
    }
    if (canEscape(g) && h.heat + pendingPatrol(g) > greed) {
      escapeHeist(g);
      return;
    }
    endTurn(g);
  }
}

function shop(g: GameState): void {
  for (const id of BUY_ORDER) {
    const index = g.shop!.offers.findIndex((o) => o.id === id);
    if (index >= 0) buyOffer(g, index);
  }
  nextHeist(g);
}

function run(seed: number, greed: number) {
  const g = newGame(seed);
  const turns: number[] = [];
  const kept: number[] = [];
  for (;;) {
    playHeist(g, greed);
    const phase: string = g.phase;
    if (phase === 'busted') break;
    turns.push(g.lastResult!.turns);
    kept.push(g.lastResult!.kept);
    if (phase === 'won') break;
    shop(g);
  }
  return { cleared: turns.length, turns, kept };
}

const games = Number(process.argv[2] ?? 2000);
for (const greed of [-1, 5, 7]) {
  const cleared = LOCATIONS.map(() => 0);
  const turnSum = LOCATIONS.map(() => 0);
  const keptSum = LOCATIONS.map(() => 0);
  for (let seed = 1; seed <= games; seed++) {
    const r = run(seed * 7919, greed);
    for (let i = 0; i < r.cleared; i++) {
      cleared[i]! += 1;
      turnSum[i]! += r.turns[i]!;
      keptSum[i]! += r.kept[i]!;
    }
  }
  const label = greed < 0 ? '바로 철수' : `경보 ${greed} 이하면 더 머묾`;
  console.log(`\n봇 성향: ${label} (${games}판)`);
  LOCATIONS.forEach((loc, i) => {
    const n = cleared[i]!;
    const rate = ((n / games) * 100).toFixed(1);
    const t = n ? (turnSum[i]! / n).toFixed(1) : '-';
    const k = n ? (keptSum[i]! / n).toFixed(1) : '-';
    console.log(`  ${loc.name}: 통과 ${rate}% · 평균 ${t}턴 · 평균 챙긴 돈 ${k}`);
  });
}
