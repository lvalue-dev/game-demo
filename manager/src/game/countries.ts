// 나라와 리그의 고정 자료: 리그 구조, 컵 대회, 외국인 규정, 감독 자격 요건.
// 실제 규정은 RULES.md에 출처와 함께 적었다. 확인하지 못한 값은 "게임 규칙"이라고 밝혀 둔다.
import { WORLD_CLUBS } from './world-clubs.ts';

/** 나라. 리그 번호의 앞부분과 같다(kr1, eng1, jpn5 …). */
export type CountryId = 'kr' | 'jpn' | 'eng' | 'esp' | 'ger' | 'ita' | 'fra';
export const COUNTRY_IDS: CountryId[] = ['kr', 'jpn', 'eng', 'esp', 'ger', 'ita', 'fra'];

export interface Country {
  /** 나라 이름이자 그 나라 국적 선수의 국적 표기. */
  name: string;
  confed: 'afc' | 'uefa';
  cup: string;
  /** 국내 컵 우승의 무게(커리어 점수). */
  cupWeight: number;
  /** 감독 자격증 이름. 0은 없음, 1 C급 … 4 최상위(Pro). */
  licenses: [string, string, string, string, string];
  /** 한 단계 낮은 자격으로도 강습에 등록하면 감독을 맡을 수 있는지(독일 3부, 프랑스 BEF 예외, 잉글랜드 수강자 연장). */
  provisional: boolean;
  /** 승격으로 요구 자격이 올라가도 강습을 받는 동안 한 시즌은 지휘할 수 있는지(일본 J3→J2, 이탈리아 D→C, 독일, 프랑스). */
  grace: boolean;
  /** 외국인 감독에게 따로 필요한 것. */
  coachPermit: string | null;
}

export const COUNTRIES: Record<CountryId, Country> = {
  kr: {
    name: '대한민국', confed: 'afc', cup: '코리아컵', cupWeight: 8,
    licenses: ['자격 없음', 'C급', 'B급', 'A급', 'P급'], provisional: false, grace: false, coachPermit: null,
  },
  jpn: {
    name: '일본', confed: 'afc', cup: '천황배', cupWeight: 9,
    licenses: ['자격 없음', 'C급', 'B급', 'A급 제너럴', 'JFA Pro'], provisional: false, grace: true, coachPermit: null,
  },
  eng: {
    name: '잉글랜드', confed: 'uefa', cup: 'FA컵', cupWeight: 15,
    licenses: ['자격 없음', 'UEFA C', 'UEFA B', 'UEFA A', 'UEFA Pro'], provisional: true, grace: false,
    coachPermit: '외국인 감독은 워크퍼밋(GBE)이 필요하다: Pro 자격과 최근 상위 리그 지휘 경력',
  },
  esp: {
    name: '스페인', confed: 'uefa', cup: '코파 델 레이', cupWeight: 14,
    licenses: ['자격 없음', 'UEFA C', 'UEFA B(1단계)', 'UEFA A(2단계)', 'UEFA Pro(3단계)'], provisional: false, grace: false, coachPermit: null,
  },
  ger: {
    name: '독일', confed: 'uefa', cup: 'DFB-포칼', cupWeight: 13,
    licenses: ['자격 없음', 'C-라이선스', 'B-라이선스', 'A-라이선스', 'Pro-라이선스'], provisional: true, grace: true, coachPermit: null,
  },
  ita: {
    name: '이탈리아', confed: 'uefa', cup: '코파 이탈리아', cupWeight: 13,
    licenses: ['자격 없음', 'UEFA C', 'UEFA B', 'UEFA A', 'UEFA Pro'], provisional: false, grace: true, coachPermit: null,
  },
  fra: {
    name: '프랑스', confed: 'uefa', cup: '쿠프 드 프랑스', cupWeight: 11,
    licenses: ['자격 없음', 'BMF', 'BEF', 'DES', 'BEPF'], provisional: true, grace: true, coachPermit: null,
  },
};

