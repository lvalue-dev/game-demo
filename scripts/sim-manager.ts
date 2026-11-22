// 감독 커리어를 봇으로 여러 번 돌려 균형을 본다.
//   node scripts/sim-manager.ts [횟수] [smart|random] [text|live] [출발 리그: kr5|kr4|...|eu1]
// 셋째 값이 live면 직접 지휘하는 경기를 실시간 모드로 치른다(느리다).
import { act, createGame, legacyScore } from '../manager/src/game/career.ts';
import { BACKGROUND_IDS } from '../manager/src/game/data.ts';
import { rand } from '../manager/src/game/rng.ts';
import { liveAdvice, liveCommand, liveTick } from '../manager/src/game/match.ts';
import { weakest } from '../manager/src/game/squad.ts';
import type { ClubLeagueId, Game, StyleId } from '../manager/src/game/types.ts';

const hintOf = (g: Game, st: StyleId): string | undefined => liveAdvice(g).hints[st];

const runs = Number(process.argv[2] ?? 200);
const mode = process.argv[3] ?? 'smart';
const view = process.argv[4] ?? 'text';
const startLeague = (process.argv[5] ?? 'kr5') as ClubLeagueId;
/** 이적 시장에서 이미 들여다본 협상. 같은 협상을 되풀이하지 않게 한다. */
const visited = new Set<string>();
/** 연봉 예산에 막힌 시장. 이런 시장에서는 후보를 더 적극적으로 정리한다. */
const wageTight = new Set<string>();

