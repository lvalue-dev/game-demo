import { api } from './wiki.mjs';
const titles = process.argv.slice(2);
const j = await api('en', { action: 'query', titles: titles.join('|'), redirects: 1 });
const missing = new Set((j.query.pages ?? []).filter((p) => p.missing).map((p) => p.title));
for (const t of titles) console.log(missing.has(t) ? '없음' : '있음', t);
