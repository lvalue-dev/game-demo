// 실시간 경기 화면. 위에서 내려다본 경기장을 캔버스에 그리고, 배속에 맞춰 liveTick을 부른다.
// 경기장은 한 번만 만들고, 점수, 시계, 기록, 지시 패널만 바꿔 그린다.
//
// 움직임: 엔진은 3초(1틱)마다 선수의 위치를 정한다. 화면은 그 위치를 그대로 잇지 않고, 선수마다 감쇠 스프링으로 따라가게 해서
// 가속과 감속이 생기고 재개 위치로의 순간이동도 짧은 달리기로 보이게 한다. 공은 가진 선수의 발밑에 붙고, 날아갈 때는 감속하며 뜬다.
import { STYLES, STYLE_IDS } from '../game/data.ts';
import { PER_MIN, SLOTS, slotSpot } from '../game/live.ts';
import { FOOT_NAME, posPenalty, statNames, statsOf } from '../game/player.ts';
import { benchPlayers, liveAdvice, liveCommand, liveTick, staminaText } from '../game/match.ts';
import { ROLES, SHAPES, SHAPE_IDS } from '../game/tactics.ts';
import type { Club, Game, LivePlayer, LiveState, MatchState, Player, Pos } from '../game/types.ts';
import { face, hashName } from './face.ts';

export interface LiveHost {
  /** 진행 상황을 저장한다. */
  save(): void;
  /** 경기가 끝났다. 결과 화면으로 넘어간다. */
  done(): void;
}

type Panel = 'squad' | 'team' | 'mood';

/** 1배속에서 1초에 진행하는 틱 수. 1틱은 경기 시간 3초이고, 1배속이면 선수가 실제 달리기 속도로 보인다(한 경기 약 12분). */
const BASE_TPS = 2.5;
const SPEEDS = [1, 2, 4, 8];

let game: Game | null = null;
let host: LiveHost | null = null;
let raf = 0;
let paused = true;
let speed = 1;
let panel: Panel = 'squad';
/** 고른 우리 선수(경기장 자리 번호)와 고른 후보(선수 번호). 둘 다 고르면 교체를 확정할 수 있다. */
let selected = -1;
let benchPick = -1;
let acc = 0;
let last = 0;
let lastSave = 0;
let seenLog = 0;
let flash: { text: string; until: number; good: boolean } | null = null;
let canvas: HTMLCanvasElement | null = null;
let kit: Kits = defaultKits();

/** 이름표에 쓰는 짧은 이름. 외국 이름은 성만 쓴다(일본 이름은 성이 앞이라 앞을 쓴다). */
const short = (name: string, nat?: string): string => (name.includes(' ') ? (nat === '일본' ? name.split(' ')[0] as string : name.split(' ').pop() as string) : name);

const esc = (text: string | number): string => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const isLive = (g: Game | null): boolean => !!g && g.phase === 'match' && g.match?.step === 'live' && !!g.match.live;

// ---------- 색과 유니폼 ----------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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

const light = (hex: string): boolean => {
  const [r, g, b] = rgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
};

const GRASS = '#2f8a52';

interface Kit {
  body: string;
  trim: string;
  /** 0 단색, 1 반반, 2 세로 줄무늬, 3 가로 줄무늬, 4 사선 띠. */
  pattern: number;
  keeper: string;
}

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
  const okHome = (k: Kit): boolean => dE(k.body, GRASS) > 28;
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
  const b = awayOptions(theirs).find((k) => dE(k.body, GRASS) > 28 && clash(k, a) > 38) ?? (light(a.body) ? { body: '#1d1d1d', trim: '#ffffff', pattern: 0, keeper: '' } : { body: '#ffffff', trim: '#1d1d1d', pattern: 0, keeper: '' });
  const keepers = ['#f2c230', '#b78cf0', '#ff7a1a', '#22c4d6', '#e64aa0', '#8bd346', '#111111', '#ffffff'];
  const far = (avoid: string[]): string => [...keepers].sort((x, y) => Math.min(...avoid.map((c) => dE(y, c))) - Math.min(...avoid.map((c) => dE(x, c))))[0] as string;
  const outfield = [a.body, a.trim, b.body, b.trim, GRASS];
  a.keeper = far(outfield);
  b.keeper = far([...outfield, a.keeper]);
  return [a, b];
}

// ---------- 그리기 ----------