/** 실시간 경기를 봇이 지휘한다. 상대 전술이 읽히면 유리한 전술로, 60분에 뒤지면 공격수, 75분에 점수에 따라 태세. */
function playLive(g: Game): void {
  const m = g.match!;
  const L = m.live!;
  while (m.step === 'live') {
    if (L.halfTimeDone && !L.talked) liveCommand(g, 'talk:calm');
    if (mode === 'smart' && (L.tick === 30 * 20 || L.tick === 46 * 20)) {
      const good = (['press', 'possess', 'counter', 'direct', 'wide', 'park'] as const).find((st) => m.read && st !== m.me.style && hintOf(g, st) === '유리');
      if (good && hintOf(g, m.me.style) !== '유리') liveCommand(g, `style:${good}`);
    }
    if (mode === 'smart' && L.tick === 60 * 20) liveCommand(g, m.score[0] < m.score[1] ? 'sub:fw' : m.me.stamina < 55 ? 'sub:legs' : 'sub:mf');
    if (mode === 'smart' && L.tick === 75 * 20) liveCommand(g, `push:${m.score[0] < m.score[1] ? 1 : m.score[0] > m.score[1] ? -1 : 0}`);
    liveTick(g);
  }
}

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
      if (m.step === 'mode') return view;
      if (m.step === 'm30' || m.step === 'ht') return open.find((c) => c.id !== 'keep' && c.detail?.includes('유리') && !open[0]!.detail?.includes('유리'))?.id ?? 'keep';
      if (m.step === 'talk') return 'calm';
      if (m.step === 'm60') return m.score[0] < m.score[1] ? 'fw' : m.me.stamina < 55 ? 'legs' : 'mf';
      if (m.step === 'm75') return m.score[0] < m.score[1] ? 'allout' : m.score[0] > m.score[1] ? 'lock' : 'hold';
      return 'next';
    }
    case 'focus': return 'attack';
    case 'market':
    case 'winter': {
      // 이적료는 요구액대로, 개인 조건은 연봉을 10% 얹어 제안한다. 바이아웃 제안은 받아들이고, 다른 제안은 거절한다.
      // 계약이 끝나 가는 선발과는 재계약하고, 주전보다 2 이상 좋은 후보를 여름에 둘, 겨울에 하나까지 산다.
      // 후보가 셋을 넘으면(연봉 예산에 막혔으면 하나를 넘으면) 가장 약한 후보를 판다.
      const w = g.window!;
      const key = (id: string): string => `${g.year}-${w.kind}-${id}`;
      const extra = g.reserves.length > (wageTight.has(key('')) ? 1 : 3) ? [...g.reserves].sort((a, b) => a.ovr - b.ovr)[0] : undefined;
      if (w.view === 'sell') {
        if (!extra || visited.has(key(`sale-${extra.id}`)) || !open.some((c) => c.id === `sale:${extra.id}`)) return 'back';
        visited.add(key(`sale-${extra.id}`));
        return `sale:${extra.id}`;
      }
      if (w.view?.startsWith('sale:')) {
        // 시장가의 80%를 희망가로 두 번까지 내놓는다.
        const range = g.scene.blocks.flatMap((b) => (b.kind === 'form' ? b.rows : []))[0]?.range;
        const priced = key(`${w.view}-price`);
        if (range && !visited.has(priced)) {
          visited.add(priced);
          return `s:price=${Math.max(range.min, Math.round((range.min / 0.3) * 0.8 * 10) / 10)}`;
        }
        return open.some((c) => c.id === 'sell') ? 'sell' : 'back';
      }
      if (w.view?.startsWith('lend:')) return 'back';
      if (w.view) {
        const d = w.list.find((x) => x.id === w.view);
        if (!d) return 'back';
        if (d.stage === 'fee') return open.some((c) => c.id === 'submit') ? 'submit' : 'back';
        if (d.stage === 'loan') return 'back';
        if (!open.some((c) => c.id === 'submit')) {
          const why = g.scene.choices.find((c) => c.id === 'submit')?.detail ?? '?';
          const reason = why.split('(')[0]!.trim();
          blocked[reason] = (blocked[reason] ?? 0) + 1;
          if (why.includes('연봉')) wageTight.add(key(''));
          return 'back';
        }
        // 협상마다 한 번만 연봉을 올린다(작은 연봉은 반올림 때문에 그대로일 수 있다).
        const wageRow = g.scene.blocks.flatMap((b) => (b.kind === 'form' ? b.rows : [])).find((r) => r.range?.id === 't:wage');
        const bump = key(`${d.id}-wage-${d.talks}`);
        if (wageRow && !visited.has(bump)) {
          visited.add(bump);
          return `t:wage=${Math.min(wageRow.range!.max, Math.round(d.ask.wage * 1.1 * 10) / 10)}`;
        }
        return 'submit';
      }
      const clauseBid = open.find((c) => c.id.startsWith('bid:') && c.id.endsWith(':yes') && c.label.startsWith('바이아웃'));
      if (clauseBid) return clauseBid.id;
      const refuse = open.find((c) => c.id.startsWith('bid:') && c.id.endsWith(':no'));
      if (refuse) return refuse.id;
      if (extra && !visited.has(key(`sell-${extra.id}`))) {
        visited.add(key(`sell-${extra.id}`));
        return 'sellmenu';
      }
      const renew = w.list.find((d) => d.kind === 'renew' && g.squad.includes(d.player) && !visited.has(key(d.id)));
      if (renew) {
        visited.add(key(renew.id));
        return `view:${renew.id}`;
      }
      const best = w.list
        .filter((d) => d.kind !== 'renew' && d.kind !== 'loan' && !visited.has(key(d.id)) && d.price * 1.1 <= g.job!.budget && d.player.ovr - weakest(g.squad, d.player.pos).ovr >= 2)
        .sort((a, b) => (b.player.ovr - weakest(g.squad, b.player.pos).ovr) - (a.player.ovr - weakest(g.squad, a.player.pos).ovr))[0];
      if (best && w.signed < 2 && (w.kind === 'summer' || w.signed < 1)) {
        visited.add(key(best.id));
        return `view:${best.id}`;
      }
      if (!g.clubs[g.job!.club]!.nation) signedTotal += w.signed;
      for (const l of w.log) if (l.includes('재계약했다')) moves['재계약'] = (moves['재계약'] ?? 0) + 1;
      return 'done';
    }
    case 'plan': return 'steady';
    case 'growth': return open.sort((a, b) => a.label.localeCompare(b.label))[Math.floor(rand(dice) * open.length)]!.id;
    default: return random();
  }
}

