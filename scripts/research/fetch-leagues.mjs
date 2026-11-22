// 리그 문서에서 참가 구단을 모은다.
//   NODE_USE_ENV_PROXY=1 node scripts/research/fetch-leagues.mjs [리그id ...]
// 결과: scripts/research/out/<리그id>.json
//   { id, lang, page, section, clubs: [{ name: 표에 적힌 이름, title: 구단 문서 제목(없으면 null), ko: 한국어 문서 제목 }] }
// 문서마다 구단을 적는 방식이 달라서 mode로 고른다.
//   table   섹션 첫 표의 행마다 첫 링크(없으면 첫 칸 글자)
//   sports  순위표 모듈의 name_XXX=[[...]]
//   map     위치 지도의 팀 이름표(label=[[...]])
//   bullets 섹션 첫 표의 첫 칸에 있는 글머리 목록
import { mkdirSync, writeFileSync } from 'node:fs';
import { koTitles, wikitext } from './wiki.mjs';
import { LEAGUES } from './leagues.mjs';

const only = process.argv.slice(2);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });

function sections(text) {
  const out = [];
  let cur = { title: '(머리)', level: 1, body: [] };
  for (const line of text.split('\n')) {
    const m = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (m) {
      out.push(cur);
      cur = { title: m[2], level: m[1].length, body: [] };
    } else cur.body.push(line);
  }
  out.push(cur);
  return out.map((s) => ({ ...s, body: s.body.join('\n') }));
}

