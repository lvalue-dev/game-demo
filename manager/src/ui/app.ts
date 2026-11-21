// 화면. 게임 규칙은 game/에 있고, 여기서는 game.scene을 그리고 누른 선택지를 act()에 넘긴다.
import { act, createGame, legacyScore } from '../game/career.ts';
import {
  ATTRS, ATTR_IDS, BACKGROUNDS, BACKGROUND_IDS, CLUB_LEAGUES, LEAGUES, POS_NAME, STYLES, TRAITS, won,
} from '../game/data.ts';
import { potentialText, ratings } from '../game/squad.ts';
import { legacyTitle } from '../game/talk.ts';
import { dropCount, sortTable, zone } from '../game/world.ts';
import { isLive, mountLive, onLiveClick, pauseLive, renderLive, unmountLive } from './live.ts';
import type { BackgroundId, Block, Club, ClubLeagueId, Game, LeagueId, MatchLine, Phase, Pos } from '../game/types.ts';

type Tab = 'play' | 'table' | 'squad' | 'record';

interface HallEntry {
  name: string;
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
let confirmReset = false;
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
  game = saved && saved.version === 3 ? saved : null;
  root.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseLive();
  });
  root.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === 'manager-name') draft.name = input.value;
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

function onClick(e: Event): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab],[data-league],[data-bg],[data-do],[data-live],[data-live-do]');
  if (!el) return;
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
  if (el.dataset.do === 'keep') {
    confirmReset = false;
    render();
    return;
  }
  if (!game) return;
  if (el.dataset.tab) {
    tab = el.dataset.tab as Tab;
    confirmReset = false;
    render();
    window.scrollTo(0, 0);
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
      name: game.manager.name, score: legacyScore(game), title: legacyTitle(legacyScore(game)),
      years: `${game.history[0]?.year ?? game.year}–${game.year}`, best: best ? `${best.year} ${best.name}` : '트로피 없음',
    });
    store(HALL_KEY, hall.sort((a, b) => b.score - a.score).slice(0, 10));
    game = null;
    store(SAVE_KEY, null);
    render();
    window.scrollTo(0, 0);
    return;
  }
  act(game, id);
  store(SAVE_KEY, game);
  render();
  window.scrollTo(0, 0);
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
      <p class="board__lede">K5 동호인 팀에서 K리그와 프리미어리그를 거쳐 월드컵 결승 벤치까지. 한 시즌에 열 번쯤 결정하고, 서른 시즌이 지나면 은퇴한다.</p>
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
        <button type="submit" class="choice choice--primary choice--solo"><span class="choice__label">커리어 시작</span></button>
      </form>
      <section class="section">
        <h2 class="section__title">능력치 다섯 가지</h2>
        <dl class="stats">${ATTR_IDS.map((id) => `<div class="stats__row"><dt>${esc(ATTRS[id].name)}</dt><dd class="stats__text">${esc(ATTRS[id].desc)}</dd></div>`).join('')}</dl>
      </section>
      ${hall.length > 0 ? `
      <section class="section">
        <h2 class="section__title">명예의 전당</h2>
        <ol class="hall">${hall.map((h) => `
          <li class="hall__row"><span class="hall__score">${h.score}</span><span class="hall__body"><strong>${esc(h.name)}</strong> · ${esc(h.title)}<br><span class="muted">${esc(h.years)} · ${esc(h.best)}</span></span></li>`).join('')}
        </ol>
      </section>` : ''}
      <p class="fine">K리그와 잉글랜드 리그의 구단은 2026년 실제 구성을 따랐다. 어느 구단이나 리그와도 공식 제휴한 것이 아니며, 문장은 실제 엠블럼이 아니라 팀 색으로 직접 그린 것이다. 게임 속 성적, 사건, 기사, 댓글은 모두 지어낸 것이고, K5리그 팀과 선수, 매체 이름도 가상이다.</p>
      <p class="fine">진행 상황은 이 기기의 브라우저에 저장된다.</p>
    </main>`;
}

function renderGame(g: Game): string {
  const club = g.job ? (g.clubs[g.job.club] as Club) : null;
  const meta = club && !club.nation ? LEAGUES[club.league as ClubLeagueId] : null;
  const where = club ? (meta ? (meta.short === meta.name || meta.name.startsWith(meta.short) ? meta.name : `${meta.name} · ${meta.short}`) : '국가대표팀') : '무소속';
  const step = g.phase === 'match' ? (g.season.half === 1 ? 3 : 6) : STEPS.findIndex((s) => s.phases.includes(g.phase));
  return `
    <header class="board">
      <div class="board__row">
        ${club ? crest(club, 40) : ''}
        <div class="board__club">
          <p class="board__kicker">${esc(where)} · ${g.year}</p>
          <h1 class="board__name">${esc(club ? club.name : '터치라인')}</h1>
        </div>
        <dl class="board__nums">
          <div><dt>평판</dt><dd>${Math.round(g.manager.rep)}</dd></div>
          <div><dt>나이</dt><dd>${g.manager.age}</dd></div>
        </dl>
      </div>
      ${step >= 0 ? `<ol class="steps" aria-label="시즌 진행">${STEPS.map((s, i) => `<li class="steps__item${i < step ? ' is-done' : i === step ? ' is-now' : ''}"${i === step ? ' aria-current="step"' : ''}>${s.label}</li>`).join('')}</ol>` : ''}
    </header>
    <main class="page">${tab === 'play' ? (isLive(g) ? renderLive(g) : renderScene(g)) : tab === 'table' ? renderTables(g) : tab === 'squad' ? renderSquad(g) : renderRecord(g)}</main>
    <nav class="tabs" aria-label="화면 전환">
      ${([['play', '진행'], ['table', '순위'], ['squad', '선수단'], ['record', '기록']] as [Tab, string][]).map(([id, label]) =>
        `<button type="button" class="tabs__item${tab === id ? ' is-on' : ''}" data-tab="${id}"${tab === id ? ' aria-current="page"' : ''}>${label}</button>`).join('')}
    </nav>`;
}

function renderScene(g: Game): string {
  const s = g.scene;
  return `
    <article class="scene">
      <p class="eyebrow">${esc(s.eyebrow)}</p>
      <h2 class="scene__title">${esc(s.title)}</h2>
      ${s.blocks.map((b) => renderBlock(g, b)).join('')}
      <div class="choices">
        ${s.choices.map((c) => `
          <button type="button" class="choice${c.tone === 'primary' ? ' choice--primary' : c.tone === 'danger' ? ' choice--danger' : ''}${s.choices.length === 1 ? ' choice--solo' : ''}${c.club !== undefined ? ' choice--club' : ''}" data-act="${esc(c.id)}"${c.disabled ? ' disabled' : ''}>
            ${c.club !== undefined ? crest(g.clubs[c.club] as Club, 30) : ''}
            <span class="choice__label">${esc(c.label)}</span>
            ${c.detail ? `<span class="choice__detail">${esc(c.detail)}</span>` : ''}
            ${c.disabled ? '<span class="choice__detail">예산이 모자란다</span>' : ''}
          </button>`).join('')}
      </div>
    </article>`;
}

const POS_SHORT: Record<Pos, string> = { GK: 'GK', DF: 'DF', MF: 'MF', FW: 'FW' };

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
        <thead><tr><th class="num">#</th><th>팀</th><th class="num">경기</th><th class="num">승</th><th class="num">무</th><th class="num">패</th><th class="num">득실</th><th class="num">승점</th></tr></thead>
        <tbody>${rows.map((r, i) => {
          const z = zone(league, i + 1, rows.length);
          const gd = r.gf - r.ga;
          return `<tr class="${r.club === mine ? 'is-mine' : ''}${z === 1 ? ' is-up' : z === -1 ? ' is-down' : ''}">
            <td class="num table__pos">${i + 1}</td><td class="table__team"><span class="team">${crest(g.clubs[r.club] as Club, 14)}${esc((g.clubs[r.club] as Club).name)}</span></td>
            <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
            <td class="num">${gd > 0 ? '+' : ''}${gd}</td><td class="num table__pts">${r.pts}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

