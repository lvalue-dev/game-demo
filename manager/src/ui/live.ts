// 실시간 경기 화면. 위에서 내려다본 경기장을 캔버스에 그리고, 배속에 맞춰 liveTick을 부른다.
// 경기장은 한 번만 만들고, 점수, 시계, 기록, 지시 패널만 바꿔 그린다.
import { STYLES, STYLE_IDS, POS_NAME } from '../game/data.ts';
import { PER_MIN, SLOTS } from '../game/live.ts';
import { liveAdvice, liveCommand, liveTick, staminaText } from '../game/match.ts';
import { ROLES, SHAPES, SHAPE_IDS } from '../game/tactics.ts';
import type { Club, Game, LivePlayer, LiveState, MatchState, Pos } from '../game/types.ts';

export interface LiveHost {
  /** 진행 상황을 저장한다. */
  save(): void;
  /** 경기가 끝났다. 결과 화면으로 넘어간다. */
  done(): void;
}

type Panel = 'team' | 'players' | 'bench';

/** 1배속에서 1초에 진행하는 틱 수. 1틱은 경기 시간 3초다. */
const BASE_TPS = 6;
const SPEEDS = [1, 2, 4, 8];

let game: Game | null = null;
let host: LiveHost | null = null;
let raf = 0;
let paused = true;
let speed = 2;
let panel: Panel = 'team';
let selected = -1;
let acc = 0;
let last = 0;
let lastSave = 0;
let seenLog = 0;
let flash: { text: string; until: number; good: boolean } | null = null;
let canvas: HTMLCanvasElement | null = null;
let colors: [string, string] = ['#ffffff', '#222222'];

const esc = (text: string | number): string => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

export const isLive = (g: Game | null): boolean => !!g && g.phase === 'match' && g.match?.step === 'live' && !!g.match.live;

// ---------- 색 ----------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const gap = (a: string, b: string): number => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

const light = (hex: string): boolean => {
  const [r, g, b] = rgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
};

const GRASS = '#2f8a52';

