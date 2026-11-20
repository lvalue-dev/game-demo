// 리그, 구단 이름, 전술, 능력치 같은 고정 자료. 구단과 대회, 매체 이름은 모두 지어낸 것이다.
import type { AttrId, BackgroundId, ClubLeagueId, FocusId, PlanId, Pos, StyleId, TraitId } from './types.ts';

export interface LeagueMeta {
  name: string;
  short: string;
  region: 'kr' | 'eu';
  /** 평균 전력. 선수 실력과 같은 눈금이다. */
  level: number;
  /** 이 리그 구단이 감독에게 기대하는 평판. */
  rep: number;
  /** 한 시즌 기본 예산(백만 원). */
  money: number;
  up: ClubLeagueId | null;
  down: ClubLeagueId | null;
  /** 우승 트로피의 무게. 커리어 점수에 쓴다. */
  weight: number;
  blurb: string;
}

export const CLUB_LEAGUES: ClubLeagueId[] = ['kr5', 'kr4', 'kr3', 'kr2', 'kr1', 'eu2', 'eu1'];

export const LEAGUES: Record<ClubLeagueId, LeagueMeta> = {
  kr5: { name: '동네 리그', short: '5부', region: 'kr', level: 32, rep: 0, money: 3, up: 'kr4', down: null, weight: 1, blurb: '주말 아침 운동장을 빌려 뛰는 아마추어 리그' },
  kr4: { name: '지역 리그', short: '4부', region: 'kr', level: 42, rep: 10, money: 30, up: 'kr3', down: 'kr5', weight: 2, blurb: '직장과 축구를 병행하는 선수들의 리그' },
  kr3: { name: '전국 리그', short: '3부', region: 'kr', level: 51, rep: 22, money: 150, up: 'kr2', down: 'kr4', weight: 4, blurb: '세미프로. 버스로 전국을 돈다' },
  kr2: { name: '챌린저스 리그', short: '2부', region: 'kr', level: 60, rep: 36, money: 800, up: 'kr1', down: 'kr3', weight: 7, blurb: '프로의 문턱. 중계 카메라가 온다' },
  kr1: { name: '프리미어 디비전', short: '1부', region: 'kr', level: 69, rep: 50, money: 4000, up: null, down: 'kr2', weight: 15, blurb: '국내 최고 무대' },
  eu2: { name: '유럽 2부 리그', short: '유럽 2부', region: 'eu', level: 74, rep: 62, money: 15000, up: 'eu1', down: null, weight: 12, blurb: '유럽 무대의 입구' },
  eu1: { name: '유럽 엘리트 리그', short: '유럽 1부', region: 'eu', level: 85, rep: 76, money: 60000, up: null, down: 'eu2', weight: 40, blurb: '세계에서 가장 강한 리그' },
};

export const CLUB_NAMES: Record<ClubLeagueId, string[]> = {
  kr5: ['새벽 조기회', '삼거리 정육점 FC', '행복 부동산 유나이티드', '퇴근 후 FC', '무릎 조심 FC', '월요병 시티', '명진 철물 FC', '동네 형들 FC', '주말만 FC', '숙취 유나이티드'],
  kr4: ['솔밭 시민구단', '강나루 FC', '은행골 유나이티드', '큰바위 FC', '달맞이 시티', '버들 FC', '새터 유나이티드', '물안개 FC', '느티 SC', '갯마을 FC'],
  kr3: ['한빛 FC', '가람 유나이티드', '노을 SC', '다온 FC', '마루 시티', '누리 FC', '바람개비 FC', '온새미 유나이티드', '푸른솔 FC', '해오름 시티'],
  kr2: ['미르 FC', '청운 유나이티드', '백호 FC', '서라벌 시티', '한울 FC', '아리 유나이티드', '금강 FC', '두물 시티', '새별 FC', '가온 SC'],
  kr1: ['한성 유나이티드', '동해 아이언즈', '남도 FC', '중앙 시티', '서해 웨이브', '태백 마운틴', '한라 FC', '수도 레인저스', '달구벌 FC', '빛고을 유나이티드'],
  eu2: ['FC 그라우베르크', '유니온 생클레르', '애슬레틱 던모어', 'SC 블라우하임', 'AS 포르토피노', 'CD 알메이라', 'FK 스벤보르', '로코모티브 카르파', 'RKS 비스와', '하버 로버스'],
  eu1: ['FC 발렌토', '노르트하펜 SV', 'AC 몬테비앙카', '레알 카스텔로', '올림피크 마르소', '로열 켄싱턴', '디나모 벨그라브', '스포르팅 리베이라', 'FC 바젤란트', '아틀레티코 솔라나'],
};