export function renderLive(g: Game): string {
  const m = g.match as MatchState;
  const mine = (g.clubs[g.job!.club] as Club).name;
  return `
    <section class="live" aria-label="실시간 경기">
      <p class="eyebrow">${esc(m.label)}</p>
      <div class="live__stick">
      <div class="live__score score" role="group" aria-label="점수">
        <span class="score__team is-mine"><span class="kitdot" id="kit-a"></span>${esc(mine)}</span>
        <span class="score__num" id="live-score"></span>
        <span class="score__team score__team--away">${esc(m.oppName)}<span class="kitdot" id="kit-b"></span></span>
        <span class="score__minute" id="live-clock"></span>
      </div>
      <div class="live__field">
        <canvas class="live__pitch" id="live-pitch" role="img" aria-label="경기장. 우리 팀은 오른쪽으로 공격한다. 선수를 누르면 고를 수 있다"></canvas>
        <p class="live__flash" id="live-flash" aria-live="assertive"></p>
      </div>
      <p class="live__call" id="live-call" aria-live="polite"></p>
      </div>
      <div class="live__controls">
        <button type="button" class="live__play" data-live-do="play" id="live-play"></button>
        <div class="live__speeds" role="group" aria-label="배속">
          ${SPEEDS.map((s) => `<button type="button" class="chip" data-live-do="speed:${s}" aria-pressed="false">${s}×</button>`).join('')}
        </div>
      </div>
      <dl class="live__stats" id="live-stats"></dl>
      <details class="live__tickerbox"><summary class="live__label">중계 기록</summary><ol class="log live__ticker" id="live-ticker"></ol></details>
      <div class="live__tabs" role="tablist" aria-label="지시">
        ${([['squad', '선수 · 교체'], ['team', '팀 전술'], ['mood', '태세']] as [Panel, string][]).map(([id, label]) =>
          `<button type="button" role="tab" class="live__tab" data-live-do="panel:${id}" aria-selected="false">${label}</button>`).join('')}
      </div>
      <div class="live__panel" id="live-panel"></div>
      <button type="button" class="link" data-act="skip">남은 경기를 지금 지시대로 건너뛴다</button>
    </section>`;
}

export function mountLive(g: Game, h: LiveHost): void {
  unmountLive();
  game = g;
  host = h;
  canvas = $<HTMLCanvasElement>('#live-pitch');
  const m = g.match as MatchState;
  kit = kits(g, m);
  vis.clear();
  trail.length = 0;
  seenLog = m.log.length;
  paused = true;
  acc = 0;
  last = performance.now();
  lastSave = last;
  const dotA = $('#kit-a');
  const dotB = $('#kit-b');
  if (dotA) dotA.style.cssText = `--kit:${kit[0].body};--trim:${kit[0].trim}`;
  if (dotB) dotB.style.cssText = `--kit:${kit[1].body};--trim:${kit[1].trim}`;
  canvas?.addEventListener('click', onPitchClick);
  updateHud(true);
  updatePanel();
  raf = requestAnimationFrame(frame);
}

export function unmountLive(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (game && host && isLive(game)) host.save();
  canvas?.removeEventListener('click', onPitchClick);
  game = null;
  host = null;
  canvas = null;
}

/** 페이지가 가려지면 멈춘다. */
export function pauseLive(): void {
  if (!game || paused) return;
  paused = true;
  host?.save();
  updateControls();
}

