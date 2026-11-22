// 선수 얼굴 일러스트. 선수는 모두 지어낸 인물이라 사진이 없다. 대신 선수 번호(또는 이름)와 국적으로 정해지는
// 단순한 얼굴을 그린다. 같은 선수는 언제나 같은 얼굴이다.

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
function dice(seed: number): () => number {
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

/**
 * 얼굴 SVG. seed는 선수 번호(없으면 이름의 해시), kit는 유니폼 두 색.
 * 머리 모양 여덟 가지, 수염, 눈썹 굵기가 씨앗에 따라 정해진다.
 */
export function face(seed: number, nat: string, size = 36, kit: [string, string] = ['#3d4b44', '#ffffff'], title = ''): string {
  const r = dice(seed);
  const group = groupOf(nat || '대한민국', r);
  const skin = pick(r, SKIN[group]);
  const hairColor = pick(r, HAIR[group]);
  const style = group === 'africa' ? pick(r, [0, 1, 1, 5, 6, 6, 7]) : group === 'asia' ? pick(r, [0, 0, 2, 2, 3, 4, 7, 1]) : pick(r, [0, 1, 2, 2, 3, 4, 5, 7]);
  const beard = r() < (group === 'asia' ? 0.12 : 0.35);
  const brow = r() < 0.5 ? 1.6 : 2.2;
  const jaw = 0.9 + r() * 0.15;
  const eyeY = 19.5 + r() * 1.2;
  const smile = r() < 0.5;
  const shade = 'rgba(0,0,0,0.18)';
  const hair = (() => {
    switch (style) {
      case 0: return `<path d="M11 17 C10.5 9.5 15 6.5 20 6.5 C25 6.5 29.5 9.5 29 17 C27.5 13 24.5 11.6 20 11.6 C15.5 11.6 12.5 13 11 17 Z" fill="${hairColor}"/>`;
      case 1: return `<path d="M11.5 16 C11.5 10 15.5 8 20 8 C24.5 8 28.5 10 28.5 16 C26.5 12.6 23.5 11.8 20 11.8 C16.5 11.8 13.5 12.6 11.5 16 Z" fill="${hairColor}" opacity="0.65"/>`;
      case 2: return `<path d="M10.8 18 C9.5 9 15 5.8 20.5 5.8 C26.5 5.8 30.6 9.5 29.2 18 C28 13.5 26.5 12 23.5 11.2 C20 12.6 15 12.6 12.4 13.6 C11.6 14.8 11.1 16.2 10.8 18 Z" fill="${hairColor}"/>`;
      case 3: return `<path d="M10.8 17 C9 12 11 6.5 15 6 C16 4.5 19 4 20.5 5 C22.5 3.8 25.5 4.6 26.2 6.4 C30 7.4 31 12 29.2 17 C28 13 25 11.5 20 11.5 C15 11.5 12 13 10.8 17 Z" fill="${hairColor}"/>`;
      case 4: return `<path d="M10.5 19 C9 9 14.5 5.5 20 5.5 C25.5 5.5 31 9 29.5 19 C28.5 14 26 11.5 20 11.5 C14 11.5 11.5 14 10.5 19 Z" fill="${hairColor}"/><circle cx="20" cy="4.6" r="2.6" fill="${hairColor}"/>`;
      case 5: return `<path d="M12 16.5 C12.5 11 15.6 9 20 9 C24.4 9 27.5 11 28 16.5" fill="none" stroke="${shade}" stroke-width="0.8"/>`;
      case 6: return `<path d="M9.5 18 C7 10 12 4 20 4 C28 4 33 10 30.5 18 C29.5 13.5 26 11 20 11 C14 11 10.5 13.5 9.5 18 Z" fill="${hairColor}"/>`;
      default: return `<path d="M17 12 C17 7 18.5 5 20 5 C21.5 5 23 7 23 12 Z" fill="${hairColor}"/><path d="M11.5 16 C11.8 12 13.5 11 15.5 10.6 M28.5 16 C28.2 12 26.5 11 24.5 10.6" stroke="${hairColor}" stroke-width="1.2" opacity="0.5" fill="none"/>`;
    }
  })();
  const body = kit[0];
  const trim = kit[1];
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="${title ? `${title} 얼굴` : '선수 얼굴'}">
    <clipPath id="fc${seed}"><circle cx="20" cy="20" r="20"/></clipPath>
    <g clip-path="url(#fc${seed})">
      <rect width="40" height="40" fill="#dfe7e0"/>
      <path d="M4 40 C5 31 11 28.5 20 28.5 C29 28.5 35 31 36 40 Z" fill="${body}"/>
      <path d="M15.5 28.8 L20 33 L24.5 28.8" fill="none" stroke="${trim}" stroke-width="1.6"/>
      <rect x="17" y="24" width="6" height="6" rx="2" fill="${skin}"/>
      <path d="M17 27.5 C18.5 28.6 21.5 28.6 23 27.5" stroke="${shade}" stroke-width="1" fill="none"/>
      <ellipse cx="11.4" cy="20" rx="1.6" ry="2.4" fill="${skin}"/>
      <ellipse cx="28.6" cy="20" rx="1.6" ry="2.4" fill="${skin}"/>
      <path d="M11.5 17 C11.5 10.5 15 8.5 20 8.5 C25 8.5 28.5 10.5 28.5 17 L28.5 20 C28.5 ${24 * jaw} 24.5 27 20 27 C15.5 27 11.5 ${24 * jaw} 11.5 20 Z" fill="${skin}"/>
      ${beard ? `<path d="M12.2 21 C12.6 25 16 27 20 27 C24 27 27.4 25 27.8 21 C26 24.5 23.5 25 20 25 C16.5 25 14 24.5 12.2 21 Z" fill="${hairColor}" opacity="0.55"/>` : ''}
      ${hair}
      <path d="M14.3 ${eyeY - 2.4} L17.6 ${eyeY - 2.8} M22.4 ${eyeY - 2.8} L25.7 ${eyeY - 2.4}" stroke="${hairColor}" stroke-width="${brow}" stroke-linecap="round"/>
      <circle cx="16" cy="${eyeY}" r="1.05" fill="#1b1410"/>
      <circle cx="24" cy="${eyeY}" r="1.05" fill="#1b1410"/>
      <path d="M20 ${eyeY + 0.5} L19.2 ${eyeY + 3.4} L20.6 ${eyeY + 3.6}" stroke="${shade}" stroke-width="0.9" fill="none" stroke-linecap="round"/>
      <path d="${smile ? `M17.4 ${eyeY + 5.2} C18.6 ${eyeY + 6.4} 21.4 ${eyeY + 6.4} 22.6 ${eyeY + 5.2}` : `M17.8 ${eyeY + 5.6} L22.2 ${eyeY + 5.6}`}" stroke="#7a3b2e" stroke-width="1" fill="none" stroke-linecap="round"/>
    </g>
  </svg>`;
}
