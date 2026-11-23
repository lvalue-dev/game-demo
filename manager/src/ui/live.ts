// 실시간 경기 화면. 터치라인에 선 감독의 전술판이다.
// 화면 한 장에 점수 막대, 경기장, 지시 시트가 모두 들어가고 페이지는 스크롤하지 않는다.
// 세로로 긴 화면(휴대폰)에서는 경기장을 세워 우리 팀이 위로 공격하고, 넓은 화면에서는 눕혀서 옆에 지시 패널을 둔다.
//
// 움직임: 엔진은 3초(1틱)마다 선수의 위치를 정한다. 화면은 그 위치를 그대로 잇지 않고, 선수마다 감쇠 스프링으로 따라가게 해서
// 가속과 감속이 생기고 재개 위치로의 순간이동도 짧은 달리기로 보이게 한다. 공은 가진 선수의 발밑에 붙고, 날아갈 때는 감속하며 뜬다.
//
// 중계 카메라: 슈팅이 나오면 골문 쪽으로 잠깐 다가가고, 골은 느린 화면으로 한 번 더 보여 준다(1, 2배속에서만. 경기 시트에서 끌 수 있다).
// 선수 말은 서로 포개지지 않게 그릴 자리만 벌린다(spread.ts). 엔진의 위치와 경기 결과는 그대로다.
// 카메라는 그리는 좌표만 바꾼다. 누른 자리는 카메라를 걷어 낸 좌표로 되돌려 찾으므로 확대 중에도 선수를 고르고 끌 수 있다.
//
// 지시: 선수 말을 누르면 그 선수의 시트(역할, 위치, 교체)가 열린다. 말을 끌어 옮기면 기준 자리가 바뀌고, 다른 선수 위에 놓으면 자리를 맞바꾼다.
import { STYLES, STYLE_IDS } from '../game/data.ts';
import { PER_MIN, movedSlot, slotSpot, slotsOf } from '../game/live.ts';
import type { Slot } from '../game/live.ts';
import { FOOT_NAME, posPenalty, statNames, statsOf } from '../game/player.ts';
import { TACTIC_GAIN, actingSpot, benchPlayers, liveAdvice, liveCommand, liveTick, outlook, staminaText } from '../game/match.ts';
import type { Outlook } from '../game/match.ts';
import { DIALS, NEUTRAL, PHASES, ROLES, SHAPES, SHAPE_IDS, dialChanges, presetDials, roleName } from '../game/tactics.ts';
import type { DialId, DialPhase } from '../game/tactics.ts';
import type { Club, Game, Level, LiveMark, LivePlayer, LiveState, MatchState, Player, ShapeId } from '../game/types.ts';
import { face, hashName, tones } from './face.ts';
import { PICK, drawBall, drawFigure, drawFlag, drawNetHit, drawParty, drawRain, drawWind, startParty } from './figures.ts';
import type { Kit, Party } from './figures.ts';
import { spread } from './spread.ts';
import type { Dot } from './spread.ts';
import { TURF, light, margins, paintStadium, rgb } from './stadium.ts';
import type { Look, Scene } from './stadium.ts';

export interface LiveHost {
  /** 진행 상황을 저장한다. */
  save(): void;
  /** 경기가 끝났다. 결과 화면으로 넘어간다. */
  done(): void;
}

/** 아래에서 올라오는 지시 시트. 넓은 화면에서는 옆 패널이라 늘 하나가 열려 있다. */
type Sheet = 'none' | 'squad' | 'player' | 'tactic' | 'orders' | 'match' | 'talk';
const TABS: [Sheet, string][] = [['squad', '선수'], ['tactic', '전술'], ['orders', '지시'], ['match', '경기']];

/** 1배속에서 1초에 진행하는 틱 수. 1틱은 경기 시간 3초이고, 1배속이면 선수가 실제 달리기 속도로 보인다(한 경기 약 12분). */
const BASE_TPS = 2.5;
const SPEEDS = [1, 2, 4, 8];
/** 위치 버튼 한 번에 옮기는 거리(m). */
const NUDGE = 4;

let game: Game | null = null;
let host: LiveHost | null = null;
let raf = 0;
let paused = true;
let speed = 1;
let sheet: Sheet = 'none';
/** 고른 우리 선수(경기장 자리 번호)와 고른 후보(선수 번호). 둘 다 고르면 교체를 확정할 수 있다. */
let selected = -1;
let benchPick = -1;
/** 교체하면서 함께 바꿀 대형. 빈 문자열이면 지금 대형 그대로. */
let subShape: ShapeId | '' = '';
/** 전술 시트의 작은 탭: 판세, 전술, 대형. */
type TacTab = 'read' | 'plan' | 'shape';
let tacTab: TacTab = 'read';
/** 지시 시트에서 보고 있는 국면. */
let phase: DialPhase = 'att';
/** 방금 만진 지시. 그 지시의 설명을 시트 아래에 보여 준다. */
let lastDial: DialId | '' = '';
/** 방금 한 지시로 판세가 움직인 폭. 점수 막대 아래에 잠깐 보여 준다. */
let swing: { atk: number; dfn: number; until: number } | null = null;
let acc = 0;
let last = 0;
let lastSave = 0;
let seenLog = 0;
/** 골이 들어가면 경기장 위에 띄우는 띠. */
let flash: { text: string; sub: string; until: number; good: boolean } | null = null;
let flashKey = '';
/** 화면에 보여 준 점수. 달라지면 골이다. */
let shown: [number, number] = [0, 0];
/** 방금 한 지시를 중계 줄에 잠깐 보여 준다. */
let note: { text: string; until: number } | null = null;
/** 시트를 마지막으로 누른 때. 누르는 도중에 시트를 다시 그려 버튼이 사라지지 않게 한다. */
let touchedAt = 0;
let canvas: HTMLCanvasElement | null = null;
let kit: Kits = defaultKits();
/** 오늘의 구장과, 한 번 그려 둔 배경. 화면 크기가 바뀌면 다시 그린다. */
let look: Look | null = null;
let scene: Scene | null = null;
let sceneKey = '';
/** 골 뒤풀이: 뛰는 관중과 출렁이는 그물(side는 엔진 기준 골대, 1이 우리가 넣는 쪽). */
let party: Party | null = null;
let netHit: { side: 0 | 1; start: number } | null = null;
/** 선수의 살색과 머리색. 키는 "팀:자리:이름". */
const toneOf = new Map<string, [string, string]>();
/** 움직임을 줄여 달라는 설정이면 비와 종이, 걸음을 그리지 않는다. */
let calm = false;

/** 이름표에 쓰는 짧은 이름. 외국 이름은 성만 쓴다(일본 이름은 성이 앞이라 앞을 쓴다). */
const short = (name: string, nat?: string): string => (name.includes(' ') ? (nat === '일본' ? name.split(' ')[0] as string : name.split(' ').pop() as string) : name);

const esc = (text: string | number): string => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const isLive = (g: Game | null): boolean => !!g && g.phase === 'match' && g.match?.step === 'live' && !!g.match.live;

const wide = (): boolean => window.matchMedia('(min-width: 900px)').matches;
/** 세로로 긴 좁은 화면이면 경기장을 세운다. */
const upright = (): boolean => !wide() && window.innerHeight > window.innerWidth;

// ---------- 색과 유니폼 ----------

/** sRGB를 CIE Lab으로. 사람 눈에 비슷한 색인지 재는 데 쓴다. */
function lab(hex: string): [number, number, number] {
  const lin = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** 두 색의 지각 차이(ΔE). 30 아래면 경기장에서 헷갈린다. */
const dE = (a: string, b: string): number => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

type Kits = [Kit, Kit];

function defaultKits(): Kits {
  return [{ body: '#ffffff', trim: '#1d1d1d', pattern: 0, keeper: '#f2c230' }, { body: '#1d1d1d', trim: '#ffffff', pattern: 0, keeper: '#b78cf0' }];
}

/**
 * 두 팀의 유니폼. 홈 유니폼이 잔디나 상대와 겹치면 원정 유니폼(보조색 바탕, 흰색, 검은색, 대체 색)으로 바꿔 입는다.
 * 골키퍼는 네 필드 유니폼과 서로에게서 가장 멀리 떨어진 색을 입는다.
 */
function kits(g: Game, m: MatchState): Kits {
  const mine = g.clubs[g.job!.club] as Club;
  const theirs = g.clubs[m.oppId] as Club | undefined;
  const home: Kit = { body: mine.colors[0], trim: mine.colors[1], pattern: mine.pattern % 5, keeper: '' };
  const okHome = (k: Kit): boolean => dE(k.body, TURF) > 28;
  const a = okHome(home) ? home : { body: mine.colors[1], trim: mine.colors[0], pattern: 0, keeper: '' };
  const awayOptions = (c: Club | undefined): Kit[] => {
    const base: Kit[] = c
      ? [{ body: c.colors[0], trim: c.colors[1], pattern: c.pattern % 5, keeper: '' }, { body: c.colors[1], trim: c.colors[0], pattern: 0, keeper: '' }]
      : [{ body: '#d43a2f', trim: '#ffffff', pattern: 0, keeper: '' }];
    return [...base, { body: '#ffffff', trim: c?.colors[0] ?? '#1d1d1d', pattern: 0, keeper: '' }, { body: '#1d1d1d', trim: c?.colors[0] ?? '#ffffff', pattern: 0, keeper: '' },
      { body: '#f0c419', trim: '#1d1d1d', pattern: 0, keeper: '' }, { body: '#2d5fd3', trim: '#ffffff', pattern: 0, keeper: '' }, { body: '#e0532b', trim: '#1d1d1d', pattern: 0, keeper: '' }];
  };
  // 상대와 겹치는지는 바탕색과 무늬 색을 함께 본다.
  const clash = (x: Kit, y: Kit): number => Math.min(dE(x.body, y.body), x.pattern ? dE(x.trim, y.body) + 12 : 99, y.pattern ? dE(x.body, y.trim) + 12 : 99);
  const b = awayOptions(theirs).find((k) => dE(k.body, TURF) > 28 && clash(k, a) > 38) ?? (light(a.body) ? { body: '#1d1d1d', trim: '#ffffff', pattern: 0, keeper: '' } : { body: '#ffffff', trim: '#1d1d1d', pattern: 0, keeper: '' });
  const keepers = ['#f2c230', '#b78cf0', '#ff7a1a', '#22c4d6', '#e64aa0', '#8bd346', '#111111', '#ffffff'];
  const far = (avoid: string[]): string => [...keepers].sort((x, y) => Math.min(...avoid.map((c) => dE(y, c))) - Math.min(...avoid.map((c) => dE(x, c))))[0] as string;
  const outfield = [a.body, a.trim, b.body, b.trim, TURF];
  a.keeper = far(outfield);
  b.keeper = far([...outfield, a.keeper]);
  return [a, b];
}

/**
 * 오늘의 구장. 홈이면 우리 구장, 원정이면 상대 구장이고 규모는 구장 주인의 전력을 따른다.
 * 중립 경기와 대표팀 경기는 큰 구장에서, 토너먼트는 야간에 치른다.
 */
function lookOf(g: Game, m: MatchState): Look {
  const mine = g.clubs[g.job!.club] as Club;
  const theirs = g.clubs[m.oppId] as Club | undefined;
  const owner = m.venue === 'home' ? mine : m.venue === 'away' ? theirs : undefined;
  const level = owner ? (owner.att + owner.def) / 2 : 99;
  return {
    tier: !owner || owner.nation ? 3 : level < 40 ? 0 : level < 55 ? 1 : level < 70 ? 2 : 3,
    owner: owner ? [owner.colors[0], owner.colors[1]] : ['#3d4f63', '#d9d6cc'],
    fans: [[mine.colors[0], mine.colors[1]], theirs ? [theirs.colors[0], theirs.colors[1]] : ['#d43a2f', '#ffffff']],
    kits: [kit[0].body, kit[1].body],
    venue: m.venue,
    weather: m.weather,
    night: m.kind === 'knockout',
    seed: (owner?.id ?? 7) * 7919 + 13,
  };
}

// ---------- 화면 틀 ----------

export function renderLive(g: Game): string {
  const m = g.match as MatchState;
  const mine = (g.clubs[g.job!.club] as Club).name;
  return `
    <section class="lv" id="lv" aria-label="실시간 경기">
      <header class="lv__bar">
        <div class="lv__teams" role="group" aria-label="점수">
          <span class="lv__team"><span class="lv__kit" id="lv-kit-a"></span><span class="lv__name">${esc(mine)}</span></span>
          <span class="lv__score" id="lv-score"></span>
          <span class="lv__team lv__team--away"><span class="lv__name">${esc(m.oppName)}</span><span class="lv__kit" id="lv-kit-b"></span></span>
        </div>
        <div class="lv__poss" id="lv-poss" aria-hidden="true"><i></i><i></i></div>
        <div class="lv__meta">
          <span class="lv__stam" id="lv-stam"></span>
          <span class="lv__clock" id="lv-clock"></span>
          <span class="lv__subs" id="lv-subs"></span>
        </div>
        <button type="button" class="lv__edge" id="lv-edge" data-live-do="edge" aria-label="판세. 누르면 이유를 본다"></button>
      </header>
      <div class="lv__stage" id="lv-stage">
        <canvas class="lv__pitch" id="lv-pitch" role="img" aria-label="경기장. 우리 선수를 누르면 고르고, 끌면 자리를 옮긴다"></canvas>
        <p class="lv__flash" id="lv-flash" aria-live="assertive"></p>
      </div>
      <p class="lv__call" id="lv-call" aria-live="polite"></p>
      <div class="lv__sheet" id="lv-sheet" hidden></div>
      <div class="lv__dock">
        <button type="button" class="lv__play" data-live-do="play" id="lv-play"></button>
        <button type="button" class="lv__speed" data-live-do="speed" id="lv-speed" aria-label="배속 바꾸기"></button>
        <div class="lv__tabs" role="tablist" aria-label="지시">
          ${TABS.map(([id, label]) => `<button type="button" role="tab" class="lv__tab" data-live-do="sheet:${id}" aria-selected="false">${label}</button>`).join('')}
        </div>
      </div>
    </section>`;
}

export function mountLive(g: Game, h: LiveHost): void {
  unmountLive();
  game = g;
  host = h;
  canvas = $<HTMLCanvasElement>('#lv-pitch');
  const m = g.match as MatchState;
  kit = kits(g, m);
  look = lookOf(g, m);
  scene = null;
  sceneKey = '';
  party = null;
  netHit = null;
  flash = null;
  resetCam();
  shown = [m.score[0], m.score[1]];
  toneOf.clear();
  calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  vis.clear();
  trail.length = 0;
  seenLog = m.log.length;
  paused = true;
  acc = 0;
  selected = -1;
  benchPick = -1;
  subShape = '';
  tacTab = 'read';
  phase = 'att';
  lastDial = '';
  swing = null;
  drag = null;
  note = null;
  sheet = halftime(g) ? 'talk' : 'none';
  last = performance.now();
  lastSave = last;
  const dotA = $('#lv-kit-a');
  const dotB = $('#lv-kit-b');
  if (dotA) dotA.style.cssText = `--kit:${kit[0].body};--trim:${kit[0].trim}`;
  if (dotB) dotB.style.cssText = `--kit:${kit[1].body};--trim:${kit[1].trim}`;
  canvas?.addEventListener('pointerdown', onPitchDown);
  canvas?.addEventListener('pointermove', onPitchMove);
  canvas?.addEventListener('pointerup', onPitchUp);
  canvas?.addEventListener('pointercancel', onPitchCancel);
  $('#lv-sheet')?.addEventListener('pointerdown', onSheetTouch);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  updateHud(true);
  updateSheet();
  raf = requestAnimationFrame(frame);
}

export function unmountLive(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (game && host && isLive(game)) host.save();
  canvas?.removeEventListener('pointerdown', onPitchDown);
  canvas?.removeEventListener('pointermove', onPitchMove);
  canvas?.removeEventListener('pointerup', onPitchUp);
  canvas?.removeEventListener('pointercancel', onPitchCancel);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKey);
  game = null;
  host = null;
  canvas = null;
  scene = null;
  party = null;
  replay = null;
  tape.length = 0;
}

