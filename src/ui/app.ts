import { ROLE_NAMES, cardDef } from '../game/cards.ts';
import type { CardDef } from '../game/cards.ts';
import {
  ENERGY_PER_TURN, HEAT_LIMIT, MIN_DECK, PATROL_STEP_TURNS, REMOVE_COST, REROLL_COST,
  buyOffer, canEscape, canPlay, canRemove, currentLocation, endTurn, escapeHeist, isUsableState,
  newGame, nextHeist, patrolAt, pendingPatrol, playCard, previewPlay, randomSeed, removeCard,
  rerollShop, vaultLocked,
} from '../game/engine.ts';
import { ro } from '../game/josa.ts';
import { LOCATIONS } from '../game/locations.ts';
import type { GameState, LocationDef, Role } from '../game/types.ts';

const SAVE_KEY = 'hantang-save';
const ROLE_ORDER: Role[] = ['loot', 'cover', 'escape', 'tech'];

type DialogKind = 'rules' | 'deck' | 'remove';

let g: GameState;
let appEl: HTMLElement;
let dialogEl: HTMLDialogElement;
let dialogBody: HTMLElement;
let dialogKind: DialogKind | null = null;
let confirmNewGame = false;
/** 직전 화면의 수치. 바뀐 만큼을 계기 옆에 잠깐 띄우는 데 쓴다. */
let shown: { heist: number; loot: number; heat: number; escape: number } | null = null;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

export function start(data: { game?: unknown }): void {
  appEl = document.getElementById('app')!;
  dialogEl = document.getElementById('dialog') as HTMLDialogElement;
  dialogBody = document.getElementById('dialog-body')!;
  g = isUsableState(data.game) ? data.game : (loadSaved() ?? newGame(randomSeed()));

  document.addEventListener('click', onClick);
  dialogEl.addEventListener('close', () => {
    dialogKind = null;
    confirmNewGame = false;
  });
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });
  render();
}

/** 열려 있는 페이지가 새 버전으로 바뀔 때 진행 중인 판을 넘겨주기 위한 스냅샷. */
export function snapshot(): { game: GameState } {
  return { game: g };
}

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isUsableState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function save(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(g));
  } catch {
    // 저장이 막힌 환경에서는 이어하기만 안 될 뿐 게임은 그대로 진행된다.
  }
}

function onClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target || (target as HTMLButtonElement).disabled) return;
  const action = target.dataset.action!;
  const uid = Number(target.dataset.uid);
  const index = Number(target.dataset.index);

  switch (action) {
    case 'play': playCard(g, uid); break;
    case 'end-turn': endTurn(g); break;
    case 'escape': escapeHeist(g); break;
    case 'buy': buyOffer(g, index); break;
    case 'reroll': rerollShop(g); break;
    case 'next-heist': nextHeist(g); break;
    case 'remove':
      removeCard(g, uid);
      if (!canRemove(g)) dialogEl.close();
      break;
    case 'new-game':
      g = newGame(randomSeed());
      shown = null;
      if (dialogEl.open) dialogEl.close();
      break;
    case 'ask-new-game': confirmNewGame = true; break;
    case 'open-rules': openDialog('rules'); return;
    case 'open-deck': openDialog('deck'); return;
    case 'open-remove': openDialog('remove'); return;
    case 'close-dialog': dialogEl.close(); return;
    default: return;
  }
  save();
  render();
}

function openDialog(kind: DialogKind): void {
  dialogKind = kind;
  renderDialog();
  if (!dialogEl.open) dialogEl.showModal();
}

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
  appEl.innerHTML =
    g.phase === 'heist' ? heistScreen()
    : g.phase === 'shop' ? shopScreen()
    : endScreen();
  if (dialogEl.open) renderDialog();
  if (focusKey) appEl.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
}

// ---------- 공통 조각 ----------

function header(eyebrow: string, title: string): string {
  // 상점에서는 방금 끝낸 작전이 아니라 다음 작전을 현재 위치로 보여준다.
  const now = g.phase === 'shop' || g.phase === 'won' ? g.heistIndex + 1 : g.heistIndex;
  const route = LOCATIONS.map((loc, i) => {
    const state = i < now ? 'done' : i === now ? 'now' : 'todo';
    return `<li class="route-step is-${state}">${esc(loc.name)}</li>`;
  }).join('');
  return `
    <header class="top">
      <div class="top-title">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <h1>${esc(title)}</h1>
      </div>
      <div class="top-actions">
        <button type="button" class="btn btn-small" data-action="open-deck" data-key="deck">덱 ${g.deck.length}</button>
        <button type="button" class="btn btn-small" data-action="open-rules" data-key="rules">규칙</button>
      </div>
      <ol class="route" aria-label="작전 순서">${route}</ol>
    </header>`;
}

