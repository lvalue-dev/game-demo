// 위키백과 API를 부르는 작은 도구. 연구용 스크립트들이 같이 쓴다.
const UA = 'touchline-game-research/0.1 (football manager game data)';

let last = 0;

export async function api(lang, params) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) url.searchParams.set(k, String(v));
  // 위키미디어 권고대로 요청을 하나씩, 간격을 두고 보낸다. 429면 점점 오래 기다린다.
  for (let attempt = 0; attempt < 7; attempt++) {
    const wait = Math.max(0, last + 1500 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.ok) return res.json();
    const retry = Number(res.headers.get('retry-after')) || 0;
    await new Promise((r) => setTimeout(r, Math.max(retry * 1000, 4000 * 2 ** attempt)));
  }
  throw new Error(`위키백과 요청 실패: ${url}`);
}

/** 문서의 위키텍스트. 넘겨주기(redirect)를 따라간다. 없으면 null. */
export async function wikitext(lang, title) {
  const j = await api(lang, { action: 'parse', page: title, prop: 'wikitext', redirects: 1 });
  return j.parse?.wikitext ?? null;
}

/** 문서 제목들(lang 위키)의 한국어 문서 제목. 없으면 빠진다. */
export async function koTitles(titles, lang = 'en') {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const j = await api(lang, { action: 'query', prop: 'langlinks', lllang: 'ko', titles: chunk.join('|'), redirects: 1, lllimit: 'max' });
    const back = {};
    for (const r of j.query?.redirects ?? []) back[r.to] = r.from;
    for (const n of j.query?.normalized ?? []) back[n.to] = n.from;
    for (const p of j.query?.pages ?? []) {
      const ko = p.langlinks?.[0]?.title;
      if (!ko) continue;
      let from = p.title;
      while (back[from]) from = back[from];
      out[from] = ko;
      out[p.title] = ko;
    }
  }
  return out;
}
