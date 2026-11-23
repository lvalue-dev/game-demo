// 스쿼드 미리보기. 이적시장과 협상 화면에서 화면을 옮기지 않고 선발과 후보를 본다.
// 좁은 화면에서는 전광판 아래에 붙는 한 줄이고, 누르면 그 자리에서 펼쳐진다. 넓은 화면에서는 오른쪽에 붙어 있다.
// 여기서는 보기만 한다. 배치를 바꾸는 일은 구단 관리의 라인업에서 한다.
import { POS_NAME } from '../game/data.ts';
import { RESERVE_LIMIT, contractText, isForeign, promiseKept, quotaWord } from '../game/contract.ts';
import { effOvr, formationOf, lineAt, lineOf, slotsFor, spotAt, weakest } from '../game/squad.ts';
import { SHAPES } from '../game/tactics.ts';
import type { Game, Player, Pos } from '../game/types.ts';
import { spread } from './spread.ts';

const esc = (text: string | number): string => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const short = (p: Player): string => (p.name.includes(' ') ? (p.nat === '일본' ? p.name.split(' ')[0] as string : p.name.split(' ').pop() as string) : p.name);
const LINES: Pos[] = ['GK', 'DF', 'MF', 'FW'];

/** 손봐야 할 일: 불만, 계약 만료, 어긴 출전 약속. */
const alertsOf = (g: Game, p: Player): string[] => [
  p.unhappy ? '불만' : '',
  p.contract && p.contract.years <= 1 && !p.loan ? '만료 임박' : '',
  !promiseKept(g, p) ? '약속 위반' : '',
].filter(Boolean);

/** 선수 옆에 붙이는 꼬리표. */
export const flagsOf = (g: Game, p: Player): string[] => [...alertsOf(g, p), p.loan?.dir === 'in' ? '임대' : '', isForeign(g, p) ? quotaWord(g) : ''].filter(Boolean);

// 작은 경기장의 치수. 너비를 100으로 본다. 말 하나는 동그라미와 그 아래 이름까지가 제 자리다.
const PITCH_H = (100 * 80) / 68;
const TOK_W = 18.5;
const TOK_H = 21.5;

/**
 * 선발 열한 명을 작은 경기장에 놓을 자리(말의 한가운데, 너비 100 기준).
 * 대형의 자리를 그대로 줄이면 파이브백이나 수비형 미드필더가 이름을 가리므로, 포개진 말만 벌린다.
 */
export function peekSpots(slots: { u: number; v: number }[]): { x: number; y: number }[] {
  const us = slots.map((s) => s.u);
  const lo = Math.min(...us);
  const span = Math.max(1, Math.max(...us) - lo);
  // 세로를 눌러서 말을 동그라미로 보고 벌린 뒤 되돌린다.
  const k = TOK_W / TOK_H;
  const edge = TOK_H / 2 + 1;
  const dots = slots.map((s, i) => ({
    x: 50 + ((s.v - 34) / 34) * 48,
    y: (PITCH_H - edge - ((s.u - lo) / span) * (PITCH_H - edge * 2)) * k,
    r: TOK_W / 2,
    hold: i === 0 ? 3 : 1,
  }));
  spread(dots, 16, { x0: TOK_W / 2 + 0.5, x1: 99.5 - TOK_W / 2, y0: edge * k, y1: (PITCH_H - edge) * k });
  return dots.map((d) => ({ x: d.x, y: d.y / k }));
}

export interface PeekView {
  open: boolean;
  /** 지금 협상하거나 살펴보는 선수. 같은 줄의 우리 선수를 도드라지게 한다. */
  focus: Player | null;
  /** 눌러서 자세히 보는 선수. */
  pick: number | null;
}

