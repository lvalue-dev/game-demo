import { api } from './wiki.mjs';
const [lang, q] = process.argv.slice(2);
const r = await api(lang, { action: 'query', list: 'search', srsearch: q, srlimit: '10' });
for (const s of r.query.search) console.log(s.title);