/** 두 팀의 유니폼 색. 잔디와 비슷하거나 서로 비슷하면 다른 색으로 바꿔 입는다. */
function kits(g: Game, m: MatchState): [string, string] {
  const mine = g.clubs[g.job!.club] as Club;
  const theirs = g.clubs[m.oppId] as Club | undefined;
  const choose = (club: Club | undefined, avoid: string | null): string => {
    const options = club ? [...club.colors, '#ffffff', '#1d1d1d'] : ['#ffffff', '#1d1d1d'];
    return options.find((c) => gap(c, GRASS) > 110 && (!avoid || gap(c, avoid) > 140)) ?? (avoid && light(avoid) ? '#1d1d1d' : '#ffffff');
  };
  const a = choose(mine, null);
  return [a, choose(theirs, a)];
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
        <span class="score__team is-mine">${esc(mine)}</span>
        <span class="score__num" id="live-score"></span>
        <span class="score__team score__team--away">${esc(m.oppName)}</span>
        <span class="score__minute" id="live-clock"></span>
      </div>
      <div class="live__field">
        <canvas class="live__pitch" id="live-pitch" role="img" aria-label="경기장. 우리 팀은 오른쪽으로 공격한다"></canvas>
        <p class="live__flash" id="live-flash" aria-live="assertive"></p>
      </div>
      </div>
      <div class="live__controls">
        <button type="button" class="live__play" data-live-do="play" id="live-play"></button>
        <div class="live__speeds" role="group" aria-label="배속">
          ${SPEEDS.map((s) => `<button type="button" class="chip" data-live-do="speed:${s}" aria-pressed="false">${s}×</button>`).join('')}
        </div>
      </div>
      <dl class="live__stats" id="live-stats"></dl>
      <ol class="log live__ticker" id="live-ticker" aria-live="polite"></ol>
      <div class="live__tabs" role="tablist" aria-label="지시">
        ${([['team', '팀 전술'], ['players', '선수 지시'], ['bench', '교체 · 태세']] as [Panel, string][]).map(([id, label]) =>
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
  colors = kits(g, m);
  seenLog = m.log.length;
  paused = true;
  acc = 0;
  last = performance.now();
  lastSave = last;
  updateHud(true);
  updatePanel();
  raf = requestAnimationFrame(frame);
}

export function unmountLive(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (game && host && isLive(game)) host.save();
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
      draw(0);
    }
    return true;
  }
  if (cmd) {
    const wasHalf = halftime(g);
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
        panel = 'team';
        host?.save();
        updatePanel();
        break;
      }
    }
  }
  if (ticked) updateHud(false);
  if (m.step !== 'live') {
    // 경기 끝. 마지막 장면을 잠깐 보여 준 뒤 결과 화면으로 간다.
    draw(1);
    const h = host;
    raf = 0;
    setTimeout(() => h?.done(), 900);
    return;
  }
  if (!paused && now - lastSave > 10000) {
    lastSave = now;
    host?.save();
  }
  draw(paused ? 1 : Math.min(1, acc));
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
    stats.innerHTML = `
      <div><dt>점유율</dt><dd>${Math.round((a.possession / total) * 100)}<span class="muted"> : ${Math.round((b.possession / total) * 100)}</span></dd></div>
      <div><dt>슈팅(유효)</dt><dd>${a.shots}(${a.onTarget})<span class="muted"> : ${b.shots}(${b.onTarget})</span></dd></div>
      <div><dt>패스 성공</dt><dd>${a.passes ? Math.round((a.passesOk / a.passes) * 100) : 0}%</dd></div>
      <div><dt>우리 체력</dt><dd class="${m.me.stamina < 45 ? 'is-bad' : ''}"><span class="meter" aria-hidden="true"><span class="meter__fill" style="width:${Math.round(m.me.stamina)}%"></span></span>${Math.round(m.me.stamina)}</dd></div>`;
  }
  // 새 기록이 생겼으면 위로 쌓고, 골이면 경기장 위에 크게 띄운다.
  if (m.log.length > seenLog || full) {
    for (const line of m.log.slice(seenLog)) {
      if (line.tone !== 'plain' && /골|득점|실점|성공시켰|넣었|마무리|흔들었|헤더/.test(line.text)) {
        flash = { text: line.tone === 'good' ? '골!' : '실점', until: performance.now() + 1600, good: line.tone === 'good' };
      }
    }
    seenLog = m.log.length;
    const ticker = $('#live-ticker');
    if (ticker) {
      const recent = m.log.slice(-4).reverse();
      ticker.innerHTML = recent.length === 0
        ? '<li class="log__row"><span class="log__min">시작</span><span class="log__text muted">경기장을 보며 지시를 내린다. 아래 재생 버튼을 누르면 킥오프.</span></li>'
        : recent.map((l) => `<li class="log__row log__row--${l.tone}"><span class="log__min">${l.min === 0 ? '시작' : `${Math.min(90, l.min)}'`}</span><span class="log__text">${esc(l.text)}</span></li>`).join('');
    }
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

// ---------- 지시 패널 ----------

const chip = (cmd: string, label: string, on: boolean, disabled = false, extra = ''): string =>
  `<button type="button" class="chip${on ? ' is-on' : ''}" data-live="${esc(cmd)}" aria-pressed="${on}"${disabled ? ' disabled' : ''}>${esc(label)}${extra}</button>`;

function row(title: string, body: string, note = ''): string {
  return `<div class="live__row"><p class="live__label">${esc(title)}${note ? ` <span class="muted">${esc(note)}</span>` : ''}</p><div class="chips">${body}</div></div>`;
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
      <p class="prose">${lead > 0 ? '앞선 채로 들어왔다. 선수들이 감독을 본다.' : lead < 0 ? '뒤진 채로 들어왔다. 라커룸이 조용하다.' : '팽팽한 채로 들어왔다. 선수들이 감독을 본다.'} 말을 마치면 후반이 시작된다. 전술과 지시는 후반 중에도 바꿀 수 있다.</p>
      <div class="choices">
        <button type="button" class="choice" data-live="talk:praise"><span class="choice__label">잘하고 있다고 다독인다</span><span class="choice__detail">리더십 판정. 비기거나 한 골 뒤질 때 잘 통한다</span></button>
        <button type="button" class="choice" data-live="talk:blast"><span class="choice__label">물병을 걷어찬다</span><span class="choice__detail">리더십 판정. 통하면 크게 살아나고, 안 통하면 얼어붙는다</span></button>
        <button type="button" class="choice" data-live="talk:calm"><span class="choice__label">후반 계획만 짚는다</span><span class="choice__detail">확실한 작은 효과. 후반 초반의 전술 변경에 혼선이 없다</span></button>
      </div>`;
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
      }).join(''), m.me.style === g.season.style ? '몸에 밴 전술' : '숙련도 절반')}
      ${row('수비 라인', chip('line:-1', '내린다', d.line === -1) + chip('line:0', '보통', d.line === 0) + chip('line:1', '올린다', d.line === 1), '올리면 뒷공간이 빈다')}
      ${row('폭', chip('width:-1', '좁게', d.width === -1) + chip('width:0', '보통', d.width === 0) + chip('width:1', '넓게', d.width === 1))}
      ${row('템포', chip('tempo:-1', '느리게', d.tempo === -1) + chip('tempo:0', '보통', d.tempo === 0) + chip('tempo:1', '빠르게', d.tempo === 1), '빠르면 체력이 더 든다')}
      ${row('풀백 오버래핑', chip('overlap:0', '자리 지킴', !d.overlap) + chip('overlap:1', '올라간다', d.overlap))}
      ${row('대형', SHAPE_IDS.map((id) => chip(`shape:${id}`, SHAPES[id].name, m.me.shape === id, m.subs < 1 && m.me.shape !== id)).join(''), `교체 카드 1장 · 상대 ${SHAPES[m.opp.shape].name}`)}`;
  } else if (panel === 'players') {
    const players = L.teams[0].players;
    box.innerHTML = `
      ${confused}
      <p class="fine">이름을 누르면 경기장에서 그 선수가 표시된다. 후보 넷은 개인 지시 없이 뛴다.</p>
      <ul class="live__people">${g.squad.map((p) => {
        const i = players.findIndex((x) => x.key === p.id);
        const lp = players[i];
        const role = m.roles[p.id] ?? 'base';
        const slot = lp ? SLOTS[m.me.shape][lp.slot] : undefined;
        const where = slot ? (slot.line === p.pos ? '' : ` · ${POS_NAME[slot.line]} 자리`) : '';
        return `
          <li class="live__person${i === selected ? ' is-picked' : ''}">
            <button type="button" class="live__who" data-live-do="pick:${i}" aria-pressed="${i === selected}">
              <span class="live__num" style="--kit:${colors[0]};--kit-ink:${light(colors[0]) ? '#111' : '#fff'}">${lp ? lp.n : '-'}</span>
              <span class="live__name">${esc(p.name)}<span class="muted"> ${POS_NAME[p.pos]}${esc(where)}${lp?.off ? ' · 퇴장' : ''}</span></span>
              <span class="players__ovr">${p.ovr + p.temp}</span>
            </button>
            <div class="chips">${ROLES[p.pos as Pos].map((r) => chip(`role:${p.id}:${r.id}`, r.name, role === r.id, !!lp?.off)).join('')}</div>
            <p class="fine">${esc(ROLES[p.pos as Pos].find((r) => r.id === role)?.desc ?? '')}</p>
          </li>`;
      }).join('')}</ul>`;
  } else {
    box.innerHTML = `
      ${confused}
      ${row('교체', [
        chip('sub:fw', '공격수 투입', false, m.subs < 1),
        chip('sub:mf', '미드필더 투입', false, m.subs < 1),
        chip('sub:df', '수비수 투입', false, m.subs < 1),
        chip('sub:legs', '지친 선수 둘 교체', false, m.subs < 2),
      ].join(''), `남은 카드 ${m.subs}장`)}
      <p class="fine">우리 체력 ${Math.round(m.me.stamina)} · ${esc(staminaText(m.me.stamina))}. 상대 체력은 ${esc(staminaText(m.opp.stamina))}. 지친 뒤에 넣을수록 교체 효과가 크고, 70분이 넘으면 효과를 낼 시간이 짧다.</p>
      ${row('태세', chip('push:-1', '잠근다', m.me.push === -1) + chip('push:0', '균형', m.me.push === 0) + chip('push:1', '총공세', m.me.push === 1), '막판의 승부수')}
      <p class="fine">상대 감독은 30분, 하프타임, 60분, 75분에 움직인다.${m.opp.push === 1 ? ' 지금 상대는 총공세다.' : m.opp.push === -1 ? ' 지금 상대는 잠그고 있다.' : ''}</p>`;
  }
}

// ---------- 경기장 ----------

function draw(frac: number): void {
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

  // 잔디와 줄.
  ctx.fillStyle = '#2a7d4a';
  ctx.fillRect(0, 0, cssW, cssH);
  for (let k = 0; k < 14; k += 2) {
    ctx.fillStyle = '#2f8a52';
    ctx.fillRect(X((105 / 14) * k), Y(0), (105 / 14) * s, 68 * s);
  }
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
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(Math.min(X(x0), X(x0 - dir * 1.2)), Y(30.34), 1.2 * s, 7.32 * s);
  }
  // 공격 방향.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 ${Math.max(10, s * 2.2)}px 'Barlow Condensed', system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('공격 →', X(1.5), Y(1));

  const lerp = (a: number, b: number): number => a + (b - a) * frac;
  const r = Math.max(6.5, s * 1.75);
  const owner = L.owner;
  for (const t of [1, 0] as const) {
    const kit = colors[t] as string;
    const ink = light(kit) ? '#111' : '#fff';
    L.teams[t].players.forEach((p: LivePlayer, i) => {
      if (p.off) return;
      const x = X(lerp(p.px, p.x));
      const y = Y(lerp(p.py, p.y));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.line === 'GK' ? (t === 0 ? '#f2c230' : '#b78cf0') : kit;
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.22);
      ctx.strokeStyle = owner && owner.team === t && owner.i === i ? '#ffe14a' : 'rgba(0,0,0,0.55)';
      ctx.stroke();
      if (t === 0 && i === selected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffe14a';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (r >= 6) {
        ctx.fillStyle = p.line === 'GK' ? '#111' : ink;
        ctx.font = `700 ${Math.round(r * 1.15)}px 'Barlow Condensed', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(p.n), x, y + 0.5);
      }
    });
  }

  // 공. 긴 패스와 크로스는 떠서 날아간다(그림자는 땅에 남는다).
  const bx = X(lerp(L.ball.px, L.ball.x));
  const by = Y(lerp(L.ball.py, L.ball.y));
  let lift = 0;
  const f = L.flight;
  if (f && (f.kind === 'long' || f.kind === 'cross')) {
    const span = Math.max(1, f.end - f.start);
    const prog = Math.min(1, Math.max(0, (L.tick - 1 - f.start + frac) / span));
    lift = Math.sin(Math.PI * prog) * Math.min(6, Math.hypot(f.toX - f.fromX, f.toY - f.fromY) * 0.12) * s;
  }
  const br = Math.max(3, s * 0.75);
  ctx.beginPath();
  ctx.ellipse(bx, by + 1, br, br * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by - lift, br, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#111';
  ctx.stroke();

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

