// out/*.json(위키백과에서 모은 구단 명단)으로 게임 자료 manager/src/game/world-clubs.ts를 만든다.
//   node scripts/research/build-world.mjs
// 이름: 한국어 위키백과 문서가 있으면 그 제목을 줄여 쓰고, 없으면 원어 이름을 그대로 쓴다.
// 전력(edge): 1부 명문 구단은 손으로 정하고, 나머지는 경기장 수용 인원 순위로 정한다(없으면 이름으로 정한 고정값).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('./out/', import.meta.url);
const ORDER = ['eng', 'esp', 'ger', 'ita', 'fra', 'jpn'];
const files = readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, OUT), 'utf8')));
files.sort((a, b) => ORDER.indexOf(a.id.slice(0, 3)) - ORDER.indexOf(b.id.slice(0, 3)) || a.id.localeCompare(b.id));

/** 1부 명문 구단의 전력. 표의 이름(영어 위키백과 표기) 기준. 게임용 추정이다. */
const ELITE = {
  'Real Madrid': 6, Barcelona: 6, 'Atlético Madrid': 4, 'Athletic Bilbao': 3, Villarreal: 3, 'Real Sociedad': 2, 'Real Betis': 2,
  'Bayern Munich': 7, 'Borussia Dortmund': 4, 'Bayer Leverkusen': 4, 'RB Leipzig': 3, 'Eintracht Frankfurt': 2, 'VfB Stuttgart': 2,
  'Inter Milan': 5, Napoli: 4, Juventus: 4, 'AC Milan': 4, Atalanta: 3, Roma: 3, Lazio: 2, Como: 2,
  'Paris Saint-Germain': 7, Marseille: 3, Monaco: 3, Lyon: 2, Lille: 2,
  'Kashima Antlers': 3, 'Vissel Kobe': 3, 'Sanfrecce Hiroshima': 3, 'Kawasaki Frontale': 2, 'Urawa Red Diamonds': 2,
};

/** 줄여 부르는 이름. */
const SHORT = {
  '인테르나치오날레 밀라노': '인테르', '1899 호펜하임': '호펜하임', '바이어 04 레버쿠젠': '레버쿠젠', '마인츠 05': '마인츠',
  '보루시아 도르트문트': '도르트문트', '보루시아 묀헨글라트바흐': '묀헨글라트바흐', '올랭피크 드 마르세유': '마르세유', '올랭피크 리옹': '리옹',
  '파리 생제르맹': '파리 생제르맹', '스타드 브레스투아 29': '브레스트', '스타드 렌': '렌', '스타드 드 랭스': '랭스', '스타드 라발루아': '라발',
  '데포르티보 알라베스': '알라베스', 파리: '파리 FC',
};

const PREFIX = /^(?:1\. FC|1\. FSV|FC|AFC|CF|SC|AC|AS|US|SS|SSC|UC|RC|RCD|CD|UD|SD|CA|SV|VfB|VfL|TSG|SpVgg|FCO|EA|OGC|ES|USL|AJ|SM|ACF|L\.R\.|SG|MSV|KFC|SSV|AD|CE|RB|RKD)\s+/;
const SUFFIX = /\s+(?:FC(?: \d{4})?|AFC|CF|BC|CFC|AC|FBC|SCO|FCO|AF|SAD)$/;
/** 독일 구단은 SC를 떼면 어색하다(카를스루어 SC). 다른 나라는 뗀다. */
const SC = /\s+SC$/;

function cleanKo(ko, country) {
  let s = ko.replace(/\s*\([^)]*\)$/, '');
  if (country !== 'jpn') {
    for (let i = 0; i < 2; i++) s = s.replace(PREFIX, '').replace(SUFFIX, '').replace(country === 'ger' ? /$^/ : SC, '');
  }
  return SHORT[s] ?? s;
}