const LINK = /\[\[(:?[a-z]{2}:)?([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const SKIP = /^(File|Image|Category|Datei|File|Fichier|ファイル):/i;

/** 위키 마크업을 걷어 낸 글자. */
const plain = (s) => s.replace(/<ref[^>]*\/>|<ref[^>]*>.*?<\/ref>/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(LINK, (_, i, t, l) => l ?? t).replace(/<[^>]+>|'''?/g, '').replace(/\s+/g, ' ').trim();

/** 링크 하나를 {name, title}로. 다른 언어 위키 링크(:ja:)는 문서 제목을 쓰지 않는다. */
function entry(m) {
  const [, inter, t, label] = m;
  const title = t.trim();
  const name = plain(label ?? title.replace(/\s*\([^)]*\)$/, ''));
  return { name, title: inter ? null : title, inter: inter ? inter.replace(/:/g, '') : null };
}

function firstTable(body) {
  const start = body.indexOf('{|');
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < body.length - 1; i++) {
    if (body.startsWith('{|', i)) depth++;
    if (body.startsWith('|}', i) && --depth === 0) return body.slice(start, i);
  }
  return body.slice(start);
}

function fromTable(body) {
  const rows = firstTable(body).split(/\n\|-[^\n]*/).slice(1);
  const out = [];
  for (const row of rows) {
    const cells = row.split(/\n\||\|\|/).map((c) => c.replace(/^\s*(?:[a-z-]+="[^"]*"\s*)+\|/i, '')).filter((c) => c.trim() && !c.trim().startsWith('!'));
    const first = cells[0];
    if (!first) continue;
    const links = [...row.matchAll(LINK)].filter((m) => !SKIP.test(m[2]));
    // 첫 칸에 링크가 있으면 그 링크, 없으면 첫 칸 글자(하부 리그 구단은 문서가 없는 경우가 많다).
    const inFirst = [...first.matchAll(LINK)].filter((m) => !SKIP.test(m[2]));
    // 경기장 수용 인원: 천 단위 쉼표가 있거나 formatnum으로 적힌 1천~12만 사이 숫자 가운데 가장 큰 것.
    const nums = [...row.matchAll(/formatnum:\s*([\d,]+)|\b(\d{1,3}(?:,\d{3})+)\b/g)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, ''))).filter((n) => n >= 1000 && n <= 120000);
    const cap = nums.length ? Math.max(...nums) : null;
    const before = out.length;
    // 다른 언어 위키로만 이어진 구단("Edo All United ([[:ja:...|ja]])")은 글자 이름을 쓴다.
    if (inFirst.length && !inFirst[0][1]) out.push(entry(inFirst[0]));
    else if (inFirst.length) out.push({ name: plain(first.replace(/\(\s*\[\[:[a-z]{2}:[^\]]*\]\]\s*\)/g, '')), title: null, inter: inFirst[0][1].replace(/:/g, '') });
    else if (/\[\[/.test(row) || plain(first)) {
      const name = plain(first);
      if (name && !/^\d+$/.test(name)) out.push({ name, title: null, inter: null });
      else if (links[0]) out.push(entry(links[0]));
    }
    if (out.length > before) out[out.length - 1].cap = cap;
  }
  return out;
}

/** 순위표 모듈. team_order 순서대로, name_코드의 링크가 없으면 win_코드 줄 끝의 주석 이름을 쓴다. */
function fromSports(body) {
  const order = (/team_order\s*=\s*([^\n|]+)/.exec(body)?.[1] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const named = {};
  for (const m of body.matchAll(/\|\s*name_([^=\s]+)\s*=\s*(\[\[[^\]]+\]\])/g)) named[m[1]] = entry([...m[2].matchAll(LINK)][0]);
  const noted = {};
  for (const m of body.matchAll(/\|\s*win_([^=\s]+)\s*=[^\n]*?<!--\s*(.*?)\s*-->/g)) noted[m[1]] = m[2];
  return order.map((c) => named[c] ?? (noted[c] ? { name: noted[c], title: null, inter: null } : null)).filter(Boolean);
}

const fromMap = (body) => [...body.matchAll(/label\s*=\s*\{\{small\|([^'\n]*?\[\[[^\]]+\]\])\}\}/g)].map((m) => entry([...m[1].matchAll(LINK)][0]));

function fromBullets(body) {
  const table = firstTable(body);
  const firstCell = table.split(/\n\|\s*\n/)[1] ?? '';
  return firstCell.split('\n').filter((l) => /^\*/.test(l)).map((l) => {
    const m = [...l.matchAll(LINK)][0];
    return m ? entry(m) : { name: plain(l.replace(/^\*+/, '')), title: null, inter: null };
  });
}

const MODES = { table: fromTable, sports: fromSports, map: fromMap, bullets: fromBullets };

for (const L of LEAGUES) {
  if (only.length && !only.includes(L.id)) continue;
  const lang = L.lang ?? 'en';
  const text = await wikitext(lang, L.page);
  if (!text) {
    console.log(L.id, '문서 없음', L.page);
    continue;
  }
  const secs = sections(text);
  const want = new RegExp(L.section, 'i');
  const inside = L.within ? new RegExp(L.within, 'i') : null;
  const mode = L.mode ?? 'table';
  const has = { table: (b) => b.includes('{|'), bullets: (b) => b.includes('{|'), sports: (b) => /name_/.test(b), map: (b) => /Location map/.test(b) }[mode];
  let parentOk = !inside;
  let chosen = null;
  for (const s of secs) {
    if (inside && inside.test(s.title)) parentOk = true;
    if (parentOk && want.test(s.title) && has(s.body)) {
      chosen = s;
      break;
    }
  }
  if (!chosen) {
    console.log(L.id, '섹션을 못 찾음', L.section);
    continue;
  }
  const seen = new Set();
  const clubs = MODES[mode](chosen.body).filter((c) => c.name && !(L.drop && new RegExp(L.drop, 'i').test(c.title ?? c.name)) && !seen.has(c.name) && seen.add(c.name));
  const ko = await koTitles(clubs.map((c) => c.title).filter(Boolean), lang);
  for (const c of clubs) c.ko = (c.title && ko[c.title]) ?? null;
  writeFileSync(new URL(`./out/${L.id}.json`, import.meta.url), JSON.stringify({ id: L.id, lang, page: L.page, section: chosen.title, clubs }, null, 1));
  console.log(L.id, `[${chosen.title}]`, clubs.length, '팀 · 한국어', clubs.filter((c) => c.ko).length, '|', clubs.slice(0, 5).map((c) => c.name).join(', '));
}
