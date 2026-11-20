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
  /** 한 시즌에 윗리그로 올라가는 팀 수. 그만큼 윗리그에서 내려온다. */
  promote: number;
  /** 다음 시즌 대륙 클럽 대회에 나가는 팀 수. */
  conti: number;
  /** 우승 트로피의 무게. 커리어 점수에 쓴다. */
  weight: number;
  blurb: string;
}

export const CLUB_LEAGUES: ClubLeagueId[] = ['kr5', 'kr4', 'kr3', 'kr2', 'kr1', 'eu2', 'eu1'];

// 리그의 이름과 참가 구단은 2026년(잉글랜드는 2026-27 시즌) 실제 구성을 따른다.
// 일정 방식은 단순화했다: 모든 팀이 홈과 원정으로 한 번씩 만나고, 승격과 강등은 정해진 수만큼 바로 이뤄진다.
// K5리그는 전국에 수백 팀이 있는 동호인 리그라서 가상의 권역 하나를 지어냈다.
export const LEAGUES: Record<ClubLeagueId, LeagueMeta> = {
  kr5: { name: 'K5리그', short: 'K5', region: 'kr', level: 32, rep: 0, money: 3, up: 'kr4', down: null, promote: 2, conti: 0, weight: 1, blurb: '주말 아침 운동장을 빌려 뛰는 동호인 리그' },
  kr4: { name: 'K4리그', short: 'K4', region: 'kr', level: 42, rep: 10, money: 30, up: 'kr3', down: 'kr5', promote: 2, conti: 0, weight: 2, blurb: '직장과 축구를 병행하는 선수가 많은 세미프로 리그' },
  kr3: { name: 'K3리그', short: 'K3', region: 'kr', level: 51, rep: 22, money: 150, up: 'kr2', down: 'kr4', promote: 2, conti: 0, weight: 4, blurb: '세미프로 최상위. 버스로 전국을 돈다' },
  kr2: { name: 'K리그2', short: 'K리그2', region: 'kr', level: 60, rep: 36, money: 800, up: 'kr1', down: 'kr3', promote: 2, conti: 0, weight: 7, blurb: '프로 2부. 승격 경쟁이 가장 치열한 무대' },
  kr1: { name: 'K리그1', short: 'K리그1', region: 'kr', level: 69, rep: 50, money: 4000, up: null, down: 'kr2', promote: 0, conti: 2, weight: 15, blurb: '국내 최고 무대' },
  eu2: { name: 'EFL 챔피언십', short: '잉글랜드 2부', region: 'eu', level: 74, rep: 62, money: 15000, up: 'eu1', down: null, promote: 3, conti: 0, weight: 12, blurb: '46경기를 치르는 잉글랜드 2부. 유럽 무대의 입구' },
  eu1: { name: '프리미어리그', short: '잉글랜드 1부', region: 'eu', level: 85, rep: 76, money: 60000, up: null, down: 'eu2', promote: 0, conti: 4, weight: 40, blurb: '세계에서 가장 치열한 리그' },
};

export interface ClubSeed {
  name: string;
  /** 리그 평균 대비 전력. +6이면 우승 후보, -5면 강등 후보. */
  edge: number;
  /** 팀 색 두 가지. 비어 있으면 이름에서 정해진다. 문장(배지)을 그릴 때만 쓴다. */
  colors: [string, string] | null;
  /** 문장의 무늬. 0 띠, 1 반반, 2 세로 줄무늬, 3 가로 줄무늬, 4 사선, 5 꺾쇠. */
  pattern?: number;
}

const c = (name: string, edge: number, a?: string, b?: string, pattern?: number): ClubSeed =>
  ({ name, edge, colors: a && b ? [a, b] : null, pattern });