function renderBlock(g: Game, b: Block): string {
  switch (b.kind) {
    case 'score': return `
      <div class="score" role="group" aria-label="점수">
        <span class="score__team${b.mine === 0 ? ' is-mine' : ''}">${esc(b.home)}</span>
        <span class="score__num">${b.score[0]}<span class="score__sep">:</span>${b.score[1]}</span>
        <span class="score__team score__team--away${b.mine === 1 ? ' is-mine' : ''}">${esc(b.away)}</span>
        <span class="score__minute">${esc(b.minute)}</span>
      </div>`;
    case 'log': return `<ol class="log">${b.items.map((l) => `
      <li class="log__row log__row--${l.tone}"><span class="log__min">${l.min === 0 ? '시작' : `${Math.min(90, l.min)}'`}</span><span class="log__text">${esc(l.text)}</span></li>`).join('')}</ol>`;
    case 'text': return `<p class="prose">${esc(b.text)}</p>`;
    case 'note': return `<p class="note note--${b.tone}">${esc(b.text)}</p>`;
    case 'stats': return `<dl class="stats">${b.rows.map((r) => `<div class="stats__row"><dt>${esc(r.label)}</dt><dd class="${r.tone ? `is-${r.tone}` : ''}">${esc(r.value)}</dd></div>`).join('')}</dl>`;
    case 'matches': return renderMatches(b.items);
    case 'table': return renderTable(g, b.league);
    case 'players': return `<ul class="players">${b.items.map((p) => `
      <li class="players__row">
        <span class="pos pos--${p.pos}">${POS_SHORT[p.pos]}</span>
        <span class="players__name">${esc(p.name)}<span class="muted"> ${p.age}세${p.note ? ` · ${esc(p.note)}` : ''}</span></span>
        ${p.delta ? `<span class="delta delta--${p.delta > 0 ? 'up' : 'down'}">${p.delta > 0 ? '▲' : '▼'}${Math.abs(p.delta)}</span>` : ''}
        <span class="players__ovr">${p.ovr}</span>
      </li>`).join('')}</ul>`;
    case 'feed': return `<ul class="feed">${b.items.map((f) => `
      <li class="feed__item feed__item--${f.tone}"><p class="feed__text">${esc(f.text)}</p><p class="feed__who">${esc(f.who)} · ${esc(f.where)}</p></li>`).join('')}</ul>`;
  }
}

