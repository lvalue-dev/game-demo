// 화면. 게임 규칙은 game/에 있고, 여기서는 game.scene을 그리고 누른 선택지를 act()에 넘긴다.
import { act, createGame, legacyScore, migrate } from '../game/career.ts';
import {
  ATTRS, ATTR_IDS, BACKGROUNDS, BACKGROUND_IDS, LEAGUES, POS_NAME, STYLES, STYLE_IDS, won,
} from '../game/data.ts';
import { COUNTRIES, COUNTRY_IDS, countryOf, leaguesOf, quotaOf } from '../game/countries.ts';
import type { CountryId } from '../game/countries.ts';
import { licenseName } from '../game/hiring.ts';
import { ko } from '../game/josa.ts';
import { effOvr, formationOf, lineAt, lineupLocked, potentialText, ratings, slotsFor, spotAt, stage, valueOf } from '../game/squad.ts';
import { formationMini, playerCard, playerRow, spotBadge } from './cards.ts';
import { face } from './face.ts';
import { ESC_SLOTS, NON_HG_LIMIT, PROMISES, RESERVE_LIMIT, oddsText, quotaWord, contractText, depthOf, englandStatus, englandText, foreignCount, inEngland, isForeign, placeAt, promiseKept, quota, swapLineup, totalWages } from '../game/contract.ts';
import { SLOTS } from '../game/live.ts';
import { agenda } from '../game/agenda.ts';
import { manage, planDials, planRole } from '../game/manage.ts';
import { WEATHER, hint } from '../game/match.ts';
import { posPenalty } from '../game/player.ts';
import { DIALS, PHASES, ROLES, SHAPES, SHAPE_IDS, comboState, fits } from '../game/tactics.ts';
import type { DialPhase } from '../game/tactics.ts';
import { legacyTitle } from '../game/talk.ts';
import { dropCount, sortTable, zone } from '../game/world.ts';
import { isLive, mountLive, onLiveClick, pauseLive, renderLive, unmountLive } from './live.ts';
import type { BackgroundId, Block, Choice, Club, FormRow, MarketCard, MarketTab, Game, LeagueId, MatchLine, MatchState, Phase, Player, ShapeId, StyleId } from '../game/types.ts';

type Tab = 'play' | 'table' | 'squad' | 'record';
/** 구단 관리 탭 안의 작은 탭. 한 화면이 길어지지 않게 나눈다. */
type SquadTab = 'todo' | 'xi' | 'tactic' | 'players' | 'club';

interface HallEntry {
  name: string;
  /** 출발 무대 이름. 이전 기록에는 없다. */
  start?: string;
  score: number;
  title: string;
  years: string;
  best: string;
}

const SAVE_KEY = 'touchline:save';
const HALL_KEY = 'touchline:hall';
const STEPS: { label: string; phases: Phase[] }[] = [
  { label: '전술', phases: ['style'] }, { label: '훈련', phases: ['focus'] }, { label: '여름', phases: ['market'] },
  { label: '전반기', phases: ['half1'] }, { label: '사건', phases: ['event', 'outcome'] }, { label: '겨울', phases: ['winter'] },
  { label: '후반기', phases: ['plan'] }, { label: '결산', phases: ['end'] }, { label: '성장', phases: ['growth'] },
];

let root: HTMLElement;
let game: Game | null = null;
let tab: Tab = 'play';
let tableLeague: LeagueId | null = null;
/** 이적시장에서 보고 있는 탭. */
let marketTab: string | null = null;
/** 구단 관리 탭에서 맞바꾸려고 고른 자리나 후보. */
let squadPick: { kind: 'slot'; at: number } | { kind: 'res'; id: number } | null = null;
/** 구단 관리에서 보고 있는 작은 탭(고르기 전에는 할 일이 있으면 할 일, 없으면 라인업)과 역할을 보고 있는 선발 자리. */
let squadTab: SquadTab | null = null;
let rolePick = 10;
/** 구단 관리의 팀 지시에서 보고 있는 국면. */
let planPhase: DialPhase = 'att';
/** 경기 준비 화면에서 고른 전술. 고르기 전에는 몸에 밴 전술이다. */
let preStyle: StyleId | null = null;
let confirmReset = false;
/** 선발 배치가 거절됐을 때 잠깐 보여 줄 이유. */
let notice: string | null = null;
let draft: { name: string; background: BackgroundId } = { name: '', background: 'pro' };

const esc = (text: string | number): string => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장소를 쓸 수 없는 환경에서는 이번 접속 동안만 이어진다.
  }
}

/** 새 버전이 배포될 때 진행 중인 커리어를 넘겨주기 위한 값. */
export function snapshot(): { game: Game | null } {
  return { game };
}

export function start(data: { game?: unknown }): void {
  root = document.getElementById('app') as HTMLElement;
  const saved = (data.game as Game | undefined) ?? load<Game>(SAVE_KEY);
  game = saved && migrate(saved) ? saved : null;
  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseLive();
  });
  root.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === 'manager-name') draft.name = input.value;
    if (input.type === 'range' && input.dataset.range) previewRange(input);
  });
  root.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.range) commitRange(input);
    const select = e.target as HTMLSelectElement;
    if (select.dataset.place && game) {
      const [pid, at] = select.value.split(':');
      notice = placeAt(game, Number(pid), Number(at));
      store(SAVE_KEY, game);
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    begin();
  });
  render();
}

function begin(): void {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
  game = createGame(seed, draft.name, draft.background);
  tab = 'play';
  tableLeague = null;
  store(SAVE_KEY, game);
  render();
  window.scrollTo(0, 0);
}

// ---------- 끌어다 놓기 ----------
// 마우스는 바로, 손가락은 선발 토큰이나 ⠿ 손잡이에서만 끈다(나머지는 화면 스크롤). 놓은 곳의 data-drop이 무엇이냐에 따라 맞바꾸기, 자리 옮기기, 후보로 내리기를 한다.

interface Drag {
  src: string;
  el: HTMLElement;
  ghost: HTMLElement | null;
  x0: number;
  y0: number;
  id: number;
  over: HTMLElement | null;
}

let drag: Drag | null = null;
/** 끌기를 마친 직후의 클릭(손을 뗄 때 생기는)을 무시한다. */
let justDragged = false;

function onPointerDown(e: PointerEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-drag]');
  if (!el || !game || e.button > 0) return;
  if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('.xi-tok, .drag-handle')) return;
  drag = { src: el.dataset.drag as string, el, ghost: null, x0: e.clientX, y0: e.clientY, id: e.pointerId, over: null };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cancelDrag);
}