export const CLUB_SEEDS: Record<ClubLeagueId, ClubSeed[]> = {
  // 가상의 동호인 팀들.
  kr5: [
    c('새벽 조기회', 5), c('동네 형들 FC', 4), c('명진 철물 FC', 2), c('삼거리 정육점 FC', 1), c('퇴근 후 FC', 0),
    c('행복 부동산 유나이티드', -1), c('주말만 FC', -2), c('무릎 조심 FC', -3), c('월요병 시티', -4), c('숙취 유나이티드', -5),
  ],
  kr4: [
    c('연천FC', 3), c('서울중랑축구단', 3), c('남양주시민축구단', 2), c('평창유나이티드', 2), c('진주시민축구단', 1),
    c('거제시민축구단', 1), c('평택시티즌', 0), c('기장군민축구단', -1), c('서산FC', -2), c('제천시민축구단', -2),
    c('금산인삼FC', -3), c('진천HR FC', -3), c('함안군민축구단', -4),
  ],
  kr3: [
    c('시흥시민축구단', 4), c('대전코레일', 4), c('경주한수원', 3), c('부산교통공사', 2), c('포천시민축구단', 2),
    c('창원FC', 1), c('FC강릉', 0), c('춘천시민축구단', 0), c('울산시민축구단', -1), c('FC목포', -1),
    c('전북 현대 N', -1, '#0a8a4a', '#12325c'), c('양평FC', -2), c('여주FC', -3), c('당진시민축구단', -3),
  ],
  kr2: [
    c('수원 삼성', 5, '#1458a8', '#d21f2b', 1), c('대구FC', 4, '#6fb1e4', '#123a6e'), c('수원FC', 4, '#d21f2b', '#1c3f94', 4),
    c('서울 이랜드', 3, '#14284f', '#c7a03a'), c('부산 아이파크', 2, '#d21f2b', '#ffffff'), c('전남 드래곤즈', 2, '#f6c800', '#1a1a1a'),
    c('성남FC', 1, '#1a1a1a', '#ffffff'), c('김포FC', 0, '#0e7a3f', '#f2c200'), c('경남FC', 0, '#c8102e', '#1a1a1a'),
    c('충남아산', 0, '#0d3ea3', '#f6c800'), c('천안시티', -2, '#5cbfe6', '#0d3d9c'), c('충북청주', -2, '#1c2d6e', '#c7a03a'),
    c('화성FC', -2, '#f26a1b', '#1a1a1a'), c('안산 그리너스', -3, '#0e8f4d', '#ffffff'), c('김해FC2008', -3),
    c('용인FC', -3), c('파주 프런티어', -4),
  ],
  kr1: [
    c('FC서울', 4, '#b5191a', '#1a1a1a', 2), c('전북 현대', 4, '#0a8a4a', '#12325c'), c('울산 HD', 4, '#0f4fa3', '#f5b100'),
    c('포항 스틸러스', 2, '#d21f2b', '#1a1a1a', 3), c('강원FC', 2, '#f27d1b', '#0f6b3a'), c('대전하나시티즌', 2, '#7a1f3d', '#0e9c93'),
    c('인천 유나이티드', 0, '#0d4a9a', '#1a1a1a', 2), c('김천 상무', 0, '#d21f2b', '#1b3668'), c('제주SK', -1, '#f26a1b', '#d21f2b'),
    c('FC안양', -2, '#5f2a9c', '#ffffff'), c('광주FC', -3, '#f6c800', '#b5121b'), c('부천FC 1995', -4, '#b31b1b', '#1a1a1a'),
  ],
  eu2: [
    c('웨스트햄', 5, '#7a263a', '#3bb3e6'), c('울버햄프턴', 4, '#f9b413', '#231f20'), c('번리', 4, '#6c1d45', '#99d6ea'),
    c('사우샘프턴', 3, '#d71920', '#ffffff', 2), c('미들즈브러', 3, '#e11b22', '#ffffff'), c('셰필드 유나이티드', 2, '#ee2737', '#ffffff', 2),
    c('버밍엄 시티', 2, '#183b90', '#ffffff'), c('밀월', 2, '#001d5e', '#ffffff'), c('노리치 시티', 1, '#fff200', '#00a650'),
    c('웨스트브롬', 1, '#122f67', '#ffffff', 2), c('렉섬', 1, '#d71920', '#ffffff'), c('왓퍼드', 0, '#fbee23', '#ed2127'),
    c('스토크 시티', 0, '#e03a3e', '#ffffff', 2), c('스완지 시티', 0, '#ffffff', '#1a1a1a'), c('브리스틀 시티', 0, '#e21a23', '#ffffff'),
    c('QPR', -1, '#1d5ba4', '#ffffff', 3), c('더비 카운티', -1, '#ffffff', '#1a1a1a'), c('블랙번', -1, '#009ee0', '#ffffff', 1),
    c('프레스턴', -2, '#ffffff', '#000055'), c('포츠머스', -2, '#001489', '#ffffff'), c('찰턴', -2, '#d4021d', '#ffffff'),
    c('카디프 시티', -3, '#0070b5', '#ffffff'), c('볼턴', -4, '#ffffff', '#263c7e'), c('링컨 시티', -4, '#d6001c', '#ffffff', 2),
  ],
  eu1: [
    c('맨체스터 시티', 6, '#6cabdd', '#1c2c5b'), c('아스널', 6, '#ef0107', '#ffffff'), c('리버풀', 6, '#c8102e', '#00b2a9'),
    c('첼시', 4, '#034694', '#ffffff'), c('뉴캐슬', 3, '#241f20', '#ffffff', 2), c('토트넘', 3, '#ffffff', '#132257'),
    c('맨체스터 유나이티드', 3, '#da291c', '#fbe122'), c('애스턴 빌라', 3, '#670e36', '#95bfe5'), c('브라이턴', 1, '#0057b8', '#ffffff', 2),
    c('노팅엄 포리스트', 1, '#dd0000', '#ffffff'), c('본머스', 1, '#da291c', '#1a1a1a', 2), c('크리스털 팰리스', 1, '#1b458f', '#c4122e', 2),
    c('브렌트퍼드', 0, '#e30613', '#ffffff', 2), c('풀럼', 0, '#ffffff', '#1a1a1a'), c('에버턴', 0, '#003399', '#ffffff'),
    c('리즈 유나이티드', -2, '#ffffff', '#1d428a'), c('선덜랜드', -2, '#eb172b', '#ffffff', 2), c('코번트리 시티', -4, '#59cbe8', '#ffffff'),
    c('입스위치 타운', -4, '#3a64a3', '#ffffff'), c('헐 시티', -5, '#f5a12d', '#1a1a1a', 2),
  ],
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

export const START_YEAR = 2026;
export const START_AGE = 35;
export const RETIRE_AGE = 65;