/** 페이지가 가려지면 멈춘다. */
export function pauseLive(): void {
  if (!game || paused) return;
  paused = true;
  host?.save();
  updateControls();
}

const onSheetTouch = (): void => {
  touchedAt = performance.now();
};

const onResize = (): void => updateSheet();

/** 스페이스바로 재생과 일시정지. */
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null;
  if (e.code !== 'Space' || !game || (t && /^(BUTTON|INPUT|TEXTAREA|SELECT|A|SUMMARY)$/.test(t.tagName))) return;
  e.preventDefault();
  togglePlay();
}

function togglePlay(): void {
  const g = game;
  if (!g) return;
  if (halftime(g)) {
    sheet = 'talk';
    updateSheet();
    return;
  }
  paused = !paused;
  if (paused) host?.save();
  last = performance.now();
  updateControls();
}

/** 감독의 지시를 엔진에 넘기고 화면을 맞춘다. */
function command(cmd: string): void {
  const g = game;
  if (!g) return;
  const wasHalf = halftime(g);
  const before = outlook(g);
  liveCommand(g, cmd);
  const after = outlook(g);
  const [da, dd] = [after.atk - before.atk, after.dfn - before.dfn];
  if (Math.abs(da) >= 0.05 || Math.abs(dd) >= 0.05) swing = { atk: da, dfn: dd, until: performance.now() + 4500 };
  if (wasHalf && !halftime(g)) {
    // 라커룸 대화가 끝나면 후반을 바로 시작한다.
    paused = false;
    last = performance.now();
    sheet = 'none';
  }
  host?.save();
  updateHud(true);
  updateSheet();
}

function say(text: string): void {
  note = { text, until: performance.now() + 2600 };
  updateCall();
}

function pick(i: number): void {
  const g = game;
  if (!g) return;
  const p = (g.match!.live as LiveState).teams[0].players[i];
  benchPick = -1;
  if (!p || p.off || selected === i) {
    selected = -1;
    if (sheet === 'player') sheet = 'none';
  } else {
    selected = i;
    sheet = 'player';
  }
  updateSheet();
}

/** data-live-do(화면 조작)와 data-live(감독의 지시)를 처리한다. 처리했으면 true. */
export function onLiveClick(el: HTMLElement): boolean {
  const g = game;
  if (!g) return false;
  const local = el.dataset.liveDo;
  const cmd = el.dataset.live;
  if (local) {
    const [what, value = ''] = local.split(':');
    if (what === 'play') togglePlay();
    else if (what === 'speed') {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
      updateControls();
    } else if (what === 'sheet') {
      // 좁은 화면에서는 같은 탭을 다시 누르면 시트를 접는다.
      sheet = sheet === value && !wide() ? 'none' : value as Sheet;
      updateSheet();
    } else if (what === 'pick') pick(Number(value));
    else if (what === 'bench') {
      benchPick = benchPick === Number(value) ? -1 : Number(value);
      updateSheet();
    } else if (what === 'edge') {
      // 판세 띠를 누르면 이유를 보여 준다. 좁은 화면에서 이미 보고 있었으면 접는다.
      sheet = sheet === 'tactic' && tacTab === 'read' && !wide() ? 'none' : 'tactic';
      tacTab = 'read';
      updateSheet();
    } else if (what === 'ttab') {
      tacTab = value === 'plan' || value === 'shape' ? value : 'read';
      updateSheet();
    } else if (what === 'phase') {
      phase = PHASES.find((x) => x.id === value)?.id ?? 'att';
      lastDial = '';
      updateSheet();
    } else if (what === 'with') {
      subShape = SHAPE_IDS.includes(value as ShapeId) ? (value as ShapeId) : '';
      updateSheet();
    } else if (what === 'cam') {
      setCam(!cam.on);
      if (replay) endReplay(performance.now());
      updateSheet();
      say(cam.on ? '중계 카메라를 켰다. 슈팅에 다가가고 골은 다시 보여 준다' : '중계 카메라를 껐다. 경기장을 늘 한눈에 본다');
    } else if (what === 'close') {
      selected = -1;
      benchPick = -1;
      sheet = 'none';
      updateSheet();
    }
    return true;
  }
  if (cmd) {
    // 교체를 하면 후보 선택을 지운다(들어온 선수에게 바로 역할을 줄 수 있게 자리 선택은 남긴다).
    if (cmd.startsWith('swap:')) {
      benchPick = -1;
      subShape = '';
    }
    const dial = DIALS.find((x) => cmd.startsWith(`${x.id}:`));
    if (dial) lastDial = dial.id;
    command(cmd);
    return true;
  }
  return false;
}

const halftime = (g: Game): boolean => {
  const L = g.match?.live;
  return !!L && L.halfTimeDone && !L.talked;
};

function frame(now: number): void {
  const g = game;
  if (!g || !canvas) return;
  const m = g.match as MatchState;
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  let ticked = false;
  if (!paused && m.step === 'live') {
    acc += dt * BASE_TPS * speed;
    while (acc >= 1 && m.step === 'live') {
      if (holding(m.live as LiveState)) {
        acc = 0.999;
        break;
      }
      acc -= 1;
      liveTick(g);
      ticked = true;
      const shot = (m.live as LiveState).flight;
      if (shot?.kind === 'shot') aim = { x: shot.toX, y: shot.toY, side: shot.side };
      if (halftime(g)) {
        paused = true;
        acc = 0;
        sheet = 'talk';
        host?.save();
        updateSheet();
        break;
      }
    }
  }
  if (ticked) {
    updateHud(false);
    // 선수 상태(체력, 평점, 기록)는 몇 틱마다 다시 그린다. 버튼을 누르는 중에는 건드리지 않는다.
    const L = m.live as LiveState;
    if ((sheet === 'squad' || sheet === 'player' || sheet === 'match') && L.tick % 10 === 0 && now - touchedAt > 900) updateSheet();
  }
  if (note && now > note.until) {
    note = null;
    updateCall();
  }
  if (swing && now > swing.until) {
    swing = null;
    updateEdge();
  }
  if (m.step !== 'live') {
    // 경기 끝. 마지막 장면을 잠깐 보여 준 뒤 결과 화면으로 간다.
    draw(1, true);
    const h = host;
    raf = 0;
    setTimeout(() => h?.done(), 900);
    return;
  }
  if (!paused && now - lastSave > 10000) {
    lastSave = now;
    host?.save();
  }
  draw(paused ? 1 : Math.min(1, acc), false, dt);
  raf = requestAnimationFrame(frame);
}

const minuteOf = (tick: number): number => Math.max(1, Math.ceil(tick / PER_MIN));

function clockText(L: LiveState): string {
  if (L.halfTimeDone && !L.talked) return '하프타임';
  if (L.over) return '경기 종료';
  if (L.tick === 0) return '킥오프 전';
  const min = Math.ceil(L.tick / PER_MIN);
  if (!L.halfTimeDone && min > 45) return `45+${min - 45}'`;
  if (min > 90) return `90+${min - 90}'`;
  return `${min}'`;
}

function updateCall(): void {
  const g = game;
  const el = $('#lv-call');
  if (!g || !el) return;
  const L = g.match!.live as LiveState;
  const lastCall = L.calls[L.calls.length - 1];
  if (note) {
    el.textContent = note.text;
    el.className = 'lv__call lv__call--note';
  } else if (lastCall) {
    el.textContent = `${minuteOf(lastCall.tick)}' ${lastCall.text}`;
    el.className = `lv__call lv__call--${lastCall.tone}`;
  } else {
    el.textContent = L.tick === 0 ? '▶ 킥오프. 선수를 누르면 역할과 교체, 끌면 자리를 옮긴다.' : '';
    el.className = 'lv__call';
  }
}