interface CardView {
  def: CardDef;
  attrs: string;
  disabled?: boolean;
  danger?: boolean;
  now?: string;
  tag?: string;
}

function cardHtml(v: CardView): string {
  const { def } = v;
  return `
    <button type="button" class="card role-${def.role}${v.danger ? ' is-danger' : ''}" ${v.attrs}${v.disabled ? ' disabled' : ''}>
      <span class="card-top">
        <span class="card-role">${ROLE_NAMES[def.role]}</span>
        <span class="card-cost" aria-label="비용 ${def.cost}">${def.cost}</span>
      </span>
      <span class="card-name">${esc(def.name)}</span>
      <span class="card-text">${esc(def.text)}</span>
      ${v.now ? `<span class="card-now">${esc(v.now)}</span>` : ''}
      ${v.tag ? `<span class="card-tag">${esc(v.tag)}</span>` : ''}
    </button>`;
}

function locationBrief(loc: LocationDef): string {
  const parts = [`상납금 ${loc.quota}`, `도주 준비 ${loc.escapeNeeded}`, `순찰 +${loc.patrol}부터`];
  if (loc.vaultTech > 0) parts.push(`금고: 기술 카드 ${loc.vaultTech}장을 내기 전까지 털이 수익 절반`);
  return parts.join(' · ');
}

// ---------- 작전 화면 ----------

