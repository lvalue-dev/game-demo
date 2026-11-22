// 문서의 특정 섹션 앞부분을 보여 준다: node peek.mjs "문서" "섹션 정규식" [글자 수]
import { wikitext } from './wiki.mjs';
const [page, sec, n = '1500'] = process.argv.slice(2);
const text = await wikitext('en', page);
const re = new RegExp(`^(={2,6})\\s*(${sec})\\s*\\1\\s*$`, 'mi');
const m = re.exec(text);
console.log(m ? text.slice(m.index, m.index + Number(n)) : '섹션 없음');
