// 감독 커리어를 봇으로 여러 번 돌려 균형을 본다.
//   node scripts/sim-manager.ts [횟수] [smart|random]
import { act, createGame, legacyScore } from '../manager/src/game/career.ts';
import { BACKGROUND_IDS } from '../manager/src/game/data.ts';
import { rand } from '../manager/src/game/rng.ts';
import type { Game } from '../manager/src/game/types.ts';

const runs = Number(process.argv[2] ?? 200);
const mode = process.argv[3] ?? 'smart';

/** 봇의 선택. smart는 그럴듯한 사람처럼 고르고, random은 아무거나 고른다. */
function choose(g: Game, dice: { rng: number }): string {
  const open = g.scene.choices.filter((c) => !c.disabled);
  const random = (): string => open[Math.floor(rand(dice) * open.length)]!.id;
  if (mode === 'random') {
    // 은퇴만은 정년까지 미룬다. 그래야 커리어 전체를 본다.
    const stay = open.filter((c) => c.id !== 'retire');
    return stay[Math.floor(rand(dice) * stay.length)]!.id;
  }
  switch (g.phase) {
    case 'offers': {
      // 남을 수 있으면 대체로 남되, 더 높은 리그에서 부르면 간다.
      const offers = g.offers.map((o, i) => ({ o, i, level: g.clubs[o.club]!.nation ? 90 : (g.clubs[o.club]!.att + g.clubs[o.club]!.def) / 2 }));
      const stay = offers.find((x) => x.o.stay);
      const best = [...offers].sort((a, b) => b.level - a.level)[0]!;
      if (stay && best.level < stay.level + 6) return `offer${stay.i}`;
      return `offer${best.i}`;
    }
    case 'style': return g.lastStyle ?? 'wide';
    case 'match': {
      // 상대 전술이 읽히면 '유리'라고 적힌 전술로 바꾸고, 아니면 그대로 간다.
      const m = g.match!;
      if (m.step === 'shape') return '433';
      if (m.step === 'plan') return open.find((c) => c.detail?.includes('유리'))?.id ?? g.season.style;
      if (m.step === 'm30' || m.step === 'ht') return open.find((c) => c.id !== 'keep' && c.detail?.includes('유리') && !open[0]!.detail?.includes('유리'))?.id ?? 'keep';
      if (m.step === 'talk') return 'calm';
      if (m.step === 'm60') return m.score[0] < m.score[1] ? 'fw' : m.me.stamina < 55 ? 'legs' : 'mf';
      if (m.step === 'm75') return m.score[0] < m.score[1] ? 'allout' : m.score[0] > m.score[1] ? 'lock' : 'hold';
      return 'next';
    }
    case 'focus': return 'attack';
    case 'market':
    case 'winter': {
      const sign = open.find((c) => c.id === 'sign0');
      return sign ? sign.id : open.find((c) => c.id === 'youth')?.id ?? 'skip';
    }
    case 'plan': return 'steady';
    case 'growth': return open.sort((a, b) => a.label.localeCompare(b.label))[Math.floor(rand(dice) * open.length)]!.id;
    default: return random();
  }
}

const gaps: number[][] = [[], [], []];
const big = { w: 0, d: 0, l: 0 };
const stats = { seasons: 0, sacked: 0, titles: 0, promotions: 0, score: [] as number[], peak: [] as number[], top: {} as Record<string, number>, nation: 0, wc: 0, firstTop: [] as number[] };
const order = ['K5', 'K4', 'K3', 'K리그2', 'K리그1', '잉글랜드 2부', '잉글랜드 1부'];
for (let i = 0; i < runs; i++) {
  const dice = { rng: 9000 + i };
  const g = createGame(1000 + i * 7919, `봇${i}`, BACKGROUND_IDS[i % BACKGROUND_IDS.length]!);
  let guard = 0;
  while (g.phase !== 'retired') {
    if (g.phase === 'match' && g.match!.step === 'done' && g.match!.kind === 'league') {
      const [a, b] = g.match!.score;
      if (a > b) big.w++; else if (a < b) big.l++; else big.d++;
    }
    act(g, choose(g, dice));
    if (++guard > 5000) throw new Error(`끝나지 않는 커리어: seed ${i}, phase ${g.phase}`);
  }
  g.history.forEach((h, k) => { if (!h.club.endsWith('대표팀')) gaps[Math.min(2, Math.floor(k / 10))]!.push(h.pos); });
  stats.seasons += g.history.length;
  stats.sacked += g.history.filter((h) => h.outcome === 'sacked').length;
  stats.titles += g.history.filter((h) => h.outcome === 'title').length;
  stats.promotions += g.promotions;
  stats.score.push(legacyScore(g));
  stats.peak.push(g.manager.peakRep);
  const reached = Math.max(...g.history.map((h) => order.indexOf(h.league)));
  const label = g.history.some((h) => h.club.endsWith('대표팀')) ? '국가대표' : order[reached] ?? '?';
  stats.top[label] = (stats.top[label] ?? 0) + 1;
  if (g.history.some((h) => h.club.endsWith('대표팀'))) stats.nation++;
  if (g.trophies.some((t) => t.name === '월드컵 우승')) stats.wc++;
  const idx = g.history.findIndex((h) => h.league === 'K리그1');
  if (idx >= 0) stats.firstTop.push(idx + 1);
}
const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
console.log(`${mode} 봇 ${runs}회`);
console.log(`커리어당 시즌 ${(stats.seasons / runs).toFixed(1)}, 경질 ${(stats.sacked / runs).toFixed(2)}회, 리그 우승 ${(stats.titles / runs).toFixed(2)}회, 승격 ${(stats.promotions / runs).toFixed(2)}회`);
console.log(`커리어 점수 중앙값 ${med(stats.score)}, 최고 ${Math.max(...stats.score)}, 최저 ${Math.min(...stats.score)} / 최고 평판 중앙값 ${med(stats.peak).toFixed(0)}`);
console.log('리그 평균 순위(초반/중반/후반 10시즌):', gaps.map((a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1)).join(' / '));
console.log('도달한 가장 높은 무대:', Object.entries(stats.top).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`직접 지휘한 라이벌전: ${big.w}승 ${big.d}무 ${big.l}패 (승률 ${((big.w / Math.max(1, big.w + big.d + big.l)) * 100).toFixed(0)}%)`);
console.log(`국가대표 감독 ${stats.nation}회, 월드컵 우승 ${stats.wc}회, 1부 첫 도달까지 시즌 중앙값 ${med(stats.firstTop)} (${stats.firstTop.length}명)`);
