// 선수 카드. 선수단, 이적 시장, 성장 결과에서 같은 모양으로 쓴다.
import { POS_NAME, TRAITS } from '../game/data.ts';
import { FOOT_NAME, SPOTS, statNames, statsOf } from '../game/player.ts';
import type { Player } from '../game/types.ts';

const esc = (text: string | number): string => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(5 - n);

/** 능력치 값에 따른 색 단계. */
const grade = (v: number): string => (v >= 80 ? 'hi' : v >= 65 ? 'mid' : v >= 50 ? 'low' : 'poor');

/** 색이 밝은지. 등번호 글자색을 고른다. */
function light(hex: string): boolean {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
}

/** 유니폼 모양 아이콘. 팀 색 두 가지와 등번호. 골키퍼는 다른 색을 입는다. */
export function jersey(colors: [string, string], no: number, size = 30, keeper = false): string {
  const body = keeper ? '#f2c230' : colors[0];
  const trim = keeper ? '#1d1d1d' : colors[1];
  const ink = light(body) ? '#111' : '#fff';
  return `<svg class="jersey" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M10 3 L6 5 L1 11 L5 15 L8 12.5 L8 30 L24 30 L24 12.5 L27 15 L31 11 L26 5 L22 3 C21 6 19 7.5 16 7.5 C13 7.5 11 6 10 3 Z" fill="${body}" stroke="rgba(0,0,0,0.45)" stroke-width="1"/>
    <path d="M10 3 C11 6 13 7.5 16 7.5 C19 7.5 21 6 22 3" fill="none" stroke="${trim}" stroke-width="2"/>
    <path d="M1 11 L5 15 M31 11 L27 15" stroke="${trim}" stroke-width="2"/>
    ${no > 0 ? `<text x="16" y="23" text-anchor="middle" font-family="'Barlow Condensed', system-ui, sans-serif" font-weight="700" font-size="${no >= 10 ? 12 : 13}" fill="${ink}">${no}</text>` : ''}
  </svg>`;
}

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
export function playerRow(p: Player, opts: { note?: string; delta?: number; extra?: string[]; open?: boolean; kit?: [string, string]; actions?: string; flag?: string } = {}): string {
  const ovr = p.ovr + p.temp;
  return `<li class="prow">
    <details class="prow__box"${opts.open ? ' open' : ''}>
      <summary class="prow__sum">
        ${opts.kit && p.no ? jersey(opts.kit, p.no, 30, p.pos === 'GK') : ''}
        ${spotBadge(p)}
        <span class="prow__name">${esc(p.name)}${opts.flag ? ` <span class="flag">${esc(opts.flag)}</span>` : ''}<span class="muted"> ${p.age}세 · ${FOOT_NAME[p.foot]}${opts.note ? ` · ${esc(opts.note)}` : ''}</span></span>
        ${opts.delta ? `<span class="delta delta--${opts.delta > 0 ? 'up' : 'down'}">${opts.delta > 0 ? '▲' : '▼'}${Math.abs(opts.delta)}</span>` : ''}
        <span class="prow__ovr" aria-label="오버롤 ${ovr}">${ovr}</span>
      </summary>
      <div class="prow__body">${facts(p, opts.extra ?? [])}${statGrid(p)}${opts.actions ?? ''}</div>
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

export interface BoardSpot {
  /** 0~1, 왼쪽에서 오른쪽. */
  x: number;
  /** 0~1, 위(상대 골문)에서 아래(우리 골문). */
  y: number;
  no: number;
  name: string;
  keeper: boolean;
  /** 2군 선수(이름 없는 뎁스)면 흐리게. */
  ghost: boolean;
}

/** 세로 경기장 위의 베스트 11. */
export function formationBoard(spots: BoardSpot[], kit: [string, string], label: string): string {
  const W = 300;
  const H = 400;
  const short = (name: string): string => (name.includes(' ') ? (name.split(' ').pop() as string) : name);
  return `<figure class="board11">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <rect width="${W}" height="${H}" fill="#2a7d4a"/>
      ${Array.from({ length: 8 }, (_, i) => (i % 2 ? `<rect x="0" y="${(H / 8) * i}" width="${W}" height="${H / 8}" fill="#2f8a52"/>` : '')).join('')}
      <g fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2">
        <rect x="6" y="6" width="${W - 12}" height="${H - 12}"/>
        <line x1="6" y1="${H / 2}" x2="${W - 6}" y2="${H / 2}"/>
        <circle cx="${W / 2}" cy="${H / 2}" r="36"/>
        <rect x="${W / 2 - 80}" y="6" width="160" height="62"/><rect x="${W / 2 - 80}" y="${H - 68}" width="160" height="62"/>
        <rect x="${W / 2 - 36}" y="6" width="72" height="22"/><rect x="${W / 2 - 36}" y="${H - 28}" width="72" height="22"/>
      </g>
      ${spots.map((s) => {
        const cx = 16 + s.x * (W - 32);
        const cy = 22 + s.y * (H - 52);
        return `<g transform="translate(${cx - 17} ${cy - 20})" opacity="${s.ghost ? 0.55 : 1}">
          ${jersey(kit, s.no, 34, s.keeper).replace('<svg class="jersey"', '<svg class="jersey" x="0" y="0"')}
          <text x="17" y="44" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" stroke="rgba(0,0,0,0.55)" stroke-width="3" paint-order="stroke">${esc(short(s.name))}</text>
        </g>`;
      }).join('')}
    </svg>
    <figcaption class="fine">${esc(label)}</figcaption>
  </figure>`;
}

/** 대형 미리보기. 선택지 옆에 붙인다. */
export function formationMini(points: { x: number; y: number }[]): string {
  return `<svg class="mini11" viewBox="0 0 40 52" aria-hidden="true">
    <rect width="40" height="52" rx="3" fill="#2f8a52"/>
    <g fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1"><rect x="2" y="2" width="36" height="48"/><line x1="2" y1="26" x2="38" y2="26"/></g>
    ${points.map((p) => `<circle cx="${4 + p.x * 32}" cy="${5 + p.y * 42}" r="2.6" fill="#fff"/>`).join('')}
  </svg>`;
}