/** 경기장을 누르면 가장 가까운 우리 선수를 고른다. */
function onPitchClick(e: MouseEvent): void {
  const g = game;
  if (!g || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  let best = -1;
  let bestD = Infinity;
  const L = g.match!.live as LiveState;
  L.teams[0].players.forEach((p, i) => {
    if (p.off) return;
    const v = vis.get(`0:${i}`);
    if (!v) return;
    const d = Math.hypot(v.sx - px, v.sy - py);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best >= 0 && bestD < 40) {
    selected = selected === best ? -1 : best;
    panel = 'squad';
    updatePanel();
    draw(0, true);
  }
}

/** data-live-do(화면 조작)와 data-live(감독의 지시)를 처리한다. 처리했으면 true. */
export function onLiveClick(el: HTMLElement): boolean {
  const g = game;
  if (!g) return false;
  const local = el.dataset.liveDo;
  const cmd = el.dataset.live;
  if (local) {
    const [what, value = ''] = local.split(':');
    if (what === 'play') {
      if (halftime(g)) return true;
      paused = !paused;
      if (paused) host?.save();
      last = performance.now();
      updateControls();
    } else if (what === 'speed') {
      speed = Number(value) || 2;
      updateControls();
    } else if (what === 'panel') {
      panel = value as Panel;
      updatePanel();
    } else if (what === 'pick') {
      selected = selected === Number(value) ? -1 : Number(value);
      updatePanel();
      draw(0, true);
    } else if (what === 'bench') {
      benchPick = benchPick === Number(value) ? -1 : Number(value);
      updatePanel();
    } else if (what === 'clear') {
      selected = -1;
      benchPick = -1;
      updatePanel();
      draw(0, true);
    }
    return true;
  }
  if (cmd) {
    const wasHalf = halftime(g);
    // 교체를 하면 고른 표시를 지운다(나간 선수 자리에 들어온 선수를 다시 고르기 쉽게 자리 선택은 남긴다).
    if (cmd.startsWith('swap:')) benchPick = -1;
    liveCommand(g, cmd);
    if (wasHalf && !halftime(g)) {
      // 라커룸 대화가 끝나면 후반을 바로 시작한다.
      paused = false;
      last = performance.now();
    }
    host?.save();
    updateHud(true);
    updatePanel();
    return true;
  }
  return false;
}

/** 끌어다 놓기로 한 교체(app.ts가 부른다). */
export function liveDrop(cmd: string): void {
  const g = game;
  if (!g || !cmd.startsWith('swap:')) return;
  const [, i] = cmd.split(':');
  benchPick = -1;
  selected = Number(i);
  liveCommand(g, cmd);
  host?.save();
  updateHud(true);
  updatePanel();
  draw(0, true);
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
      acc -= 1;
      liveTick(g);
      ticked = true;
      if (halftime(g)) {
        paused = true;
        acc = 0;
        host?.save();
        updatePanel();
        break;
      }
    }
  }
  if (ticked) {
    updateHud(false);
    // 선수 상태(체력, 평점, 기록)는 몇 틱마다 다시 그린다. 버튼을 누르는 중에 목록이 흔들리지 않게 너무 자주는 하지 않는다.
    if (panel === 'squad' && (m.live as LiveState).tick % 10 === 0) updatePanel();
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

function clockText(L: LiveState): string {
  if (L.halfTimeDone && !L.talked) return '하프타임';
  if (L.over) return '경기 종료';
  if (L.tick === 0) return '킥오프 전';
  const min = Math.ceil(L.tick / PER_MIN);
  if (!L.halfTimeDone && min > 45) return `45+${min - 45}'`;
  if (min > 90) return `90+${min - 90}'`;
  return `${min}'`;
}

function updateHud(full: boolean): void {
  const g = game;
  if (!g) return;
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  const score = $('#live-score');
  if (score) score.innerHTML = `${m.score[0]}<span class="score__sep">:</span>${m.score[1]}`;
  const clock = $('#live-clock');
  if (clock) clock.textContent = `${clockText(L)}${m.venue === 'away' ? ' · 원정' : m.venue === 'home' ? ' · 홈' : ''}`;
  const [a, b] = L.teams;
  const total = Math.max(1, a.possession + b.possession);
  const stats = $('#live-stats');
  if (stats) {
    const pa = Math.round((a.possession / total) * 100);
    stats.innerHTML = `
      <div class="live__poss"><dt>점유율</dt><dd><span class="split" aria-hidden="true"><span style="width:${pa}%;background:${kit[0].body}"></span><span style="width:${100 - pa}%;background:${kit[1].body}"></span></span>${pa}<span class="muted"> : ${100 - pa}</span></dd></div>
      <div><dt>슈팅(유효)</dt><dd>${a.shots}(${a.onTarget})<span class="muted"> : ${b.shots}(${b.onTarget})</span></dd></div>
      <div><dt>기대 득점(xG)</dt><dd>${a.xg.toFixed(1)}<span class="muted"> : ${b.xg.toFixed(1)}</span></dd></div>
      <div><dt>팀 체력</dt><dd class="${m.me.stamina < 45 ? 'is-bad' : ''}"><span class="meter" aria-hidden="true"><span class="meter__fill" style="width:${Math.round(m.me.stamina)}%"></span></span>${Math.round(m.me.stamina)}</dd></div>
      <div><dt>교체 카드</dt><dd>${m.subs}장</dd></div>`;
  }
  // 새 기록이 생겼으면 위로 쌓고, 골이면 경기장 위에 크게 띄운다.
  if (m.log.length > seenLog || full) {
    for (const line of m.log.slice(seenLog)) {
      if (line.tone !== 'plain' && /골|득점|실점|성공시켰|넣었|마무리|흔들었|헤더/.test(line.text)) {
        flash = { text: line.tone === 'good' ? '골!' : '실점', until: performance.now() + 1600, good: line.tone === 'good' };
      }
    }
    seenLog = m.log.length;
  }
  const lastCall = L.calls[L.calls.length - 1];
  const callEl = $('#live-call');
  if (callEl) {
    callEl.textContent = lastCall ? `${Math.max(1, Math.ceil(lastCall.tick / PER_MIN))}' ${lastCall.text}` : (L.tick === 0 ? '재생 버튼을 누르면 킥오프. 언제든 멈추고 지시할 수 있다. 경기장의 선수를 누르면 그 선수를 고른다.' : '');
    callEl.className = `live__call${lastCall ? ` live__call--${lastCall.tone}` : ''}`;
  }
  const ticker = $('#live-ticker');
  if (ticker && (full || ticker.dataset.n !== String(L.calls.length) + ':' + (lastCall?.tick ?? 0))) {
    ticker.dataset.n = String(L.calls.length) + ':' + (lastCall?.tick ?? 0);
    const recent = [...L.calls].reverse().slice(0, 6);
    ticker.innerHTML = recent.length === 0
      ? '<li class="log__row"><span class="log__min">시작</span><span class="log__text muted">슈팅, 선방, 파울, 오프사이드, 교체가 여기에 쌓인다.</span></li>'
      : recent.map((c) => `<li class="log__row log__row--${c.tone}"><span class="log__min">${Math.max(1, Math.ceil(c.tick / PER_MIN))}'</span><span class="log__text">${esc(c.text)}</span></li>`).join('');
  }
  updateControls();
}

function updateControls(): void {
  const g = game;
  if (!g) return;
  const play = $('#live-play');
  const L = g.match?.live;
  if (play) {
    const label = halftime(g) ? '하프타임' : paused ? (L && L.tick === 0 ? '킥오프' : '재생') : '일시정지';
    play.innerHTML = `<span aria-hidden="true">${paused ? '▶' : '❚❚'}</span> ${label}`;
    play.toggleAttribute('disabled', halftime(g));
  }
  document.querySelectorAll<HTMLElement>('[data-live-do^="speed:"]').forEach((el) => {
    const on = el.dataset.liveDo === `speed:${speed}`;
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', String(on));
  });
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

const faceOf = (p: LivePlayer, team: 0 | 1, size: number): string =>
  face(p.pid ?? hashName(p.name), p.nat ?? '', size, [kit[team].body, kit[team].trim], p.name);

// ---------- 지시 패널 ----------

const chip = (cmd: string, label: string, on: boolean, disabled = false, extra = ''): string =>
  `<button type="button" class="chip${on ? ' is-on' : ''}" data-live="${esc(cmd)}" aria-pressed="${on}"${disabled ? ' disabled' : ''}>${esc(label)}${extra}</button>`;

function row(title: string, body: string, note = ''): string {
  return `<div class="live__row"><p class="live__label">${esc(title)}${note ? ` <span class="muted">${esc(note)}</span>` : ''}</p><div class="chips">${body}</div></div>`;
}

const LINE_NAME: Record<Pos, string> = { GK: '골키퍼', DF: '수비', MF: '미드필드', FW: '공격' };

function squadPanel(g: Game, m: MatchState, L: LiveState): string {
  const team = L.teams[0];
  const slots = SLOTS[m.me.shape];
  const benchList = benchPlayers(g, L).sort((a, b) => ['GK', 'DF', 'MF', 'FW'].indexOf(a.pos) - ['GK', 'DF', 'MF', 'FW'].indexOf(b.pos) || b.ovr - a.ovr);
  const pickedIn = benchList.find((p) => p.id === benchPick);
  const sel = team.players[selected];
  const canSub = m.subs > 0;
  // 교체 확정 막대: 나갈 선수와 들어올 선수를 둘 다 골랐을 때.
  let confirm = '';
  if (sel && pickedIn && !sel.off) {
    const line = (slots[sel.slot] as { line: Pos }).line;
    const pen = posPenalty(pickedIn.spot, line);
    confirm = `<div class="subbar">
      <p class="subbar__text"><span class="subbar__out">OUT ${sel.n} ${esc(sel.name)}</span> <span aria-hidden="true">⇄</span> <span class="subbar__in">IN ${pickedIn.no} ${esc(pickedIn.name)}</span>${pen ? ` <span class="muted">(${line} 자리 OVR -${pen})</span>` : ''}</p>
      <div class="chips">${chip(`swap:${selected}:${pickedIn.id}`, canSub ? '교체 확정' : '교체 카드가 없다', false, !canSub)}<button type="button" class="chip" data-live-do="clear">취소</button></div>
    </div>`;
  } else if (sel || pickedIn) {
    confirm = `<p class="note note--plain">${sel ? `${sel.n}번 ${esc(sel.name)}을 골랐다. 아래 벤치에서 들어갈 선수를 고르면 교체할 수 있다.` : `${pickedIn!.no}번 ${esc(pickedIn!.name)}을 골랐다. 경기장 명단에서 나갈 선수를 고른다.`}</p>`;
  }

  const order: Pos[] = ['GK', 'DF', 'MF', 'FW'];
  const onPitch = order.map((line) => {
    const rows = team.players.map((p, i) => ({ p, i })).filter(({ p }) => (slots[p.slot] as { line: Pos }).line === line);
    if (!rows.length) return '';
    return `<li class="lsq__group">${LINE_NAME[line]}</li>${rows.map(({ p, i }) => {
      const pl = playerOf(g, p);
      const cond = condition(L, m, p);
      const rt = rating(L, m, 0, p);
      const at = slotSpot(slots[p.slot]!);
      const r = p.rec;
      const marks = `${r?.goals ? `<span class="lsq__mark" title="골">⚽${r.goals > 1 ? `×${r.goals}` : ''}</span>` : ''}${p.off ? '<span class="lsq__mark lsq__mark--red" title="퇴장">퇴장</span>' : ''}${p.on ? '<span class="lsq__mark" title="교체 투입">IN</span>' : ''}`;
      const open = i === selected;
      const role = pl ? (m.roles[pl.id] ?? 'base') : 'base';
      const roles = pl && p.key >= 0 && g.squad.some((q) => q.id === pl.id) ? ROLES[pl.pos].map((x) => chip(`role:${pl.id}:${x.id}`, x.name, role === x.id, p.off)).join('') : '';
      const st = pl ? statsOf(pl) : null;
      const labels = pl ? statNames(pl.spot).short : [];
      return `<li class="lsq__row${open ? ' is-picked' : ''}${p.off ? ' is-off' : ''}"${p.off ? '' : ` data-drop="lp:${i}" data-drag="lp:${i}"`}>
        <button type="button" class="lsq__main" data-live-do="pick:${i}" aria-pressed="${open}"${p.off ? ' disabled' : ''}>
          ${p.off ? '' : '<span class="drag-handle" aria-hidden="true">⠿</span>'}
          ${faceOf(p, 0, 34)}
          <span class="lsq__no" style="--kit:${kit[0].body};--ink:${light(kit[0].body) ? '#111' : '#fff'}">${p.n}</span>
          <span class="lsq__who"><span class="lsq__name">${esc(p.name)} ${marks}</span><span class="lsq__meta">${at}${pl && pl.spot !== at ? ` · 본래 ${pl.spot}` : ''} · OVR ${Math.round(p.ovr)}${pl ? ` · ${FOOT_NAME[pl.foot]}` : ''}</span>
          <span class="lsq__cond" title="체력 ${cond}"><span class="meter"><span class="meter__fill${cond < 45 ? ' is-low' : ''}" style="width:${cond}%"></span></span></span></span>
          <span class="lsq__rt lsq__rt--${ratingTone(rt)}" title="경기 평점">${rt.toFixed(1)}</span>
        </button>
        ${open ? `<div class="lsq__more">
          ${roles ? `<p class="live__label">개인 역할</p><div class="chips">${roles}</div><p class="fine">${esc(ROLES[pl!.pos].find((x) => x.id === role)?.desc ?? '')}</p>` : '<p class="fine">후보 출신이라 개인 역할 지시 없이 뛴다.</p>'}
          ${st ? `<p class="live__statline">${st.map((v, k) => `<span>${labels[k]} <b>${v}</b></span>`).join('')}</p>` : ''}
          <p class="fine">체력 ${cond} · ${staminaText(cond)}${r ? ` · 슈팅 ${r.shots}(유효 ${r.onTarget}) · 공 뺏기 ${r.steals} · 파울 ${r.fouls}` : ''}</p>
        </div>` : ''}
      </li>`;
    }).join('')}`;
  }).join('');

  const benchRows = benchList.length === 0 ? '<li class="lsq__empty muted">남은 후보가 없다. 빠른 교체를 쓰면 2군 선수가 들어간다.</li>' : benchList.map((p) => {
    const line = sel ? (slots[sel.slot] as { line: Pos }).line : p.pos;
    const pen = sel ? posPenalty(p.spot, line) : 0;
    const on = p.id === benchPick;
    return `<li class="lsq__row lsq__row--bench${on ? ' is-picked' : ''}" data-drag="lb:${p.id}" data-drop="lb:${p.id}">
      <button type="button" class="lsq__main" data-live-do="bench:${p.id}" aria-pressed="${on}">
        <span class="drag-handle" aria-hidden="true">⠿</span>
        ${face(p.id, p.nat, 34, [kit[0].body, kit[0].trim], p.name)}
        <span class="lsq__no lsq__no--bench">${p.no}</span>
        <span class="lsq__who"><span class="lsq__name">${esc(p.name)}${(L.youth ?? []).includes(p) ? ' <span class="lsq__mark">2군</span>' : ''}</span><span class="lsq__meta">${p.spot} · ${p.age}세 · OVR ${p.ovr + p.temp}${sel ? (pen ? ` · ${line} 자리면 -${pen}` : ` · ${line} 자리에 맞다`) : ''}</span></span>
        <span class="lsq__ovr">${p.ovr + p.temp}</span>
      </button>
    </li>`;
  }).join('');
  const gone = (L.subbed ?? []).filter((n) => !team.players.some((p) => p.name === n) && !benchList.some((p) => p.name === n));

  return `
    ${confirm}
    <p class="live__label">경기장 <span class="muted">${team.players.filter((p) => !p.off).length}명 · 누르면 역할과 능력치가 펼쳐진다. 벤치 선수를 ⠿로 끌어 경기장 선수 위에 놓으면 교체한다</span></p>
    <ul class="lsq">${onPitch}</ul>
    <p class="live__label">벤치 <span class="muted">${benchList.length}명 · 교체 카드 ${m.subs}장</span></p>
    <ul class="lsq">${benchRows}</ul>
    ${gone.length ? `<p class="fine">교체로 나간 선수: ${esc(gone.join(', '))}</p>` : ''}`;
}

function updatePanel(): void {
  const g = game;
  const box = $('#live-panel');
  if (!g || !box) return;
  const m = g.match as MatchState;
  const L = m.live as LiveState;
  document.querySelectorAll<HTMLElement>('[data-live-do^="panel:"]').forEach((el) => {
    const on = el.dataset.liveDo === `panel:${panel}` && !halftime(g);
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-selected', String(on));
  });
  const confused = m.confusion > 0 && L.tick < L.confusedUntil
    ? `<p class="note note--bad">새 지시를 익히는 중이다. ${Math.ceil((L.confusedUntil - L.tick) / PER_MIN)}분쯤 손발이 맞지 않는다.</p>` : '';

  if (halftime(g)) {
    const lead = m.score[0] - m.score[1];
    box.innerHTML = `
      <p class="live__label">하프타임 라커룸</p>
      <p class="prose">${lead > 0 ? '앞선 채로 들어왔다. 선수들이 감독을 본다.' : lead < 0 ? '뒤진 채로 들어왔다. 라커룸이 조용하다.' : '팽팽한 채로 들어왔다. 선수들이 감독을 본다.'} 말을 마치면 후반이 시작된다. 교체와 전술은 후반 중에도 바꿀 수 있다.</p>
      <div class="choices">
        <button type="button" class="choice" data-live="talk:praise"><span class="choice__label">잘하고 있다고 다독인다</span><span class="choice__detail">장악력 판정. 비기거나 한 골 뒤질 때 잘 통한다</span></button>
        <button type="button" class="choice" data-live="talk:blast"><span class="choice__label">물병을 걷어찬다</span><span class="choice__detail">장악력 판정. 통하면 크게 살아나고, 안 통하면 얼어붙는다</span></button>
        <button type="button" class="choice" data-live="talk:calm"><span class="choice__label">후반 계획만 짚는다</span><span class="choice__detail">확실한 작은 효과. 후반 초반의 전술 변경에 혼선이 없다</span></button>
      </div>
      <details class="live__halfsquad"><summary class="live__label">하프타임에 선수 보기 · 교체</summary>${squadPanel(g, m, L)}</details>`;
    return;
  }

  if (panel === 'team') {
    const advice = liveAdvice(g);
    const d = m.dials;
    box.innerHTML = `
      <p class="note note--${advice.tone}">${esc(advice.text)}</p>
      ${confused}
      ${row('전술', STYLE_IDS.map((id) => {
        const h = advice.hints[id];
        return chip(`style:${id}`, STYLES[id].name, m.me.style === id, false, h && h !== '비슷' ? `<span class="chip__hint chip__hint--${h === '유리' ? 'good' : 'bad'}">${h}</span>` : '');
      }).join(''), m.me.style === g.season.style ? '몸에 밴 전술' : '완성도 절반')}
      ${row('수비 라인', chip('line:-1', '내린다', d.line === -1) + chip('line:0', '보통', d.line === 0) + chip('line:1', '올린다', d.line === 1), '올리면 뒷공간이 빈다')}
      ${row('폭', chip('width:-1', '좁게', d.width === -1) + chip('width:0', '보통', d.width === 0) + chip('width:1', '넓게', d.width === 1))}
      ${row('템포', chip('tempo:-1', '느리게', d.tempo === -1) + chip('tempo:0', '보통', d.tempo === 0) + chip('tempo:1', '빠르게', d.tempo === 1), '빠르면 체력이 더 든다')}
      ${row('풀백 오버래핑', chip('overlap:0', '자리 지킴', !d.overlap) + chip('overlap:1', '올라간다', d.overlap))}
      ${row('대형', SHAPE_IDS.map((id) => chip(`shape:${id}`, SHAPES[id].name, m.me.shape === id, m.subs < 1 && m.me.shape !== id)).join(''), `교체 카드 1장 · 상대 ${SHAPES[m.opp.shape].name}`)}`;
  } else if (panel === 'squad') {
    box.innerHTML = `${confused}${squadPanel(g, m, L)}`;
  } else {
    box.innerHTML = `
      ${confused}
      ${row('태세', chip('push:-1', '잠근다', m.me.push === -1) + chip('push:0', '균형', m.me.push === 0) + chip('push:1', '총공세', m.me.push === 1), '막판의 승부수')}
      <p class="fine">상대 감독은 30분, 하프타임, 60분, 75분에 움직인다.${m.opp.push === 1 ? ' 지금 상대는 총공세다.' : m.opp.push === -1 ? ' 지금 상대는 잠그고 있다.' : ''}</p>
      ${row('빠른 교체', [
        chip('sub:fw', '공격수 투입', false, m.subs < 1),
        chip('sub:mf', '미드필더 투입', false, m.subs < 1),
        chip('sub:df', '수비수 투입', false, m.subs < 1),
        chip('sub:legs', '지친 선수 둘 교체', false, m.subs < 2),
      ].join(''), `남은 카드 ${m.subs}장 · 고르기 귀찮을 때`)}
      <p class="fine">팀 체력 ${Math.round(m.me.stamina)} · ${esc(staminaText(m.me.stamina))}. 상대 체력은 ${esc(staminaText(m.opp.stamina))}. 지친 뒤에 넣을수록 교체 효과가 크고, 70분이 넘으면 효과를 낼 시간이 짧다. 선수를 직접 골라 바꾸려면 "선수 · 교체" 탭을 쓴다.</p>`;
  }
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
  /** 화면 좌표(누르기 판정용). */
  sx: number;
  sy: number;
}

/** 화면에 그리는 위치. 엔진 위치를 스프링으로 따라간다. 키는 "팀:자리". */
const vis = new Map<string, Vis>();
/** 공이 지나간 자리(빠르게 움직일 때 꼬리). */
const trail: { x: number; y: number }[] = [];

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
    v = { x, y, vx: 0, vy: 0, hx, hy: 0, sx: 0, sy: 0 };
    vis.set(key, v);
  }
  return v;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** 유니폼 무늬를 원 안에 그린다. */
function shirt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: Kit, body: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  if (body === k.body && k.pattern) {
    ctx.clip();
    ctx.fillStyle = k.trim;
    if (k.pattern === 1) ctx.fillRect(x, y - r, r, r * 2);
    else if (k.pattern === 2) for (let i = -2; i <= 2; i += 2) ctx.fillRect(x + (i - 0.5) * r * 0.4, y - r, r * 0.4, r * 2);
    else if (k.pattern === 3) for (let i = -2; i <= 2; i += 2) ctx.fillRect(x - r, y + (i - 0.5) * r * 0.4, r * 2, r * 0.4);
    else if (k.pattern === 4) {
      ctx.beginPath();
      ctx.moveTo(x - r, y + r * 0.2);
      ctx.lineTo(x + r * 0.2, y - r);
      ctx.lineTo(x + r * 0.75, y - r);
      ctx.lineTo(x - r, y + r * 0.75);
      ctx.fill();
    }
  }
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
  const pad = 3;
  const s = (cssW - pad * 2) / 105;
  const cssH = Math.round(68 * s + pad * 2);
  if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    c.style.height = `${cssH}px`;
  }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = (x: number): number => pad + x * s;
  const Y = (y: number): number => pad + y * s;

  // 잔디: 줄무늬와 가장자리 그늘.
  ctx.fillStyle = '#2a7d4a';
  ctx.fillRect(0, 0, cssW, cssH);
  for (let k = 0; k < 14; k += 2) {
    ctx.fillStyle = '#2f8a52';
    ctx.fillRect(X((105 / 14) * k), Y(0), (105 / 14) * s, 68 * s);
  }
  const vignette = ctx.createRadialGradient(cssW / 2, cssH / 2, cssH * 0.3, cssW / 2, cssH / 2, cssW * 0.7);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = Math.max(1, s * 0.15);
  ctx.strokeRect(X(0), Y(0), 105 * s, 68 * s);
  ctx.beginPath();
  ctx.moveTo(X(52.5), Y(0));
  ctx.lineTo(X(52.5), Y(68));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(52.5), Y(34), 9.15 * s, 0, Math.PI * 2);
  ctx.stroke();
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : 105;
    const dir = side === 0 ? 1 : -1;
    ctx.strokeRect(Math.min(X(x0), X(x0 + dir * 16.5)), Y(13.84), 16.5 * s, 40.32 * s);
    ctx.strokeRect(Math.min(X(x0), X(x0 + dir * 5.5)), Y(24.84), 5.5 * s, 18.32 * s);
    ctx.beginPath();
    ctx.arc(X(x0 + dir * 11), Y(34), 9.15 * s, side === 0 ? -0.93 : Math.PI - 0.93, side === 0 ? 0.93 : Math.PI + 0.93);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(Math.min(X(x0), X(x0 - dir * 1.2)), Y(30.34), 1.2 * s, 7.32 * s);
  }
  // 공격 방향.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 ${Math.max(10, s * 2.2)}px 'Barlow Condensed', system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('공격 →', X(1.5), Y(1));
  ctx.textAlign = 'right';
  ctx.fillText('← 상대 공격', X(103.5), Y(1));

  // 배속이 빠를수록 스프링을 빠르게 한다. 멈춰 있거나 처음 그리면 바로 맞춘다.
  const w = 9 * Math.sqrt(speed);
  const step = snap ? 0 : dt;
  const lerp = (a: number, b: number): number => a + (b - a) * frac;

  // 선수 위치.
  type Dot = { t: 0 | 1; i: number; p: LivePlayer; v: Vis };
  const dots: Dot[] = [];
  for (const t of [0, 1] as const) {
    L.teams[t].players.forEach((p, i) => {
      if (p.off) return;
      const tx = lerp(p.px, p.x);
      const ty = lerp(p.py, p.y);
      const v = visOf(`${t}:${i}`, tx, ty, t === 0 ? 1 : -1);
      if (snap || step === 0 || Math.hypot(tx - v.x, ty - v.y) > 25) {
        v.x = tx;
        v.y = ty;
        v.vx = 0;
        v.vy = 0;
      } else spring(v, tx, ty, step, w);
      // 움직이면 그쪽을, 서 있으면 공을 본다.
      const sp = Math.hypot(v.vx, v.vy);
      const [dx, dy] = sp > 0.6 ? [v.vx / sp, v.vy / sp] : (() => {
        const bx = L.ball.x - v.x;
        const by = L.ball.y - v.y;
        const d = Math.hypot(bx, by) || 1;
        return [bx / d, by / d];
      })();
      const turn = Math.min(1, step * 8 || 1);
      v.hx += (dx - v.hx) * turn;
      v.hy += (dy - v.hy) * turn;
      const hn = Math.hypot(v.hx, v.hy) || 1;
      v.hx /= hn;
      v.hy /= hn;
      v.sx = X(v.x);
      v.sy = Y(v.y);
      dots.push({ t, i, p, v });
    });
  }

  // 공: 가진 선수 발밑, 날아가는 중이면 감속하는 궤적, 멈춰 있으면 그 자리.
  const f = L.flight;
  let ballX = lerp(L.ball.px, L.ball.x);
  let ballY = lerp(L.ball.py, L.ball.y);
  let lift = 0;
  if (f) {
    const span = Math.max(1, f.end - f.start);
    const prog = clamp((L.tick - 1 - f.start + frac) / span, 0, 1);
    const e = f.kind === 'shot' ? prog : easeOut(prog);
    ballX = f.fromX + (f.toX - f.fromX) * e;
    ballY = f.fromY + (f.toY - f.fromY) * e;
    if (f.kind === 'long' || f.kind === 'cross') lift = Math.sin(Math.PI * prog) * Math.min(6, Math.hypot(f.toX - f.fromX, f.toY - f.fromY) * 0.12) * s;
  } else if (L.owner) {
    const ov = vis.get(`${L.owner.team}:${L.owner.i}`);
    if (ov) {
      ballX = ov.x + ov.hx * 0.9;
      ballY = ov.y + ov.hy * 0.9;
    }
  }
  const bv = visOf('ball', ballX, ballY, 1);
  if (snap || step === 0 || Math.hypot(ballX - bv.x, ballY - bv.y) > 30) {
    bv.x = ballX;
    bv.y = ballY;
    bv.vx = 0;
    bv.vy = 0;
  } else spring(bv, ballX, ballY, step, f ? 40 : 22);
  if (Math.hypot(bv.vx, bv.vy) > 12) trail.push({ x: bv.x, y: bv.y });
  else if (trail.length) trail.shift();
  if (trail.length > 7) trail.shift();

  // 패스와 슈팅의 목표 지점.
  if (f) {
    ctx.save();
    ctx.setLineDash(f.kind === 'shot' ? [] : [3, 5]);
    ctx.strokeStyle = f.kind === 'shot' ? 'rgba(255,225,74,0.85)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = f.kind === 'shot' ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(X(bv.x), Y(bv.y));
    ctx.lineTo(X(f.toX), Y(f.toY));
    ctx.stroke();
    ctx.restore();
  }

  // 선수: 아래에 있는 선수부터 그려 겹칠 때 자연스럽게 한다.
  const r = Math.max(8, s * 2);
  const tags: { x: number; y: number; text: string; mine: boolean }[] = [];
  const owner = L.owner;
  dots.sort((a, b) => a.v.y - b.v.y);
  for (const { t, i, p, v } of dots) {
    const k = kit[t];
    const x = X(v.x);
    const y = Y(v.y);
    const keeper = p.line === 'GK' && (SLOTS[t === 0 ? m.me.shape : m.opp.shape][p.slot] as { line: Pos }).line === 'GK';
    const body = keeper ? k.keeper : k.body;
    // 그림자.
    ctx.beginPath();
    ctx.ellipse(x + r * 0.18, y + r * 0.32, r * 1.02, r * 0.78, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    shirt(ctx, x, y, r, k, body);
    const hasBall = !!owner && owner.team === t && owner.i === i;
    ctx.lineWidth = Math.max(1.2, r * 0.2);
    ctx.strokeStyle = hasBall ? '#ffe14a' : 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // 바라보는 쪽 표시.
    const ang = Math.atan2(v.hy, v.hx);
    ctx.beginPath();
    ctx.arc(x, y, r + 1.6, ang - 0.5, ang + 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.stroke();
    if (t === 0 && i === selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffe14a';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (hasBall || (t === 0 && i === selected) || (L.next && L.next.team === t && L.next.i === i)) {
      tags.push({ x, y, text: `${p.n} ${short(p.name, p.nat)}`, mine: t === 0 });
    }
    // 등번호: 바탕이 밝으면 검게, 무늬가 있으면 테두리를 둘러 읽히게 한다.
    ctx.font = `700 ${Math.round(r * 1.2)}px 'Barlow Condensed', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ink = light(body) ? '#111' : '#fff';
    if (!keeper && k.pattern) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = ink === '#111' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)';
      ctx.strokeText(String(p.n), x, y + 0.5);
    }
    ctx.fillStyle = ink;
    ctx.fillText(String(p.n), x, y + 0.5);
  }

  // 공과 꼬리. 뜬 공은 그림자가 땅에 남는다.
  const bx = X(bv.x);
  const by = Y(bv.y);
  const br = Math.max(3, s * 0.75);
  trail.forEach((pt, k) => {
    ctx.beginPath();
    ctx.arc(X(pt.x), Y(pt.y) - lift * 0.5, br * (0.4 + k * 0.06), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.08 + k * 0.04})`;
    ctx.fill();
  });
  ctx.beginPath();
  ctx.ellipse(bx + lift * 0.15, by + 1, br * (1 + lift / (s * 12)), br * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by - lift, br * (1 + lift / (s * 20)), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#111';
  ctx.stroke();

  ctx.font = `700 ${Math.max(11, Math.round(s * 2.4))}px 'IBM Plex Sans KR', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const tag of tags) {
    const tw = ctx.measureText(tag.text).width + 10;
    const h = Math.max(16, s * 3.6);
    const tx = Math.min(Math.max(tag.x, tw / 2 + 2), cssW - tw / 2 - 2);
    const ty = tag.y - r - h / 2 - 4 < h / 2 ? tag.y + r + h / 2 + 4 : tag.y - r - h / 2 - 4;
    ctx.fillStyle = tag.mine ? 'rgba(255,255,255,0.94)' : 'rgba(20,20,20,0.85)';
    ctx.beginPath();
    ctx.roundRect(tx - tw / 2, ty - h / 2, tw, h, h / 2);
    ctx.fill();
    ctx.fillStyle = tag.mine ? '#111' : '#fff';
    ctx.fillText(tag.text, tx, ty + 0.5);
  }

  const flashEl = $('#live-flash');
  if (flashEl) {
    const on = !!flash && performance.now() < flash.until;
    flashEl.textContent = on && flash ? flash.text : '';
    flashEl.className = `live__flash${on && flash ? (flash.good ? ' is-good' : ' is-bad') : ''}`;
  }
  if (L.halfTimeDone && !L.talked) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.max(18, s * 5)}px 'Black Han Sans', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('하프타임', cssW / 2, cssH / 2);
  }
}
