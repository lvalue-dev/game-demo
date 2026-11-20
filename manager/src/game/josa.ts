// 이름 뒤에 붙는 조사를 받침에 맞게 고른다. "한빛 FC는", "임진준은", "서태호가".

/** 낱말의 마지막 소리에 받침이 있는지. 2는 ㄹ 받침이다. */
function finalOf(word: string): 0 | 1 | 2 {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return code % 28 === 0 ? 0 : code % 28 === 8 ? 2 : 1;
  if (/[0-9]/.test(ch)) return '136'.includes(ch) ? 1 : '78'.includes(ch) ? 2 : ch === '0' ? 1 : 0;
  if (/[a-z]/i.test(ch)) return 'mn'.includes(ch.toLowerCase()) ? 1 : 'lr'.includes(ch.toLowerCase()) ? 2 : 0;
  return 0;
}

const SWAP: Record<string, string> = { 은: '는', 이: '가', 을: '를', 과: '와', 으로: '로' };
const PARTICLE = /^(으로|은|이|을|과)(?=[\s,.!?"]|$)/;

/** 받침 있는 꼴(은, 이, 을, 과, 으로)로 적힌 조사를 앞말에 맞게 바꾼다. */
export function attach(word: string, rest: string): string {
  const m = PARTICLE.exec(rest);
  if (!m) return rest;
  const particle = m[1] as string;
  const final = finalOf(word);
  if (final === 0 || (final === 2 && particle === '으로')) return SWAP[particle] + rest.slice(particle.length);
  return rest;
}

/**
 * 조사를 자동으로 맞추는 글틀. 끼워 넣는 값 바로 뒤에 받침 있는 꼴의 조사를 적어 두면 값에 맞게 바뀐다.
 * ko`${name}은 떠났다` → "임진준은 떠났다", "서태호는 떠났다"
 */
export function ko(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] as string;
  values.forEach((value, i) => {
    const word = String(value);
    out += word + attach(word, strings[i + 1] as string);
  });
  return out;
}