function heistScreen(): string {
  const h = g.heist!;
  const loc = currentLocation(g);
  const patrol = pendingPatrol(g);
  const endHeat = h.heat + patrol;

  const delta = (key: 'loot' | 'heat' | 'escape'): string => {
    if (!shown || shown.heist !== g.heistIndex) return '';
    const d = h[key] - shown[key];
    if (d === 0) return '';
    const good = key === 'heat' ? d < 0 : d > 0;
    return `<span class="delta ${good ? 'is-good' : 'is-bad'}">${signed(d)}</span>`;
  };
  const deltas = { loot: delta('loot'), heat: delta('heat'), escape: delta('escape') };
  shown = { heist: g.heistIndex, loot: h.loot, heat: h.heat, escape: h.escape };

  // 수익
  const lootLeft = loc.quota - h.loot;
  const lootNote = lootLeft > 0 ? `상납금까지 ${lootLeft} 남음` : `상납금 달성 · 지금 나가면 내 몫 ${h.loot - loc.quota}`;
  const lootPct = Math.min(100, Math.round((h.loot / loc.quota) * 100));

  // 경보
  const segs = Array.from({ length: HEAT_LIMIT }, (_, i) => {
    const cls = i < h.heat ? 'is-on' : i < endHeat ? 'is-pending' : '';
    return `<i class="seg ${cls}"></i>`;
  }).join('');
  const heatNote = h.ignorePatrol ? '이번 턴은 순찰을 무시한다'
    : endHeat >= HEAT_LIMIT ? `턴을 끝내면 순찰 +${patrol}로 검거된다`
    : `턴을 끝내면 순찰 +${patrol} → 경보 ${endHeat}`;

  // 도주 준비
  const pips = Array.from({ length: loc.escapeNeeded }, (_, i) =>
    `<i class="pip ${i < h.escape ? 'is-on' : ''}"></i>`).join('');
  const escLeft = loc.escapeNeeded - h.escape;
  const escNote = escLeft > 0 ? `철수하려면 ${escLeft} 더 필요` : '도주 준비 완료';

  // 순찰이 세지는 시점
  const turnsToStep = PATROL_STEP_TURNS - ((h.turn - 1) % PATROL_STEP_TURNS);
  const patrolHint = `순찰 +${patrolAt(loc, h.turn)} · ${turnsToStep}턴 뒤 +${patrolAt(loc, h.turn + turnsToStep)}`;

  const energyPips = Array.from({ length: Math.max(ENERGY_PER_TURN, h.energy) }, (_, i) =>
    `<i class="pip ${i < h.energy ? 'is-on' : ''}"></i>`).join('');

  const vault = loc.vaultTech === 0 ? ''
    : vaultLocked(g)
      ? `<p class="notice is-warn">금고 잠김 · 기술 카드 ${h.techPlayed}/${loc.vaultTech} · 털이 수익이 절반</p>`
      : `<p class="notice is-ok">금고 열림 · 털이 수익이 정상으로 들어온다</p>`;

  const modifiers = [
    h.nextLootDouble ? '다음 털이 수익 2배' : '',
    h.nextLootNoHeat ? '다음 털이 경보 없음' : '',
  ].filter(Boolean).map((m) => `<span class="chip">${m}</span>`).join('');

  const hand = h.hand.map((card) => {
    const def = cardDef(card.id);
    const p = previewPlay(g, card.uid);
    const playable = canPlay(g, card.uid);
    const modified = def.role === 'loot' && (h.nextLootDouble || h.nextLootNoHeat || vaultLocked(g));
    let now = '';
    if (p && (def.dynamic || modified || p.bust)) {
      const parts: string[] = [];
      if (p.loot) parts.push(`수익 ${signed(p.loot)}`);
      if (p.heat) parts.push(`경보 ${signed(p.heat)}`);
      if (p.escape) parts.push(`도주 ${signed(p.escape)}`);
      const energyGain = p.energy + def.cost;
      if (energyGain > 0) parts.push(`행동력 +${energyGain}`);
      now = p.bust ? '내면 검거된다' : `지금 내면: ${parts.join(' · ') || '변화 없음'}`;
    }
    const tag = playable ? '' : def.cost > h.energy ? '행동력 부족' : '조건 미달';
    return cardHtml({
      def, now, tag, disabled: !playable, danger: !!p?.bust,
      attrs: `data-action="play" data-uid="${card.uid}" data-key="card-${card.uid}"`,
    });
  }).join('');

  // 결정 버튼
  const escapeReady = canEscape(g);
  const missing = [
    lootLeft > 0 ? `상납금 ${lootLeft}` : '',
    escLeft > 0 ? `도주 준비 ${escLeft}` : '',
  ].filter(Boolean).join(' · ');
  const escapeBtn = escapeReady
    ? `<button type="button" class="btn btn-go" data-action="escape" data-key="escape">
         <span class="btn-main">철수한다</span><span class="btn-sub">내 몫 ${h.loot - loc.quota} 챙김</span></button>`
    : `<button type="button" class="btn" data-key="escape" disabled>
         <span class="btn-main">철수 불가</span><span class="btn-sub">${missing} 부족</span></button>`;
  const willBust = endHeat >= HEAT_LIMIT;
  const endBtn = `<button type="button" class="btn ${willBust ? 'btn-danger' : 'btn-next'}" data-action="end-turn" data-key="end-turn">
      <span class="btn-main">턴 종료</span>
      <span class="btn-sub">${willBust ? '경보 한계 초과 · 검거' : patrol > 0 ? `순찰 경보 +${patrol}` : '순찰 없음'}</span></button>`;

  return `
    ${header(`작전 ${g.heistIndex + 1} / ${LOCATIONS.length} · ${h.turn}턴`, loc.name)}
    <section class="gauges" aria-label="작전 상황">
      <div class="gauge gauge-loot">
        <div class="gauge-head"><span class="gauge-label">수익</span>${deltas.loot}
          <span class="gauge-value"><b>${h.loot}</b> / ${loc.quota}</span></div>
        <div class="bar"><div class="bar-fill" style="width:${lootPct}%"></div></div>
        <p class="gauge-note">${lootNote}</p>
      </div>
      <div class="gauge gauge-heat${endHeat >= HEAT_LIMIT - 2 ? ' is-hot' : ''}">
        <div class="gauge-head"><span class="gauge-label">경보</span>${deltas.heat}
          <span class="gauge-value"><b>${h.heat}</b> / ${HEAT_LIMIT}</span></div>
        <div class="segs">${segs}</div>
        <p class="gauge-note">${heatNote}</p>
      </div>
      <div class="gauge gauge-escape">
        <div class="gauge-head"><span class="gauge-label">도주 준비</span>${deltas.escape}
          <span class="gauge-value"><b>${h.escape}</b> / ${loc.escapeNeeded}</span></div>
        <div class="pips">${pips}</div>
        <p class="gauge-note">${escNote}</p>
      </div>
    </section>
    ${vault}
    <div class="status">
      <span class="status-energy"><span class="status-label">행동력</span><span class="pips">${energyPips}</span><b>${h.energy}</b></span>
      <span class="status-item">${patrolHint}</span>
      <span class="status-item">뽑을 카드 ${h.drawPile.length} · 버린 카드 ${h.discard.length}</span>
    </div>
    <p class="message" aria-live="polite">${esc(g.message)}${modifiers ? ` ${modifiers}` : ''}</p>
    <section class="hand" aria-label="손패">${hand || '<p class="empty">손패가 없다. 턴을 끝내거나 철수하라.</p>'}</section>
    <footer class="actions">${escapeBtn}${endBtn}</footer>`;
}