export const CONTI_NAME: Record<'afc' | 'uefa', string> = { afc: 'AFC 챔피언스리그 엘리트', uefa: 'UEFA 챔피언스리그' };
export const CONTI_WEIGHT: Record<'afc' | 'uefa', number> = { afc: 25, uefa: 60 };

export interface LeagueMeta {
  name: string;
  short: string;
  country: CountryId;
  /** 1부가 1. */
  tier: number;
  /** 평균 전력. 선수 실력과 같은 눈금이다. */
  level: number;
  /** 이 리그 구단이 감독에게 기대하는 평판. */
  rep: number;
  /** 한 시즌 기본 예산(백만 원). */
  money: number;
  up: string | null;
  down: string | null;
  /** 한 시즌에 윗리그로 올라가는 팀 수. 그만큼 윗리그에서 내려온다. */
  promote: number;
  /** 다음 시즌 대륙 클럽 대회에 나가는 팀 수. */
  conti: number;
  /** 우승 트로피의 무게. 커리어 점수에 쓴다. */
  weight: number;
  /** 감독에게 필요한 자격(0~4). */
  license: number;
  /** 자격 요건의 근거: 확인(검색 결과의 규정 문구), 추정(가까운 규정에서 미룸), 게임(찾지 못해 게임용으로 정함). */
  licenseBasis: 'checked' | 'guess' | 'game';
  blurb: string;
}

interface Def {
  name: string;
  short: string;
  level: number;
  promote: number;
  conti?: number;
  license: number;
  basis: LeagueMeta['licenseBasis'];
  blurb: string;
  rep?: number;
  money?: number;
  weight?: number;
}