/** 국가대표팀. 첫 줄이 감독이 맡을 수 있는 팀이다. 전력 수치는 게임용으로 정한 것이다. */
export const NATIONS: { name: string; level: number; asia: boolean }[] = [
  { name: '대한민국', level: 76, asia: true },
  { name: '일본', level: 79, asia: true }, { name: '이란', level: 76, asia: true }, { name: '호주', level: 74, asia: true },
  { name: '사우디아라비아', level: 72, asia: true }, { name: '카타르', level: 70, asia: true }, { name: '우즈베키스탄', level: 70, asia: true },
  { name: '이라크', level: 68, asia: true }, { name: '아랍에미리트', level: 67, asia: true }, { name: '요르단', level: 67, asia: true },
  { name: '오만', level: 63, asia: true }, { name: '중국', level: 62, asia: true }, { name: '바레인', level: 62, asia: true },
  { name: '태국', level: 60, asia: true }, { name: '베트남', level: 58, asia: true }, { name: '인도네시아', level: 58, asia: true },
  { name: '아르헨티나', level: 90, asia: false }, { name: '프랑스', level: 90, asia: false }, { name: '스페인', level: 89, asia: false },
  { name: '잉글랜드', level: 88, asia: false }, { name: '브라질', level: 88, asia: false }, { name: '포르투갈', level: 86, asia: false },
  { name: '네덜란드', level: 86, asia: false }, { name: '독일', level: 86, asia: false }, { name: '이탈리아', level: 84, asia: false },
  { name: '벨기에', level: 83, asia: false }, { name: '크로아티아', level: 82, asia: false }, { name: '우루과이', level: 82, asia: false },
  { name: '콜롬비아', level: 81, asia: false }, { name: '모로코', level: 81, asia: false }, { name: '스위스', level: 80, asia: false },
  { name: '덴마크', level: 80, asia: false }, { name: '세네갈', level: 79, asia: false }, { name: '미국', level: 78, asia: false },
  { name: '멕시코', level: 78, asia: false }, { name: '에콰도르', level: 77, asia: false }, { name: '나이지리아', level: 77, asia: false },
  { name: '이집트', level: 76, asia: false }, { name: '캐나다', level: 74, asia: false },
];
export const NATION_REP = 68;

export const STYLES: Record<StyleId, { name: string; desc: string }> = {
  attack: { name: '공격 축구', desc: '골이 늘고 실점도 는다' },
  defend: { name: '선수비', desc: '실점이 줄고 골도 준다' },
  possess: { name: '점유 축구', desc: '미드필더가 리그 평균보다 좋아야 통한다' },
  counter: { name: '역습', desc: '강팀에 강하고 약팀을 상대로는 답답하다' },
  press: { name: '전방 압박', desc: '전반기에 강하고 후반기에 지친다' },
};
export const STYLE_IDS: StyleId[] = ['attack', 'defend', 'possess', 'counter', 'press'];

export const FOCUSES: Record<FocusId, { name: string; desc: string }> = {
  attack: { name: '공격 전개', desc: '공격력이 조금 오른다' },
  defense: { name: '수비 조직', desc: '수비력이 조금 오른다' },
  fitness: { name: '체력', desc: '후반기에 강해지고 전방 압박이 지치지 않는다' },
  youth: { name: '유망주 육성', desc: '23세 이하 선수가 더 빨리 큰다' },
};
export const FOCUS_IDS: FocusId[] = ['attack', 'defense', 'fitness', 'youth'];

export const PLANS: Record<PlanId, { name: string; desc: string }> = {
  allout: { name: '총력전', desc: '공격을 끌어올린다. 수비와 선수층이 얇아진다' },
  steady: { name: '실리 운영', desc: '지지 않는 경기를 한다. 골은 줄어든다' },
  rotate: { name: '컵 대회에 집중', desc: '토너먼트에 주전을 아낀다. 리그는 조금 손해 본다' },
};
export const PLAN_IDS: PlanId[] = ['allout', 'steady', 'rotate'];

export const ATTRS: Record<AttrId, { name: string; desc: string }> = {
  tactics: { name: '전술', desc: '전술 숙련도가 주는 힘이 커진다' },
  lead: { name: '리더십', desc: '사기를 지키고 선수와 팬을 설득한다' },
  youth: { name: '육성', desc: '어린 선수가 더 크게 자란다' },
  deal: { name: '수완', desc: '싸게 사고 비싸게 팔며 이사회를 달랜다' },
  eye: { name: '안목', desc: '더 좋은 영입 후보가 나오고 잠재력이 보인다' },
};
export const ATTR_IDS: AttrId[] = ['tactics', 'lead', 'youth', 'deal', 'eye'];