const gaps: number[][] = [[], [], []];
const big = { w: 0, d: 0, l: 0 };
/** 시즌 결산에 나온 선수 이동과 재계약 수. */
const moves: Record<string, number> = {};
let signedTotal = 0;
/** 봇의 서명을 막은 사유. */
const blocked: Record<string, number> = {};
const stats = { seasons: 0, sacked: 0, titles: 0, promotions: 0, score: [] as number[], peak: [] as number[], top: {} as Record<string, number>, nation: 0, wc: 0, firstTop: [] as number[] };
const order = ['K5', 'K4', 'K3', 'K리그2', 'K리그1', '잉글랜드 2부', '잉글랜드 1부'];
for (let i = 0; i < runs; i++) {
  const dice = { rng: 9000 + i };
  visited.clear();
  wageTight.clear();
  const g = createGame(1000 + i * 7919, `봇${i}`, BACKGROUND_IDS[i % BACKGROUND_IDS.length]!, startLeague);
  let guard = 0;
  while (g.phase !== 'retired') {
    if (g.phase === 'match' && g.match!.step === 'done' && g.match!.kind === 'league') {
      const [a, b] = g.match!.score;
      if (a > b) big.w++; else if (a < b) big.l++; else big.d++;
    }
    if (g.phase === 'end') {
      for (const b of g.scene.blocks) {
        if (b.kind !== 'note') continue;
        for (const [k, word] of [['계약 만료', '자유계약으로 떠났다'], ['빅클럽', '빅클럽'], ['불만', '불만을 터뜨렸다'], ['은퇴', '유니폼을 벗었다']] as const) if (b.text.includes(word)) moves[k] = (moves[k] ?? 0) + 1;
      }
    }
    if (g.phase === 'match' && g.match!.step === 'live') playLive(g);
    else act(g, choose(g, dice));
    if (++guard > 5000) throw new Error(`끝나지 않는 커리어: seed ${i}, phase ${g.phase}, 장면 ${g.scene.title}`);
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
console.log(`${mode} 봇 ${runs}회 (${view === 'live' ? '실시간' : '빠른 진행'}, ${startLeague} 출발)`);
console.log(`커리어당 시즌 ${(stats.seasons / runs).toFixed(1)}, 경질 ${(stats.sacked / runs).toFixed(2)}회, 리그 우승 ${(stats.titles / runs).toFixed(2)}회, 승격 ${(stats.promotions / runs).toFixed(2)}회`);
console.log(`커리어 점수 중앙값 ${med(stats.score)}, 최고 ${Math.max(...stats.score)}, 최저 ${Math.min(...stats.score)} / 최고 평판 중앙값 ${med(stats.peak).toFixed(0)}`);
console.log('리그 평균 순위(초반/중반/후반 10시즌):', gaps.map((a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1)).join(' / '));
console.log('도달한 가장 높은 무대:', Object.entries(stats.top).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`직접 지휘한 라이벌전: ${big.w}승 ${big.d}무 ${big.l}패 (승률 ${((big.w / Math.max(1, big.w + big.d + big.l)) * 100).toFixed(0)}%)`);
console.log(`구단 영입 ${(signedTotal / runs).toFixed(1)}명/커리어, 서명이 막힌 사유: ${Object.entries(blocked).map(([k, v]) => `${k} ${(v / runs).toFixed(1)}`).join(', ') || '없음'}`);
console.log('선수 이동(커리어당):', Object.entries(moves).map(([k, v]) => `${k} ${(v / runs).toFixed(1)}`).join(', '));
console.log(`국가대표 감독 ${stats.nation}회, 월드컵 우승 ${stats.wc}회, 1부 첫 도달까지 시즌 중앙값 ${med(stats.firstTop)} (${stats.firstTop.length}명)`);
