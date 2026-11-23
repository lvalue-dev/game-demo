// 선수 얼굴 스티커. 선수는 모두 지어낸 인물이라 사진이 없다. 대신 선수 번호(또는 이름)와 국적으로 정해지는
// 납작한 스티커 그림을 그린다. 같은 선수는 언제나 같은 얼굴이다.

const ASIA = new Set(['대한민국', '일본', '중국', '태국', '베트남', '인도네시아', '말레이시아', '캄보디아', '싱가포르', '미얀마']);
const AFRICA = new Set(['세네갈', '나이지리아', '코트디부아르', '가나', '카메룬']);
const LATIN = new Set(['브라질', '콜롬비아', '우루과이', '멕시코', '에콰도르', '모로코', '알제리', '튀니지', '카타르', '이란', '사우디아라비아', '이라크', '요르단', '아랍에미리트', '오만', '바레인']);
const MIXED = new Set(['잉글랜드', '프랑스', '네덜란드', '벨기에', '미국', '포르투갈', '스페인', '독일', '이탈리아', '스위스']);

const SKIN = {
  asia: ['#f3d2b3', '#eac4a0', '#e0b48e', '#d8a982'],
  europe: ['#f6d5c0', '#eec3a6', '#e2ad8a', '#f1cdb4'],
  latin: ['#d9a07c', '#c68a63', '#b07650', '#a86d48'],
  africa: ['#8d5a3b', '#6f4429', '#5a3520', '#7a4a2f'],
};
const HAIR = {
  asia: ['#161210', '#221a14', '#2e2219', '#3b2a1c'],
  europe: ['#2b1d14', '#4a3020', '#6b4428', '#a57843', '#d2a659', '#8a4b26'],
  latin: ['#161210', '#221a14', '#3b2a1c', '#4a3020'],
  africa: ['#0f0c0a', '#161210', '#221a14'],
};

/** 0~1 난수 여러 개를 씨앗 하나에서 뽑는다. */
export function dice(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashName(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
  return h;
}

type Group = keyof typeof SKIN;

function groupOf(nat: string, r: () => number): Group {
  if (ASIA.has(nat)) return 'asia';
  if (AFRICA.has(nat)) return 'africa';
  if (nat === '브라질') return r() < 0.35 ? 'africa' : r() < 0.6 ? 'europe' : 'latin';
  if (LATIN.has(nat)) return 'latin';
  if (MIXED.has(nat)) return r() < 0.22 ? 'africa' : r() < 0.1 ? 'latin' : 'europe';
  return 'europe';
}

const pick = <T,>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length)] as T;

/** 씨앗에서 가장 먼저 정해지는 것: 계통, 살색, 머리색. */
function looks(r: () => number, nat: string): [Group, string, string] {
  const group = groupOf(nat || '대한민국', r);
  return [group, pick(r, SKIN[group]), pick(r, HAIR[group])];
}

/** 얼굴 스티커와 같은 살색과 머리색. 경기장 위의 작은 선수 그림이 쓴다. */
export function tones(seed: number, nat: string): [string, string] {
  const [, skin, hair] = looks(dice(seed), nat);
  return [skin, hair];
}

/**
 * 선수 스티커 SVG. seed는 선수 번호(없으면 이름의 해시), kit는 유니폼 두 색.
 * 수집용 스티커처럼 납작한 면으로만 그린다: 종이색 바탕에 팀 색 사선 띠, 한쪽에만 떨어지는 그림자, 굵은 머리 실루엣.
 * 머리 모양 여덟 가지, 수염, 눈썹 굵기, 옷깃이 씨앗에 따라 정해진다. 모서리는 CSS(.face)가 둥글린다.
 */