const cleanRaw = (name) => name
  .replace(/\b(?:A\.C\.D\.|A\.C\.|A\.S\.D\.|G\.S\.|U\.S\.D\.|S\.S\.D\.|S\.C\.|F\.C\.D\.|Pol\.D\.|F\.B\.C\.|a r\.l\.)/g, '')
  .replace(/\s+/g, ' ').trim();

/** 2군 팀 표시(II, B, 2, Next Gen). 한국어 문서가 1군 문서면 뒤에 붙인다. */
const reserveTag = (name) => /\s(II|B|2)$/.exec(name)?.[1] ?? null;

function hash(t) {
  let h = 7;
  for (const ch of t) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

const used = new Map();
/** 1·2부 구단 이름. 이 구단과 이름이 같은 하부 리그 팀은 2군이다. */
const proClubs = new Set();
const out = {};
const sources = {};
for (const L of files) {
  const country = L.id.slice(0, 3);
  const top = L.id.endsWith('1');
  const withCap = L.clubs.filter((c) => c.cap).sort((a, b) => b.cap - a.cap);
  const clubs = L.clubs.map((c) => {
    let name;
    const tag = reserveTag(c.name);
    if (c.ko) {
      name = cleanKo(c.ko, country);
      if (tag && !new RegExp(`\\s(${tag}|II|B|2)$`).test(name)) name = `${name} ${tag}`;
    } else name = cleanRaw(c.name);
    // 줄인 이름이 다른 구단과 겹치면 줄이지 않은 한국어 제목을 쓴다(UD 오우렌세와 오우렌세 CF).
    if (used.has(name) && c.ko && used.get(name) !== c.ko) name = c.ko.replace(/\s*\([^)]*\)$/, '');
    // 같은 구단이 윗리그에 있으면: 프로 구단이면 2군 팀(B)이고, 아니면 문서끼리 명단이 어긋난 것이라 뺀다.
    if (used.has(name)) {
      if (!proClubs.has(name)) return null;
      name = `${name} B`;
    }
    used.set(name, c.ko ?? c.name);
    let edge;
    if (top && ELITE[c.name] !== undefined) edge = ELITE[c.name];
    else if (c.cap && withCap.length >= L.clubs.length * 0.7) {
      const rank = withCap.indexOf(c) / Math.max(1, withCap.length - 1);
      edge = Math.round((top ? 2 : 4) - rank * (top ? 6 : 8));
    } else edge = (hash(c.name) % 7) - 3;
    if (tag) edge = Math.min(edge, 0);
    if (/[12]$/.test(L.id)) proClubs.add(name);
    return [name, edge];
  }).filter(Boolean);
  out[L.id] = clubs;
  sources[L.id] = `${L.lang}:${L.page}#${L.section}`;
}

const body = Object.entries(out).map(([id, clubs]) => `  ${id}: [\n${clubs.map(([n, e]) => `    [${JSON.stringify(n)}, ${e}],`).join('\n')}\n  ],`).join('\n');
const src = Object.entries(sources).map(([id, s]) => `  ${id}: ${JSON.stringify(s)},`).join('\n');
writeFileSync(new URL('../../manager/src/game/world-clubs.ts', import.meta.url), `// 자동 생성 파일: scripts/research/build-world.mjs가 위키백과에서 모은 명단(scripts/research/out)으로 만든다. 손으로 고치지 말 것.
// 2026-27 시즌(일본은 2026-27 특별 시즌, 간토 리그는 2026) 참가 구단. 지역별로 나뉜 리그는 한 권역만 넣었다.
// [이름, 전력]: 이름은 한국어 위키백과 문서가 있으면 그 제목을 줄인 것, 없으면 원어 이름. 전력은 리그 평균 대비 게임용 추정치다.
export const WORLD_CLUBS: Record<string, [string, number][]> = {
${body}
};

/** 명단을 가져온 위키백과 문서(언어:제목#섹션). */
export const WORLD_SOURCES: Record<string, string> = {
${src}
};
`);
console.log(Object.entries(out).map(([id, c]) => `${id} ${c.length}`).join(' · '));
