// 시즌이 끝나면 쏟아지는 기사와 팬 반응. 매체와 게시판 이름은 지어낸 것이다.
import { attach } from './josa.ts';
import { pick } from './rng.ts';
import type { Block, Game, Tone } from './types.ts';

export type Mood = 'title' | 'promoted' | 'over' | 'par' | 'under' | 'relegated' | 'sacked';

const PRESS = ['풋볼 데일리', '주간 킥오프', '터치라인 뉴스', '스포츠 한마당'];
const NICKS = ['골대뒤1열', '원정버스기사', '직관10년차', '축구는인생', '전술덕후', '어제도졌다', '우리팀만본다', '90분의남자', '후반추가시간', '코너킥장인', '벤치워머', '오프사이드트랩'];

const HEAD: Record<Mood, string[]> = {
  title: ['{club}, 정상에 서다. {name} 감독 "선수들이 해냈다"', '우승의 설계자 {name}. {club}의 한 해를 돌아보다', '{name} 매직. 아무도 예상하지 못한 {club}의 우승'],
  promoted: ['{club} 승격 확정. {name} 감독의 다음 무대는', '한 계단 위로. {name}과 {club}이 쓴 승격 드라마'],
  over: ['기대 이상. {name} 감독의 {club}이 보여 준 것', '{club}의 돌풍, 중심에는 {name}이 있었다'],
  par: ['{club}, 무난한 한 해. {name} 감독 "다음 시즌이 진짜"', '절반의 성공. {name}의 {club}은 어디로 가나'],
  under: ['{club}의 추락. {name} 감독 책임론 고개', '무엇이 문제였나. {name} 체제의 {club}을 해부한다'],
  relegated: ['{club} 강등. {name} 감독 "모든 책임은 나에게"', '눈물의 최종전. {club}이 내려간다'],
  sacked: ['{club}, {name} 감독 경질 발표', '결국 결별. {club}과 {name}의 동행이 끝났다'],
};

const FANS: Record<Mood, [string, Tone][]> = {
  title: [['감독님 동상 세웁시다', 'good'], ['이 팀 응원하길 잘했다. 진짜로', 'good'], ['작년에 감독 욕한 사람 접니다. 죄송합니다', 'good'], ['우승 티셔츠 언제 나오나요', 'good'], ['{name} 종신 계약 가자', 'good']],
  promoted: ['승격이다!!!!!', '내년에 원정 어디까지 가야 되는 거임', '{name} 감독 다른 데서 채 가기 전에 재계약 좀', '위에 가서도 지금처럼만 하자', '살다 보니 이런 날도 오네'].map((t): [string, Tone] => [t, 'good']),
  over: [['솔직히 이 정도 할 줄 몰랐음', 'good'], ['감독 하나 바뀌었다고 팀이 이렇게 됨?', 'good'], ['내년이 더 기대된다', 'good'], ['선수 몇 명만 더 있으면 진짜 일 내겠는데', 'plain'], ['{name} 전술 보는 맛이 있다', 'good']],
  par: [['딱 예상한 만큼 했다', 'plain'], ['나쁘진 않은데 뭔가 아쉬움', 'plain'], ['내년엔 좀 더 위를 보자', 'plain'], ['{name} 감독 한 시즌은 더 봐야지', 'plain'], ['경기는 재밌었음. 순위는 모르겠고', 'plain']],
  under: [['이게 맞나', 'bad'], ['전술이 없다 전술이', 'bad'], ['시즌권 환불 되나요', 'bad'], ['그래도 선수들은 열심히 뛰었다', 'plain'], ['{name} 감독 믿어 보자던 사람들 다 어디 갔냐', 'bad']],
  relegated: [['할 말이 없다', 'bad'], ['내려가서 다시 시작하자. 난 계속 간다', 'plain'], ['누가 책임질 건데', 'bad'], ['최종전에서 울었다', 'bad'], ['{name} 감독도 힘들었겠지만 결과가 이러면', 'bad']],
  sacked: [['늦었지만 잘한 결정', 'bad'], ['감독만 문제였을까', 'plain'], ['{name} 감독 고생했습니다', 'plain'], ['다음 감독은 누구냐', 'plain'], ['솔직히 선수단이 더 문제임', 'plain']],
};

const fill = (text: string, name: string, club: string): string =>
  text.split(/(\{name\}|\{club\})/).reduce((out, part, i, parts) => {
    if (part === '{name}' || part === '{club}') return out + (part === '{name}' ? name : club);
    const before = parts[i - 1];
    return out + (before ? attach(before === '{name}' ? name : club, part) : part);
  }, '');

/** 기사 한 줄과 팬 댓글 세 줄. */
export function reactions(g: Game, mood: Mood, club: string, amateur: boolean): Block {
  const name = g.manager.name;
  const items: { who: string; where: string; text: string; tone: Tone }[] = [];
  const tone: Tone = mood === 'title' || mood === 'promoted' || mood === 'over' ? 'good' : mood === 'par' ? 'plain' : 'bad';
  if (amateur) {
    items.push({ who: '총무', where: `${club} 단체 대화방`, text: fill(pick(g, HEAD[mood]), name, club).replace(/\..*$/, '') + '. 회식 장소 투표 올립니다', tone });
  } else {
    items.push({ who: pick(g, PRESS), where: '기사', text: fill(pick(g, HEAD[mood]), name, club), tone });
  }
  const pool = [...FANS[mood]];
  const names = [...NICKS];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const [text, fanTone] = pool.splice(Math.floor((pick(g, [0.1, 0.3, 0.5, 0.7, 0.9]) as number) * pool.length), 1)[0] as [string, Tone];
    const who = names.splice(Math.floor((pick(g, [0.05, 0.25, 0.45, 0.65, 0.85]) as number) * names.length), 1)[0] as string;
    items.push({ who, where: amateur ? '동네 축구 밴드' : `${club} 팬 게시판`, text: fill(text, name, club), tone: fanTone });
  }
  return { kind: 'feed', items };
}

/** 커리어 점수에 따른 칭호. */
export function legacyTitle(score: number): string {
  if (score >= 600) return '시대를 정의한 감독';
  if (score >= 350) return '세계가 아는 명장';
  if (score >= 200) return '한 나라를 대표한 감독';
  if (score >= 110) return '프로 무대의 승부사';
  if (score >= 55) return '승격 청부사';
  if (score >= 20) return '동네가 기억하는 감독';
  return '주말 아침의 지도자';
}