export function face(seed: number, nat: string, size = 36, kit: [string, string] = ['#3d4b44', '#ffffff'], title = ''): string {
  const r = dice(seed);
  const [group, skin, hairColor] = looks(r, nat);
  const style = group === 'africa' ? pick(r, [0, 1, 1, 5, 6, 6, 7]) : group === 'asia' ? pick(r, [0, 0, 2, 2, 3, 4, 7, 1]) : pick(r, [0, 1, 2, 2, 3, 4, 5, 7]);
  const beard = r() < (group === 'asia' ? 0.12 : 0.35);
  const brow = r() < 0.5 ? 1.7 : 2.3;
  const jaw = 0.9 + r() * 0.15;
  const eyeY = 19.3 + r() * 1.2;
  const smile = r() < 0.5;
  const crew = r() < 0.4;
  const shade = 'rgba(30,14,6,0.16)';
  const hair = (() => {
    switch (style) {
      case 0: return `<path d="M11 17.2 C10.2 9 15 6 20 6 C25 6 29.8 9 29 17.2 C27.6 13 24.5 11.4 20 11.4 C15.5 11.4 12.4 13 11 17.2 Z" fill="${hairColor}"/>`;
      case 1: return `<path d="M11.4 16.4 C11.2 10 15.4 7.8 20 7.8 C24.6 7.8 28.8 10 28.6 16.4 C26.6 12.4 23.6 11.6 20 11.6 C16.4 11.6 13.4 12.4 11.4 16.4 Z" fill="${hairColor}" opacity="0.7"/>`;
      case 2: return `<path d="M10.8 18.2 C9.2 8.6 15 5.4 20.6 5.4 C26.8 5.4 30.8 9.4 29.2 18.2 C28.2 13.6 26.6 12 23.6 11 C20 13 15 12.8 12.4 13.8 C11.6 15 11.1 16.4 10.8 18.2 Z" fill="${hairColor}"/>`;
      case 3: return `<path d="M10.9 17 C10 13 11.5 11 13 10.5 H27 C28.5 11 30 13 29.1 17 C28 13.4 25 11.6 20 11.6 C15 11.6 12 13.4 10.9 17 Z" fill="${hairColor}"/><g fill="${hairColor}"><circle cx="13.4" cy="9.4" r="3.1"/><circle cx="17.6" cy="7.2" r="3.3"/><circle cx="22.4" cy="7.2" r="3.3"/><circle cx="26.6" cy="9.4" r="3.1"/></g>`;
      case 4: return `<path d="M10.5 24.5 C8.6 12 13.5 5.4 20 5.4 C26.5 5.4 31.4 12 29.5 24.5 C28.8 18.5 28 14.4 26.6 12.4 C23 13.6 17 13.6 13.4 12.4 C12 14.4 11.2 18.5 10.5 24.5 Z" fill="${hairColor}"/><path d="M11.6 13 C15.5 10.4 24.5 10.4 28.4 13" fill="none" stroke="${kit[1]}" stroke-width="1.5" stroke-linecap="round"/>`;
      case 5: return `<path d="M13.6 12.6 C15 10.6 17 9.9 19 9.8" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.3" stroke-linecap="round"/>`;
      case 6: return `<path d="M9.3 18.4 C6.4 10 12 3.4 20 3.4 C28 3.4 33.6 10 30.7 18.4 C29.6 13.6 26 11 20 11 C14 11 10.4 13.6 9.3 18.4 Z" fill="${hairColor}"/>`;
      default: return `<path d="M15.6 12.2 C15.4 6.6 17.6 4.6 20 4.6 C22.4 4.6 24.6 6.6 24.4 12.2 Z" fill="${hairColor}"/><path d="M11.5 16.2 C11.6 12.6 13.2 11 15.4 10.6 L15.6 12.2 C13.6 12.8 12.4 14 11.5 16.2 Z M28.5 16.2 C28.4 12.6 26.8 11 24.6 10.6 L24.4 12.2 C26.4 12.8 27.6 14 28.5 16.2 Z" fill="${hairColor}" opacity="0.55"/>`;
    }
  })();
  const body = kit[0];
  const trim = kit[1];
  const chin = (24 * jaw).toFixed(1);
  const y = (n: number): string => (eyeY + n).toFixed(1);
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="${title ? `${title} 얼굴` : '선수 얼굴'}">
    <rect width="40" height="40" fill="#e7eadf"/>
    <path d="M-2 31 L27 -2 H42 V7 L9 42 H-2 Z" fill="${body}" opacity="0.2"/>
    <path d="M3 40 C4 31.6 10 29 20 29 C30 29 36 31.6 37 40 Z" fill="${body}"/>
    <path d="${crew ? 'M14.8 29.4 C17 32.4 23 32.4 25.2 29.4' : 'M15.2 29.2 L20 33.6 L24.8 29.2'}" fill="none" stroke="${trim}" stroke-width="1.9" stroke-linejoin="round"/>
    <rect x="16.6" y="23" width="6.8" height="7.4" rx="2.2" fill="${skin}"/>
    <path d="M16.6 25.4 C18.5 28 21.5 28 23.4 25.4 V27.8 C21.5 29.6 18.5 29.6 16.6 27.8 Z" fill="${shade}"/>
    <ellipse cx="11.3" cy="20" rx="1.7" ry="2.5" fill="${skin}"/>
    <ellipse cx="28.7" cy="20" rx="1.7" ry="2.5" fill="${skin}"/>
    <path d="M11.5 17 C11.5 10.5 15 8.5 20 8.5 C25 8.5 28.5 10.5 28.5 17 V20 C28.5 ${chin} 24.5 27 20 27 C15.5 27 11.5 ${chin} 11.5 20 Z" fill="${skin}"/>
    <path d="M20 8.5 C25 8.5 28.5 10.5 28.5 17 V20 C28.5 ${chin} 24.5 27 20 27 C23.4 24.6 24.6 20.4 24.2 15.6 C23.9 12 22.4 9.6 20 8.5 Z" fill="${shade}"/>
    ${beard ? `<path d="M12 20.6 C12.4 25.2 16 27.2 20 27.2 C24 27.2 27.6 25.2 28 20.6 C26.2 24.2 23.6 24.6 20 24.6 C16.4 24.6 13.8 24.2 12 20.6 Z" fill="${hairColor}" opacity="0.6"/>` : ''}
    ${hair}
    <path d="M14.2 ${y(-2.5)} L17.7 ${y(-2.9)} M22.3 ${y(-2.9)} L25.8 ${y(-2.5)}" stroke="${hairColor}" stroke-width="${brow}" stroke-linecap="round"/>
    <ellipse cx="16" cy="${y(0)}" rx="1" ry="1.25" fill="#1b1410"/>
    <ellipse cx="24" cy="${y(0)}" rx="1" ry="1.25" fill="#1b1410"/>
    <path d="M20.2 ${y(1)} L19.3 ${y(3.4)} H20.9" stroke="${shade}" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${smile ? `M17.4 ${y(5.3)} C18.6 ${y(6.5)} 21.4 ${y(6.5)} 22.6 ${y(5.3)}` : `M17.9 ${y(5.7)} H22.1`}" stroke="#6e3226" stroke-width="1.1" fill="none" stroke-linecap="round"/>
  </svg>`;
}