function updateHud(full: boolean): void {
  const g = game;
  if (!g) return;
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  const score = $('#lv-score');
  if (score) score.innerHTML = `${m.score[0]}<i>:</i>${m.score[1]}`;
  const clock = $('#lv-clock');
  if (clock) clock.textContent = `${clockText(L)}${m.venue === 'away' ? ' · 원정' : m.venue === 'home' ? ' · 홈' : ''}`;
  const [a, b] = L.teams;
  const pa = Math.round((a.possession / Math.max(1, a.possession + b.possession)) * 100);
  const poss = $('#lv-poss');
  if (poss) {
    const [x, y] = [poss.children[0] as HTMLElement, poss.children[1] as HTMLElement];
    x.style.cssText = `width:${L.tick ? pa : 50}%;background:${kit[0].body}`;
    y.style.cssText = `width:${L.tick ? 100 - pa : 50}%;background:${kit[1].body}`;
  }
  const stam = $('#lv-stam');
  if (stam) {
    const v = Math.round(m.me.stamina);
    stam.innerHTML = `체력 <span class="lv-meter${v < 45 ? ' is-low' : ''}"><i style="width:${v}%"></i></span> <b>${v}</b>`;
  }
  const subs = $('#lv-subs');
  if (subs) subs.innerHTML = `교체 카드 <b>${m.subs}</b>`;
  // 점수가 달라졌으면 골이다. 경기장 위에 띠를 띄우고, 그물이 출렁이고, 넣은 팀 관중이 뛴다. 조금 뒤에 느린 화면으로 다시 보여 준다.
  if (m.score[0] !== shown[0] || m.score[1] !== shown[1]) {
    const good = m.score[0] > shown[0];
    const now = performance.now();
    const line = m.log.slice(seenLog).reverse().find((l) => l.tone === (good ? 'good' : 'bad'));
    flash = { text: good ? '골!' : '실점', sub: line?.text ?? '', until: now + 2400, good };
    cheer(now, good);
    cueReplay(now, good, line?.text ?? '');
    shown = [m.score[0], m.score[1]];
    if (score) {
      score.classList.remove('is-pop');
      void score.offsetWidth;
      score.classList.add('is-pop');
    }
  }
  seenLog = m.log.length;
  if (full || L.tick % 10 === 0) updateEdge();
  updateCall();
  updateControls();
}

