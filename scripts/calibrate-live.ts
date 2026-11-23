// 실시간 경기 엔진을 화면 없이 돌려 골, 슈팅, 점유율이 현실적인지 본다.
//   node scripts/calibrate-live.ts            기본 점검
//   node scripts/calibrate-live.ts tables     전술, 대형 보정표를 처음부터 다시 계산
//   node scripts/calibrate-live.ts fill       표에 아직 없는 대형과 지시, 역할만 계산해 채운다(있는 값은 그대로 둔다)
import { writeFileSync } from 'node:fs';
import { SHAPE_ORDER, TICKS, createLive, lineup, stepLive } from '../manager/src/game/live.ts';
import { NEUTRAL } from '../manager/src/game/tactics.ts';
import { tuning } from '../manager/src/game/live-tuning.ts';
import { makeDetail } from '../manager/src/game/player.ts';
import type { LiveEnv, LiveSide } from '../manager/src/game/live.ts';
import type { Dials, Pos, RoleId, ShapeId, StyleId } from '../manager/src/game/types.ts';

const STYLES: StyleId[] = ['press', 'possess', 'counter', 'direct', 'wide', 'park'];
const SHAPES: ShapeId[] = SHAPE_ORDER;
const KEYS: Pos[] = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW'];

interface Setup {
  style?: StyleId;
  shape?: ShapeId;
  edge?: number;
  dials?: Partial<Dials>;
  roles?: Record<number, RoleId>;
  push?: -1 | 0 | 1;
}

const side = (s: Setup): LiveSide => ({
  style: s.style ?? 'possess', shape: s.shape ?? '442', push: s.push ?? 0, red: false, tired: false,
  dials: { ...NEUTRAL, ...s.dials }, roles: s.roles ?? {}, edge: s.edge ?? 0, venue: 1,
});

export interface Stat {
  gf: number;
  ga: number;
  shots: number;
  shotsAgainst: number;
  onTarget: number;
  xg: number;
  xga: number;
  poss: number;
  passes: number;
  passOk: number;
  win: number;
  draw: number;
  reds: number;
  how: Record<string, number>;
}

export function run(a: Setup, b: Setup, n: number, seed = 1): Stat {
  const st: Stat = { gf: 0, ga: 0, shots: 0, shotsAgainst: 0, onTarget: 0, xg: 0, xga: 0, poss: 0, passes: 0, passOk: 0, win: 0, draw: 0, reds: 0, how: {} };
  for (let k = 0; k < n; k++) {
    const r = { rng: seed * 100003 + k * 7919 };
    const env: LiveEnv = { sides: [side(a), side(b)] };
    // 실제 경기처럼 선수마다 세부 포지션과 능력치 개인차를 준다.
    const squad = (shape: ShapeId) => lineup(shape, KEYS.map((pos, i) => ({ name: `${pos}${i}`, pos, ovr: 60, key: i, ...makeDetail(r, pos) })), (pos, spot) => ({ name: '후보', pos, ovr: 56, key: -1, ...makeDetail(r, pos, spot) }));
    const L = createLive(squad(env.sides[0].shape), squad(env.sides[1].shape), [env.sides[0].shape, env.sides[1].shape]);
    let gf = 0;
    let ga = 0;
    while (!L.over) {
      for (const e of stepLive(L, env, r)) {
        if (e.kind === 'goal') {
          if (e.team === 0) gf++;
          else ga++;
          st.how[e.how] = (st.how[e.how] ?? 0) + 1;
        } else if (e.kind === 'red') {
          st.reds++;
          env.sides[e.team].red = true;
        }
      }
    }
    st.gf += gf;
    st.ga += ga;
    st.win += gf > ga ? 1 : 0;
    st.draw += gf === ga ? 1 : 0;
    st.shots += L.teams[0].shots;
    st.shotsAgainst += L.teams[1].shots;
    st.onTarget += L.teams[0].onTarget;
    st.xg += L.teams[0].xg;
    st.xga += L.teams[1].xg;
    st.poss += L.teams[0].possession / TICKS;
    st.passes += L.teams[0].passes;
    st.passOk += L.teams[0].passesOk;
  }
  for (const key of ['gf', 'ga', 'shots', 'shotsAgainst', 'onTarget', 'xg', 'xga', 'poss', 'passes', 'passOk', 'win', 'draw', 'reds'] as const) st[key] /= n;
  return st;
}