// 리그 정의. 위에서부터 1부. level은 게임용 전력 눈금(K5 32, 프리미어리그 85)이다.
// 한국과 잉글랜드 1·2부의 평판·예산·무게는 이전 버전 값을 그대로 쓴다. 나머지는 level에서 계산한다.
const DEFS: Record<CountryId, Def[]> = {
  kr: [
    { name: 'K리그1', short: 'K리그1', level: 69, rep: 50, money: 4000, weight: 15, promote: 0, conti: 2, license: 4, basis: 'checked', blurb: '국내 최고 무대' },
    { name: 'K리그2', short: 'K리그2', level: 60, rep: 36, money: 800, weight: 7, promote: 2, license: 4, basis: 'checked', blurb: '프로 2부. 승격 경쟁이 가장 치열한 무대' },
    { name: 'K3리그', short: 'K3', level: 51, rep: 22, money: 150, weight: 4, promote: 2, license: 3, basis: 'game', blurb: '세미프로 최상위. 버스로 전국을 돈다' },
    { name: 'K4리그', short: 'K4', level: 42, rep: 10, money: 30, weight: 2, promote: 2, license: 2, basis: 'game', blurb: '직장과 축구를 병행하는 선수가 많은 세미프로 리그' },
    { name: 'K5리그 서울', short: 'K5', level: 32, rep: 0, money: 3, weight: 1, promote: 2, license: 1, basis: 'game', blurb: '주말 아침 운동장을 빌려 뛰는 동호인 리그' },
  ],
  jpn: [
    { name: 'J1리그', short: 'J1', level: 72, promote: 0, conti: 3, license: 4, basis: 'checked', blurb: '아시아에서 가장 두꺼운 프로 리그. 2026-27 시즌부터 가을에 개막한다' },
    { name: 'J2리그', short: 'J2', level: 64, promote: 3, license: 4, basis: 'checked', blurb: '전국에 뿌리내린 지역 구단들의 2부' },
    { name: 'J3리그', short: 'J3', level: 57, promote: 3, license: 3, basis: 'checked', blurb: '프로의 막내. 2026-27 시즌부터 A급 제너럴 자격으로 지휘할 수 있다' },
    { name: '일본 풋볼리그', short: 'JFL', level: 49, promote: 2, license: 2, basis: 'game', blurb: '실업팀과 J리그 지망 구단이 섞인 전국 4부' },
    { name: '간토 축구 리그 1부', short: '간토 1부', level: 40, promote: 1, license: 1, basis: 'game', blurb: '도쿄 근교의 지역 리그. 대학팀과 클럽팀이 섞여 있다' },
  ],
  eng: [
    { name: '프리미어리그', short: '프리미어리그', level: 85, rep: 76, money: 60000, weight: 40, promote: 0, conti: 4, license: 4, basis: 'checked', blurb: '세계에서 가장 치열한 리그' },
    { name: 'EFL 챔피언십', short: '챔피언십', level: 74, rep: 62, money: 15000, weight: 12, promote: 3, license: 4, basis: 'guess', blurb: '46경기를 치르는 잉글랜드 2부. 유럽 무대의 입구' },
    { name: 'EFL 리그 원', short: '리그 원', level: 66, promote: 3, license: 4, basis: 'guess', blurb: '전통의 구단들이 다시 올라가려 버티는 3부' },
    { name: 'EFL 리그 투', short: '리그 투', level: 60, promote: 4, license: 4, basis: 'guess', blurb: '풋볼리그의 마지막 계단' },
    { name: '내셔널리그', short: '내셔널리그', level: 54, promote: 2, license: 3, basis: 'game', blurb: '논리그 최상위. 승격 두 자리를 두고 24팀이 싸운다' },
  ],
  esp: [
    { name: '라리가', short: '라리가', level: 84, promote: 0, conti: 4, license: 4, basis: 'checked', blurb: '기술과 점유의 리그' },
    { name: '세군다 디비시온', short: '세군다', level: 71, promote: 3, license: 4, basis: 'checked', blurb: '42경기를 치르는 스페인 2부' },
    { name: '프리메라 페데라시온 1조', short: '프리메라 RFEF', level: 60, promote: 2, license: 4, basis: 'checked', blurb: '3부. 북부 구단들의 조' },
    { name: '세군다 페데라시온 1조', short: '세군다 RFEF', level: 52, promote: 1, license: 4, basis: 'checked', blurb: '4부. 갈리시아와 북부 해안의 조' },
    { name: '테르세라 페데라시온 갈리시아조', short: '테르세라 RFEF', level: 45, promote: 1, license: 3, basis: 'game', blurb: '5부. 갈리시아 지역 리그' },
  ],
  ger: [
    { name: '분데스리가', short: '분데스리가', level: 83, promote: 0, conti: 4, license: 4, basis: 'checked', blurb: '관중이 가장 많은 리그' },
    { name: '2. 분데스리가', short: '2. 분데스리가', level: 72, promote: 3, license: 4, basis: 'checked', blurb: '명문의 이름이 즐비한 2부' },
    { name: '3. 리가', short: '3. 리가', level: 64, promote: 3, license: 4, basis: 'checked', blurb: '전국 단일 3부. 2군 팀도 뛴다' },
    { name: '레기오날리가 베스트', short: '레기오날리가', level: 55, promote: 1, license: 3, basis: 'checked', blurb: '노르트라인베스트팔렌의 4부. 우승해야 올라간다' },
    { name: '오버리가 니더라인', short: '오버리가', level: 48, promote: 1, license: 2, basis: 'guess', blurb: '라인강 하류 지역의 5부' },
  ],
  ita: [
    { name: '세리에 A', short: '세리에 A', level: 82, promote: 0, conti: 4, license: 4, basis: 'checked', blurb: '전술의 리그' },
    { name: '세리에 B', short: '세리에 B', level: 71, promote: 3, license: 4, basis: 'checked', blurb: '세리에 A로 가는 길' },
    { name: '세리에 C A조', short: '세리에 C', level: 61, promote: 2, license: 3, basis: 'checked', blurb: '3부 북부 조' },
    { name: '세리에 D A조', short: '세리에 D', level: 53, promote: 1, license: 2, basis: 'checked', blurb: '전국 아마추어 최상위. 피에몬테와 리구리아의 조' },
    { name: '에첼렌차 롬바르디아 A조', short: '에첼렌차', level: 45, promote: 1, license: 1, basis: 'game', blurb: '밀라노 근교의 지역 리그' },
  ],
  fra: [
    { name: '리그 1', short: '리그 1', level: 80, promote: 0, conti: 3, license: 4, basis: 'checked', blurb: '재능을 길러 내보내는 리그' },
    { name: '리그 2', short: '리그 2', level: 70, promote: 3, license: 4, basis: 'checked', blurb: '프랑스 2부' },
    { name: '리그 3', short: '리그 3', level: 61, promote: 3, license: 4, basis: 'guess', blurb: '2026-27 시즌 새로 생긴 프로 3부(옛 내셔널)' },
    { name: '내셔널 1 A조', short: '내셔널 1', level: 53, promote: 1, license: 3, basis: 'checked', blurb: '4부(옛 내셔널 2). 서부 조' },
    { name: '내셔널 2 A조', short: '내셔널 2', level: 46, promote: 1, license: 3, basis: 'checked', blurb: '5부(옛 내셔널 3). 남서부 조' },
  ],
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

function build(): Record<string, LeagueMeta> {
  const out: Record<string, LeagueMeta> = {};
  for (const country of COUNTRY_IDS) {
    const defs = DEFS[country];
    defs.forEach((d, i) => {
      const id = `${country}${i + 1}`;
      out[id] = {
        name: d.name, short: d.short, country, tier: i + 1, level: d.level,
        rep: d.rep ?? Math.max(0, Math.round((d.level - 32) * 1.43)),
        money: d.money ?? round1(3 * 10 ** ((d.level - 32) * 0.081)),
        up: i > 0 ? `${country}${i}` : null,
        down: i < defs.length - 1 ? `${country}${i + 2}` : null,
        promote: d.promote, conti: d.conti ?? 0,
        weight: d.weight ?? Math.round(1 + 39 * ((d.level - 32) / 53) ** 4),
        license: d.license, licenseBasis: d.basis, blurb: d.blurb,
      };
    });
  }
  return out;
}

export const LEAGUES: Record<string, LeagueMeta> = build();
/** 모든 클럽 리그. 나라 순서, 나라 안에서는 1부부터. */
export const CLUB_LEAGUES: string[] = Object.keys(LEAGUES);
export const countryOf = (league: string): CountryId => LEAGUES[league]?.country ?? 'kr';
export const leaguesOf = (country: CountryId): string[] => CLUB_LEAGUES.filter((id) => LEAGUES[id]!.country === country);

/** 위키백과에서 모은 실제 구단 명단(한국 리그는 data.ts에 손으로 적었다). */
export const RESEARCHED: Record<string, [string, number][]> = WORLD_CLUBS;

// ---------- 외국인 규정 ----------

/** EU·EEA 국적. 스페인, 이탈리아, 프랑스의 비EU 한도에서 빠진다. */
export const EU = new Set(['프랑스', '스페인', '포르투갈', '독일', '이탈리아', '네덜란드', '벨기에', '덴마크', '크로아티아', '오스트리아', '스웨덴', '폴란드', '아일랜드', '노르웨이']);
/** 코토누 협정(아프리카·카리브·태평양) 국가. 스페인과 프랑스에서 비EU로 세지 않는다. */
export const COTONOU = new Set(['세네갈', '코트디부아르', '나이지리아', '가나', '카메룬']);
/** J리그 제휴국. 외국인으로 세지 않는다. */
export const JLEAGUE_PARTNERS = new Set(['태국', '베트남', '미얀마', '말레이시아', '캄보디아', '싱가포르', '인도네시아', '카타르']);

export interface Quota {
  /** 누구를 세는가: 자국 국적이 아닌 선수(foreign) 또는 EU 밖 국적 선수(noneu). */
  basis: 'foreign' | 'noneu';
  /** 등록 한도. null은 제한 없음. */
  reg: number | null;
  /** 동시 출전(선발) 한도. */
  pitch: number | null;
  /** 세지 않는 국적. */
  exempt: Set<string>;
  /** 화면에 적을 설명. */
  note: string;
}

const NONE: Quota = { basis: 'foreign', reg: null, pitch: null, exempt: new Set(), note: '외국인 한도 없음' };

/** 리그별 외국인 한도. 근거는 RULES.md. */
export function quotaOf(league: string): Quota {
  const c = countryOf(league);
  const tier = LEAGUES[league]?.tier ?? 5;
  if (c === 'kr') {
    const t: [number | null, number | null][] = [[null, 5], [null, 4], [4, 4], [4, 4], [3, 3]];
    const [reg, pitch] = t[tier - 1]!;
    return { basis: 'foreign', reg, pitch, exempt: new Set(), note: `외국인 ${reg === null ? '보유 무제한' : `보유 ${reg}명`}, 동시 출전 ${pitch}명${tier === 5 ? '(게임 규칙)' : ''}` };
  }
  if (c === 'jpn') {
    const pitch = [5, 4, 4, 4, 3][tier - 1]!;
    return { basis: 'foreign', reg: null, pitch, exempt: JLEAGUE_PARTNERS, note: `외국인 경기 엔트리 ${pitch}명${tier >= 4 ? '(게임 규칙)' : ''}. 동남아 제휴국 선수는 세지 않는다` };
  }
  if (c === 'esp' && tier <= 2) {
    const reg = tier === 1 ? 3 : 2;
    return { basis: 'noneu', reg, pitch: null, exempt: COTONOU, note: `비EU 선수 ${reg}명까지 등록. 코토누 협정국 선수는 세지 않는다` };
  }
  if (c === 'fra' && tier === 1) {
    return { basis: 'noneu', reg: 4, pitch: null, exempt: new Set([...COTONOU, '모로코', '알제리', '튀니지']), note: '비EU 선수 4명까지 계약. EU 협력 협정국 선수는 세지 않는다' };
  }
  if (c === 'ita' && tier === 1) {
    return { basis: 'noneu', reg: null, pitch: null, exempt: new Set(), note: '해외에서 비EU 선수를 새로 데려오는 것은 여름마다 2명까지' };
  }
  if (c === 'eng') return { ...NONE, note: '외국인 한도는 없지만 워크퍼밋과 홈그로운 규정이 있다' };
  if (c === 'ger') return { ...NONE, note: '비EU 한도 없음(분데스리가의 로컬 선수 규정은 게임에 넣지 않았다)' };
  return { ...NONE, note: '외국인 한도 없음(하부 리그 규정은 확인하지 못했다)' };
}

/** 세리에 A에서 한 여름 시장에 해외에서 새로 데려올 수 있는 비EU 선수 수. */
export const ITALY_NON_EU_SIGNINGS = 2;

// ---------- 선수 이름 ----------

/** 나라별 이름 재료(성, 이름). 일본은 성 이름 순서로 쓴다. */
const NAMES: Record<string, [string[], string[]]> = {
  일본: [
    ['사토', '스즈키', '다카하시', '다나카', '이토', '와타나베', '야마모토', '나카무라', '고바야시', '가토', '요시다', '야마다', '사사키', '야마구치', '마쓰모토', '이노우에', '기무라', '하야시', '사이토', '시미즈'],
    ['하루토', '유토', '소타', '다이키', '겐타', '렌', '쇼', '다쿠미', '가이토', '히로키', '료', '쓰바사', '유야', '고키', '신지', '마코토', '게이스케', '아쓰토', '다이치', '유마'],
  ],
  잉글랜드: [
    ['스미스', '존스', '테일러', '브라운', '윌리엄스', '윌슨', '존슨', '데이비스', '로버트슨', '라이트', '톰프슨', '에번스', '워커', '화이트', '로버츠', '그린', '홀', '우드', '잭슨', '클라크'],
    ['잭', '해리', '조지', '올리버', '찰리', '제임스', '토머스', '대니얼', '루이스', '조', '벤', '샘', '알피', '메이슨', '키어런', '리스', '캘럼', '코너', '라이언', '애덤'],
  ],
  스페인: [
    ['가르시아', '로드리게스', '곤살레스', '페르난데스', '로페스', '마르티네스', '산체스', '페레스', '고메스', '마르틴', '히메네스', '루이스', '에르난데스', '디아스', '모레노', '알바레스', '무뇨스', '로메로', '알론소', '나바로'],
    ['알레한드로', '파블로', '하비에르', '다니엘', '세르히오', '이반', '알바로', '마르코스', '아드리안', '호르헤', '라울', '미겔', '카를로스', '이케르', '우나이', '페드로', '루벤', '다비드', '마리오', '곤살로'],
  ],
  독일: [
    ['뮐러', '슈미트', '슈나이더', '피셔', '베버', '마이어', '바그너', '베커', '슐츠', '호프만', '코흐', '리히터', '클라인', '볼프', '슈뢰더', '노이만', '슈바르츠', '브라운', '침머만', '크뤼거'],
    ['루카스', '레온', '핀', '요나스', '니코', '팀', '얀', '펠릭스', '막시밀리안', '율리안', '파울', '니클라스', '토비아스', '마르코', '케빈', '플로리안', '다니엘', '슈테판', '마티아스', '요나탄'],
  ],
  이탈리아: [
    ['로시', '루소', '페라리', '에스포지토', '비앙키', '로마노', '콜롬보', '리치', '마리노', '그레코', '브루노', '갈로', '콘티', '데루카', '만치니', '코스타', '조르다노', '리초', '롬바르디', '모레티'],
    ['로렌초', '레오나르도', '프란체스코', '알레산드로', '마티아', '안드레아', '페데리코', '리카르도', '다비데', '니콜로', '잔루카', '마르코', '루카', '시모네', '파비오', '로베르토', '스테파노', '조반니', '에마누엘레', '토마소'],
  ],
  프랑스: [
    ['마르탱', '베르나르', '뒤부아', '토마', '로베르', '리샤르', '프티', '뒤랑', '르루아', '모로', '시몽', '로랑', '르페브르', '미셸', '다비드', '베르트랑', '루', '뱅상', '푸르니에', '지라르'],
    ['뤼카', '위고', '테오', '루이', '앙투안', '마티스', '클레망', '바티스트', '막상스', '노아', '라파엘', '쥘', '아드리앵', '에탕', '킬리앙', '얀', '사샤', '발랑탱', '로맹', '니콜라'],
  ],
};

/** 그 국적에 맞는 이름. 모르는 국적이면 null(공통 외국 이름을 쓴다). a, b는 0~1 난수. */
export function nativeName(nat: string, a: number, b: number): string | null {
  const pool = NAMES[nat];
  if (!pool) return null;
  const last = pool[0][Math.floor(a * pool[0].length)]!;
  const first = pool[1][Math.floor(b * pool[1].length)]!;
  return nat === '일본' ? `${last} ${first}` : `${first} ${last}`;
}

/** 외국인 선수 국적 후보. 아시아 리그와 유럽 리그가 다르다. 자기 나라는 뽑을 때 뺀다. */
export const FOREIGN_POOL: Record<'afc' | 'uefa', string[]> = {
  afc: ['브라질', '브라질', '브라질', '일본', '호주', '콜롬비아', '세르비아', '아르헨티나', '나이지리아', '포르투갈', '스페인', '우즈베키스탄', '크로아티아', '대한민국', '태국', '베트남'],
  uefa: ['브라질', '브라질', '프랑스', '스페인', '포르투갈', '아르헨티나', '네덜란드', '독일', '이탈리아', '벨기에', '덴마크', '노르웨이', '세네갈', '코트디부아르', '나이지리아', '미국', '크로아티아', '세르비아', '잉글랜드', '모로코', '우루과이', '콜롬비아', '일본', '대한민국'],
};

/** 리그 수준별 외국인 선수 비율. 한국은 이전 버전과 같게 둔다. */
export function foreignShare(league: string): number {
  const meta = LEAGUES[league];
  if (!meta) return 0.12;
  if (meta.country === 'kr') return 0.12;
  if (meta.country === 'jpn') return [0.15, 0.12, 0.08, 0.05, 0.03][meta.tier - 1]!;
  if (meta.country === 'eng') return [0.65, 0.45, 0.3, 0.2, 0.12][meta.tier - 1]!;
  return [0.5, 0.35, 0.22, 0.12, 0.06][meta.tier - 1]!;
}