const signed = (v: number): string => (Math.abs(v) < 0.05 ? '0.0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);

/** 0을 가운데 둔 작은 막대. 오른쪽으로 뻗으면 우세, 왼쪽이면 열세. */
const gauge = (v: number): string =>
  `<span class="lv-gauge" aria-hidden="true"><i class="${v >= 0 ? 'is-up' : 'is-down'}" style="width:${Math.min(50, (Math.abs(v) / 8) * 50).toFixed(1)}%"></i></span>`;

const edgeCell = (name: string, v: number): string => `<span class="lv__edgecell">${name} ${gauge(v)} <b>${signed(v)}</b></span>`;

/** 점수 막대 아래의 판세 띠. 방금 지시로 움직인 폭이 있으면 가운데에 잠깐 보여 준다. */
function updateEdge(): void {
  const g = game;
  const el = $('#lv-edge');
  if (!g || !el || !g.match?.live) return;
  const o = outlook(g);
  const moved = swing
    ? [Math.abs(swing.atk) >= 0.05 ? `공격 ${signed(swing.atk)}` : '', Math.abs(swing.dfn) >= 0.05 ? `수비 ${signed(swing.dfn)}` : ''].filter(Boolean).join(' · ')
    : '';
  const good = !!swing && swing.atk + swing.dfn >= 0;
  el.innerHTML = `${edgeCell('공격', o.atk)}<span class="lv__edgemid${moved ? (good ? ' is-good' : ' is-bad') : ''}">${moved || '판세'}</span>${edgeCell('수비', o.dfn)}`;
}

function updateControls(): void {
  const g = game;
  if (!g) return;
  const play = $('#lv-play');
  const L = g.match?.live;
  if (play) {
    const half = halftime(g);
    const label = half ? '라커룸' : paused ? (L && L.tick === 0 ? '킥오프' : '재생') : '멈춤';
    play.innerHTML = `<span class="lv__playicon${paused ? '' : ' is-pause'}" aria-hidden="true"></span><span class="lv__playtext">${label}</span>`;
    play.classList.toggle('is-running', !paused);
  }
  const sp = $('#lv-speed');
  if (sp) sp.innerHTML = `${speed}<small>배속</small>`;
}

// ---------- 선수 상태 ----------

/** 선수별 체력. 팀 체력에서, 경기장에 들어온 뒤 뛴 시간만큼 지친 것으로 본다(교체 선수는 쌩쌩하다). */
function condition(L: LiveState, m: MatchState, p: LivePlayer): number {
  const played = Math.max(0, L.tick - (p.on ?? 0));
  return Math.round(100 - (100 - m.me.stamina) * (played / Math.max(1, L.tick)));
}

/** 경기 평점(6.0 기준). 골, 유효 슈팅, 공 뺏기, 파울, 팀 득실, 실력이 들어간다. */
function rating(L: LiveState, m: MatchState, team: 0 | 1, p: LivePlayer): number {
  const r = p.rec ?? { goals: 0, shots: 0, onTarget: 0, steals: 0, fouls: 0 };
  const mean = L.teams[team].players.reduce((s, q) => s + q.ovr, 0) / Math.max(1, L.teams[team].players.length);
  const diff = team === 0 ? m.score[0] - m.score[1] : m.score[1] - m.score[0];
  const keeper = p.line === 'GK' ? (team === 0 ? L.teams[1].onTarget - m.score[1] : L.teams[0].onTarget - m.score[0]) * 0.25 - (team === 0 ? m.score[1] : m.score[0]) * 0.3 : 0;
  const v = 6.2 + r.goals * 1.1 + r.onTarget * 0.25 + (r.shots - r.onTarget) * 0.05 + r.steals * 0.2 - r.fouls * 0.15 + diff * 0.15 + (p.ovr - mean) * 0.03 + keeper;
  return Math.round(clamp(p.off ? Math.min(v, 4.5) : v, 3, 10) * 10) / 10;
}

const ratingTone = (v: number): string => (v >= 7.5 ? 'good' : v < 5.8 ? 'bad' : 'plain');

/** 우리 선수의 Player(주전이나 후보). 2군은 없다. */
function playerOf(g: Game, p: LivePlayer): Player | undefined {
  const id = p.pid ?? (p.key >= 0 ? p.key : -1);
  return id >= 0 ? [...g.squad, ...g.reserves, ...(g.match?.live?.youth ?? [])].find((x) => x.id === id) : undefined;
}

const myKit = (): [string, string] => [kit[0].body, kit[0].trim];
const noStyle = (): string => `--kit:${kit[0].body};--ink:${light(kit[0].body) ? '#111' : '#fff'}`;

// ---------- 지시 시트 ----------

const opt = (cmd: string, label: string, on: boolean, disabled = false, extra = ''): string =>
  `<button type="button" class="lv-opt${on ? ' is-on' : ''}" data-live="${esc(cmd)}" aria-pressed="${on}"${disabled ? ' disabled' : ''}>${esc(label)}${extra}</button>`;

/** 화면만 바꾸는 단추(지시를 내리지 않는다). */
const localOpt = (what: string, text: string, on: boolean, extra = ''): string =>
  `<button type="button" class="lv-opt${on ? ' is-on' : ''}" data-live-do="${esc(what)}" aria-pressed="${on}">${esc(text)}${extra}</button>`;

/** 시트 안의 작은 탭 줄. */
const subtabs = (name: string, items: [string, string, boolean, number?][]): string =>
  `<div class="lv-sub2" role="tablist" aria-label="${esc(name)}">${items.map(([what, text, on, n]) =>
    `<button type="button" role="tab" class="lv-sub2__tab${on ? ' is-on' : ''}" data-live-do="${esc(what)}" aria-selected="${on}">${esc(text)}${n ? `<i>${n}</i>` : ''}</button>`).join('')}</div>`;

/**
 * 이것을 고르면 판세가 얼마나 달라지는지. 달라지지 않으면 빈 문자열.
 * 좁은 단추(pair)에는 이름표 없이 숫자 둘만 쓴다. 왼쪽이 공격, 오른쪽이 수비로 판세 띠와 같은 순서다.
 */
function preview(base: Outlook, next: Outlook, pair = false): string {
  const [a, d] = [next.atk - base.atk, next.dfn - base.dfn];
  if (Math.abs(a) < 0.05 && Math.abs(d) < 0.05) return '';
  const tone = (v: number): string => (Math.abs(v) < 0.05 ? '' : v > 0 ? ' class="is-up"' : ' class="is-down"');
  if (pair) return `<span class="lv-pv lv-pv--pair" aria-label="공격 ${signed(a)}, 수비 ${signed(d)}"><i${tone(a)}>${Math.abs(a) < 0.05 ? '0' : signed(a)}</i><i${tone(d)}>${Math.abs(d) < 0.05 ? '0' : signed(d)}</i></span>`;
  const bit = (name: string, v: number): string => (Math.abs(v) < 0.05 ? '' : `<i${tone(v)}>${name}${signed(v)}</i>`);
  return `<span class="lv-pv">${bit('공', a)}${bit('수', d)}</span>`;
}

const label = (title: string, hint = ''): string => `<p class="lv-label">${esc(title)}${hint ? `<small>${esc(hint)}</small>` : ''}</p>`;

/** 셋 중 하나를 고르는 지시(붙은 단추 세 개). */
const seg = (title: string, body: string, hint = ''): string =>
  `<div class="lv-seg">${label(title, hint)}<div class="lv-seg__opts" role="group" aria-label="${esc(title)}">${body}</div></div>`;

function confusedNote(m: MatchState, L: LiveState): string {
  return m.confusion > 0 && L.tick < L.confusedUntil
    ? `<p class="lv-note lv-note--bad">새 지시를 익히는 중. ${Math.ceil((L.confusedUntil - L.tick) / PER_MIN)}분쯤 손발이 맞지 않는다.</p>` : '';
}

function sheetSquad(g: Game, m: MatchState, L: LiveState): string {
  const team = L.teams[0];
  const slots = slotsOf(L, 0, m.me.shape);
  const order = team.players.map((p, i) => ({ p, i })).sort((a, b) => (slots[a.p.slot] as Slot).u - (slots[b.p.slot] as Slot).u || (slots[a.p.slot] as Slot).v - (slots[b.p.slot] as Slot).v);
  const men = order.map(({ p, i }) => {
    const at = slotSpot(slots[p.slot] as Slot);
    const cond = condition(L, m, p);
    const rt = rating(L, m, 0, p);
    const role = p.pid !== undefined ? m.roles[p.pid] : undefined;
    const marks = `${p.rec?.goals ? `<em>${p.rec.goals}골</em>` : ''}${p.off ? '<em class="is-red">퇴장</em>' : ''}${p.on ? '<em>IN</em>' : ''}`;
    return `<button type="button" class="lv-man${i === selected ? ' is-picked' : ''}${p.off ? ' is-off' : ''}" data-live-do="pick:${i}"${p.off ? ' disabled' : ''}>
      <span class="lv-no" style="${noStyle()}">${p.n}</span>
      <span class="lv-man__name">${esc(short(p.name, p.nat))}${marks}</span>
      <span class="lv-man__spot">${at}${role ? ` · ${esc(roleName(at, role))}` : ''}</span>
      <span class="lv-meter${cond < 45 ? ' is-low' : ''}" title="체력 ${cond}"><i style="width:${cond}%"></i></span>
      <span class="lv-rt lv-rt--${ratingTone(rt)}" title="경기 평점">${rt.toFixed(1)}</span>
    </button>`;
  }).join('');
  const bench = benchPlayers(g, L).length;
  return `
    ${confusedNote(m, L)}
    ${label('경기장', '누르면 역할 · 위치 · 교체')}
    <div class="lv-roster">${men}</div>
    ${label('빠른 교체', `카드 ${m.subs}장 · 벤치 ${bench}명`)}
    <div class="lv-chips">
      ${opt('sub:fw', '공격수 투입', false, m.subs < 1)}${opt('sub:mf', '미드필더 투입', false, m.subs < 1)}${opt('sub:df', '수비수 투입', false, m.subs < 1)}${opt('sub:legs', '지친 둘 교체', false, m.subs < 2)}
    </div>`;
}

function sheetPlayer(g: Game, m: MatchState, L: LiveState): string {
  const p = L.teams[0].players[selected] as LivePlayer;
  const pl = playerOf(g, p);
  const slot = slotsOf(L, 0, m.me.shape)[p.slot] as Slot;
  const at = actingSpot(m, L, p);
  const keeper = slot.line === 'GK';
  const cond = condition(L, m, p);
  const rt = rating(L, m, 0, p);
  const role = p.pid !== undefined ? (m.roles[p.pid] ?? 'base') : 'base';
  const roles = p.pid === undefined ? '' : ROLES[at].map((x) => opt(`role:${p.pid}:${x.id}`, x.name, role === x.id)).join('');
  const desc = ROLES[at].find((x) => x.id === role)?.desc ?? '';
  // 화면에서 앞(공격 방향)이 어느 쪽인지에 따라 화살표를 맞춘다.
  // 후반에는 진영이 바뀌어 앞이 반대쪽이다. 세운 화면의 왼쪽과 오른쪽은 보이는 대로 움직인다.
  const up = upright();
  const flip = secondHalf(L);
  const side = up && flip ? -NUDGE : NUDGE;
  const nudge = (text: string, glyph: string, du: number, dv: number): string => {
    const u = slot.u + du;
    const v = slot.v + dv;
    const dead = keeper || u < 12 || u > 76 || v < 3 || v > 65;
    return `<button type="button" class="lv-nudge" data-live="move:${selected}:${u}:${v}"${dead ? ' disabled' : ''}><span aria-hidden="true">${glyph}</span>${text}</button>`;
  };
  const bench = benchPlayers(g, L).map((b) => ({ b, pen: posPenalty(b.spot, slot.line) })).sort((x, y) => x.pen - y.pen || y.b.ovr + y.b.temp - x.b.ovr - x.b.temp);
  const pickedIn = bench.find(({ b }) => b.id === benchPick)?.b;
  const cards = bench.length === 0 ? '<p class="lv-fine">남은 후보가 없다.</p>' : bench.map(({ b, pen }) => `
    <button type="button" class="lv-sub${b.id === benchPick ? ' is-picked' : ''}" data-live-do="bench:${b.id}" aria-pressed="${b.id === benchPick}">
      ${face(b.id, b.nat, 30, myKit(), b.name)}
      <span class="lv-sub__name">${esc(short(b.name, b.nat))}</span>
      <span class="lv-sub__meta">${b.spot} <b>${b.ovr + b.temp}</b>${pen ? `<i>-${pen}</i>` : ''}</span>
    </button>`).join('');
  const st = pl ? statsOf(pl) : null;
  const names = pl ? statNames(pl.spot).short : [];
  const r = p.rec;
  return `
    <header class="lv-who">
      ${face(p.pid ?? hashName(p.name), p.nat ?? '', 44, myKit(), p.name)}
      <div class="lv-who__text">
        <p class="lv-who__name"><span class="lv-no" style="${noStyle()}">${p.n}</span>${esc(p.name)}</p>
        <p class="lv-who__meta">${at}${pl && pl.spot !== at ? ` (본래 ${pl.spot})` : ''} · OVR ${Math.round(p.ovr)}${pl ? ` · ${FOOT_NAME[pl.foot]}` : ''} · 체력 ${cond} · 평점 <b class="lv-rt--${ratingTone(rt)}">${rt.toFixed(1)}</b></p>
      </div>
      <button type="button" class="lv-x" data-live-do="close" aria-label="닫기"></button>
    </header>
    ${roles ? `${label('역할', desc)}<div class="lv-chips">${roles}</div>` : ''}
    ${keeper ? '' : `${label('위치', '경기장에서 끌어도 된다')}
    <div class="lv-pad">
      ${nudge('올린다', up ? (flip ? '▼' : '▲') : (flip ? '◀' : '▶'), NUDGE, 0)}${nudge('내린다', up ? (flip ? '▲' : '▼') : (flip ? '▶' : '◀'), -NUDGE, 0)}${nudge('왼쪽', up ? '◀' : (flip ? '▼' : '▲'), 0, -side)}${nudge('오른쪽', up ? '▶' : (flip ? '▲' : '▼'), 0, side)}
    </div>`}
    ${label('교체', `카드 ${m.subs}장 · ${slot.line} 자리 기준`)}
    <div class="lv-bench">${cards}</div>
    ${pickedIn && m.subs > 0 ? `${label('함께 바꾸기', '같은 카드 한 장으로 대형까지')}
    <div class="lv-strip">${localOpt('with:', '대형 그대로', subShape === '')}${SHAPE_IDS.filter((id) => id !== m.me.shape).map((id) => localOpt(`with:${id}`, SHAPES[id].name, subShape === id)).join('')}</div>` : ''}
    ${pickedIn ? `<button type="button" class="lv-go" data-live="swap:${selected}:${pickedIn.id}${subShape ? `:${subShape}` : ''}"${m.subs < 1 ? ' disabled' : ''}>${m.subs < 1 ? '교체 카드가 없다' : `<b>IN</b> ${pickedIn.no} ${esc(short(pickedIn.name, pickedIn.nat))} <span aria-hidden="true">⇄</span> <b>OUT</b> ${p.n} ${esc(short(p.name, p.nat))}${subShape ? ` <b>+ ${SHAPES[subShape].name}</b>` : ''}`}</button>` : ''}
    <p class="lv-fine">${st ? `${st.map((v, k) => `${names[k]} ${v}`).join(' · ')}<br>` : ''}${esc(staminaText(cond))}${r ? ` · 슈팅 ${r.shots}(유효 ${r.onTarget}) · 공 뺏기 ${r.steals} · 파울 ${r.fouls}` : ''}</p>`;
}

/** 판세의 이유: 전술 싸움의 갈래마다 공격과 수비에 얼마나 보태는지. */
function reasons(o: Outlook): string {
  const rows = o.parts
    .map((p) => ({ p, a: (p.att - p.oDef) * TACTIC_GAIN, d: (p.def - p.oAtt) * TACTIC_GAIN }))
    .filter((x) => Math.abs(x.a) >= 0.05 || Math.abs(x.d) >= 0.05)
    .sort((x, y) => Math.abs(y.a) + Math.abs(y.d) - Math.abs(x.a) - Math.abs(x.d));
  if (rows.length === 0) return '<p class="lv-fine">전술로는 어느 쪽도 앞서지 않는다. 지금의 차이는 선수 실력과 체력, 사기에서 나온다.</p>';
  const num = (v: number): string => `<span class="lv-why__n${Math.abs(v) < 0.05 ? '' : v > 0 ? ' is-up' : ' is-down'}">${signed(v)}</span>`;
  return `<ul class="lv-why">
    <li class="lv-why__head"><span></span><span>공격</span><span>수비</span></li>
    ${rows.map(({ p, a, d }) => `<li><span class="lv-why__t"><b>${esc(p.label)}</b>${p.notes.length ? `<small>${esc(p.notes.slice(0, 2).join(' · '))}</small>` : ''}</span>${num(a)}${num(d)}</li>`).join('')}
  </ul>`;
}

/** 벤치가 읽어 낸 상대의 운영. */
function oppLine(m: MatchState): string {
  const head = `${SHAPES[m.opp.shape].name}${m.read ? ` · ${STYLES[m.opp.style].name}` : ''}`;
  const seen = m.oppSeen ? dialChanges(NEUTRAL, m.oppSeen) : null;
  const dials = seen === null ? '지시는 아직 읽는 중' : seen.length ? seen.join(' · ') : '특별한 지시 없음';
  return `<p class="lv-note${m.oppNews ? ' lv-note--bad' : ''}"><b>상대</b> ${esc(head)} · ${esc(dials)}${m.oppNews ? '<br>상대 벤치가 방금 무언가 바꿨다. 읽는 중이다.' : ''}</p>`;
}

/** 지시를 바꾼 뒤로 경기가 어떻게 달라졌는지. 바꾸기 전 구간도 한 줄로 견준다. */
function afterMarks(m: MatchState, L: LiveState): string {
  const marks = L.marks ?? [];
  if (marks.length === 0) return '<p class="lv-fine">지시를 바꾸면, 그 뒤로 슈팅과 점유가 어떻게 달라졌는지 여기에 쌓인다.</p>';
  const [a, b] = L.teams;
  const now: LiveMark = { tick: L.tick, text: '', shots: [a.shots, b.shots], xg: [a.xg, b.xg], poss: [a.possession, b.possession], score: [m.score[0], m.score[1]] };
  const zero: LiveMark = { tick: 0, text: '', shots: [0, 0], xg: [0, 0], poss: [0, 0], score: [0, 0] };
  const row = (from: LiveMark, to: LiveMark, title: string): string => {
    const mins = Math.max(0, Math.round((to.tick - from.tick) / PER_MIN));
    const px = to.poss[0] - from.poss[0];
    const py = to.poss[1] - from.poss[1];
    const goals: [number, number] = [to.score[0] - from.score[0], to.score[1] - from.score[1]];
    const stats = mins < 1 ? '방금 바꿨다' : `${mins}분 동안 슈팅 ${to.shots[0] - from.shots[0]}:${to.shots[1] - from.shots[1]} · 기대 득점 ${(to.xg[0] - from.xg[0]).toFixed(1)}:${(to.xg[1] - from.xg[1]).toFixed(1)}${px + py > 0 ? ` · 점유 ${Math.round((px / (px + py)) * 100)}%` : ''}${goals[0] + goals[1] > 0 ? ` · 골 ${goals[0]}:${goals[1]}` : ''}`;
    return `<li><b>${title}</b><span>${stats}</span></li>`;
  };
  const first = marks[0] as LiveMark;
  const rows = marks.map((mk, k) => row(mk, marks[k + 1] ?? now, `${minuteOf(mk.tick)}' ${esc(mk.text)}`)).reverse();
  // 남아 있는 가장 오래된 변경 앞의 구간. 킥오프부터가 아닐 수 있어 "그 전"이라고만 부른다.
  if (first.tick >= PER_MIN) rows.push(row(zero, first, `${minuteOf(first.tick)}' 전까지`));
  return `<ol class="lv-after">${rows.join('')}</ol>`;
}

function sheetTactic(g: Game, m: MatchState, L: LiveState): string {
  const base = outlook(g);
  const tabs = subtabs('전술', [['ttab:read', '판세', tacTab === 'read'], ['ttab:plan', '전술 · 태세', tacTab === 'plan'], ['ttab:shape', '대형', tacTab === 'shape']]);
  if (tacTab === 'read') {
    return `
      ${tabs}
      <div class="lv-read">
        <span>공격 ${gauge(base.atk)} <b>${signed(base.atk)}</b></span>
        <span>수비 ${gauge(base.dfn)} <b>${signed(base.dfn)}</b></span>
      </div>
      ${oppLine(m)}
      ${confusedNote(m, L)}
      ${label('왜 이런가', '전술이 보탠 몫')}
      ${reasons(base)}
      ${label('바꾼 뒤', '지시를 바꾼 뒤의 경기')}
      ${afterMarks(m, L)}
      <p class="lv-fine">공격은 우리 공격과 상대 수비의 차이, 수비는 우리 수비와 상대 공격의 차이다. 1이 오르면 기대 득점이 6%쯤 움직인다. 상대 지시는 벤치가 읽은 만큼만 들어 있다.</p>`;
  }
  if (tacTab === 'plan') {
    const advice = liveAdvice(g);
    const styles = STYLE_IDS.map((id) => opt(`style:${id}`, STYLES[id].name, m.me.style === id, false, m.me.style === id ? '' : preview(base, outlook(g, { style: id })))).join('');
    const oppPush = m.opp.push === 1 ? ' · 상대 총공세' : m.opp.push === -1 ? ' · 상대 잠금' : '';
    return `
      ${tabs}
      <p class="lv-note lv-note--${advice.tone}">${esc(advice.text)}</p>
      ${confusedNote(m, L)}
      ${seg('태세', opt('push:-1', '잠근다', m.me.push === -1) + opt('push:0', '균형', m.me.push === 0) + opt('push:1', '총공세', m.me.push === 1), `막판의 승부수${oppPush}`)}
      ${label('전술', m.me.style === g.season.style ? '몸에 밴 전술' : '완성도 절반')}
      <div class="lv-chips lv-chips--pv">${styles}</div>
      <p class="lv-fine">숫자는 바꿨을 때 판세가 움직이는 폭(공격, 수비)이다. 전술을 바꾸면 15분쯤 손발이 어긋난다.</p>`;
  }
  const shapes = SHAPE_IDS.map((id) => opt(`shape:${id}`, SHAPES[id].name, m.me.shape === id, m.subs < 1 && m.me.shape !== id)).join('');
  const def = m.me.shapeDef ?? m.me.shape;
  const defs = opt('shapedef:same', '공격과 같게', def === m.me.shape, false, def === m.me.shape ? '' : preview(base, outlook(g, { shapeDef: null })))
    + SHAPE_IDS.filter((id) => id !== m.me.shape).map((id) => opt(`shapedef:${id}`, SHAPES[id].name, def === id, false, def === id ? '' : preview(base, outlook(g, { shapeDef: id })))).join('');
  return `
    ${tabs}
    ${confusedNote(m, L)}
    ${label('공격 대형', `바꾸면 교체 카드 1장(남은 ${m.subs}장) · 상대 ${SHAPES[m.opp.shape].name}`)}
    <div class="lv-chips">${shapes}</div>
    ${label('수비 대형', '공이 없을 때 서는 모양 · 카드 없음')}
    <div class="lv-chips lv-chips--pv">${defs}</div>
    <p class="lv-fine">공격과 수비 대형이 다르면 공이 넘어갈 때마다 자리를 찾아 뛰어야 한다. 모양이 많이 다를수록, 즉시 압박이나 바로 역습과 겹칠수록 부담이 크다. 선수를 바꾸면서 대형을 함께 바꾸려면 선수 시트의 교체에서 고른다.</p>`;
}

function sheetOrders(g: Game, m: MatchState, L: LiveState): string {
  const d = m.dials;
  const base = outlook(g);
  const count = (id: DialPhase): number => DIALS.filter((x) => x.phase === id && d[x.id] !== 0).length + (id === 'att' && d.overlap ? 1 : 0);
  const tabs = subtabs('국면', PHASES.map((x): [string, string, boolean, number] => [`phase:${x.id}`, x.name, phase === x.id, count(x.id)]));
  const dials = DIALS.filter((x) => x.phase === phase).map((x) => seg(x.name, x.steps.map((text, k) => {
    const level = (k - 1) as Level;
    return opt(`${x.id}:${level}`, text, d[x.id] === level, false, d[x.id] === level ? '' : preview(base, outlook(g, { dials: { ...d, [x.id]: level } }), true));
  }).join(''))).join('');
  const overlap = phase !== 'att' ? '' : seg('풀백 오버래핑',
    opt('overlap:0', '자리 지킴', !d.overlap, false, d.overlap ? preview(base, outlook(g, { dials: { ...d, overlap: false } }), true) : '')
    + opt('overlap:1', '올라간다', d.overlap, false, d.overlap ? '' : preview(base, outlook(g, { dials: { ...d, overlap: true } }), true)));
  // 조합: 걸린 것은 이름표로, 하나만 더 맞추면 되는 것은 바로 누를 수 있는 단추로.
  const on = base.combos.on.map((c) => `<span class="lv-combo lv-combo--${c.good ? 'good' : 'bad'}" title="${esc(c.text)}">${c.good ? '' : '주의 '}${esc(c.name)}</span>`).join('');
  const near = base.combos.near.slice(0, 3).map(({ combo, missing, fix }) => (fix
    ? `<button type="button" class="lv-combo lv-combo--near" data-live="${fix.dial}:${fix.level}" title="${esc(combo.text)}">${esc(combo.name)}<small>+ ${esc(missing)}</small></button>`
    : `<span class="lv-combo lv-combo--near" title="${esc(combo.text)}">${esc(combo.name)}<small>+ ${esc(missing)}</small></span>`)).join('');
  const bad = base.combos.on.filter((c) => !c.good).map((c) => `<p class="lv-note lv-note--bad"><b>${esc(c.name)}</b> ${esc(c.text)}</p>`).join('');
  const picked = lastDial ? DIALS.find((x) => x.id === lastDial) : undefined;
  const fine = picked ? `${picked.name}: ${picked.desc}.` : `${(PHASES.find((x) => x.id === phase) as (typeof PHASES)[number]).desc}의 지시다. 숫자 둘은 골랐을 때 판세가 움직이는 폭으로, 왼쪽이 공격이고 오른쪽이 수비다.`;
  const moved = !!L.custom?.[m.me.shape];
  const preset = outlook(g, { dials: presetDials(m.me.style, 1) });
  return `
    ${tabs}
    ${confusedNote(m, L)}
    <div class="lv-combos" aria-label="조합">${on || near ? `${on}${near}` : '<span class="lv-fine">걸린 조합이 없다. 지시를 서로 맞물리면 조합이 걸린다.</span>'}</div>
    ${bad}
    <div class="lv-dials">
      ${dials}
      ${overlap}
    </div>
    <p class="lv-fine">${esc(fine)}</p>
    <div class="lv-chips lv-chips--pv">
      ${opt('dials:preset', '코치 추천', false, false, preview(base, preset))}${opt('dials:reset', '모두 보통', false)}<button type="button" class="lv-opt" data-live="move:reset"${moved ? '' : ' disabled'}>옮긴 자리 되돌리기</button>
    </div>`;
}

function sheetMatch(m: MatchState, L: LiveState): string {
  const [a, b] = L.teams;
  const pa = Math.round((a.possession / Math.max(1, a.possession + b.possession)) * 100);
  const recent = [...L.calls].reverse().slice(0, 8);
  const ticker = recent.length === 0
    ? '<li class="lv-log__row"><span>시작</span><span>슈팅, 선방, 파울, 교체가 여기에 쌓인다.</span></li>'
    : recent.map((c) => `<li class="lv-log__row lv-log__row--${c.tone}"><span>${minuteOf(c.tick)}'</span><span>${esc(c.text)}</span></li>`).join('');
  return `
    <p class="lv-fine">${esc(m.label)}</p>
    <dl class="lv-stats">
      <div><dt>점유율</dt><dd>${pa}<i> : ${100 - pa}</i></dd></div>
      <div><dt>슈팅(유효)</dt><dd>${a.shots}(${a.onTarget})<i> : ${b.shots}(${b.onTarget})</i></dd></div>
      <div><dt>기대 득점</dt><dd>${a.xg.toFixed(1)}<i> : ${b.xg.toFixed(1)}</i></dd></div>
      <div><dt>상대 체력</dt><dd class="lv-stats__text">${esc(staminaText(m.opp.stamina))}</dd></div>
    </dl>
    <ol class="lv-log">${ticker}</ol>
    <div class="lv-chips lv-chips--tight">
      <button type="button" class="lv-opt" data-act="skip">남은 경기 건너뛰기</button>
      <button type="button" class="lv-opt" data-live-do="cam" aria-pressed="${cam.on}" aria-label="중계 카메라">카메라 <b>${cam.on ? '켬' : '끔'}</b></button>
      <button type="button" class="lv-opt" data-tab="table">순위표</button>
      <button type="button" class="lv-opt" data-tab="squad">구단 관리</button>
    </div>`;
}

function sheetTalk(m: MatchState): string {
  const lead = m.score[0] - m.score[1];
  const talk = (cmd: string, title: string, detail: string): string =>
    `<button type="button" class="lv-talk" data-live="talk:${cmd}"><b>${title}</b><span>${detail}</span></button>`;
  return `
    ${label('하프타임 라커룸', lead > 0 ? '앞선 채로 들어왔다' : lead < 0 ? '뒤진 채로 들어왔다' : '팽팽한 채로 들어왔다')}
    <div class="lv-talks">
      ${talk('praise', '잘하고 있다고 다독인다', '비기거나 한 골 뒤질 때 잘 통한다')}
      ${talk('blast', '물병을 걷어찬다', '통하면 크게 살아나고, 안 통하면 얼어붙는다')}
      ${talk('calm', '후반 계획만 짚는다', '확실한 작은 효과. 후반 초반 전술 변경에 혼선이 없다')}
    </div>
    <p class="lv-fine">말을 마치면 진영을 바꿔 후반이 시작된다. 교체와 전술은 아래 탭에서 먼저 바꿔 둘 수 있다.</p>`;
}

function updateSheet(): void {
  const g = game;
  const box = $('#lv-sheet');
  const root = $('#lv');
  if (!g || !box || !root) return;
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  const sel = L.teams[0].players[selected];
  if (sheet === 'player' && (!sel || sel.off)) {
    selected = -1;
    sheet = 'none';
  }
  if (sheet === 'talk' && !halftime(g)) sheet = 'none';
  // 넓은 화면의 옆 패널은 비워 두지 않는다.
  if (sheet === 'none' && wide()) sheet = halftime(g) ? 'talk' : 'squad';
  root.dataset.sheet = sheet;
  box.hidden = sheet === 'none';
  document.querySelectorAll<HTMLElement>('[data-live-do^="sheet:"]').forEach((el) => {
    const id = el.dataset.liveDo?.slice(6);
    const on = id === sheet || (id === 'squad' && sheet === 'player');
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-selected', String(on));
  });
  const top = box.scrollTop;
  const side = box.querySelector('.lv-bench')?.scrollLeft ?? 0;
  const strip2 = box.querySelector('.lv-strip')?.scrollLeft ?? 0;
  box.innerHTML = sheet === 'none' ? ''
    : sheet === 'squad' ? sheetSquad(g, m, L)
    : sheet === 'player' ? sheetPlayer(g, m, L)
    : sheet === 'tactic' ? sheetTactic(g, m, L)
    : sheet === 'orders' ? sheetOrders(g, m, L)
    : sheet === 'match' ? sheetMatch(m, L)
    : sheetTalk(m);
  box.dataset.kind = sheet;
  box.scrollTop = top;
  const strip = box.querySelector('.lv-bench');
  if (strip) strip.scrollLeft = side;
  const withs = box.querySelector('.lv-strip');
  if (withs) withs.scrollLeft = strip2;
  updateControls();
}

// ---------- 경기장 ----------

interface Vis {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 바라보는 방향(단위 벡터). */
  hx: number;
  hy: number;
  /** 다른 말과 포개지지 않게 벌린 뒤의 자리(m). 그리는 자리다. */
  fx: number;
  fy: number;
  /** 화면 좌표(누르기 판정용). */
  sx: number;
  sy: number;
  /** 걸음의 위상(공은 구른 각도). */
  ph: number;
  /** 이름표를 말 위쪽에 다는가. */
  up: boolean;
}

/** 화면에 그리는 위치. 엔진 위치를 스프링으로 따라간다. 키는 "팀:자리". */
const vis = new Map<string, Vis>();
/** 공이 지나간 자리(빠르게 움직일 때 꼬리). */
const trail: { x: number; y: number }[] = [];

/**
 * 경기장 좌표(m)를 화면에 옮기는 법. 세운 경기장은 우리 팀이 전반에 위로, 눕힌 경기장은 오른쪽으로 공격한다.
 * 엔진은 90분 내내 우리 팀이 x가 커지는 쪽으로 공격한다고 본다. 후반에는 화면만 반 바퀴 돌려(flip) 두 팀이 진영을 바꾼 것으로 보여 준다.
 */
const view = { up: false, flip: false, s: 4, ox: 0, oy: 0 };
const FX = (x: number): number => (view.flip ? 105 - x : x);
const FY = (y: number): number => (view.flip ? 68 - y : y);
const PX = (x: number, y: number): number => view.ox + (view.up ? FY(y) : FX(x)) * view.s;
const PY = (x: number, y: number): number => view.oy + (view.up ? 105 - FX(x) : FY(y)) * view.s;
/** 화면의 점을 경기장 좌표로. */
const toPitch = (sx: number, sy: number): [number, number] => {
  const [x, y] = view.up ? [105 - (sy - view.oy) / view.s, (sx - view.ox) / view.s] : [(sx - view.ox) / view.s, (sy - view.oy) / view.s];
  return [FX(x), FY(y)];
};
/** 경기장의 방향 벡터를 화면 방향으로. */
const turn = (dx: number, dy: number): [number, number] => {
  const k = view.flip ? -1 : 1;
  return view.up ? [dy * k, -dx * k] : [dx * k, dy * k];
};
/** 후반이 시작됐는가(라커룸 대화까지 마쳤는가). 이때부터 진영이 바뀐다. */
const secondHalf = (L: LiveState): boolean => L.halfTimeDone && L.talked;

/** 임계 감쇠 스프링 한 걸음(암시적 오일러라 큰 dt에도 안정적이다). */
function spring(v: Vis, tx: number, ty: number, dt: number, w: number): void {
  const f = 1 + 2 * dt * w;
  const oo = w * w;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const inv = 1 / (f + hhoo);
  const nx = (f * v.x + dt * v.vx + hhoo * tx) * inv;
  const nvx = (v.vx + hoo * (tx - v.x)) * inv;
  const ny = (f * v.y + dt * v.vy + hhoo * ty) * inv;
  const nvy = (v.vy + hoo * (ty - v.y)) * inv;
  v.x = nx;
  v.vx = nvx;
  v.y = ny;
  v.vy = nvy;
}

function visOf(key: string, x: number, y: number, hx: number): Vis {
  let v = vis.get(key);
  if (!v) {
    v = { x, y, vx: 0, vy: 0, hx, hy: 0, fx: x, fy: y, sx: 0, sy: 0, ph: 0, up: false };
    vis.set(key, v);
  }
  return v;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

// ----- 누르기와 끌기 -----

interface Drag {
  id: number;
  /** 잡은 선수. 빈 곳을 눌렀으면 -1. */
  i: number;
  /** 누른 자리와 지금 자리(캔버스 좌표). 카메라가 움직여도 손가락 밑을 가리키도록 따로 둔다. */
  rx0: number;
  ry0: number;
  rx: number;
  ry: number;
  /** 지금 자리(카메라를 걷어 낸 좌표). */
  x: number;
  y: number;
  moving: boolean;
}

let drag: Drag | null = null;

/** 기준 자리(대형의 자리)를 보여 줄 때: 멈췄거나, 선수를 골랐거나, 끄는 중. */
const boardMode = (): boolean => paused || !!drag?.moving;

/** 화면의 점에서 가장 가까운 우리 선수. 전술판 모드에서는 기준 자리를 잡아도 된다. */
function ownAt(px: number, py: number, skip = -1): number {
  const g = game;
  if (!g) return -1;
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  const slots = slotsOf(L, 0, m.me.shape);
  let best = -1;
  let bestD = 30;
  L.teams[0].players.forEach((p, i) => {
    if (p.off || i === skip) return;
    const v = vis.get(`0:${i}`);
    if (!v) return;
    let d = Math.hypot(v.sx - px, v.sy - py);
    const slot = slots[p.slot] as Slot;
    if (boardMode() && slot.line !== 'GK') d = Math.min(d, Math.hypot(PX(slot.u, slot.v) - px, PY(slot.u, slot.v) - py));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function local(e: PointerEvent): [number, number] {
  const rect = (canvas as HTMLCanvasElement).getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function onPitchDown(e: PointerEvent): void {
  if (!game || !canvas || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (replay) {
    // 리플레이는 누르면 넘어간다. 시작하기 전에 눌렀으면 리플레이 없이 하던 일을 한다.
    const showing = replay.live;
    endReplay(performance.now());
    if (showing) {
      e.preventDefault();
      return;
    }
  }
  const [rx, ry] = local(e);
  const [x, y] = uncam(rx, ry);
  drag = { id: e.pointerId, i: ownAt(x, y), rx0: rx, ry0: ry, rx, ry, x, y, moving: false };
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPitchMove(e: PointerEvent): void {
  const g = game;
  if (!g || !drag || drag.id !== e.pointerId || drag.i < 0) return;
  [drag.rx, drag.ry] = local(e);
  [drag.x, drag.y] = uncam(drag.rx, drag.ry);
  if (drag.moving || Math.hypot(drag.rx - drag.rx0, drag.ry - drag.ry0) < 9) return;
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  const p = L.teams[0].players[drag.i] as LivePlayer;
  // 골키퍼는 옮기지 않는다.
  if ((slotsOf(L, 0, m.me.shape)[p.slot] as Slot).line === 'GK') return;
  drag.moving = true;
}

function onPitchUp(e: PointerEvent): void {
  const g = game;
  const d = drag;
  if (!g || !d || d.id !== e.pointerId) return;
  drag = null;
  if (!d.moving) {
    // 그냥 눌렀다: 선수를 고르거나, 빈 곳이면 고른 것을 푼다.
    if (d.i >= 0) pick(d.i);
    else if (selected >= 0) pick(selected);
    return;
  }
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  const p = L.teams[0].players[d.i] as LivePlayer;
  const slots = slotsOf(L, 0, m.me.shape);
  const other = ownAt(d.x, d.y, d.i);
  const before = actingSpot(m, L, p);
  selected = d.i;
  benchPick = -1;
  sheet = 'player';
  if (other >= 0 && (slots[(L.teams[0].players[other] as LivePlayer).slot] as Slot).line !== 'GK') {
    const q = L.teams[0].players[other] as LivePlayer;
    command(`trade:${d.i}:${other}`);
    say(`${p.n}번 ${short(p.name, p.nat)}와 ${q.n}번 ${short(q.name, q.nat)}이 자리를 맞바꿨다`);
    return;
  }
  const [x, y] = toPitch(d.x, d.y);
  command(`move:${d.i}:${clamp(x, 0, 105).toFixed(1)}:${clamp(y, 0, 68).toFixed(1)}`);
  const after = actingSpot(m, L, p);
  say(after === before ? `${p.n}번 ${short(p.name, p.nat)}의 자리를 옮겼다` : `${p.n}번 ${short(p.name, p.nat)}: ${before} → ${after}`);
}

function onPitchCancel(): void {
  drag = null;
}

// ----- 그리기 -----

/** 경기장 좌표의 두 모서리로 화면 사각형을 얻는다. */
function box(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const ax = PX(x0, y0);
  const ay = PY(x0, y0);
  const bx = PX(x1, y1);
  const by = PY(x1, y1);
  return [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
}

function plate(ctx: CanvasRenderingContext2D, cssW: number, x: number, y: number, text: string, bg: string, ink: string, h: number): void {
  const tw = ctx.measureText(text).width + 8;
  const tx = clamp(x, tw / 2 + 2, cssW - tw / 2 - 2);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(tx - tw / 2, y - h / 2, tw, h, 3);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.fillText(text, tx, y + 0.5);
}

// ----- 중계 카메라 -----

/** 한 순간의 선수 한 명(경기장 좌표). */
interface Man {
  t: 0 | 1;
  i: number;
  p: LivePlayer;
  x: number;
  y: number;
  hx: number;
  hy: number;
  ph: number;
  run: number;
  has: boolean;
}

/** 한 순간의 그림. 화면은 늘 이것을 그리고, 골 장면을 다시 보여 주려고 몇 초 치를 모아 둔다. */
interface Still {
  /** 경기 시각(틱). */
  at: number;
  men: Man[];
  bx: number;
  by: number;
  /** 공이 뜬 높이(m)와 구른 각도. */
  lift: number;
  spin: number;
  /** 날아가는 공이 향하는 곳. */
  to: { x: number; y: number; shot: boolean } | null;
}

interface Replay {
  /** 다시 보여 줄 구간(경기 시각)과 시작하는 때(ms). 골이 들어가고 잠깐 뜸을 들인 뒤 시작한다. */
  from: number;
  to: number;
  start: number;
  /** 공이 꽂힌 자리. */
  x: number;
  y: number;
  good: boolean;
  sub: string;
  idx: number;
  /** 화면에 나오기 시작했는가, 공이 그물에 닿았는가. */
  live: boolean;
  hit: boolean;
}

/** 되감는 길이(틱), 느린 화면의 속도(1초에 몇 틱), 골과 리플레이 사이의 뜸(ms), 그물에 닿은 뒤 머무는 시간(초). */
const REPLAY_TICKS = 6;
const REPLAY_RATE = BASE_TPS * 0.55;
const REPLAY_WAIT = 1200;
const REPLAY_REST = 0.9;
const CAM_KEY = 'touchline:cam';

/**
 * 중계 카메라. 슈팅이 나오면 골문 쪽으로 잠깐 다가가고, 골은 느린 화면으로 한 번 더 보여 준다.
 * 공이 페널티 지역에 들어갈 때마다 다가가면 화면이 10초에 한 번꼴로 출렁여서, 슈팅에만 움직인다.
 * x, y는 화면 한가운데에 오는 점, tx, ty는 그 점이 따라가는 목표다(모두 확대하기 전의 화면 좌표).
 * 멈췄거나 선수를 골랐으면 전술판이 다 보이게 물러난다. 4배속부터는 쓰지 않는다.
 */
const cam = { on: true, z: 1, x: 0, y: 0, tx: 0, ty: 0, w: 0, h: 0, shot: 0, cut: 0, snap: false };
const tape: Still[] = [];
let tapeAt = 0;
/** 마지막 슈팅이 향한 곳. 골이 되면 공을 그물 안에 잠깐 둔다. */
let aim: { x: number; y: number; side: 0 | 1 } | null = null;
let netBall: { x: number; y: number; until: number } | null = null;
let replay: Replay | null = null;

const camLive = (): boolean => cam.on && !calm && speed <= 2;

function camPref(): boolean {
  try {
    return localStorage.getItem(CAM_KEY) !== '0';
  } catch {
    return true;
  }
}

function setCam(on: boolean): void {
  cam.on = on;
  try {
    if (on) localStorage.removeItem(CAM_KEY);
    else localStorage.setItem(CAM_KEY, '0');
  } catch {
    // 저장소를 쓸 수 없으면 이번 접속 동안만 따른다.
  }
}

function resetCam(): void {
  Object.assign(cam, { on: camPref(), z: 1, shot: 0, cut: 0, snap: false });
  tape.length = 0;
  aim = null;
  netBall = null;
  replay = null;
}

/** 확대한 화면의 점을 확대하기 전 좌표로. 누른 자리를 찾을 때 쓴다. */
const uncam = (x: number, y: number): [number, number] => (cam.z === 1 ? [x, y] : [(x - cam.w / 2) / cam.z + cam.x, (y - cam.h / 2) / cam.z + cam.y]);

/** 골이다. 그물이 출렁이고 넣은 팀 관중이 뛴다. */
function cheer(now: number, good: boolean): void {
  netHit = { side: good ? 1 : 0, start: now };
  if (scene && look && canvas) party = startParty(now, scene.fans.filter((f) => f.team === (good ? 0 : 1)), scene.dot, look.fans[good ? 0 : 1], canvas.clientWidth, canvas.clientHeight);
}

/** 골이 들어갔다. 공을 그물 안에 두고, 모아 둔 그림이 넉넉하면 리플레이를 건다. */
function cueReplay(now: number, good: boolean, sub: string): void {
  const side = good ? 0 : 1;
  const spot = aim && aim.side === side ? aim : { x: side === 0 ? 106.2 : -1.2, y: 34 };
  aim = null;
  netBall = { x: spot.x, y: spot.y, until: now + 1100 };
  const end = tape[tape.length - 1];
  if (!camLive() || paused || !end || tape.length < 8 || game?.match?.step !== 'live') return;
  const from = Math.max((tape[0] as Still).at, end.at - REPLAY_TICKS);
  if (end.at - from < 2) return;
  replay = { from, to: end.at, start: now + REPLAY_WAIT, x: spot.x, y: spot.y, good, sub, idx: Math.max(0, tape.findIndex((s) => s.at >= from)), live: false, hit: false };
  netBall.until = replay.start;
  cam.shot = replay.start;
  if (flash) flash.until = replay.start;
}

/** 리플레이를 끝낸다. 화면에 나오던 중이었으면 장면을 끊고 전체 화면으로 돌아간다. */
function endReplay(now: number): void {
  const cut = !!replay?.live;
  replay = null;
  tape.length = 0;
  if (!cut) return;
  netBall = null;
  Object.assign(cam, { z: 1, shot: 0, cut: now });
}

/** 리플레이가 끝날 때까지 다음 킥오프를 미룬다(그 전까지 경기는 그대로 흐른다). */
const holding = (L: LiveState): boolean => !!replay && L.restart === 'kick' && L.wait <= 2;

function blend(a: Still, b: Still, k: number): Still {
  if (a.men.length !== b.men.length) return a;
  const mix = (p: number, q: number): number => p + (q - p) * k;
  const men = a.men.map((m, j) => {
    const n = b.men[j] as Man;
    return n.t !== m.t || n.i !== m.i ? m : { ...m, x: mix(m.x, n.x), y: mix(m.y, n.y), hx: mix(m.hx, n.hx), hy: mix(m.hy, n.hy), ph: mix(m.ph, n.ph), run: mix(m.run, n.run) };
  });
  return { at: mix(a.at, b.at), men, bx: mix(a.bx, b.bx), by: mix(a.by, b.by), lift: mix(a.lift, b.lift), spin: mix(a.spin, b.spin), to: a.to };
}

/** 리플레이 중이면 지금 보여 줄 그림. 모아 둔 그림 사이를 이어 느리게 돌리고, 끝에는 공을 그물까지 보낸다. */
function replayStill(now: number): Still | null {
  const r = replay;
  if (!r || now < r.start) return null;
  if (!r.live) {
    r.live = true;
    party = null;
    netHit = null;
    cam.cut = now;
    cam.snap = true;
  }
  const t = (now - r.start) / 1000;
  const at = r.from + t * REPLAY_RATE;
  if (at <= r.to) {
    while (r.idx < tape.length - 2 && (tape[r.idx + 1] as Still).at <= at) r.idx++;
    const a = tape[r.idx] as Still;
    const b = tape[r.idx + 1] as Still;
    return blend(a, b, b.at > a.at ? clamp((at - a.at) / (b.at - a.at), 0, 1) : 0);
  }
  const end = tape[tape.length - 1] as Still;
  const tail = t - (r.to - r.from) / REPLAY_RATE;
  const fly = Math.hypot(r.x - end.bx, r.y - end.by) / 22;
  const k = fly > 0 ? Math.min(1, tail / fly) : 1;
  if (k >= 1 && !r.hit) {
    r.hit = true;
    cheer(now, r.good);
  }
  if (tail > fly + REPLAY_REST) {
    endReplay(now);
    return null;
  }
  const slow = Math.max(0, 1 - tail / 0.4);
  return { ...end, men: end.men.map((m) => ({ ...m, run: m.run * slow })), bx: end.bx + (r.x - end.bx) * k, by: end.by + (r.y - end.by) * k, lift: end.lift * (1 - k), to: null };
}

/** 카메라가 볼 곳을 정하고 한 걸음 따라간다. */
function follow(L: LiveState, st: Still, showing: boolean, dt: number, now: number): void {
  // 공과 골문 사이를 본다.
  const mouth = (gx: number, k: number): void => {
    cam.tx = PX(st.bx, st.by) * (1 - k) + PX(gx, 34) * k;
    cam.ty = PY(st.bx, st.by) * (1 - k) + PY(gx, 34) * k;
  };
  let zoom = 1;
  let rate = 9;
  if (showing) {
    zoom = 1.5;
    mouth((replay as Replay).x > 52.5 ? 105 : 0, 0.3);
  } else if (drag && !drag.moving) {
    // 누르고 있는 동안에는 화면을 움직이지 않는다.
    return;
  } else if (camLive() && !boardMode() && selected < 0) {
    // 슈팅이 날아가는 동안과 그 뒤 1초(선방, 골대 밖, 골)를 가까이서 본다.
    const f = L.flight;
    if (f?.kind === 'shot') {
      cam.shot = now + 1000;
      mouth(f.side === 0 ? 105 : 0, 0.45);
    }
    zoom = now < cam.shot ? 1.32 : 1;
    rate = zoom > cam.z ? 6 : 2.6;
  }
  const ease = (r: number): number => 1 - Math.exp(-dt * r);
  if (cam.snap) {
    cam.snap = false;
    cam.z = zoom;
    cam.x = cam.tx;
    cam.y = cam.ty;
  }
  cam.z += (zoom - cam.z) * ease(rate);
  if (zoom === 1 && cam.z < 1.004) cam.z = 1;
  cam.x += (cam.tx - cam.x) * ease(5);
  cam.y += (cam.ty - cam.y) * ease(5);
  // 경기장 밖이 보이지 않게 한다. 다 물러나면 한가운데다.
  const hw = cam.w / (2 * cam.z);
  const hh = cam.h / (2 * cam.z);
  cam.x = clamp(cam.x, hw, cam.w - hw);
  cam.y = clamp(cam.y, hh, cam.h - hh);
}

/** 말의 반지름(화면 px). 우리 팀 기준이고 상대는 조금 작다. */
const manR = (): number => clamp(view.s * 2.2, 9, 15);
const THEIRS = 0.9;

/**
 * 엔진의 위치를 스프링으로 따라가 지금 그릴 그림을 만든다. 누르기 판정에 쓰는 화면 좌표도 여기서 맞춘다.
 * 말이 서로 포개지지 않게 자리를 벌린다. 따라갈 자리를 먼저 벌려 스프링이 부드럽게 옮기게 하고,
 * 스프링이 늦어 생긴 작은 겹침은 그리기 직전에 한 번 더 푼다.
 */
function pose(L: LiveState, frac: number, snap: boolean, dt: number, now: number): Still {
  // 배속이 빠를수록 스프링을 빠르게 한다. 멈춰 있거나 처음 그리면 바로 맞춘다.
  const w = 9 * Math.sqrt(speed);
  const step = snap ? 0 : dt;
  const lerp = (a: number, b: number): number => a + (b - a) * frac;
  const owner = L.owner;
  // 테두리와 팔다리까지 닿지 않게 반지름에 틈을 더한다. 시트를 열어 경기장이 작아지면 자리가 모자라 틈을 줄인다.
  const rad = (manR() + clamp(view.s * 0.6, 0.8, 3.2)) / view.s;
  const cast: { t: 0 | 1; i: number; p: LivePlayer; x: number; y: number; has: boolean }[] = [];
  for (const t of [0, 1] as const) {
    L.teams[t].players.forEach((p, i) => {
      if (!p.off) cast.push({ t, i, p, x: lerp(p.px, p.x), y: lerp(p.py, p.y), has: !!owner && owner.team === t && owner.i === i });
    });
  }
  const dotOf = (c: (typeof cast)[number], x: number, y: number): Dot => ({ x, y, r: c.t === 0 ? rad : rad * THEIRS, hold: c.has ? 3 : 1 });
  const want = cast.map((c) => dotOf(c, c.x, c.y));
  spread(want, 12);
  const seen = cast.map((c, k) => {
    const { x: tx, y: ty } = want[k] as Dot;
    const v = visOf(`${c.t}:${c.i}`, tx, ty, c.t === 0 ? 1 : -1);
    if (snap || step === 0 || Math.hypot(tx - v.x, ty - v.y) > 25) {
      v.x = tx;
      v.y = ty;
      v.vx = 0;
      v.vy = 0;
    } else spring(v, tx, ty, step, w);
    return dotOf(c, v.x, v.y);
  });
  spread(seen, 4);
  const men: Man[] = [];
  cast.forEach(({ t, i, p, has }, k) => {
    const v = vis.get(`${t}:${i}`) as Vis;
    v.fx = (seen[k] as Dot).x;
    v.fy = (seen[k] as Dot).y;
    // 움직이면 그쪽을, 서 있으면 공을 본다.
    const sp = Math.hypot(v.vx, v.vy);
    const [dx, dy] = sp > 0.6 ? [v.vx / sp, v.vy / sp] : (() => {
      const bx = L.ball.x - v.x;
      const by = L.ball.y - v.y;
      const d = Math.hypot(bx, by) || 1;
      return [bx / d, by / d];
    })();
    const rate = Math.min(1, step * 8 || 1);
    v.hx += (dx - v.hx) * rate;
    v.hy += (dy - v.hy) * rate;
    const hn = Math.hypot(v.hx, v.hy) || 1;
    v.hx /= hn;
    v.hy /= hn;
    if (!calm) v.ph += step * clamp(5 + sp * 1.2, 0, 22);
    v.sx = PX(v.fx, v.fy);
    v.sy = PY(v.fx, v.fy);
    men.push({ t, i, p, x: v.fx, y: v.fy, hx: v.hx, hy: v.hy, ph: v.ph, run: calm ? 0 : clamp(sp / 4, 0, 1), has });
  });
  // 벌린 만큼 공도 옮긴다. 패스는 찬 선수의 그림에서 떠나 받는 선수의 그림에 닿는다.
  const shift = (t: 0 | 1, i: number): [number, number] => {
    const c = cast.find((o) => o.t === t && o.i === i);
    const v = c && vis.get(`${t}:${i}`);
    return c && v ? [v.fx - c.x, v.fy - c.y] : [0, 0];
  };

  // 공: 가진 선수 발밑, 날아가는 중이면 감속하는 궤적, 멈춰 있으면 그 자리. 골이 된 공은 그물 안에 잠깐 남는다.
  const f = L.flight;
  let ballX = lerp(L.ball.px, L.ball.x);
  let ballY = lerp(L.ball.py, L.ball.y);
  let lift = 0;
  let to: Still['to'] = null;
  if (netBall && (now > netBall.until || L.restart !== 'kick' || L.wait <= 0)) netBall = null;
  if (netBall) {
    ballX = netBall.x;
    ballY = netBall.y;
  } else if (f) {
    const span = Math.max(1, f.end - f.start);
    const prog = clamp((L.tick - 1 - f.start + frac) / span, 0, 1);
    const e = f.kind === 'shot' ? prog : easeOut(prog);
    const [ax, ay] = shift(f.side, f.by);
    const [zx, zy] = f.result === null && f.kind !== 'shot' ? shift(f.team, f.to) : [0, 0];
    ballX = f.fromX + (f.toX - f.fromX) * e + ax * (1 - e) + zx * e;
    ballY = f.fromY + (f.toY - f.fromY) * e + ay * (1 - e) + zy * e;
    if (f.kind === 'long' || f.kind === 'cross') lift = Math.sin(Math.PI * prog) * Math.min(6, Math.hypot(f.toX - f.fromX, f.toY - f.fromY) * 0.12);
    to = { x: f.toX + zx, y: f.toY + zy, shot: f.kind === 'shot' };
  } else if (owner) {
    const ov = vis.get(`${owner.team}:${owner.i}`);
    if (ov) {
      ballX = ov.fx + ov.hx * 0.9;
      ballY = ov.fy + ov.hy * 0.9;
    }
  }
  const bv = visOf('ball', ballX, ballY, 1);
  if (snap || step === 0 || Math.hypot(ballX - bv.x, ballY - bv.y) > 30) {
    bv.x = ballX;
    bv.y = ballY;
    bv.vx = 0;
    bv.vy = 0;
  } else spring(bv, ballX, ballY, step, f ? 40 : 22);
  const ballPace = Math.hypot(bv.vx, bv.vy);
  if (!calm) bv.ph += step * Math.min(ballPace, 30) * 1.1;
  if (ballPace > 12) trail.push({ x: bv.x, y: bv.y });
  else if (trail.length) trail.shift();
  if (trail.length > 7) trail.shift();
  return { at: L.tick - 1 + frac, men, bx: bv.x, by: bv.y, lift, spin: bv.ph, to };
}

/** 리플레이 딱지. 화면 왼쪽 위에 붙고, 아래 줄이 차오르며 남은 길이를 알려 준다. */
function replayTag(ctx: CanvasRenderingContext2D, r: Replay, now: number, cssW: number): void {
  const title = "600 12px 'IBM Plex Sans KR', system-ui, sans-serif";
  const fine = "500 11px 'IBM Plex Sans KR', system-ui, sans-serif";
  const hint = '누르면 넘어간다';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = title;
  const tw = ctx.measureText('리플레이').width;
  ctx.font = fine;
  const w = Math.min(cssW - 16, Math.max(tw + 35 + ctx.measureText(hint).width, r.sub ? ctx.measureText(r.sub).width + 18 : 0));
  const h = r.sub ? 42 : 24;
  const total = (r.to - r.from) / REPLAY_RATE + REPLAY_REST;
  // 긴 해설은 딱지 안에 들어가는 데까지만 쓴다.
  let sub = r.sub;
  while (sub.length > 1 && ctx.measureText(sub).width > w - 18) sub = `${sub.slice(0, -2).trimEnd()}…`;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(8, 8, w, h, 3);
  ctx.clip();
  ctx.fillStyle = 'rgba(8,24,16,0.84)';
  ctx.fillRect(8, 8, w, h);
  ctx.fillStyle = 'rgba(244,248,240,0.6)';
  ctx.fillText(hint, tw + 34, 20.5);
  if (sub) ctx.fillText(sub, 17, 37.5);
  ctx.fillStyle = 'rgba(244,248,240,0.5)';
  ctx.fillRect(8, 6 + h, w * clamp((now - r.start) / 1000 / total, 0, 1), 2);
  // 넣은 팀의 색.
  ctx.fillStyle = kit[r.good ? 0 : 1].body;
  ctx.fillRect(8, 8, 3, h);
  ctx.fillStyle = '#f4f8f0';
  ctx.font = title;
  ctx.fillText('리플레이', 17, 20.5);
  ctx.restore();
}

function draw(frac: number, snap = false, dt = 0): void {
  const g = game;
  const c = canvas;
  if (!g || !c) return;
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = c.clientWidth || 320;
  const cssH = c.clientHeight || 240;
  if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
  }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  view.up = upright();
  const [pw, ph] = view.up ? [68, 105] : [105, 68];
  const [padT, padG] = margins(wide());
  const [padX, padY] = view.up ? [padT, padG] : [padG, padT];
  view.s = Math.max(1.5, Math.min((cssW - padX * 2) / pw, (cssH - padY * 2) / ph));
  view.ox = (cssW - pw * view.s) / 2;
  view.oy = (cssH - ph * view.s) / 2;
  const s = view.s;
  const now = performance.now();
  const sec = now / 1000;
  cam.w = cssW;
  cam.h = cssH;

  // 선수와 공의 자리. 후반에는 화면만 반 바퀴 돌려 두 팀이 진영을 바꾼 것으로 보여 준다.
  const turned = secondHalf(L);
  view.flip = turned;
  if (replay && (paused || drag?.moving || m.step !== 'live')) endReplay(now);
  const cur = pose(L, frac, snap, dt, now);
  if (!camLive()) {
    if (!replay) tape.length = 0;
  } else if (!paused && !replay && now - tapeAt >= 30) {
    tapeAt = now;
    tape.push(cur);
    while (tape.length > 1 && (tape[0] as Still).at < cur.at - REPLAY_TICKS - 1) tape.shift();
  }
  const st = replayStill(now) ?? cur;
  const showing = st !== cur;
  follow(L, st, showing, snap ? 0 : dt, now);
  if (drag) [drag.x, drag.y] = uncam(drag.rx, drag.ry);
  // 경기장은 카메라를 거쳐 그리고, 비와 딱지는 화면에 바로 그린다.
  const world = (): void => ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (cssW / 2 - cam.x * cam.z), dpr * (cssH / 2 - cam.y * cam.z));
  const screen = (): void => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 구장과 벤치는 그대로 두고, 후반에는 선수와 공만 반대 진영으로 옮겨 그린다. 배경은 크기가 바뀔 때만 다시 칠한다.
  view.flip = false;
  const key = `${c.width}x${c.height}:${view.up}:${s.toFixed(3)}`;
  if (look && (!scene || sceneKey !== key)) {
    scene = paintStadium(scene?.image ?? document.createElement('canvas'), cssW, cssH, dpr, { s, up: view.up, X: PX, Y: PY }, look);
    sceneKey = key;
    party = null;
  }
  world();
  if (scene) ctx.drawImage(scene.image, 0, 0, cssW, cssH);
  const shade = scene?.shade ?? [0.14, 0.3];
  const wind = look?.weather === 'wind' ? 1 : 0;
  // 코너 깃발.
  const flagSize = clamp(s * 0.8, 3, 5);
  for (const [fx, fy] of [[0, 0], [105, 0], [105, 68], [0, 68]] as const) drawFlag(ctx, PX(fx, fy), PY(fx, fy), flagSize, look?.owner[0] ?? PICK, calm ? 0 : sec, wind);
  // 공격 방향.
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `600 ${clamp(s * 2.2, 10, 13)}px 'Barlow Condensed', 'IBM Plex Sans KR', system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (view.up) ctx.fillText(turned ? '공격 ▼' : '공격 ▲', PX(50, 1.2), PY(50, 1.2));
  else if (turned) {
    ctx.textAlign = 'right';
    ctx.fillText('◀ 공격', PX(51, 2.4), PY(51, 2.4));
  } else ctx.fillText('공격 ▶', PX(54, 2.4), PY(54, 2.4));
  view.flip = turned;

  const mySlots = slotsOf(L, 0, m.me.shape);
  const board = !showing && boardMode();
  const r = manR();
  const spots = st.men.map((man) => ({ man, x: PX(man.x, man.y), y: PY(man.x, man.y) }));

  // 전술판: 우리 선수의 기준 자리와 지금 위치를 잇는다. 고른 선수의 자리는 경기 중에도 보인다.
  for (const { man, x, y } of spots) {
    if (showing || man.t !== 0 || (!board && man.i !== selected)) continue;
    const slot = mySlots[man.p.slot] as Slot;
    if (slot.line === 'GK') continue;
    const ax = PX(slot.u, slot.v);
    const ay = PY(slot.u, slot.v);
    const on = man.i === selected;
    ctx.save();
    ctx.strokeStyle = on ? PICK : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(ax, ay, r * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = on ? 'rgba(255,225,74,0.22)' : 'rgba(255,255,255,0.1)';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 패스와 슈팅의 목표 지점.
  const bx = PX(st.bx, st.by);
  const by = PY(st.bx, st.by);
  if (st.to) {
    ctx.save();
    ctx.setLineDash(st.to.shot ? [] : [3, 5]);
    ctx.strokeStyle = st.to.shot ? 'rgba(255,225,74,0.85)' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = st.to.shot ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(PX(st.to.x, st.to.y), PY(st.to.x, st.to.y));
    ctx.stroke();
    ctx.restore();
  }

  // 선수 말: 화면 아래에 있는 선수가 위에 오게 그린다.
  const tags: { x: number; y: number; text: string; kind: 'name' | 'mine' | 'theirs' }[] = [];
  const th = clamp(s * 2.6, 12, 15);
  // 이름표가 가리는 다른 말의 수. 공 가진 선수와 고른 선수의 이름표는 덜 가리는 쪽(아래나 위)에 단다.
  const hidden = (own: Man, x: number, y: number, text: string): number => {
    const half = text.length * 5.5 + 5 + r * 0.7;
    return spots.filter((o) => o.man !== own && Math.abs(o.x - x) < half && Math.abs(o.y - y) < th / 2 + r * 0.7).length;
  };
  spots.sort((a, b) => a.y - b.y);
  for (const { man, x, y } of spots) {
    const { t, i, p } = man;
    const k = kit[t];
    const rr = t === 0 ? r : r * THEIRS;
    const keeper = p.line === 'GK' && (slotsOf(L, t, t === 0 ? m.me.shape : m.opp.shape)[p.slot] as Slot).line === 'GK';
    const body = keeper ? k.keeper : k.body;
    const picked = !showing && t === 0 && i === selected;
    const tk = `${t}:${i}:${p.name}`;
    let tone = toneOf.get(tk);
    if (!tone) {
      tone = tones(p.pid ?? hashName(p.name), p.nat ?? '');
      toneOf.set(tk, tone);
    }
    const [hx, hy] = turn(man.hx, man.hy);
    drawFigure(ctx, {
      x, y, r: rr, ang: Math.atan2(hy, hx), kit: k, body, skin: tone[0], hair: tone[1], keeper, n: p.n,
      stride: man.ph, run: man.run, hasBall: man.has, picked, shade, lit: scene?.lit ?? false,
    });
    // 이름표: 전술판 모드에서는 우리 선수 모두, 경기 중에는 공 가진 선수와 고른 선수만.
    const named = t === 0 ? board || picked || man.has : man.has;
    if (!named) continue;
    const text = t === 0 ? short(p.name, p.nat) : `${p.n} ${short(p.name, p.nat)}`;
    const drop = rr + 8;
    const v = vis.get(`${t}:${i}`);
    // 지금 단 쪽이 더 많이 가릴 때만 옮긴다(오락가락하지 않게). 전술판에서는 모두 아래에 단다.
    if (v && !board) {
      const here = hidden(man, x, v.up ? y - drop : y + drop, text);
      if (here > 0 && here > hidden(man, x, v.up ? y + drop : y - drop, text)) v.up = !v.up;
    } else if (v) v.up = false;
    tags.push({ x, y: v?.up ? y - drop : y + drop, text, kind: t === 1 ? 'theirs' : picked || man.has ? 'mine' : 'name' });
  }

  // 공과 꼬리. 뜬 공은 그림자가 땅에 남는다.
  const lift = st.lift * s;
  const br = Math.max(3, s * 0.75);
  if (!showing) {
    trail.forEach((pt, k) => {
      ctx.beginPath();
      ctx.arc(PX(pt.x, pt.y), PY(pt.x, pt.y) - lift * 0.5, br * (0.4 + k * 0.06), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.08 + k * 0.04})`;
      ctx.fill();
    });
  }
  ctx.beginPath();
  ctx.ellipse(bx + lift * 0.15, by + 1.5, br * (1 + lift / (s * 12)), br * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,24,16,0.4)';
  ctx.fill();
  drawBall(ctx, bx, by - lift, br * (1 + lift / (s * 20)), st.spin);

  // 골 뒤풀이와 날씨. 이름표보다 아래에 그린다.
  if (netHit) {
    const age = (now - netHit.start) / 1000;
    if (age > 1.1) netHit = null;
    else {
      const gx = netHit.side === 1 ? 105 : 0;
      const out = netHit.side === 1 ? 1 : -1;
      drawNetHit(ctx, box(gx, 30.34, gx + out * 2.2, 37.66), turn(out, 0), 1 - age / 1.1, calm ? 0 : age);
    }
  }
  if (party) {
    if (now > party.until) party = null;
    else drawParty(ctx, party, now, calm);
  }
  screen();
  if (!calm && look?.weather === 'rain') drawRain(ctx, cssW, cssH, sec);
  else if (!calm && wind) drawWind(ctx, cssW, cssH, sec);
  world();

  ctx.font = `600 ${clamp(s * 1.9, 10, 12)}px 'IBM Plex Sans KR', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const tag of tags) {
    if (tag.kind === 'name') plate(ctx, cssW, tag.x, tag.y, tag.text, 'rgba(8,24,16,0.62)', '#f4f8f0', th);
    else if (tag.kind === 'mine') plate(ctx, cssW, tag.x, tag.y, tag.text, 'rgba(255,255,255,0.95)', '#111', th);
    else plate(ctx, cssW, tag.x, tag.y, tag.text, 'rgba(20,20,20,0.82)', '#fff', th);
  }

  // 끄는 중: 놓을 자리와, 놓으면 어떤 자리가 되는지.
  if (drag?.moving) {
    const p = L.teams[0].players[drag.i] as LivePlayer;
    const base = mySlots[p.slot] as Slot;
    const other = ownAt(drag.x, drag.y, drag.i);
    const swap = other >= 0 && (mySlots[(L.teams[0].players[other] as LivePlayer).slot] as Slot).line !== 'GK';
    const [x, y] = toPitch(drag.x, drag.y);
    const next = movedSlot(base, clamp(x, 0, 105), clamp(y, 0, 68), false);
    const tx = swap ? (vis.get(`0:${other}`) as Vis).sx : PX(next.u, next.v);
    const ty = swap ? (vis.get(`0:${other}`) as Vis).sy : PY(next.u, next.v);
    ctx.save();
    ctx.strokeStyle = PICK;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(PX(base.u, base.v), PY(base.u, base.v));
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty, r + (swap ? 6 : 2), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,225,74,0.2)';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.font = `700 ${clamp(s * 2.1, 11, 13)}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    plate(ctx, cssW, tx, Math.max(th, ty - r - th), swap ? '자리 맞바꾸기' : `${p.n} → ${slotSpot(next)}`, PICK, '#111', th + 3);
  }

  screen();
  if (showing && replay) replayTag(ctx, replay, now, cssW);
  // 장면이 바뀔 때는 잠깐 어두워졌다 밝아진다.
  if (now - cam.cut < 180) {
    ctx.fillStyle = `rgba(6,14,10,${(0.6 * (1 - (now - cam.cut) / 180)).toFixed(3)})`;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  const flashEl = $('#lv-flash');
  if (flashEl) {
    const on = flash && now < flash.until ? flash : null;
    const fk = on ? `${on.until}` : '';
    if (flashKey !== fk || (!on && flashEl.className !== 'lv__flash')) {
      flashKey = fk;
      flashEl.innerHTML = on ? `<b>${esc(on.text)}</b>${on.sub ? `<span>${esc(on.sub)}</span>` : ''}` : '';
      flashEl.className = `lv__flash${on ? (on.good ? ' is-good' : ' is-bad') : ''}`;
      if (on) flashEl.style.cssText = `--club:${kit[on.good ? 0 : 1].body};--club-ink:${light(kit[on.good ? 0 : 1].body) ? '#111' : '#fff'}`;
    }
  }
  if (L.halfTimeDone && !L.talked && !drag?.moving) {
    ctx.fillStyle = 'rgba(8,24,16,0.4)';
    ctx.fillRect(0, 0, cssW, cssH);
    // 글자 뒤에 띠를 깔아 선수 이름표와 겹쳐도 읽히게 한다.
    const big = clamp(s * 5, 20, 34);
    ctx.fillStyle = 'rgba(8,24,16,0.82)';
    ctx.fillRect(0, PY(52.5, 34) - big * 0.95, cssW, big * 2.55);
    ctx.fillStyle = '#fff';
    ctx.font = `400 ${clamp(s * 5, 20, 34)}px 'Black Han Sans', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('하프타임', cssW / 2, PY(52.5, 34));
    ctx.font = `600 ${clamp(s * 2.4, 11, 14)}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    ctx.fillText('후반은 진영을 바꿔 뛴다', cssW / 2, PY(52.5, 34) + clamp(s * 5, 20, 34));
  }
}