function renderTables(g: Game): string {
  const club = g.job ? (g.clubs[g.job.club] as Club) : null;
  const options: LeagueId[] = [...(g.tables.intl.length > 0 && club?.nation ? ['intl' as LeagueId] : []), ...[...CLUB_LEAGUES].reverse()];
  const current = tableLeague && options.includes(tableLeague) ? tableLeague : club ? (club.league as LeagueId) : 'kr5';
  const label = (id: LeagueId): string => (id === 'intl' ? '대표팀 조' : LEAGUES[id].short);
  return `
    <section class="section">
      <p class="eyebrow">${g.year} 시즌${g.round === 0 ? ' · 개막 전' : g.round === 1 ? ' · 전반기 종료' : ' · 시즌 종료'}</p>
      <h2 class="scene__title">${current === 'intl' ? '대표팀 조별 순위' : esc(LEAGUES[current as ClubLeagueId].name)}</h2>
      <div class="chips" role="group" aria-label="리그 고르기">
        ${options.map((id) => `<button type="button" class="chip${id === current ? ' is-on' : ''}" data-league="${id}" aria-pressed="${id === current}">${esc(label(id))}</button>`).join('')}
      </div>
      ${renderTable(g, current)}
      ${current !== 'intl' ? `<p class="fine">${esc(zoneNote(current as ClubLeagueId))}</p>` : ''}
    </section>`;
}