// ---------- 상점 화면 ----------

function shopScreen(): string {
  const shop = g.shop!;
  const r = g.lastResult!;
  const next = LOCATIONS[g.heistIndex + 1]!;

  const offers = shop.offers.map((offer, index) => {
    const def = cardDef(offer.id);
    const free = shop.freePicks > 0;
    const affordable = free || g.money >= offer.price;
    const tag = offer.sold ? '영입 완료' : free ? '무료 영입' : `가격 ${offer.price}`;
    return cardHtml({
      def, tag, disabled: offer.sold || !affordable,
      attrs: `data-action="buy" data-index="${index}" data-key="offer-${index}"`,
    });
  }).join('');

  const freeNote = shop.freePicks > 0
    ? `보스가 붙여 주는 신입 ${shop.freePicks}명은 돈을 받지 않는다. 고른 뒤부터는 가격을 낸다.`
    : '추가 영입은 가진 돈으로 한다.';

  return `
    ${header(`상점 · 다음 작전 ${g.heistIndex + 2} / ${LOCATIONS.length}`, '크루 영입')}
    <section class="result">
      <p class="result-line">${esc(r.location)} 철수 성공 · ${r.turns}턴</p>
      <p class="result-math">수익 ${r.loot} − 상납금 ${r.quota} = 내 몫 <b>${r.kept}</b></p>
    </section>
    <div class="wallet"><span class="gauge-label">가진 돈</span><b>${g.money}</b></div>
    <p class="message" aria-live="polite">${esc(freeNote)}</p>
    <section class="hand" aria-label="영입 후보">${offers}</section>
    <div class="shop-actions">
      <button type="button" class="btn" data-action="reroll" data-key="reroll" ${g.money < REROLL_COST ? 'disabled' : ''}>
        <span class="btn-main">후보 다시 뽑기</span><span class="btn-sub">가격 ${REROLL_COST}</span></button>
      <button type="button" class="btn" data-action="open-remove" data-key="remove" ${canRemove(g) ? '' : 'disabled'}>
        <span class="btn-main">크루 내보내기</span><span class="btn-sub">가격 ${REMOVE_COST} · 덱에서 1장 제거</span></button>
    </div>
    <section class="next">
      <p class="eyebrow">다음 작전</p>
      <p class="next-name">${esc(next.name)}</p>
      <p class="next-brief">${esc(locationBrief(next))}</p>
    </section>
    <footer class="actions is-single">
      <button type="button" class="btn btn-go" data-action="next-heist" data-key="next-heist">
        <span class="btn-main">${esc(ro(next.name))} 출발</span>
        <span class="btn-sub">${shop.freePicks > 0 ? '무료 영입을 아직 쓰지 않았다' : '남은 돈은 다음 상점으로 넘어간다'}</span></button>
    </footer>`;
}

// ---------- 결과 화면 ----------

function endScreen(): string {
  const won = g.phase === 'won';
  const loc = currentLocation(g);
  const body = won
    ? `<p class="end-lead">모든 상납을 끝냈다. 보스에게 진 빚은 없다.</p>
       <p class="end-stat">손에 남은 돈 <b>${g.money}</b> · 덱 ${g.deck.length}장</p>`
    : `<p class="end-lead">${esc(loc.name)}에서 경보가 ${HEAT_LIMIT}에 닿았다. 이번 작전의 수익을 모두 잃었다.</p>
       <p class="end-stat">통과한 작전 <b>${g.heistIndex}</b> / ${LOCATIONS.length} · 덱 ${g.deck.length}장</p>`;
  return `
    ${header(won ? '작전 완료' : `작전 ${g.heistIndex + 1} / ${LOCATIONS.length} 실패`, won ? '빚 청산' : '검거')}
    <section class="end ${won ? 'is-won' : 'is-lost'}">
      ${body}
      <button type="button" class="btn btn-go" data-action="new-game" data-key="new-game">
        <span class="btn-main">새 판 시작</span><span class="btn-sub">편의점부터 다시</span></button>
    </section>`;
}

