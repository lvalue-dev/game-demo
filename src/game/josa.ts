/** 한글 낱말의 마지막 글자 받침 번호. 받침이 없으면 0, 한글이 아니면 -1. */
function jong(word: string): number {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code < 0 || code > 11171 ? -1 : code % 28;
}

/** "전당포로", "보석상으로"처럼 이름에 맞는 조사를 붙인다. */
export function ro(word: string): string {
  const j = jong(word);
  return word + (j > 0 && j !== 8 ? '으로' : '로');
}

/** "해커를", "작전 참모를", "배후를", "금고털이를". */
export function eul(word: string): string {
  return word + (jong(word) > 0 ? '을' : '를');
}