function zoneNote(league: ClubLeagueId): string {
  const meta = LEAGUES[league];
  const top = meta.promote > 0 ? `위 ${meta.promote}팀은 ${LEAGUES[meta.up as ClubLeagueId].name}로 승격` : `위 ${meta.conti}팀은 다음 시즌 대륙 대회 진출`;
  const drop = dropCount(league);
  return `${meta.blurb}. ${top}${drop > 0 ? `, 아래 ${drop}팀은 강등` : ''}.`;
}

function renderSquad(g: Game): string {
  if (!g.job) return '<p class="prose">아직 맡은 팀이 없다.</p>';
  const r = ratings(g.squad, g.depth + g.season.depthMod);
  const a = g.manager.attrs;
  return `
    <section class="section">
      <p class="eyebrow">${esc((g.clubs[g.job.club] as Club).name)}</p>
      <h2 class="scene__title">선수단</h2>
      <dl class="stats">
        <div class="stats__row"><dt>공격력</dt><dd>${r.att.toFixed(1)}</dd></div>
        <div class="stats__row"><dt>수비력</dt><dd>${r.def.toFixed(1)}</dd></div>
        <div class="stats__row"><dt>선수층</dt><dd>${(g.depth + g.season.depthMod).toFixed(1)}</dd></div>
        <div class="stats__row"><dt>전술</dt><dd>${g.lastStyle ? esc(STYLES[g.lastStyle].name) : '미정'} · 숙련도 ${Math.round(g.cohesion)}</dd></div>
        <div class="stats__row"><dt>사기</dt><dd>${Math.round(g.morale)}</dd></div>
        ${g.job.kind === 'club' ? `<div class="stats__row"><dt>예산</dt><dd>${esc(won(g.job.budget))}</dd></div>` : ''}
      </dl>
      <ul class="players">${g.squad.map((p) => `
        <li class="players__row players__row--tall">
          <span class="pos pos--${p.pos}">${POS_SHORT[p.pos]}</span>
          <span class="players__name">${esc(p.name)}<br><span class="muted">${POS_NAME[p.pos]} · ${p.age}세 · ${esc(potentialText(g, p))}${p.trait ? ` · ${esc(TRAITS[p.trait].name)}` : ''}${p.goals > 0 ? ` · ${p.goals}골` : ''}</span></span>
          <span class="players__ovr">${p.ovr + p.temp}</span>
        </li>`).join('')}</ul>
    </section>
    <section class="section">
      <h2 class="section__title">${esc(g.manager.name)} 감독</h2>
      <dl class="stats">${ATTR_IDS.map((id) => `
        <div class="stats__row"><dt>${esc(ATTRS[id].name)}</dt><dd><span class="meter" aria-hidden="true"><span class="meter__fill" style="width:${a[id] * 5}%"></span></span>${a[id]}</dd></div>`).join('')}
      </dl>
    </section>`;
}

function renderRecord(g: Game): string {
  return `
    <section class="section">
      <p class="eyebrow">${esc(g.manager.name)} · ${esc(BACKGROUNDS[g.manager.background].name)}</p>
      <h2 class="scene__title">커리어 기록</h2>
      <dl class="stats">
        <div class="stats__row"><dt>커리어 점수</dt><dd>${legacyScore(g)} · ${esc(legacyTitle(legacyScore(g)))}</dd></div>
        <div class="stats__row"><dt>트로피</dt><dd>${g.trophies.length}개</dd></div>
        <div class="stats__row"><dt>승격</dt><dd>${g.promotions}회</dd></div>
        <div class="stats__row"><dt>최고 평판</dt><dd>${Math.round(g.manager.peakRep)}</dd></div>
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