export function renderPeek(g: Game, o: PeekView): string {
  const mine = [...g.squad, ...g.reserves, ...g.loaned];
  const own = o.focus ? mine.find((p) => p.id === o.focus!.id) ?? null : null;
  const line: Pos | null = o.focus ? (own ? lineOf(g, own) : o.focus.pos) : null;
  // 주전으로 들어오면 밀려날 선수.
  const out = o.focus && !own ? weakest(g, o.focus.pos) : null;
  const pickId = o.pick ?? own?.id ?? null;
  const who = mine.find((p) => p.id === pickId) ?? null;
  const spots = peekSpots(slotsFor(g));
  const at = (i: number): number => effOvr(g.squad[i] as Player, lineAt(g, i));
  const on = (i: number): boolean => lineAt(g, i) === line;

  // 접힌 줄에도 쓸모 있는 숫자를 둔다. 협상 중이면 같은 줄의 선발과 후보, 아니면 줄마다 선발 평균.
  let sum: string;
  if (line) {
    const first = g.squad.map((_, i) => i).filter(on).map(at).sort((a, b) => b - a);
    const bench = g.reserves.filter((p) => p.pos === line).map((p) => p.ovr + p.temp).sort((a, b) => b - a);
    sum = `<span class="spot spot--${line}">${line}</span><span class="peek__nums">선발 ${first.map((v) => `<b>${v}</b>`).join(' ')}</span><span class="peek__nums peek__nums--sub">후보 ${bench.length ? bench.join(' ') : '없음'}</span>`;
  } else {
    sum = LINES.map((l) => {
      const list = g.squad.map((_, i) => i).filter((i) => lineAt(g, i) === l).map(at);
      return list.length ? `<span class="peek__ln"><span class="spot spot--${l}">${l}</span><b>${Math.round(list.reduce((a, b) => a + b, 0) / list.length)}</b></span>` : '';
    }).join('');
  }
  const bar = `<button type="button" class="peek__bar" data-peek="toggle" aria-expanded="${o.open}" aria-controls="peek-body">
      <span class="peek__title">스쿼드</span>
      <span class="peek__sum">${sum}</span>
      <span class="peek__chev" aria-hidden="true"></span>
    </button>`;
  if (!o.open) return `<aside class="peek" aria-label="내 스쿼드">${bar}</aside>`;

  const token = (p: Player, i: number): string => {
    const s = spots[i]!;
    const v = at(i);
    const cls = `${line && !on(i) ? ' is-dim' : ''}${p.id === out?.id ? ' is-out' : ''}${p.id === pickId ? ' is-picked' : ''}${alertsOf(g, p).length ? ' is-warn' : ''}${v < p.ovr + p.temp ? ' is-off' : ''}`;
    return `<button type="button" class="peek-tok peek-tok--${lineAt(g, i)}${cls}" style="left:${s.x.toFixed(1)}%;top:${((s.y / PITCH_H) * 100).toFixed(1)}%" data-peek="p:${p.id}" aria-pressed="${p.id === pickId}" aria-label="${esc(`${spotAt(g, i)} ${p.name} OVR ${v}`)}">
      <b>${v}</b><span>${esc(short(p))}</span>
    </button>`;
  };
  const row = (p: Player, away: boolean): string => `<li><button type="button" class="peek-row${line && p.pos !== line ? ' is-dim' : ''}${p.id === pickId ? ' is-picked' : ''}${alertsOf(g, p).length ? ' is-warn' : ''}" data-peek="p:${p.id}" aria-pressed="${p.id === pickId}">
      <span class="spot spot--${p.pos}">${p.spot}</span><span class="peek-row__name">${esc(short(p))}</span><span class="peek-row__age">${away ? '임대' : `${p.age}세`}</span><b>${p.ovr + p.temp}</b>
    </button></li>`;
  const bench = [...g.reserves].sort((a, b) => LINES.indexOf(a.pos) - LINES.indexOf(b.pos) || b.ovr + b.temp - (a.ovr + a.temp));

  const where = (p: Player): string => {
    const i = g.squad.findIndex((q) => q.id === p.id);
    return i >= 0 ? `선발 ${spotAt(g, i)}` : g.loaned.includes(p) ? `임대 보냄(${p.loan?.club ?? ''})` : '후보';
  };
  const note = who
    ? `<b>${esc(who.name)}</b> ${who.spot} · ${who.age}세 · OVR ${who.ovr + who.temp} · ${esc(where(who))} · ${esc(contractText(g, who.contract))}${flagsOf(g, who).map((f) => ` <span class="flag">${esc(f)}</span>`).join('')}`
    : out && o.focus
      ? `<b>${esc(o.focus.name)}</b> ${o.focus.spot} OVR ${o.focus.ovr + o.focus.temp}. 주전으로 오면 <b>${esc(out.name)}</b>(${out.spot} ${out.ovr + out.temp})이 후보로 밀린다.`
      : '선수를 누르면 나이와 계약이 보인다. 빨간 점은 불만이나 계약 만료처럼 손볼 일이 있는 선수.';

  return `<aside class="peek is-open" aria-label="내 스쿼드">
    ${bar}
    <div class="peek__body" id="peek-body">
      <div class="peek__cols">
        <div class="peek__pitch" role="group" aria-label="${esc(`선발 11명 · ${SHAPES[formationOf(g)].name}`)}">
          <svg class="peek__marks" viewBox="0 0 68 80" preserveAspectRatio="none" aria-hidden="true">
            <rect x="1" y="1" width="66" height="78"/><line x1="1" y1="40" x2="67" y2="40"/><circle cx="34" cy="40" r="7"/>
            <rect x="16" y="1" width="36" height="10"/><rect x="16" y="69" width="36" height="10"/>
          </svg>
          <span class="peek__shape">${esc(SHAPES[formationOf(g)].name)}</span>
          ${g.squad.map(token).join('')}
        </div>
        <div class="peek__bench">
          <p class="peek__head">후보 ${g.reserves.length}${g.job?.kind === 'club' ? `/${RESERVE_LIMIT}` : ''}${line ? ` · ${POS_NAME[line]} ${g.reserves.filter((p) => p.pos === line).length}` : ''}</p>
          ${bench.length + g.loaned.length ? `<ul class="peek__list">${bench.map((p) => row(p, false)).join('')}${g.loaned.map((p) => row(p, true)).join('')}</ul>` : '<p class="peek__none">후보가 없다. 빈자리는 이름 없는 2군이 메운다.</p>'}
        </div>
      </div>
      <p class="peek__note" role="status">${note}</p>
      <button type="button" class="peek__go" data-stab="xi">라인업에서 배치 바꾸기 ›</button>
    </div>
  </aside>`;
}
