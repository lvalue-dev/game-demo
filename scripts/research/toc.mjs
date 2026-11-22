// 문서의 섹션 제목과 각 섹션에 표가 있는지 보여 준다: node toc.mjs "문서"
import { wikitext } from './wiki.mjs';
const text = await wikitext(process.argv[3] ?? 'en', process.argv[2]);
if (!text) { console.log('문서 없음'); process.exit(); }
let cur = '(머리)'; let body = '';
const flush = () => console.log(`${cur} ${body.includes('{|') ? '[표]' : ''}${/Sports table/.test(body) ? '[순위표]' : ''}${/Location map/.test(body) ? '[지도]' : ''}${/^\*\s*\[\[/m.test(body) ? '[목록]' : ''}`);
for (const line of text.split('\n')) {
  const m = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
  if (m) { flush(); cur = '  '.repeat(m[1].length - 2) + m[2]; body = ''; } else body += line + '\n';
}
flush();