function onPointerMove(e: PointerEvent): void {
  const d = drag;
  if (!d || e.pointerId !== d.id) return;
  if (!d.ghost) {
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    const rect = d.el.getBoundingClientRect();
    const ghost = d.el.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('data-drop');
    ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:0;top:0;`;
    document.body.appendChild(ghost);
    d.ghost = ghost;
    d.el.classList.add('is-dragging');
    document.body.classList.add('is-dragging-any');
  }
  e.preventDefault();
  const r = d.ghost.getBoundingClientRect();
  d.ghost.style.transform = `translate(${e.clientX - r.width / 2}px, ${e.clientY - r.height / 2}px) scale(1.05)`;
  const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null;
  if (target !== d.over) {
    d.over?.classList.remove('is-over');
    if (target && target !== d.el) target.classList.add('is-over');
    d.over = target;
  }
}

function cancelDrag(): void {
  const d = drag;
  drag = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', cancelDrag);
  if (!d) return;
  d.ghost?.remove();
  d.el.classList.remove('is-dragging');
  d.over?.classList.remove('is-over');
  document.body.classList.remove('is-dragging-any');
}

function onPointerUp(e: PointerEvent): void {
  const d = drag;
  if (!d || e.pointerId !== d.id) return;
  const started = !!d.ghost;
  const target = started ? ((document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null) : null;
  cancelDrag();
  if (!started || !game) return;
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 50);
  const g = game;
  const dst = target?.dataset.drop ?? '';
  const [sk, sv] = d.src.split(':');
  let action: string | null = null;
  const at = Number(sv);
  if (dst.startsWith('s:')) {
    const j = Number(dst.slice(2));
    if (sk === 's' && j !== at) action = `place:${(g.squad[at] as Player).id}.${j}`;
    if (sk === 'r') action = `place:${at}.${j}`;
  } else if (dst.startsWith('res:')) {
    if (sk === 's') action = `place:${dst.slice(4)}.${at}`;
  } else if (dst === 'reserves') {
    if (sk === 's') action = `bench:${at}`;
  } else if (dst === 'pitch' && target) {
    const rect = target.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    // 화면의 위치(%)를 경기장 좌표로: 토큰을 그릴 때(x = 6 + v/68×88, y = 94 − u/80×88)의 거꾸로.
    const v = ((px - 6) / 88) * 68;
    const u = ((94 - py) / 88) * 80;
    if (sk === 's') action = `move:${at}.${Math.round(u)}.${Math.round(v)}`;
    if (sk === 'r') {
      // 후보를 잔디에 놓으면 가장 가까운 자리에 세운다.
      const slots = slotsFor(g);
      let best = 0;
      let bestD = Infinity;
      slots.forEach((s2, k) => {
        const dd = Math.hypot(s2.u - u, s2.v - v);
        if (dd < bestD) {
          bestD = dd;
          best = k;
        }
      });
      action = `place:${at}.${best}`;
    }
  }
  if (!action) return;
  notice = manage(g, action).msg;
  squadPick = null;
  store(SAVE_KEY, g);
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

function onClick(e: Event): void {
  if (justDragged) {
    e.preventDefault();
    return;
  }
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab],[data-league],[data-bg],[data-country],[data-mtab],[data-todo],[data-lineup],[data-do],[data-live],[data-live-do],[data-step],[data-stab],[data-pre],[data-role],[data-phase]');
  if (!el) return;
  if (el.dataset.step && el.dataset.for) {
    const slider = root.querySelector<HTMLInputElement>(`input[type="range"][data-range="${CSS.escape(el.dataset.for)}"]`);
    if (slider) {
      const step = Number(slider.step) * Number(el.dataset.step);
      slider.value = String(Math.min(Number(slider.max), Math.max(Number(slider.min), Number(slider.value) + step)));
      commitRange(slider);
    }
    return;
  }
  if ((el.dataset.live || el.dataset.liveDo) && onLiveClick(el)) return;
  if (el.dataset.bg) {
    draft.background = el.dataset.bg as BackgroundId;
    render();
    return;
  }
  if (el.dataset.do === 'reset') {
    if (!confirmReset) {
      confirmReset = true;
    } else {
      confirmReset = false;
      game = null;
      store(SAVE_KEY, null);
    }
    render();
    return;
  }
  if (el.dataset.do?.startsWith('swap:') && game) {
    const [, a, b] = el.dataset.do.split(':');
    if (swapLineup(game, Number(a), Number(b))) store(SAVE_KEY, game);
    render();
    return;
  }
  if (el.dataset.do === 'keep') {
    confirmReset = false;
    render();
    return;
  }
  if (!game) return;
  if (el.dataset.stab) {
    // 구단 관리의 작은 탭. 다른 화면의 바로가기에서도 쓴다.
    const same = tab === 'squad';
    const y = window.scrollY;
    tab = 'squad';
    squadTab = el.dataset.stab as SquadTab;
    squadPick = null;
    render();
    window.scrollTo(0, same ? y : 0);
    return;
  }
  if (el.dataset.phase) {
    planPhase = PHASES.find((x) => x.id === el.dataset.phase)?.id ?? 'att';
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }
  if (el.dataset.role) {
    rolePick = Number(el.dataset.role);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }
  if (el.dataset.pre) {
    prematch(game, el.dataset.pre);
    return;
  }
  if (el.dataset.tab) {
    tab = el.dataset.tab as Tab;
    confirmReset = false;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (el.dataset.todo && game) {
    const res = manage(game, el.dataset.todo);
    notice = res.msg;
    store(SAVE_KEY, game);
    if (res.go) {
      tab = 'play';
      if (res.tab) marketTab = res.tab;
      squadPick = null;
      render();
      window.scrollTo(0, 0);
    } else {
      const y = window.scrollY;
      squadPick = null;
      render();
      window.scrollTo(0, y);
    }
    return;
  }
  if (el.dataset.lineup && game) {
    const v = el.dataset.lineup;
    const y = window.scrollY;
    if (v === 'clear') squadPick = null;
    else {
      const [kind, raw] = v.split(':');
      const n = Number(raw);
      const cur = squadPick;
      if (kind === 's') {
        if (cur?.kind === 'slot' && cur.at === n) squadPick = null;
        else if (cur?.kind === 'slot') {
          notice = manage(game, `place:${(game.squad[n] as Player).id}.${cur.at}`).msg;
          squadPick = null;
        } else if (cur?.kind === 'res') {
          notice = manage(game, `place:${cur.id}.${n}`).msg;
          squadPick = null;
        } else squadPick = { kind: 'slot', at: n };
      } else if (kind === 'r') {
        if (cur?.kind === 'slot') {
          notice = manage(game, `place:${n}.${cur.at}`).msg;
          squadPick = null;
        } else squadPick = cur?.kind === 'res' && cur.id === n ? null : { kind: 'res', id: n };
      }
      store(SAVE_KEY, game);
    }
    render();
    window.scrollTo(0, y);
    return;
  }
  if (el.dataset.mtab) {
    marketTab = el.dataset.mtab;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }
  if (el.dataset.country) {
    tableLeague = el.dataset.country === 'intl' ? 'intl' : `${el.dataset.country}1`;
    render();
    return;
  }
  if (el.dataset.league) {
    tableLeague = el.dataset.league as LeagueId;
    render();
    return;
  }
  const id = el.dataset.act as string;
  if (game.phase === 'retired' && id === 'new') {
    const hall = load<HallEntry[]>(HALL_KEY) ?? [];
    const best = [...game.trophies].sort((a, b) => b.weight - a.weight)[0];
    hall.push({
      name: game.manager.name, start: game.history[0] ? `${game.history[0].club}(${game.history[0].league})` : '', score: legacyScore(game), title: legacyTitle(legacyScore(game)),
      years: `${game.history[0]?.year ?? game.year}–${game.year}`, best: best ? `${best.year} ${best.name}` : '트로피 없음',
    });
    store(HALL_KEY, hall.sort((a, b) => b.score - a.score).slice(0, 10));
    game = null;
    store(SAVE_KEY, null);
    render();
    window.scrollTo(0, 0);
    return;
  }
  const before = screenKey(game);
  const y = window.scrollY;
  act(game, id);
  store(SAVE_KEY, game);
  render();
  // 같은 화면 안에서 고른 것(칩, 지원 표시, 슬라이더 버튼 등)은 보던 자리를 지키고, 화면이 바뀔 때만 맨 위로 간다.
  window.scrollTo(0, screenKey(game) === before ? y : 0);
}

const isPrematch = (g: Game): boolean => g.phase === 'match' && !!g.job && !!g.match && (g.match.step === 'shape' || g.match.step === 'plan' || g.match.step === 'mode');

/**
 * 경기 준비 화면의 동작. 대형, 전술, 지휘 방식을 한 화면에서 고르고, 킥오프를 누르면 엔진의 세 단계(대형 → 전술 → 방식)를 차례로 넘긴다.
 * 대형은 구단 관리의 대형과 같은 것이라, 여기서 바꾸면 선발의 자리도 함께 바뀐다.
 */
function prematch(g: Game, cmd: string): void {
  const m = g.match;
  if (!m || !isPrematch(g)) return;
  const [what, v = ''] = cmd.split(':');
  const y = window.scrollY;
  if (what === 'shape') {
    if (m.step === 'shape') notice = manage(g, `formation:${v}`).msg;
  } else if (what === 'style') {
    if (m.step !== 'mode' && STYLE_IDS.includes(v as StyleId)) preStyle = v as StyleId;
  } else if (what === 'go') {
    if (v === 'auto') {
      if (m.step === 'shape') act(g, 'auto');
    } else {
      const style = preStyle ?? g.season.style;
      if (g.match?.step === 'shape') act(g, formationOf(g));
      if (g.match?.step === 'plan') act(g, style);
      if (g.match?.step === 'mode') act(g, v === 'live' ? 'live' : 'text');
    }
    preStyle = null;
  }
  store(SAVE_KEY, g);
  render();
  window.scrollTo(0, what === 'go' ? 0 : y);
}

/** 화면을 가르는 값. 이 값이 그대로면 같은 화면을 다시 그린 것이다. */
function screenKey(g: Game): string {
  return [g.year, g.phase, g.scene.title, g.window?.view ?? '', g.hiring?.step ?? '', g.hiring?.talk?.at ?? '', g.hiring?.talk?.i ?? '', g.match?.step ?? '', g.match?.seg ?? ''].join('|');
}

// ---------- 그리기 ----------

let crestCount = 0;

/**
 * 구단의 문장. 실제 엠블럼이 아니라 팀 색 두 가지와 무늬 번호로 직접 그린 방패다.
 * 무늬: 0 띠, 1 반반, 2 세로 줄무늬, 3 가로 줄무늬, 4 사선, 5 꺾쇠.
 */
function crest(club: Club, size: number): string {
  const [a, b] = club.colors;
  const id = `crest${crestCount++}`;
  const marks = [
    `<rect x="0" y="0" width="24" height="8" fill="${b}"/>`,
    `<rect x="12" y="0" width="12" height="28" fill="${b}"/>`,
    `<rect x="5" y="0" width="4" height="28" fill="${b}"/><rect x="15" y="0" width="4" height="28" fill="${b}"/>`,
    `<rect x="0" y="6" width="24" height="4.5" fill="${b}"/><rect x="0" y="15" width="24" height="4.5" fill="${b}"/>`,
    `<path d="M-2 22 L18 -2 L26 -2 L26 4 L4 30 L-2 30 Z" fill="${b}"/>`,
    `<path d="M0 9 L12 19 L24 9 L24 15 L12 25 L0 15 Z" fill="${b}"/>`,
  ][club.pattern % 6] as string;
  return `<svg class="crest" width="${size}" height="${Math.round((size * 28) / 24)}" viewBox="0 0 24 28" aria-hidden="true">
    <clipPath id="${id}"><path d="M2 2 H22 V14 C22 21 17 25 12 27 C7 25 2 21 2 14 Z"/></clipPath>
    <g clip-path="url(#${id})"><rect width="24" height="28" fill="${a}"/>${marks}</g>
    <path class="crest__edge" d="M2 2 H22 V14 C22 21 17 25 12 27 C7 25 2 21 2 14 Z" fill="none"/>
  </svg>`;
}

function render(): void {
  crestCount = 0;
  unmountLive();
  root.innerHTML = game ? renderGame(game) : renderStart();
  const live = !!game && tab === 'play' && isLive(game);
  // 실시간 경기 중에는 전광판 대신 점수와 경기장을 화면 위에 붙여 둔다. 아래 지시 패널을 만지면서도 경기가 보인다.
  document.body.classList.toggle('is-live', live);
  // 위아래에 붙는 막대의 실제 높이를 알려, 그 사이에 붙는 단추와 작은 탭이 가려지지 않게 한다.
  const bar = root.querySelector<HTMLElement>('.board');
  const nav = root.querySelector<HTMLElement>('.tabs');
  if (bar && bar.offsetHeight) document.documentElement.style.setProperty('--board-h', `${bar.offsetHeight}px`);
  if (nav && nav.offsetHeight) document.documentElement.style.setProperty('--tabs-h', `${nav.offsetHeight}px`);
  if (game && live) {
    mountLive(game, {
      save: () => store(SAVE_KEY, game),
      done: () => {
        store(SAVE_KEY, game);
        render();
        window.scrollTo(0, 0);
      },
    });
  }
}

function renderStart(): string {
  const hall = load<HallEntry[]>(HALL_KEY) ?? [];
  return `
    <header class="board board--start">
      <p class="board__kicker">감독 커리어 시뮬레이션</p>
      <h1 class="brand">터치라인</h1>
      <p class="board__lede">자격증 하나로 시작해 동호인 리그에서 K리그, J리그, 유럽 5대 리그를 거쳐 월드컵 결승 벤치까지. 7개국 35개 리그, 실제 구단 600여 곳. 서른 시즌이 지나면 은퇴한다.</p>
    </header>
    <main class="page">
      <form class="create" autocomplete="off">
        <label class="field" for="manager-name">
          <span class="field__label">감독 이름</span>
          <input id="manager-name" class="field__input" type="text" maxlength="10" placeholder="김감독" value="${esc(draft.name)}">
        </label>
        <fieldset class="field">
          <legend class="field__label">지도자가 되기 전에는</legend>
          <div class="choices">
            ${BACKGROUND_IDS.map((id) => `
              <button type="button" class="choice${draft.background === id ? ' is-picked' : ''}" data-bg="${id}" aria-pressed="${draft.background === id}">
                <span class="choice__label">${esc(BACKGROUNDS[id].name)}</span>
                <span class="choice__detail">${esc(BACKGROUNDS[id].desc)}</span>
              </button>`).join('')}
          </div>
        </fieldset>
        <section class="field">
          <p class="field__label">감독이 되는 길</p>
          <p class="prose">처음에는 맡은 팀이 없다. 지도자 강습으로 자격증을 따고, 구인 공고에 지원서를 내고, 서류를 통과하면 면접을 본다. 리그마다 필요한 자격이 다르다: K5리그는 C급, K3는 A급, K리그와 유럽 1부는 P급(UEFA Pro)이다. 한국, 일본, 잉글랜드, 스페인, 독일, 이탈리아, 프랑스의 5부까지 어디든 지원할 수 있다.</p>
        </section>
        <button type="submit" class="choice choice--primary choice--solo"><span class="choice__label">커리어 시작</span></button>
      </form>
      <section class="section">
        <h2 class="section__title">지도자 역량 다섯 가지</h2>
        <dl class="stats">${ATTR_IDS.map((id) => `<div class="stats__row"><dt>${esc(ATTRS[id].name)}</dt><dd class="stats__text">${esc(ATTRS[id].desc)}</dd></div>`).join('')}</dl>
      </section>
      ${hall.length > 0 ? `
      <section class="section">
        <h2 class="section__title">명예의 전당</h2>
        <ol class="hall">${hall.map((h) => `
          <li class="hall__row"><span class="hall__score">${h.score}</span><span class="hall__body"><strong>${esc(h.name)}</strong> · ${esc(h.title)}${h.start ? ` · ${esc(h.start)} 출발` : ''}<br><span class="muted">${esc(h.years)} · ${esc(h.best)}</span></span></li>`).join('')}
        </ol>
      </section>` : ''}
      <p class="fine">리그와 구단은 2026-27 시즌 실제 구성을 따랐다(한국 리그는 2026 시즌, 하부 리그는 한 권역만). 명단은 위키백과에서 모았고, 한국어 문서가 없는 구단은 원어 이름으로 적었다. 어느 구단이나 리그와도 공식 제휴한 것이 아니며, 문장은 실제 엠블럼이 아니라 팀 색으로 직접 그린 것이다. 구단의 전력과 게임 속 성적, 사건, 기사, 댓글과 선수, 매체 이름은 모두 지어낸 것이다.</p>
      <p class="fine">진행 상황은 이 기기의 브라우저에 저장된다.</p>
    </main>`;
}

function renderGame(g: Game): string {
  const club = g.job ? (g.clubs[g.job.club] as Club) : null;
  const meta = club && !club.nation ? LEAGUES[club.league]! : null;
  const where = club ? (meta ? (meta.short === meta.name || meta.name.startsWith(meta.short) ? meta.name : `${meta.name} · ${meta.short}`) : '국가대표팀') : '무소속';
  const step = g.phase === 'match' ? (g.season.half === 1 ? 3 : 6) : STEPS.findIndex((s) => s.phases.includes(g.phase));
  return `
    <header class="board">
      <div class="board__row">
        ${club ? crest(club, 30) : ''}
        <div class="board__club">
          <h1 class="board__name">${esc(club ? club.name : '터치라인')}</h1>
          <p class="board__kicker">${esc(where)} · ${g.year}</p>
        </div>
        <dl class="board__nums">
          <div><dt>명성</dt><dd>${Math.round(g.manager.rep)}</dd></div>
          <div><dt>나이</dt><dd>${g.manager.age}</dd></div>
        </dl>
      </div>
      ${step >= 0 ? `<ol class="steps" aria-label="시즌 진행">${STEPS.map((s, i) => `<li class="steps__item${i < step ? ' is-done' : i === step ? ' is-now' : ''}"${i === step ? ' aria-current="step"' : ''}>${s.label}</li>`).join('')}</ol>` : ''}
    </header>
    <main class="page">${tab === 'play' ? (isLive(g) ? renderLive(g) : isPrematch(g) ? renderPrematch(g) : renderScene(g)) : tab === 'table' ? renderTables(g) : tab === 'squad' ? renderSquad(g) : renderRecord(g)}</main>
    <nav class="tabs" aria-label="화면 전환">
      ${([['play', '진행'], ['table', '순위'], ['squad', '구단 관리'], ['record', '기록']] as [Tab, string][]).map(([id, label]) => {
        const n = id === 'squad' && g.job ? agenda(g).length : 0;
        const hot = id === 'squad' && g.job ? agenda(g).some((t) => t.tone === 'bad') : false;
        return `<button type="button" class="tabs__item${tab === id ? ' is-on' : ''}" data-tab="${id}"${tab === id ? ' aria-current="page"' : ''}>${TAB_ICONS[id]}${n ? `<span class="tabs__badge${hot ? ' is-hot' : ''}" aria-label="할 일 ${n}건">${n}</span>` : ''}<span>${label}</span></button>`;
      }).join('')}
    </nav>`;
}

/** 하단 탭 아이콘: 공, 순위표, 유니폼, 트로피. */
const TAB_ICONS: Record<Tab, string> = {
  play: '<svg class="tabs__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5 L15.8 10.3 L14.4 14.8 H9.6 L8.2 10.3 Z" fill="currentColor"/><path d="M12 3 V7.5 M15.8 10.3 L20.5 9 M14.4 14.8 L17 19.5 M9.6 14.8 L7 19.5 M8.2 10.3 L3.5 9" stroke="currentColor" stroke-width="1.4"/></svg>',
  table: '<svg class="tabs__icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9 H20.5 M3.5 14 H20.5 M9 4 V20" stroke="currentColor" stroke-width="1.5"/></svg>',
  squad: '<svg class="tabs__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 L4.5 5 L1.5 9.5 L4.5 12 L6.5 10.5 V21 H17.5 V10.5 L19.5 12 L22.5 9.5 L19.5 5 L16 3 C15.2 5 13.8 6 12 6 C10.2 6 8.8 5 8 3 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  record: '<svg class="tabs__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5 H17 V9 C17 12 14.8 14.2 12 14.2 C9.2 14.2 7 12 7 9 Z M7 5.5 H3.5 C3.5 8.5 5 10 7.3 10.3 M17 5.5 H20.5 C20.5 8.5 19 10 16.7 10.3 M12 14.2 V18 M8 20.5 H16 L15 18 H9 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
};

/** 진행 화면 위의 할 일 요약. 처리는 구단 관리 탭에서 한다. */
function renderTodo(g: Game): string {
  const items = agenda(g);
  if (items.length === 0) return '';
  const urgent = items.filter((t) => t.tone === 'bad').length;
  return `<button type="button" class="todo-bar${urgent ? ' is-urgent' : ''}" data-stab="todo">
    <span class="todo-bar__count">${items.length}</span>
    <span class="todo-bar__text">할 일 ${items.length}건${urgent ? ` · 급함 ${urgent}` : ''} — ${esc(items[0]!.text.split('.')[0] as string)}</span>
    <span class="todo-bar__go" aria-hidden="true">›</span>
  </button>`;
}

const TODO_PHASES: Phase[] = ['style', 'focus', 'market', 'winter', 'half1', 'event', 'outcome', 'plan', 'end', 'growth'];

function choiceButton(g: Game, c: Choice, solo: boolean): string {
  const shape = g.phase === 'match' && g.match?.step === 'shape' && SHAPE_IDS.includes(c.id as ShapeId);
  return `<button type="button" class="choice${shape ? ' choice--icon' : ''}${c.tone === 'primary' ? ' choice--primary' : c.tone === 'danger' ? ' choice--danger' : ''}${solo ? ' choice--solo' : ''}${c.club !== undefined ? ' choice--club' : ''}" data-act="${esc(c.id)}"${c.disabled ? ' disabled' : ''}>
    ${c.club !== undefined ? crest(g.clubs[c.club] as Club, 30) : ''}
    ${shape ? miniFor(c.id as ShapeId) : ''}
    <span class="choice__label">${esc(c.label)}</span>
    ${c.detail ? `<span class="choice__detail">${esc(c.detail)}</span>` : ''}
  </button>`;
}

/** 진행 화면 맨 위의 한 줄 현황: 순위, 최근 흐름, 분위기, 예산. 누르면 해당 화면으로 간다. */
function renderPulse(g: Game): string {
  if (!g.job) return '';
  const club = g.clubs[g.job.club] as Club;
  const rows = club.nation ? [] : sortTable(g.tables[club.league] ?? []);
  const at = rows.findIndex((r) => r.club === g.job!.club);
  const row = rows[at];
  const form = row && row.form.length
    ? `<span class="form">${row.form.map((f) => `<span class="form__dot form__dot--${f}">${f === 'W' ? '승' : f === 'D' ? '무' : '패'}</span>`).join('')}</span>`
    : '<span class="muted">개막 전</span>';
  const mood = Math.round(g.morale);
  return `<div class="pulse" role="group" aria-label="팀 현황">
    <button type="button" class="pulse__cell" data-tab="table"><span class="pulse__k">순위</span><span class="pulse__v">${row && row.p > 0 ? `${at + 1}<small>위 / ${rows.length}</small>` : '<small>–</small>'}</span></button>
    <button type="button" class="pulse__cell pulse__cell--form" data-tab="table"><span class="pulse__k">최근</span><span class="pulse__v">${form}</span></button>
    <button type="button" class="pulse__cell" data-stab="club"><span class="pulse__k">분위기</span><span class="pulse__v${mood < 40 ? ' is-bad' : ''}">${mood}</span></button>
    ${g.job.kind === 'club' ? `<button type="button" class="pulse__cell" data-stab="club"><span class="pulse__k">예산</span><span class="pulse__v pulse__v--text">${esc(won(g.job.budget))}</span></button>` : ''}
  </div>`;
}

function renderScene(g: Game): string {
  const s = g.scene;
  const deal = s.blocks.find((b): b is Extract<Block, { kind: 'deal' }> => b.kind === 'deal');
  const visible = s.choices.filter((c) => !c.hidden);
  // 협상 화면에서는 합의 가능성과 제출 버튼을 화면 아래에 붙여, 조건을 바꾸면서 바로 본다.
  const main = deal ? visible.find((c) => c.tone === 'primary') : undefined;
  const rest = visible.filter((c) => c !== main);
  const hub = TODO_PHASES.includes(g.phase) && !deal;
  // 선택지가 하나뿐이면 화면 아래에 붙여 둔다. 긴 글을 끝까지 내리지 않아도 넘어갈 수 있다.
  const lone = !deal && visible.length === 1;
  const list = rest.map((c, i) => `${c.group && c.group !== rest[i - 1]?.group ? `<p class="choices__group">${esc(c.group.trim())}</p>` : ''}${choiceButton(g, c, visible.length === 1)}`).join('');
  return `
    ${hub ? `${renderPulse(g)}${renderTodo(g)}` : ''}
    <article class="scene${deal ? ' scene--deal' : ''}${s.blocks.length && rest.length > 1 ? ' scene--split' : ''}">
      <header class="scene__head">
        <p class="eyebrow">${esc(s.eyebrow)}</p>
        <h2 class="scene__title">${esc(s.title)}</h2>
      </header>
      <div class="scene__body">${s.blocks.map((b) => renderBlock(g, b)).join('')}</div>
      ${lone ? `<div class="dock">${list}</div>` : `<div class="choices${rest.length >= 6 && rest.every((c) => !c.group) ? ' choices--many' : ''}">${list}</div>`}
      ${deal && main ? `<div class="dealbar">${gauge(deal.odds, deal.oddsLabel)}${choiceButton(g, main, false)}</div>` : ''}
    </article>`;
}

/** 경기 준비: 상대, 두 팀의 대형을 올린 전술판, 대형과 전술 고르기, 킥오프를 한 화면에 담는다. */
function renderPrematch(g: Game): string {
  const m = g.match as MatchState;
  const club = g.clubs[g.job!.club] as Club;
  const opp = g.clubs[m.oppId] as Club | undefined;
  const open = m.step === 'shape';
  const shape = open ? formationOf(g) : m.me.shape;
  const style = m.step === 'mode' ? m.me.style : (preStyle ?? g.season.style);
  const a = SHAPES[shape];
  const b = SHAPES[m.opp.shape];
  const weather = WEATHER[m.weather];
  const msg = notice;
  notice = null;
  const shapeNotes = [a.desc, a.cm !== b.cm ? (a.cm > b.cm ? '중원 수적 우위' : '중원 수적 열세') : '', a.cb - b.cf >= 2 ? '문전에 수비 여유' : a.cb - b.cf <= 0 ? '문전 일대일' : ''].filter(Boolean);
  const styleNotes = [STYLES[style].desc, style === g.season.style ? '몸에 밴 전술' : '완성도 절반', fits(style, shape) ? `${a.name}과 잘 맞음` : ''].filter(Boolean);
  // 전술판: 우리는 왼쪽에서 오른쪽으로 공격한다. 자리 좌표(길이 80 기준)를 반쪽 조금 넘게 펼친다.
  const mine = slotsFor(g, shape).map((sl, i) => {
    const p = g.squad[i];
    return `<g transform="translate(${(5 + sl.u * 0.66).toFixed(1)} ${sl.v.toFixed(1)})"><circle r="3.5" fill="${club.colors[0]}" stroke="#0e2218" stroke-width="0.7"/><text class="pre__no" fill="${lightOf(club.colors[0]) ? '#111' : '#fff'}">${p ? p.no : ''}</text></g>`;
  }).join('');
  const theirs = SLOTS[m.opp.shape].map((sl) => `<circle cx="${(100 - sl.u * 0.66).toFixed(1)}" cy="${(68 - sl.v).toFixed(1)}" r="2.6" fill="${opp ? opp.colors[0] : '#c9cdc9'}" stroke="#0e2218" stroke-width="0.6" opacity="0.92"/>`).join('');
  const d = planDials(g);
  const combos = comboState(d, g.squad.map((_, i) => planRole(g, i))).on;
  const orders = [...combos.map((c) => (c.good ? `조합 ${c.name}` : `주의 ${c.name}`)), ...DIALS.filter((x) => d[x.id] !== 0).map((x) => `${x.name} ${x.steps[d[x.id] + 1]}`), ...(d.overlap ? ['풀백 오버래핑'] : [])];
  return `
    <article class="pre">
      <header class="pre__vs">
        <div class="pre__side">${crest(club, 30)}<b>${esc(club.name)}</b><span>${esc(a.name)}</span></div>
        <p class="pre__at"><b>${m.venue === 'home' ? '홈' : m.venue === 'away' ? '원정' : '중립'}</b><span>${esc(weather.name)}</span></p>
        <div class="pre__side pre__side--opp">${opp ? crest(opp, 30) : ''}<b>${esc(m.oppName)}</b><span>${esc(b.name)} · ${esc(STYLES[m.oppUsual].name)}</span></div>
      </header>
      <p class="eyebrow">${esc(m.label)}${weather.note ? ` · ${esc(weather.note)}` : ''}</p>
      ${m.intro ? `<p class="note note--plain">${esc(m.intro)}</p>` : ''}
      ${msg ? `<p class="note note--plain" role="status">${esc(msg)}</p>` : ''}
      <button type="button" class="pre__board" data-stab="xi" aria-label="전술판. 누르면 라인업을 손본다">
        <svg viewBox="0 0 105 68" aria-hidden="true">
          <rect class="pre__turf" width="105" height="68"/>
          <path class="pre__chalk" d="M1 1 H104 V67 H1 Z M52.5 1 V67 M1 13.8 H17.5 V54.2 H1 M104 13.8 H87.5 V54.2 H104 M1 24.8 H6.5 V43.2 H1 M104 24.8 H98.5 V43.2 H104"/>
          <circle class="pre__chalk" cx="52.5" cy="34" r="9.15"/>
          ${theirs}${mine}
        </svg>
        <span class="pre__edit">라인업 손보기 ›</span>
      </button>
      <section class="pre__pick">
        <p class="pre__label">대형<small>${esc(shapeNotes.join(' · '))}</small></p>
        <div class="pre__shapes" role="group" aria-label="대형">
          ${SHAPE_IDS.map((id) => `<button type="button" class="pre__shape${id === shape ? ' is-on' : ''}" data-pre="shape:${id}" aria-pressed="${id === shape}"${open ? '' : ' disabled'}>${miniFor(id)}<span>${esc(SHAPES[id].name)}</span></button>`).join('')}
        </div>
      </section>
      <section class="pre__pick">
        <p class="pre__label">전술<small>${esc(styleNotes.join(' · '))}</small></p>
        <div class="pre__styles" role="group" aria-label="전술">
          ${STYLE_IDS.map((id) => {
            const h = hint(g, m, id, m.oppUsual);
            return `<button type="button" class="pre__style${id === style ? ' is-on' : ''}" data-pre="style:${id}" aria-pressed="${id === style}"${m.step === 'mode' ? ' disabled' : ''}><span>${esc(STYLES[id].name)}</span>${h === '비슷' ? '' : `<i class="pre__hint pre__hint--${h === '유리' ? 'good' : 'bad'}">${h}</i>`}</button>`;
          }).join('')}
        </div>
      </section>
      <p class="pre__orders"><span>팀 지시 · ${orders.length ? esc(orders.join(' · ')) : '모두 보통'}</span><button type="button" class="link" data-stab="tactic">지시와 역할 ›</button></p>
      <div class="dock dock--kick">
        <button type="button" class="choice choice--solo" data-pre="go:live"><span class="choice__label">킥오프 · 보면서 지휘</span></button>
        <div class="dock__row">
          <button type="button" class="choice" data-pre="go:text"><span class="choice__label">빠른 진행</span><span class="choice__detail">글로 1분</span></button>
          <button type="button" class="choice" data-pre="go:auto"${open ? '' : ' disabled'}><span class="choice__label">코치에게 맡긴다</span><span class="choice__detail">자동 진행</span></button>
        </div>
      </div>
    </article>`;
}

/** 밝은 색인지(위에 올릴 글자 색을 정한다). */
function lightOf(hex: string): boolean {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
}

/** 합의 가능성 막대. */
function gauge(odds: number | null, label: string): string {
  if (odds === null) return '';
  const v = Math.round(odds * 100);
  const tone = odds >= 0.6 ? 'good' : odds < 0.35 ? 'bad' : 'plain';
  return `<div class="gauge gauge--${tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" aria-label="${esc(label)}">
    <span class="gauge__label">${esc(label)}</span><span class="gauge__val">${esc(oddsText(odds))} ${v}%</span>
    <span class="gauge__track"><span class="gauge__fill" style="width:${v}%"></span></span>
  </div>`;
}

/** 이적시장 카드 묶음. 탭은 화면 상태(marketTab)로 고른다. */
function renderMarket(tabs: MarketTab[]): string {
  const cur = tabs.find((t) => t.id === marketTab) ?? tabs.find((t) => t.cards.length > 0) ?? tabs[0];
  if (!cur) return '';
  return `<section class="market">
    <div class="mtabs" role="tablist" aria-label="이적시장 구분">${tabs.map((t) => `<button type="button" role="tab" class="mtab${t.id === cur.id ? ' is-on' : ''}${t.id === 'bids' ? ' mtab--alert' : ''}" data-mtab="${esc(t.id)}" aria-selected="${t.id === cur.id}">${esc(t.label)}<span class="mtab__n">${t.cards.length}</span></button>`).join('')}</div>
    ${cur.hint ? `<p class="fine">${esc(cur.hint)}</p>` : ''}
    ${cur.cards.length ? `<ul class="mgrid">${cur.cards.map((c) => marketCard(c)).join('')}</ul>` : '<p class="muted">지금은 없다.</p>'}
  </section>`;
}

function marketCard(c: MarketCard): string {
  const p = c.player;
  const gain = c.gain === undefined ? '' : `<span class="mcard__gain mcard__gain--${c.gain > 0 ? 'up' : c.gain < 0 ? 'down' : 'flat'}" title="같은 포지션 가장 약한 선발 대비">${c.gain > 0 ? '+' : ''}${c.gain}</span>`;
  // 한 장이 두 줄을 넘지 않게: 윗줄에 얼굴, 자리, 이름과 값, OVR. 아랫줄에 꼬리표.
  const body = `
    <span class="mcard__top">${face(p.id, p.nat, 36, undefined, p.name)}<span class="mcard__who"><span class="mcard__name">${spotBadge(p)}${esc(p.name)}</span><span class="mcard__meta">${p.age}세 · ${esc(c.from)}</span></span><span class="mcard__ovr"><span class="mcard__ovrn">${p.ovr + p.temp}</span>${gain}</span></span>
    <span class="mcard__line"><span class="mcard__price">${esc(c.price)}</span>${c.tags.length ? `<span class="mcard__tags">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}</span>
    ${c.status ? `<span class="mcard__status mcard__status--${c.status.tone}">${esc(c.status.text)}</span>` : ''}`;
  return `<li class="mcard${c.status?.tone === 'bad' ? ' is-warn' : ''}">
    ${c.act ? `<button type="button" class="mcard__main" data-act="${esc(c.act)}" aria-label="${esc(`${p.name} 협상`)}">${body}</button>` : `<div class="mcard__main">${body}</div>`}
    ${c.actions?.length ? `<div class="mcard__acts">${c.actions.map((a) => `<button type="button" class="chip${a.tone === 'primary' ? ' chip--primary' : a.tone === 'danger' ? ' chip--danger' : ''}" data-act="${esc(a.act)}"${a.disabled ? ' disabled' : ''}>${esc(a.label)}</button>`).join('')}</div>` : ''}
  </li>`;
}

/** 협상 테이블: 선수 한 줄(누르면 능력치), 상대 요구와 우리 제안의 비교, 돈 계산. */
function renderDeal(b: Extract<Block, { kind: 'deal' }>): string {
  const note = `${b.gain !== undefined ? `주전 대비 ${b.gain > 0 ? '+' : ''}${b.gain} · ` : ''}${b.note}`;
  return `<section class="deal">
    <ul class="plist">${playerRow(b.player, { note })}</ul>
    <div class="dealtable" role="table" aria-label="협상 조건 비교">
      <div class="dealtable__row dealtable__row--head" role="row"><span role="columnheader">조건</span><span role="columnheader">${esc(b.side)}</span><span role="columnheader">우리 제안</span></div>
      ${b.rows.map((r) => `<div class="dealtable__row" role="row"><span class="dealtable__label" role="cell">${esc(r.label)}</span><span class="dealtable__ask" role="cell">${esc(r.ask)}</span><span class="dealtable__offer is-${r.tone}" role="cell">${esc(r.offer)}</span></div>`).join('')}
    </div>
    ${b.money.length ? `<dl class="stats stats--tight">${b.money.map((r) => `<div class="stats__row"><dt>${esc(r.label)}</dt><dd class="${r.tone ? `is-${r.tone}` : ''}">${esc(r.value)}</dd></div>`).join('')}</dl>` : ''}
  </section>`;
}


/** 대형 미리보기: 자리를 세로 경기장 좌표로. */
function miniFor(shape: ShapeId): string {
  return formationMini(SLOTS[shape].map((slot) => ({ x: slot.v / 68, y: 1 - slot.u / 80 })));
}

function renderMatches(items: MatchLine[]): string {
  return `<ul class="matches">${items.map((m) => `
    <li class="matches__row">
      <span class="matches__label">${esc(m.label)}</span>
      <span class="matches__opp">${m.home ? '' : '<span class="muted">원정 </span>'}${esc(m.opp)}${m.note ? ` <span class="muted">${esc(m.note)}</span>` : ''}</span>
      <span class="matches__score">${m.gf}:${m.ga}</span>
      <span class="pill pill--${m.result}">${m.result === 'W' ? '승' : m.result === 'D' ? '무' : '패'}</span>
    </li>`).join('')}</ul>`;
}

function renderTable(g: Game, league: LeagueId): string {
  const rows = sortTable(g.tables[league]);
  const mine = g.job?.club ?? -1;
  if (rows.length === 0) return '<p class="muted">아직 치른 경기가 없다.</p>';
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th class="num">#</th><th>팀</th><th class="num">경기</th><th class="num">승</th><th class="num">무</th><th class="num">패</th><th class="num">득실</th><th class="num">승점</th><th class="table__form">최근 5경기</th></tr></thead>
        <tbody>${rows.map((r, i) => {
          const z = zone(league, i + 1, rows.length);
          const gd = r.gf - r.ga;
          return `<tr class="${r.club === mine ? 'is-mine' : ''}${z === 1 ? ' is-up' : z === -1 ? ' is-down' : ''}">
            <td class="num table__pos">${i + 1}</td><td class="table__team"><span class="team">${crest(g.clubs[r.club] as Club, 14)}${esc((g.clubs[r.club] as Club).name)}</span></td>
            <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
            <td class="num">${gd > 0 ? '+' : ''}${gd}</td><td class="num table__pts">${r.pts}</td>
            <td class="table__form"><span class="form">${r.form.map((f) => `<span class="form__dot form__dot--${f}" title="${f === 'W' ? '승' : f === 'D' ? '무' : '패'}">${f === 'W' ? '승' : f === 'D' ? '무' : '패'}</span>`).join('')}</span></td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

function renderBlock(g: Game, b: Block): string {
  switch (b.kind) {
    case 'score': return `
      <div class="score" role="group" aria-label="점수">
        <span class="score__team${b.mine === 0 ? ' is-mine' : ''}">${b.clubs ? crest(g.clubs[b.clubs[0]] as Club, 22) : ''}${esc(b.home)}</span>
        <span class="score__num">${b.score[0]}<span class="score__sep">:</span>${b.score[1]}</span>
        <span class="score__team score__team--away${b.mine === 1 ? ' is-mine' : ''}">${esc(b.away)}${b.clubs ? crest(g.clubs[b.clubs[1]] as Club, 22) : ''}</span>
        <span class="score__minute">${esc(b.minute)}</span>
      </div>`;
    case 'log': return `<ol class="log">${b.items.map((l) => `
      <li class="log__row log__row--${l.tone}"><span class="log__min">${l.min === 0 ? '시작' : `${Math.min(90, l.min)}'`}</span><span class="log__text">${esc(l.text)}</span></li>`).join('')}</ol>`;
    case 'text': return `<p class="prose">${esc(b.text)}</p>`;
    case 'note': return `<p class="note note--${b.tone}">${esc(b.text)}</p>`;
    case 'stats': return `<dl class="stats${b.rows.length >= 4 && b.rows.every((r) => r.value.length <= 16) ? ' stats--grid' : ''}">${b.rows.map((r) => `<div class="stats__row"><dt>${esc(r.label)}</dt><dd class="${r.tone ? `is-${r.tone}` : ''}">${esc(r.value)}</dd></div>`).join('')}</dl>`;
    case 'matches': return renderMatches(b.items);
    case 'table': return renderTable(g, b.league);
    case 'players': return `<ul class="plist">${b.items.map((it) => playerRow(it.player, { note: it.note, delta: it.delta })).join('')}</ul>`;
    case 'card': return playerCard(b.player, { price: b.price, note: b.note, compare: b.compare });
    case 'market': return renderMarket(b.tabs);
    case 'deal': return renderDeal(b);
    case 'form': return `
      <section class="contract" aria-label="${esc(b.title)}">
        <header class="contract__head"><span class="contract__seal">제안서</span><h3 class="contract__title">${esc(b.title)}</h3></header>
        ${b.rows.map((r) => `
          <div class="contract__row">
            <p class="contract__label">${esc(r.label)}${r.note ? `<span class="contract__note">${esc(r.note)}</span>` : ''}</p>
            ${r.options ? `<div class="chips">${r.options.map((o) => `<button type="button" class="chip${o.on ? ' is-on' : ''}" data-act="${esc(o.id)}" aria-pressed="${o.on}"${o.disabled ? ' disabled' : ''}>${esc(o.label)}</button>`).join('')}</div>` : ''}
            ${r.range ? renderRange(r.label, r.range) : ''}
          </div>`).join('')}
        <p class="contract__sign">구단 대표 ______ &nbsp; 선수 ______</p>
      </section>`;
    case 'feed': return `<ul class="feed">${b.items.map((f) => `
      <li class="feed__item feed__item--${f.tone}"><p class="feed__text">${esc(f.text)}</p><p class="feed__who">${esc(f.who)} · ${esc(f.where)}</p></li>`).join('')}</ul>`;
  }
}

type Range = NonNullable<FormRow['range']>;

/** 화면에 보여 주는 값. 금액은 원 단위 글, 비율은 %. */
function showValue(unit: Range['unit'], v: number): string {
  if (unit === 'money') return won(v);
  if (unit === 'pct') return `${Math.round(v * 100)}%`;
  if (unit === 'pct100') return `${Math.round(v)}%`;
  return `${v}년`;
}

/** 숫자 칸에 넣는 값. 금액은 만 원 단위로, 비율은 %로 입력한다. */
const toInput = (unit: Range['unit'], v: number): number => (unit === 'money' ? Math.round(v * 100) : unit === 'pct' ? Math.round(v * 100) : v);
const fromInput = (unit: Range['unit'], v: number): number => (unit === 'money' ? v / 100 : unit === 'pct' ? v / 100 : v);
const inputUnit = (unit: Range['unit']): string => (unit === 'money' ? '만 원' : unit === 'years' ? '년' : '%');

/** 금액·비율 입력: 슬라이더, 한 눈금씩 움직이는 버튼, 직접 입력 칸. 바꾸면 "id=값"으로 act()에 간다. */
function renderRange(label: string, r: Range): string {
  const id = esc(r.id);
  return `<div class="amount" data-amount="${id}">
    <div class="amount__row">
      <button type="button" class="amount__step" data-step="-1" data-for="${id}" aria-label="${esc(label)} 줄이기">−</button>
      <input type="range" class="amount__range" data-range="${id}" data-unit="${r.unit}" min="${r.min}" max="${r.max}" step="${r.step}" value="${r.value}" aria-label="${esc(label)}">
      <button type="button" class="amount__step" data-step="1" data-for="${id}" aria-label="${esc(label)} 늘리기">+</button>
    </div>
    <label class="amount__direct">
      <span class="amount__out" data-out="${id}">${esc(showValue(r.unit, r.value))}</span>
      <span class="amount__type">직접 입력
        <input type="number" class="amount__input" data-range="${id}" data-unit="${r.unit}" inputmode="decimal" min="${toInput(r.unit, r.min)}" max="${toInput(r.unit, r.max)}" step="any" value="${toInput(r.unit, r.value)}">
        ${inputUnit(r.unit)}</span>
    </label>
  </div>`;
}

/** 슬라이더나 숫자 칸의 값을 확정한다. */
function commitRange(el: HTMLInputElement): void {
  if (!game) return;
  const id = el.dataset.range as string;
  const unit = el.dataset.unit as Range['unit'];
  const slider = root.querySelector<HTMLInputElement>(`input[type="range"][data-range="${CSS.escape(id)}"]`);
  if (!slider) return;
  const min = Number(slider.min);
  const max = Number(slider.max);
  let v = el.type === 'range' ? Number(el.value) : fromInput(unit, Number(el.value));
  if (!Number.isFinite(v)) return;
  v = Math.min(max, Math.max(min, v));
  const y = window.scrollY;
  act(game, `${id}=${Math.round(v * 1000) / 1000}`);
  store(SAVE_KEY, game);
  render();
  window.scrollTo(0, y);
}

/** 슬라이더를 끄는 동안 값 글자만 바꾼다. */
function previewRange(el: HTMLInputElement): void {
  const id = el.dataset.range as string;
  const unit = el.dataset.unit as Range['unit'];
  const out = root.querySelector<HTMLElement>(`[data-out="${CSS.escape(id)}"]`);
  const box = root.querySelector<HTMLInputElement>(`input[type="number"][data-range="${CSS.escape(id)}"]`);
  const v = Number(el.value);
  if (out) out.textContent = showValue(unit, v);
  if (box) box.value = String(toInput(unit, v));
}

function renderTables(g: Game): string {
  const club = g.job ? (g.clubs[g.job.club] as Club) : null;
  const hasIntl = g.tables.intl.length > 0 && !!club?.nation;
  const fallback = club && !club.nation ? club.league : hasIntl ? 'intl' : 'kr5';
  const current: LeagueId = tableLeague && (tableLeague === 'intl' ? hasIntl : !!LEAGUES[tableLeague]) ? tableLeague : fallback;
  const country = current === 'intl' ? 'intl' : countryOf(current);
  const countries = [...(hasIntl ? ['intl'] : []), ...COUNTRY_IDS];
  const tiers = country === 'intl' ? [] : leaguesOf(country as CountryId);
  return `
    <section class="section">
      <p class="eyebrow">${g.year} 시즌${g.round === 0 ? ' · 개막 전' : g.round === 1 ? ' · 전반기 종료' : ' · 시즌 종료'}</p>
      <h2 class="scene__title">${current === 'intl' ? '대표팀 조별 순위' : esc(LEAGUES[current]!.name)}</h2>
      <div class="chips" role="group" aria-label="나라 고르기">
        ${countries.map((id) => `<button type="button" class="chip${id === country ? ' is-on' : ''}" data-country="${id}" aria-pressed="${id === country}">${esc(id === 'intl' ? '대표팀' : COUNTRIES[id as CountryId].name)}</button>`).join('')}
      </div>
      ${tiers.length ? `<div class="chips" role="group" aria-label="리그 고르기">
        ${tiers.map((id) => `<button type="button" class="chip${id === current ? ' is-on' : ''}" data-league="${id}" aria-pressed="${id === current}">${esc(`${LEAGUES[id]!.tier}부 ${LEAGUES[id]!.short}`)}</button>`).join('')}
      </div>` : ''}
      ${renderTable(g, current)}
      ${current !== 'intl' ? `<p class="fine">${esc(zoneNote(current))}</p>` : ''}
    </section>`;
}

function zoneNote(league: string): string {
  const meta = LEAGUES[league]!;
  const top = meta.up ? ko`위 ${meta.promote}팀은 ${LEAGUES[meta.up]!.name}로 승격` : `위 ${meta.conti}팀은 다음 시즌 대륙 대회 진출`;
  const drop = dropCount(league);
  return `${meta.blurb}. ${top}${drop > 0 ? `, 아래 ${drop}팀은 강등` : ''}. 감독 자격: ${licenseName(meta.license, meta.country)}. ${quotaOf(league).note}.`;
}

/** 할 일 한 줄과 바로 처리하는 버튼들. */
function todoItem(t: ReturnType<typeof agenda>[number]): string {
  return `<li class="todo__item todo__item--${t.tone}">
    <span>${esc(t.text)}</span>
    ${t.actions?.length ? `<span class="todo__acts">${t.actions.map((a) => `<button type="button" class="chip${a.disabled ? '' : ' chip--primary'}" data-todo="${esc(a.id)}"${a.disabled ? ' disabled' : ''}>${esc(a.label)}</button>`).join('')}</span>` : `<span class="todo__where">${esc(t.where)}</span>`}
  </li>`;
}

function renderSquad(g: Game): string {
  if (!g.job) return '<p class="prose">아직 맡은 팀이 없다. 구직 화면에서 지원서를 낸다.</p>';
  const club = g.clubs[g.job.club] as Club;
  const r = ratings(g, depthOf(g));
  const a = g.manager.attrs;
  const { level, money } = stage(g);
  const nation = club.nation;
  const shape = formationOf(g);
  const extra = (p: Player): string[] => [
    ...(nation ? [] : [`계약|${contractText(g, p.contract)}`, `시장가|${won(valueOf(p, level, money))}`]),
    `성장|${potentialText(g, p)}`,
    ...(inEngland(g) ? [`잉글랜드 규정|${p.nat} · ${englandText(g, p)}`] : p.nat !== localNat(g) ? [`국적|${p.nat}${isForeign(g, p) ? ' · 쿼터에 든다' : ''}`] : []),
    `이번 시즌|${p.goals}골 · 팀에서 ${p.years + 1}번째 시즌${p.homegrown ? ' · 유스 출신' : ''}`,
  ];
  const flags = (p: Player): string[] => [p.unhappy ? '불만' : '', p.contract && p.contract.years <= 1 && !p.loan ? '만료 임박' : '', p.loan?.dir === 'in' ? '임대' : '', isForeign(g, p) ? quotaWord(g) : '', !promiseKept(g, p) ? '약속 위반' : ''].filter(Boolean);
  const q = quota(g);
  const msg = notice;
  notice = null;
  const busy = lineupLocked(g);
  const items = agenda(g);
  const view: SquadTab = squadTab ?? (items.length ? 'todo' : 'xi');
  const pickSlot = squadPick?.kind === 'slot' ? squadPick.at : -1;
  const pickRes = squadPick?.kind === 'res' ? squadPick.id : -1;
  const target = pickSlot >= 0 ? lineAt(g, pickSlot) : null;

  // 선발 열한 명을 대형의 자리대로 세로 경기장 위에 세운다. 누르면 고르고, 다른 자리나 후보를 누르면 맞바꾼다.
  const slotsNow = slotsFor(g, shape);
  const token = (p: Player, i: number): string => {
    const line = lineAt(g, i);
    const sl = slotsNow[i]!;
    const pen = posPenalty(p.spot, line);
    const v = effOvr(p, line) + p.temp;
    const x = 6 + (sl.v / 68) * 88;
    const y = 94 - (sl.u / 80) * 88;
    const fl = flags(p);
    const hint = pickRes >= 0 ? (() => {
      const rp = g.reserves.find((q) => q.id === pickRes);
      return rp ? `<span class="xi-tok__hint">${effOvr(rp, line) + rp.temp}</span>` : '';
    })() : '';
    return `<button type="button" class="xi-tok${i === pickSlot ? ' is-picked' : ''}${pickSlot >= 0 && i !== pickSlot ? ' is-target' : ''}${pen ? ' is-off' : ''}${fl.length ? ' is-warn' : ''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" data-lineup="s:${i}"${busy ? ' disabled' : ` data-drag="s:${i}" data-drop="s:${i}"`} aria-label="${esc(`${spotAt(g, i)} 자리 ${p.name} OVR ${v}${pen ? ` 포지션 밖 -${pen}` : ''}${fl.length ? ` ${fl.join(', ')}` : ''}`)}">
      ${face(p.id, p.nat, 34, club.colors, p.name)}
      <span class="xi-tok__ovr">${v}</span>
      <span class="xi-tok__name">${esc(p.name.includes(' ') ? (p.nat === '일본' ? p.name.split(' ')[0] as string : p.name.split(' ').pop() as string) : p.name)}</span>
      <span class="xi-tok__spot">${spotAt(g, i)}${pen ? ` <b>-${pen}</b>` : ''}</span>
      ${hint}
    </button>`;
  };
  const resCard = (p: Player): string => {
    const canPlay = !p.loan || p.loan.dir === 'in';
    const there = target ? effOvr(p, target) + p.temp : null;
    return `<button type="button" class="bench-card${p.id === pickRes ? ' is-picked' : ''}" data-lineup="r:${p.id}"${busy || !canPlay ? ' disabled' : ` data-drag="r:${p.id}" data-drop="res:${p.id}"`}>
      ${busy || !canPlay ? '' : '<span class="drag-handle" aria-hidden="true">⠿</span>'}
      ${face(p.id, p.nat, 34, club.colors, p.name)}
      <span class="bench-card__who"><span class="bench-card__name">${esc(p.name)}</span><span class="bench-card__meta">${p.spot} · ${p.age}세 · ${PROMISES[p.contract?.promise ?? 'backup'].name}${flags(p).length ? ` · ${esc(flags(p).join(' · '))}` : ''}</span></span>
      <span class="bench-card__ovr">${there !== null ? `<small>${target}에서</small>${there}` : p.ovr + p.temp}</span>
    </button>`;
  };

  const names: [SquadTab, string][] = [['todo', '할 일'], ['xi', '라인업'], ['tactic', '전술'], ['players', '선수'], ['club', '구단']];
  const head = `
      <dl class="teamrate" aria-label="팀 지표">
        <div><dt>ATT</dt><dd>${Math.round(r.att)}</dd></div>
        <div><dt>MID</dt><dd>${Math.round(r.mid)}</dd></div>
        <div><dt>DEF</dt><dd>${Math.round(r.def)}</dd></div>
        <div><dt>뎁스</dt><dd>${Math.round(depthOf(g))}</dd></div>
      </dl>
      <div class="subtabs" role="tablist" aria-label="구단 관리">
        ${names.map(([id, label]) => `<button type="button" role="tab" class="subtabs__item${id === view ? ' is-on' : ''}" data-stab="${id}" aria-selected="${id === view}">${label}${id === 'todo' && items.length ? `<i>${items.length}</i>` : ''}</button>`).join('')}
      </div>
      ${msg ? `<p class="note note--plain" role="status">${esc(msg)}</p>` : ''}`;

  let body = '';
  if (view === 'todo') {
    body = `
      ${items.length ? `<ul class="todo__list todo__list--open">${items.map(todoItem).join('')}</ul>` : '<p class="muted">지금 챙길 일이 없다.</p>'}
      ${nation ? '' : `<div class="xi-actions">${marketOpenNow(g) ? '<button type="button" class="chip" data-todo="market:sign">영입 후보 보기</button><button type="button" class="chip" data-todo="market:mine">판매 · 임대 · 해지</button>' : '<span class="fine">영입, 판매, 임대, 재계약은 여름·겨울 이적시장에서 한다.</span>'}</div>`}`;
  } else if (view === 'xi') {
    body = `
      <div class="shape-row" role="group" aria-label="대형">
        ${SHAPE_IDS.map((id) => `<button type="button" class="chip${id === shape ? ' is-on' : ''}" data-todo="formation:${id}" aria-pressed="${id === shape}"${busy ? ' disabled' : ''}>${esc(SHAPES[id].name)}</button>`).join('')}
      </div>
      <div class="xi-actions">
        <button type="button" class="chip chip--primary" data-todo="auto"${busy ? ' disabled' : ''}>가장 강한 배치로</button>
        ${g.tweaks?.[shape] ? `<button type="button" class="chip" data-todo="reset"${busy ? ' disabled' : ''}>자리 되돌리기</button>` : ''}
        ${squadPick ? '<button type="button" class="chip" data-lineup="clear">선택 취소</button>' : ''}
      </div>
      <div class="xi-wrap">
        <div class="xi-pitch" role="group" aria-label="선발 11명"${busy ? '' : ' data-drop="pitch"'}>
          <svg class="xi-pitch__lines" viewBox="0 0 68 86" preserveAspectRatio="none" aria-hidden="true">
            <rect x="1" y="1" width="66" height="84" fill="none"/><line x1="1" y1="43" x2="67" y2="43"/><circle cx="34" cy="43" r="7"/>
            <rect x="14" y="1" width="40" height="13" fill="none"/><rect x="14" y="72" width="40" height="13" fill="none"/>
          </svg>
          ${g.squad.map(token).join('')}
        </div>
        <div class="xi-side">
          <p class="fine">${busy ? '경기 중에는 경기 화면에서 바꾼다.' : squadPick ? '바꿀 상대(다른 자리나 후보)를 누른다. 같은 칸을 다시 누르면 취소.' : '선수를 끌어 빈 잔디에 놓으면 그 자리로 옮기고, 다른 선수 위에 놓으면 맞바꾼다. 눌러서 고른 뒤 상대를 눌러도 된다.'}</p>
          ${nation ? '' : `
          <h3 class="section__sub">후보 ${g.reserves.length}/${RESERVE_LIMIT}${q.reg !== null || q.pitch !== null ? ` <span class="muted">${quotaWord(g)} 등록 ${foreignCount(g, [...g.squad, ...g.reserves])}${q.reg !== null ? `/${q.reg}` : ''} · 선발 ${foreignCount(g, g.squad)}/${q.pitch ?? '-'}</span>` : ''}${inEngland(g) ? ` <span class="muted">비홈그로운 ${englandStatus(g).nonHg}/${NON_HG_LIMIT} · ESC ${englandStatus(g).esc}/${ESC_SLOTS}</span>` : ''}</h3>
          ${g.reserves.length === 0 ? '<p class="muted">후보 명단이 비어 있다. 이적시장에서 백업이나 로테이션으로 영입하면 여기에 들어온다.</p>' : `<div class="bench-grid"${busy ? '' : ' data-drop="reserves"'}>${g.reserves.map(resCard).join('')}</div>`}`}
        </div>
      </div>`;
  } else if (view === 'tactic') {
    const d = planDials(g);
    const at = Math.min(Math.max(0, rolePick), g.squad.length - 1);
    const who = g.squad[at];
    const seg = (label: string, desc: string, opts: [string, string, boolean][]): string => `<div class="seg"><p class="seg__label">${esc(label)}<small>${esc(desc)}</small></p><div class="seg__opts" role="group" aria-label="${esc(label)}">${opts.map(([cmd, text, on]) => `<button type="button" class="seg__opt${on ? ' is-on' : ''}" data-todo="${cmd}" aria-pressed="${on}"${busy ? ' disabled' : ''}>${esc(text)}</button>`).join('')}</div></div>`;
    const roles = who ? ROLES[spotAt(g, at)] : [];
    const mineRole = who ? planRole(g, at) : '';
    const combo = comboState(d, g.squad.map((_, i) => planRole(g, i)));
    const count = (id: DialPhase): number => DIALS.filter((x) => x.phase === id && d[x.id] !== 0).length + (id === 'att' && d.overlap ? 1 : 0);
    body = `
      ${busy ? '<p class="note note--plain">경기 중에는 경기 화면의 지시 탭에서 바꾼다.</p>' : ''}
      <div class="tac">
        <section class="tac__col">
          <h3 class="section__sub">팀 지시 <span class="muted">경기마다 이대로 시작한다</span></h3>
          <div class="phases" role="tablist" aria-label="국면">
            ${PHASES.map((x) => `<button type="button" role="tab" class="phases__tab${x.id === planPhase ? ' is-on' : ''}" data-phase="${x.id}" aria-selected="${x.id === planPhase}"><b>${esc(x.name)}${count(x.id) ? `<i>${count(x.id)}</i>` : ''}</b><small>${esc(x.desc)}</small></button>`).join('')}
          </div>
          <div class="combos" aria-label="조합">
            ${combo.on.length + combo.near.length === 0 ? '<span class="muted">걸린 조합이 없다. 지시를 서로 맞물리면 조합이 걸린다.</span>' : ''}
            ${combo.on.map((c) => `<span class="combo combo--${c.good ? 'good' : 'bad'}">${c.good ? '' : '주의 '}${esc(c.name)}</span>`).join('')}
            ${combo.near.slice(0, 3).map(({ combo: c, missing, fix }) => (fix
              ? `<button type="button" class="combo combo--near" data-todo="dial:${fix.dial}.${fix.level}"${busy ? ' disabled' : ''}>${esc(c.name)}<small>+ ${esc(missing)}</small></button>`
              : `<span class="combo combo--near">${esc(c.name)}<small>+ ${esc(missing)}</small></span>`)).join('')}
          </div>
          ${combo.on.map((c) => `<p class="fine${c.good ? '' : ' fine--bad'}"><b>${esc(c.name)}</b> ${esc(c.text)}</p>`).join('')}
          <div class="segs">
            ${DIALS.filter((x) => x.phase === planPhase).map((x) => seg(x.name, x.desc, x.steps.map((t, k): [string, string, boolean] => [`dial:${x.id}.${k - 1}`, t, d[x.id] === k - 1]))).join('')}
            ${planPhase === 'att' ? seg('풀백', '오버래핑하면 측면 공격이 늘고 뒷공간이 빈다', [['dial:overlap.0', '자리 지킴', !d.overlap], ['dial:overlap.1', '오버래핑', d.overlap]]) : ''}
          </div>
          <div class="xi-actions">
            <button type="button" class="chip chip--primary" data-todo="dial:preset"${busy ? ' disabled' : ''}>코치 추천(${esc(STYLES[g.season.style].name)})</button>
            <button type="button" class="chip" data-todo="dial:reset"${busy ? ' disabled' : ''}>모두 보통으로</button>
          </div>
        </section>
        <section class="tac__col">
          <h3 class="section__sub">개인 역할 <span class="muted">선수를 누르고 역할을 고른다</span></h3>
          <div class="rolegrid">
            ${g.squad.map((p, i) => `<button type="button" class="rolegrid__man${i === at ? ' is-on' : ''}" data-role="${i}" aria-pressed="${i === at}"><b>${spotAt(g, i)}</b><span>${esc(p.name)}</span><small>${esc(ROLES[spotAt(g, i)].find((x) => x.id === planRole(g, i))?.name ?? '')}</small></button>`).join('')}
          </div>
          ${who ? `<div class="rolebox">
            <p class="rolebox__who">${face(who.id, who.nat, 30, club.colors, who.name)}<b>${esc(who.name)}</b><span class="muted">${spotAt(g, at)} · OVR ${effOvr(who, lineAt(g, at)) + who.temp}</span></p>
            <div class="chips" role="group" aria-label="역할">
              ${roles.map((x) => `<button type="button" class="chip${x.id === mineRole ? ' is-on' : ''}" data-todo="role:${who.id}.${x.id}" aria-pressed="${x.id === mineRole}"${busy ? ' disabled' : ''}>${esc(x.name)}</button>`).join('')}
            </div>
            <p class="fine">${esc(roles.find((x) => x.id === mineRole)?.desc ?? '')}</p>
          </div>` : ''}
        </section>
      </div>`;
  } else if (view === 'players') {
    body = `
      <ul class="plist">${[...g.squad, ...g.reserves].map((p) => playerRow(p, {
        note: `${g.squad.includes(p) ? '선발' : '후보'} · ${POS_NAME[p.pos]}${p.contract ? ` · ${PROMISES[p.contract.promise].name}` : ''}`, extra: extra(p), kit: club.colors, flag: flags(p).join(' · ') || undefined,
      })).join('')}</ul>
      ${g.loaned.length ? `<p class="fine">임대 보낸 선수: ${g.loaned.map((p) => `${esc(p.name)}(${esc(p.loan!.club)}, ${p.loan!.until === 'winter' ? '겨울 복귀' : '시즌 끝 복귀'})`).join(', ')}</p>` : ''}`;
  } else {
    body = `
      <dl class="stats stats--grid">
        <div class="stats__row"><dt>몸에 밴 전술</dt><dd>${g.lastStyle ? esc(STYLES[g.lastStyle].name) : '미정'}</dd></div>
        <div class="stats__row"><dt>전술 완성도</dt><dd>${Math.round(g.cohesion)}</dd></div>
        <div class="stats__row"><dt>라커룸 분위기</dt><dd>${Math.round(g.morale)}</dd></div>
        ${g.job.kind === 'club' ? `<div class="stats__row"><dt>이적 예산</dt><dd>${esc(won(g.job.budget))}</dd></div>
        <div class="stats__row"><dt>연봉 총액</dt><dd>${g.job.wageBudget > 0 ? esc(won(totalWages(g))) : '무급'}</dd></div>
        <div class="stats__row"><dt>연봉 예산</dt><dd>${g.job.wageBudget > 0 ? esc(won(g.job.wageBudget)) : '아마추어'}</dd></div>` : ''}
      </dl>
      <h3 class="section__sub">${esc(g.manager.name)} 감독의 지도자 역량</h3>
      <dl class="stats">${ATTR_IDS.map((id) => `
        <div class="stats__row"><dt>${esc(ATTRS[id].name)}</dt><dd><span class="meter" aria-hidden="true"><span class="meter__fill" style="width:${a[id] * 5}%"></span></span>${a[id]}</dd></div>`).join('')}
      </dl>`;
  }
  return `
    <section class="section section--squad" data-view="${view}">
      ${head}
      ${body}
    </section>`;
}

const marketOpenNow = (g: Game): boolean => (g.phase === 'market' || g.phase === 'winter') && !!g.window;

/** 맡은 팀 나라의 국적. */
const localNat = (g: Game): string => (g.job && !(g.clubs[g.job.club] as Club).nation ? COUNTRIES[countryOf((g.clubs[g.job.club] as Club).league)].name : '대한민국');

function renderRecord(g: Game): string {
  return `
    <section class="section">
      <p class="eyebrow">${esc(g.manager.name)} · ${esc(BACKGROUNDS[g.manager.background].name)}</p>
      <h2 class="scene__title">커리어 기록</h2>
      <dl class="stats">
        <div class="stats__row"><dt>커리어 점수</dt><dd>${legacyScore(g)} · ${esc(legacyTitle(legacyScore(g)))}</dd></div>
        <div class="stats__row"><dt>트로피</dt><dd>${g.trophies.length}개</dd></div>
        <div class="stats__row"><dt>승격</dt><dd>${g.promotions}회</dd></div>
        <div class="stats__row"><dt>최고 명성</dt><dd>${Math.round(g.manager.peakRep)}</dd></div>
        <div class="stats__row"><dt>지도자 자격</dt><dd>${esc(licenseName(g.manager.license))}${g.manager.course ? ` · ${esc(licenseName(g.manager.course.level))} 강습 중` : ''}</dd></div>
        ${g.manager.idle ? `<div class="stats__row"><dt>감독 자리 없이</dt><dd>${g.manager.idle}시즌(코치)</dd></div>` : ''}
      </dl>
      ${g.trophies.length > 0 ? `<ul class="trophies">${g.trophies.map((t) => `<li><span class="trophies__year">${t.year}</span> ${esc(t.club)} · ${esc(t.name)}</li>`).join('')}</ul>` : ''}
    </section>
    <section class="section">
      <h2 class="section__title">시즌별 성적</h2>
      ${g.history.length === 0 ? '<p class="muted">첫 시즌을 마치면 여기에 기록이 쌓인다.</p>' : `
      <div class="table-wrap"><table class="table">
        <thead><tr><th class="num">연도</th><th>팀</th><th>무대</th><th class="num">순위</th><th>비고</th></tr></thead>
        <tbody>${[...g.history].reverse().map((h) => `
          <tr class="${h.outcome === 'title' || h.outcome === 'up' ? 'is-up' : h.outcome === 'down' || h.outcome === 'sacked' ? 'is-down' : ''}">
            <td class="num">${h.year}</td><td class="table__team">${esc(h.club)}</td><td>${esc(h.league)}</td><td class="num">${h.pos}</td><td>${esc([h.note, h.cup].filter(Boolean).join(' · '))}</td>
          </tr>`).join('')}</tbody>
      </table></div>`}
    </section>
    <section class="section">
      ${confirmReset
        ? `<p class="note note--bad">지금 커리어를 지우고 처음부터 시작한다. 되돌릴 수 없다.</p>
           <div class="choices"><button type="button" class="choice choice--danger" data-do="reset"><span class="choice__label">지우고 새로 시작</span></button>
           <button type="button" class="choice" data-do="keep"><span class="choice__label">계속한다</span></button></div>`
        : `<button type="button" class="link" data-do="reset">이 커리어를 그만두고 새로 시작</button>`}
    </section>`;
}