export const BACKGROUNDS: Record<BackgroundId, { name: string; desc: string; bonus: Partial<Record<AttrId, number>> }> = {
  pro: { name: '은퇴한 프로 선수', desc: '리더십 +4, 전술 +2', bonus: { lead: 4, tactics: 2 } },
  teacher: { name: '체육 교사', desc: '육성 +4, 리더십 +2', bonus: { youth: 4, lead: 2 } },
  analyst: { name: '전력 분석관', desc: '전술 +4, 안목 +2', bonus: { tactics: 4, eye: 2 } },
  scout: { name: '스카우터', desc: '안목 +4, 수완 +2', bonus: { eye: 4, deal: 2 } },
  sales: { name: '영업 사원 출신 조기축구 회장', desc: '수완 +4, 리더십 +2', bonus: { deal: 4, lead: 2 } },
};
export const BACKGROUND_IDS: BackgroundId[] = ['pro', 'teacher', 'analyst', 'scout', 'sales'];

export const POS_NAME: Record<Pos, string> = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' };
/** 주전 일곱 명의 구성. */
export const LINEUP: Pos[] = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW'];

export const TRAITS: Record<TraitId, { name: string; desc: string }> = {
  leader: { name: '리더', desc: '팀 사기가 덜 흔들린다' },
  glass: { name: '유리몸', desc: '자주 다친다' },
  clutch: { name: '강심장', desc: '토너먼트에 강하다' },
  rebel: { name: '말썽꾼', desc: '사건의 중심에 선다' },
  grinder: { name: '성실', desc: '나이 들어도 천천히 떨어진다' },
};
export const TRAIT_IDS: TraitId[] = ['leader', 'glass', 'clutch', 'rebel', 'grinder'];

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍', '전', '고', '문', '양', '손', '배', '백', '허', '남', '심'];
const GIVEN_A = ['민', '서', '지', '도', '하', '준', '시', '예', '주', '현', '승', '태', '성', '재', '우', '건', '동', '상', '영', '진', '은', '수', '기', '찬', '윤', '경', '정', '선', '규', '형'];
const GIVEN_B = ['준', '우', '호', '진', '현', '민', '혁', '훈', '빈', '석', '환', '성', '원', '재', '수', '철', '윤', '찬', '겸', '율', '결', '솔', '람', '한', '범', '욱', '일', '택', '섭', '국'];
const FOREIGN_FIRST = ['마테오', '루카', '엔조', '티아고', '니코', '라파엘', '휴고', '레온', '막심', '카이', '주앙', '디에고', '파블로', '빅토르', '요나스', '에릭', '오스카', '마르코', '안드레', '세바스티안', '올리버', '노아', '사무엘', '아담', '이반', '밀란', '루벤', '페드로', '알렉스', '다니'];
const FOREIGN_LAST = ['실바', '모레노', '베커', '로시', '뒤부아', '노바크', '페레이라', '산토스', '뮐러', '코스타', '얀센', '에릭센', '마르티네스', '페트로프', '코바치', '라르센', '폰타나', '가르시아', '바우어', '오르테가', '멘데스', '루소', '쿠퍼', '하르트만', '비앙키', '로페스', '안데르손', '니에토', '모로', '카르도주'];

/** 0~1 난수 두세 개로 이름을 짓는다. */
export function koreanName(a: number, b: number, c: number): string {
  return SURNAMES[Math.floor(a * SURNAMES.length)]! + GIVEN_A[Math.floor(b * GIVEN_A.length)]! + GIVEN_B[Math.floor(c * GIVEN_B.length)]!;
}
export function foreignName(a: number, b: number): string {
  return `${FOREIGN_FIRST[Math.floor(a * FOREIGN_FIRST.length)]!} ${FOREIGN_LAST[Math.floor(b * FOREIGN_LAST.length)]!}`;
}

/** 금액(백만 원)을 읽기 쉽게 적는다. */
export function won(m: number): string {
  const v = Math.max(0, m);
  if (v >= 1000) return `${Math.round(v / 100).toLocaleString('ko-KR')}억 원`;
  if (v >= 100) return `${(v / 100).toFixed(1).replace(/\.0$/, '')}억 원`;
  return `${Math.round(v * 100).toLocaleString('ko-KR')}만 원`;
}

export const START_YEAR = 2027;
export const START_AGE = 35;
export const RETIRE_AGE = 65;