// ---------- 대화상자 ----------

function renderDialog(): void {
  dialogBody.innerHTML = dialogKind === 'rules' ? rulesDialog() : deckDialog(dialogKind === 'remove');
}

function rulesDialog(): string {
  const stops = LOCATIONS.map((loc) => `<li><b>${esc(loc.name)}</b> ${esc(locationBrief(loc))}</li>`).join('');
  const newGameBtn = confirmNewGame
    ? `<button type="button" class="btn btn-danger" data-action="new-game"><span class="btn-main">진행 중인 판을 버리고 새로 시작</span></button>`
    : `<button type="button" class="btn" data-action="ask-new-game"><span class="btn-main">새 판 시작</span></button>`;
  return `
    <h2 id="dialog-title">규칙</h2>
    <p>보스에게 진 빚을 갚아야 한다. 가게 다섯 곳을 차례로 털고, 매번 <b>상납금</b> 이상을 챙겨 빠져나오면 된다.</p>
    <ul class="rules">
      <li>매 턴 카드 5장을 뽑는다. <b>행동력</b>은 턴마다 ${ENERGY_PER_TURN}이고, 카드 오른쪽 위 숫자만큼 쓴다.</li>
      <li><b>수익</b>이 상납금을 넘고 <b>도주 준비</b>가 채워지면 언제든 철수할 수 있다.</li>
      <li>턴을 끝낼 때마다 <b>순찰</b>만큼 경보가 오른다. 순찰은 ${PATROL_STEP_TURNS}턴마다 1씩 세진다.</li>
      <li><b>경보</b>가 ${HEAT_LIMIT}에 닿으면 검거되어 그 판이 끝난다.</li>
      <li>상납금을 넘긴 수익은 내 몫이다. 상점에서 크루를 영입하는 데 쓴다. 오래 머물수록 많이 챙기지만 위험해진다.</li>
      <li>작전을 마칠 때마다 크루 1명은 돈을 내지 않고 영입한다.</li>
    </ul>
    <h3>작전 순서</h3>
    <ol class="rules">${stops}</ol>
    <div class="dialog-actions">
      ${newGameBtn}
      <button type="button" class="btn btn-next" data-action="close-dialog"><span class="btn-main">닫기</span></button>
    </div>`;
}

function deckDialog(removing: boolean): string {
  const groups = new Map<string, number[]>();
  for (const card of g.deck) groups.set(card.id, [...(groups.get(card.id) ?? []), card.uid]);
  const rows = [...groups.entries()]
    .map(([id, uids]) => ({ def: cardDef(id), uids }))
    .sort((a, b) =>
      ROLE_ORDER.indexOf(a.def.role) - ROLE_ORDER.indexOf(b.def.role) || a.def.cost - b.def.cost)
    .map(({ def, uids }) => `
      <li class="deck-row role-${def.role}">
        <span class="deck-main">
          <span class="deck-name">${esc(def.name)} <span class="deck-count">×${uids.length}</span></span>
          <span class="deck-meta">${ROLE_NAMES[def.role]} · 비용 ${def.cost} · ${esc(def.text)}</span>
        </span>
        ${removing ? `<button type="button" class="btn btn-small btn-danger" data-action="remove" data-uid="${uids[0]}" ${canRemove(g) ? '' : 'disabled'}>내보내기</button>` : ''}
      </li>`).join('');
  const lead = removing
    ? `한 명을 내보내는 가격은 ${REMOVE_COST}. 가진 돈 ${g.money} · 덱은 ${MIN_DECK}장 아래로 줄일 수 없다.`
    : `지금 덱은 ${g.deck.length}장이다.`;
  return `
    <h2 id="dialog-title">${removing ? '크루 내보내기' : '내 덱'}</h2>
    <p>${lead}</p>
    <ul class="deck-list">${rows}</ul>
    <div class="dialog-actions">
      <button type="button" class="btn btn-next" data-action="close-dialog"><span class="btn-main">닫기</span></button>
    </div>`;
}