const f = (v: number, d = 2): string => v.toFixed(d);
const line = (name: string, s: Stat): string =>
  `${name.padEnd(26)} 골 ${f(s.gf)}:${f(s.ga)}  xG ${f(s.xg)}:${f(s.xga)}  슈팅 ${f(s.shots, 1)}:${f(s.shotsAgainst, 1)}  유효 ${f(s.onTarget, 1)}  점유 ${f(s.poss * 100, 0)}%  패스 ${f(s.passes, 0)}(${f((s.passOk / s.passes) * 100, 0)}%)  승 ${f(s.win * 100, 0)}% 무 ${f(s.draw * 100, 0)}%`;

const mode = process.argv[2] ?? 'check';
const isMain = import.meta.url === `file://${process.argv[1]}`;
const N = Number(process.argv[3] ?? 300);

if (!isMain) {
  // 다른 스크립트가 run만 가져다 쓴다.
} else if (mode === 'pairs') {
  // 전술 조합별 슈팅과 골. 보정 전 움직임 자체의 차이를 본다.
  for (const a of STYLES) for (const b of STYLES) {
    const s = run({ style: a }, { style: b }, N);
    console.log(line(`${a} vs ${b}`, s));
  }
} else if (mode === 'check') {
  const t0 = Date.now();
  const base = run({}, {}, N);
  console.log(line('같은 전력', base), ` (${((Date.now() - t0) / N).toFixed(1)}ms/경기, 퇴장 ${f(base.reds)})`);
  console.log('골 종류', base.how);
  for (const e of [-10, -5, 5, 10]) {
    const s = run({ edge: e }, { edge: -e }, N);
    console.log(line(`전력 ${e > 0 ? '+' : ''}${e}`, s), ` 기대 배수 ${f(Math.exp(0.05 * e))} 실제 ${f(s.gf / base.gf)} / ${f(s.ga / base.ga)}`);
  }
  console.log('\n전술별(상대는 점유, 전력 같음)');
  for (const style of STYLES) console.log(line(style, run({ style }, {}, N)));
  console.log('\n대형별(상대는 4-4-2)');
  for (const shape of SHAPES) console.log(line(shape, run({ shape }, {}, N)));
  console.log('\n팀 지시(상대는 점유 4-4-2)');
  const dials: [string, Partial<Dials>][] = [['라인 올림', { line: 1 }], ['라인 내림', { line: -1 }], ['넓게', { width: 1 }], ['좁게', { width: -1 }], ['빠르게', { tempo: 1 }], ['느리게', { tempo: -1 }], ['오버래핑', { overlap: true }],
    ['압박 달려든다', { press: 1 }], ['압박 기다린다', { press: -1 }], ['패스 길게', { pass: 1 }], ['패스 짧게', { pass: -1 }], ['오른쪽으로', { flank: 1 }], ['왼쪽으로', { flank: -1 }],
    ['보이면 쏜다', { final: 1 }], ['만들어 넣는다', { final: -1 }], ['잃으면 즉시 압박', { lose: 1 }], ['잃으면 물러선다', { lose: -1 }], ['따내면 바로 역습', { win: 1 }], ['따내면 지킨다', { win: -1 }], ['수비 폭 넓게', { block: 1 }], ['수비 폭 좁게', { block: -1 }]];
  for (const [name, d] of dials) console.log(line(name, run({ dials: d }, {}, N)));
  console.log('\n개인 역할(4-4-2: 0 GK, 1-2 CB, 3-4 풀백, 5-6 CM, 7-8 측면, 9-10 ST. 섀도는 4-2-3-1의 9번 자리)');
  const roles: [string, Record<number, RoleId>][] = [['스위퍼 키퍼', { 0: 'sweeper' }], ['전진 수비', { 1: 'stopper' }], ['대인 마크', { 1: 'mark' }], ['홀딩', { 5: 'hold' }], ['플레이메이커', { 5: 'maker' }], ['침투 미드필더', { 5: 'runner' }], ['연계 공격수', { 10: 'link' }], ['타깃', { 10: 'target' }], ['측면으로', { 10: 'drift' }],
    ['리베로', { 1: 'libero' }], ['공격형 풀백', { 3: 'wing' }], ['인버티드 풀백', { 3: 'invert' }], ['수비 전념 풀백', { 3: 'stay' }], ['볼 위너', { 5: 'hunter' }],
    ['안으로 좁히는 윙어', { 7: 'inside' }], ['터치라인 윙어', { 7: 'hug' }], ['수비 가담 윙어', { 7: 'track' }], ['포처', { 10: 'poach' }], ['압박 공격수', { 10: 'harry' }]];
  for (const [name, r] of roles) console.log(line(name, run({ roles: r }, {}, N)));
  console.log(line('4-2-3-1 기본', run({ shape: '4231' }, {}, N)));
  console.log(line('섀도 스트라이커', run({ shape: '4231', roles: { 9: 'shadow' } }, {}, N)));
  console.log('\n태세');
  console.log(line('총공세', run({ push: 1 }, {}, N)));
  console.log(line('잠그기', run({ push: -1 }, {}, N)));
} else {
  // 전력이 같을 때 어떤 전술, 대형, 지시든 기대 득점이 같아지도록 보정표를 만들어 live-tuning.ts에 적는다.
  // 골 수 대신 기대 득점(xG)의 합을 재서 적은 경기로도 값이 흔들리지 않게 한다.
  const target = Number(process.argv[4] ?? 1.3);
  const fill = mode === 'fill';
  // fill이면 이미 있는 칸은 건드리지 않는다. 새 칸만 1에서 시작해 맞춘다.
  const had = tuning.shape.map((row) => row.length);
  const keep = (i: number, j: number): boolean => fill && j < (had[i] ?? 0);
  const known = new Set(fill ? Object.keys(tuning.extra) : []);
  if (!fill) {
    tuning.style = STYLES.map(() => STYLES.map(() => 1));
    tuning.extra = {};
  }
  tuning.shape = SHAPES.map((_, i) => SHAPES.map((_, j) => (keep(i, j) ? ((tuning.shape[i] as number[])[j] as number) : 1)));
  for (let round = 0; round < (fill ? 0 : 3); round++) {
    for (let i = 0; i < STYLES.length; i++) {
      for (let j = 0; j < STYLES.length; j++) {
        const s = run({ style: STYLES[i] }, { style: STYLES[j] }, N, round + 1);
        (tuning.style[i] as number[])[j] = ((tuning.style[i] as number[])[j] as number) * (target / Math.max(0.15, s.xg));
      }
    }
    console.log(`전술 ${round + 1}회차 끝`);
  }
  // 대형 표는 전술 표 위에 곱해지므로, 점유 대 점유의 값(이미 맞춰진 값)을 기준으로 삼는다.
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < SHAPES.length; i++) {
      for (let j = 0; j < SHAPES.length; j++) {
        if (keep(i, j)) continue;
        const s = run({ shape: SHAPES[i] }, { shape: SHAPES[j] }, N, round + 3);
        (tuning.shape[i] as number[])[j] = ((tuning.shape[i] as number[])[j] as number) * (target / Math.max(0.15, s.xg));
      }
    }
    console.log(`대형 ${round + 1}회차 끝`);
  }
  // 역할은 그 역할을 맡길 자리가 있는 대형에서 잰다. 기준은 같은 대형에서 아무 지시도 없을 때다.
  const bases = new Map<string, Stat>();
  const baseOf = (shape: ShapeId = '442', seed = 9): Stat => {
    const key = `${shape}:${seed}`;
    if (!bases.has(key)) bases.set(key, run({ shape }, {}, N * 2, seed));
    return bases.get(key) as Stat;
  };
  const extras: [string, Setup][] = [
    ['line1', { dials: { line: 1 } }], ['line-1', { dials: { line: -1 } }], ['width1', { dials: { width: 1 } }], ['width-1', { dials: { width: -1 } }],
    ['tempo1', { dials: { tempo: 1 } }], ['tempo-1', { dials: { tempo: -1 } }], ['overlap', { dials: { overlap: true } }],
    ['push1', { push: 1 }], ['push-1', { push: -1 }],
    ['sweeper', { roles: { 0: 'sweeper' } }], ['stopper', { roles: { 1: 'stopper' } }], ['mark', { roles: { 1: 'mark' } }],
    ['hold', { roles: { 5: 'hold' } }], ['maker', { roles: { 5: 'maker' } }], ['runner', { roles: { 5: 'runner' } }],
    ['link', { roles: { 10: 'link' } }], ['target', { roles: { 10: 'target' } }], ['drift', { roles: { 10: 'drift' } }],
    ['press1', { dials: { press: 1 } }], ['press-1', { dials: { press: -1 } }], ['pass1', { dials: { pass: 1 } }], ['pass-1', { dials: { pass: -1 } }], ['flank', { dials: { flank: 1 } }],
    ['libero', { roles: { 1: 'libero' } }], ['wing', { roles: { 3: 'wing' } }], ['invert', { roles: { 3: 'invert' } }], ['stay', { roles: { 3: 'stay' } }],
    ['hunter', { roles: { 5: 'hunter' } }], ['shadow', { shape: '4231', roles: { 9: 'shadow' } }],
    ['inside', { roles: { 7: 'inside' } }], ['hug', { roles: { 7: 'hug' } }], ['track', { roles: { 7: 'track' } }],
    ['poach', { roles: { 10: 'poach' } }], ['harry', { roles: { 10: 'harry' } }],
    ['final1', { dials: { final: 1 } }], ['final-1', { dials: { final: -1 } }], ['lose1', { dials: { lose: 1 } }], ['lose-1', { dials: { lose: -1 } }],
    ['win1', { dials: { win: 1 } }], ['win-1', { dials: { win: -1 } }], ['block1', { dials: { block: 1 } }], ['block-1', { dials: { block: -1 } }],
  ];
  for (let round = 0; round < 2; round++) {
    for (const [key, setup] of extras) {
      if (known.has(key)) continue;
      const base = baseOf(setup.shape);
      const s = run(setup, {}, N * 2, 9 + round);
      const old = tuning.extra[key] ?? [1, 1];
      tuning.extra[key] = [old[0] * (base.xg / Math.max(0.15, s.xg)), old[1] * (base.xga / Math.max(0.15, s.xga))];
    }
    console.log(`지시 ${round + 1}회차 끝`);
  }
  const rows = (m: number[][]): string => m.map((row) => `    [${row.map((v) => v.toFixed(2)).join(', ')}],`).join('\n');
  const extra = Object.entries(tuning.extra).map(([k, v]) => `    '${k}': [${v[0].toFixed(2)}, ${v[1].toFixed(2)}],`).join('\n');
  writeFileSync(new URL('../manager/src/game/live-tuning.ts', import.meta.url), `// scripts/calibrate-live.ts가 만든 파일. 손으로 고치지 않는다.
// 전력이 같을 때 어떤 전술, 대형, 지시를 골라도 기대 득점이 같아지도록 맞춘 배수다.
// 전술은 press, possess, counter, direct, wide, park 순, 대형은 ${SHAPES.join(', ')} 순이다. 행이 우리, 열이 상대다.
export const tuning: { style: number[][]; shape: number[][]; extra: Record<string, [number, number]> } = {
  style: [
${rows(tuning.style)}
  ],
  shape: [
${rows(tuning.shape)}
  ],
  // 팀 지시, 태세, 개인 역할 하나하나의 [우리 득점 배수, 상대 득점 배수].
  extra: {
${extra}
  },
};
`);
  console.log('live-tuning.ts를 새로 썼다.');
}
