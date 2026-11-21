// 선수 카드. 선수단, 이적 시장, 성장 결과에서 같은 모양으로 쓴다.
import { POS_NAME, TRAITS } from '../game/data.ts';
import { FOOT_NAME, SPOTS, statNames, statsOf } from '../game/player.ts';
import type { Player } from '../game/types.ts';

const esc = (text: string | number): string => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(5 - n);

/** 능력치 값에 따른 색 단계. */
const grade = (v: number): string => (v >= 80 ? 'hi' : v >= 65 ? 'mid' : v >= 50 ? 'low' : 'poor');

function spotBadge(p: Player): string {
  return `<span class="spot spot--${p.pos}" title="${esc(SPOTS[p.spot].name)}">${p.spot}</span>`;
}

/** 능력치 여섯 개 막대. compare가 있으면 그 선수와의 차이를 함께 적는다. */
export function statGrid(p: Player, compare?: Player): string {
  const values = statsOf(p);
  const other = compare ? statsOf(compare) : null;
  const { names, short } = statNames(p.spot);
  return `<dl class="statgrid">${values.map((v, k) => {
    const diff = other ? v - (other[k] as number) : 0;
    return `<div class="statgrid__row">
      <dt><span class="statgrid__short">${short[k]}</span> ${esc(names[k] as string)}</dt>
      <dd><span class="statbar" aria-hidden="true"><span class="statbar__fill statbar__fill--${grade(v)}" style="width:${v}%"></span></span>
      <span class="statgrid__val">${v}</span>${other && diff !== 0 ? `<span class="delta delta--${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : ''}${diff}</span>` : ''}</dd>
    </div>`;
  }).join('')}</dl>`;
}

function facts(p: Player, extra: string[]): string {
  const rows = [
    ['포지션', `${SPOTS[p.spot].name}(${p.spot})`],
    ['주발', `${FOOT_NAME[p.foot]} · 약발 ${stars(p.weak)}`],
    ['나이 · 키', `${p.age}세 · ${p.height}cm`],
    ...(p.trait ? [['특성', `${TRAITS[p.trait].name}: ${TRAITS[p.trait].desc}`]] : []),
    ...extra.map((e) => e.split('|') as [string, string]),
  ];
  return `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k as string)}</dt><dd>${esc(v as string)}</dd></div>`).join('')}</dl>`;
}

/** 펼치면 능력치가 보이는 한 줄. extra는 "제목|내용" 꼴의 추가 정보다. */
export function playerRow(p: Player, opts: { note?: string; delta?: number; extra?: string[]; open?: boolean } = {}): string {
  const ovr = p.ovr + p.temp;
  return `<li class="prow">
    <details class="prow__box"${opts.open ? ' open' : ''}>
      <summary class="prow__sum">
        ${spotBadge(p)}
        <span class="prow__name">${esc(p.name)}<span class="muted"> ${p.age}세 · ${FOOT_NAME[p.foot]}${opts.note ? ` · ${esc(opts.note)}` : ''}</span></span>
        ${opts.delta ? `<span class="delta delta--${opts.delta > 0 ? 'up' : 'down'}">${opts.delta > 0 ? '▲' : '▼'}${Math.abs(opts.delta)}</span>` : ''}
        <span class="prow__ovr" aria-label="오버롤 ${ovr}">${ovr}</span>
      </summary>
      <div class="prow__body">${facts(p, opts.extra ?? [])}${statGrid(p)}</div>
    </details>
  </li>`;
}

/** 이적 시장에서 보는 큰 카드. compare는 밀려날 주전이다. */
export function playerCard(p: Player, opts: { price?: string; note?: string; compare?: Player }): string {
  return `<article class="pcard">
    <header class="pcard__head">
      ${spotBadge(p)}
      <div class="pcard__who"><p class="pcard__name">${esc(p.name)}</p><p class="muted">${esc(POS_NAME[p.pos])} · ${esc(opts.note ?? '')}</p></div>
      <p class="pcard__ovr"><span>OVR</span>${p.ovr + p.temp}</p>
    </header>
    ${opts.price ? `<p class="pcard__price">${esc(opts.price)}</p>` : ''}
    ${facts(p, [])}
    ${statGrid(p, opts.compare)}
    ${opts.compare ? `<p class="fine">숫자 옆 증감은 지금 주전 ${esc(opts.compare.name)}(${opts.compare.spot}, OVR ${opts.compare.ovr})과의 차이다.</p>` : ''}
  </article>`;
}
