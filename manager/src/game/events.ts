// 시즌 중간에 찾아오는 사건. 감독이 고르고, 능력치와 운이 결과를 가른다.
import { ko } from './josa.ts';
import { LEAGUES, won } from './data.ts';
import { chance, int, spread } from './rng.ts';
import { addPlayer, makePlayer, myClub, potentialText, stage, valueOf, weakest } from './squad.ts';
import { positionOf } from './world.ts';
import type { AttrId, ClubLeagueId, Game, Player, Tone } from './types.ts';

export interface Outcome {
  text: string;
  tone: Tone;
  effects: string[];
}

export interface EventChoice {
  id: string;
  label: string;
  detail?: string;
  run(g: Game): Outcome;
}

export interface GameEvent {
  id: string;
  weight: number;
  when(g: Game): boolean;
  title(g: Game): string;
  text(g: Game): string;
  choices(g: Game): EventChoice[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 능력치가 높을수록 잘 통하는 판정. 능력치 6이면 44%, 16이면 84%. */
export function roll(g: Game, attr: AttrId, bonus = 0): boolean {
  return chance(g, clamp(0.2 + g.manager.attrs[attr] * 0.04 + bonus, 0.1, 0.95));
}

interface Fx {
  morale?: number;
  confidence?: number;
  budget?: number;
  cohesion?: number;
  att?: number;
  def?: number;
  depth?: number;
  rep?: number;
}

/** 결과를 게임에 반영하고, 화면에 보여 줄 한 줄 요약들을 만든다. */
export function fx(g: Game, e: Fx): string[] {
  const out: string[] = [];
  const sign = (v: number): string => (v > 0 ? `+${v}` : `${v}`);
  if (e.morale) {
    g.morale = clamp(g.morale + e.morale, 0, 100);
    out.push(`분위기 ${sign(e.morale)}`);
  }
  if (e.confidence && g.job) {
    g.job.confidence = clamp(g.job.confidence + e.confidence, 0, 100);
    out.push(`${myClub(g).nation ? '협회' : '이사회'} 신뢰 ${sign(e.confidence)}`);
  }
  if (e.budget && g.job) {
    g.job.budget = Math.max(0, g.job.budget + e.budget);
    out.push(`예산 ${e.budget > 0 ? '+' : '-'}${won(Math.abs(e.budget))}`);
  }
  if (e.cohesion) {
    g.cohesion = clamp(g.cohesion + e.cohesion, 0, 100);
    out.push(`전술 완성도 ${sign(e.cohesion)}`);
  }
  if (e.att) {
    g.season.attMod += e.att;
    out.push(`이번 시즌 공격 ${sign(e.att)}`);
  }
  if (e.def) {
    g.season.defMod += e.def;
    out.push(`이번 시즌 수비 ${sign(e.def)}`);
  }
  if (e.depth) {
    g.season.depthMod += e.depth;
    out.push(`이번 시즌 스쿼드 뎁스 ${sign(e.depth)}`);
  }
  if (e.rep) {
    g.manager.rep = clamp(g.manager.rep + e.rep, 0, 100);
    out.push(`명성 ${sign(e.rep)}`);
  }
  return out;
}

const best = (g: Game): Player => [...g.squad].sort((a, b) => b.ovr - a.ovr)[0] as Player;
const second = (g: Game): Player => [...g.squad].sort((a, b) => b.ovr - a.ovr)[1] as Player;
const eldest = (g: Game): Player => [...g.squad].sort((a, b) => b.age - a.age)[0] as Player;
const kid = (g: Game): Player => [...g.squad].sort((a, b) => a.age - b.age)[0] as Player;
const troublemaker = (g: Game): Player => g.squad.find((p) => p.trait === 'rebel') ?? second(g);
const keeper = (g: Game): Player => g.squad.find((p) => p.pos === 'GK') as Player;
const isClub = (g: Game): boolean => !myClub(g).nation;
const league = (g: Game): ClubLeagueId => myClub(g).league as ClubLeagueId;
// 동호인 팀(K5)에서만 동네 축구다운 사건이 일어난다. 실제 팀이므로 구단의 잘못을 지어내는 사건은 두지 않는다.
const amateur = (g: Game): boolean => isClub(g) && league(g) === 'kr5';
const boss = (g: Game): string => (myClub(g).nation ? '협회장' : amateur(g) ? '회장님' : '구단주');
const money = (g: Game): number => stage(g).money;

export const EVENTS: GameEvent[] = [
  {
    id: 'wantaway', weight: 3,
    when: (g) => isClub(g) && best(g).ovr >= stage(g).level + 5,
    title: () => '에이스의 이적 요청',
    text: (g) => ko`OVR ${best(g).ovr}의 에이스 ${best(g).name}이 감독실 문을 두드렸다. 더 큰 무대에서 뛰고 싶다고 한다. 에이전트는 이미 다른 구단과 통화 중이라는 소문이다.`,
    choices: (g) => {
      const star = best(g);
      const fee = Math.round(valueOf(star, stage(g).level, money(g)) * 1.2);
      return [
        {
          id: 'talk', label: '직접 설득한다', detail: '장악력 판정. 실패하면 마음이 떠난 채로 뛴다',
          run: (h) => roll(h, 'lead')
            ? { text: ko`한 시간 넘게 이야기했다. ${star.name}은 고개를 끄덕였다. "이번 시즌은 감독님과 끝까지 갑니다."`, tone: 'good', effects: fx(h, { morale: 6 }) }
            : (star.temp -= 3, { text: ko`설득은 통하지 않았다. ${star.name}은 훈련장에 나오지만 눈빛이 예전 같지 않다.`, tone: 'bad', effects: [`${star.name} OVR -3 (이번 시즌)`, ...fx(h, { morale: -5 })] }),
        },
        {
          id: 'sell', label: `${won(fee)}에 판다`, detail: '돈은 생기지만 전력이 빠진다',
          run: (h) => {
            const fill = makePlayer(h, star.pos, stage(h).level - 2, int(h, 21, 27), stage(h).region);
            h.squad = h.squad.map((p) => (p.id === star.id ? fill : p));
            return { text: ko`${star.name}은 짐을 쌌다. 빈자리는 OVR ${fill.ovr}의 ${fill.name}이 맡는다. 팬들은 아쉬워하지만 통장은 두둑해졌다.`, tone: 'plain', effects: fx(h, { budget: fee, morale: -4 }) };
          },
        },
        {
          id: 'raise', label: '연봉을 올려 붙잡는다', detail: `예산 ${won(money(g) * 0.25)}`,
          run: (h) => ({ text: ko`${boss(h)}을 설득해 새 계약서를 내밀었다. ${star.name}은 사인했다.`, tone: 'good', effects: fx(h, { budget: -Math.min(h.job!.budget, money(h) * 0.25), morale: 3 }) }),
        },
      ];
    },
  },
  {
    id: 'clash', weight: 3,
    when: () => true,
    title: () => '라커룸 충돌',
    text: (g) => ko`훈련 중 ${troublemaker(g).name}과 ${best(g).name === troublemaker(g).name ? second(g).name : best(g).name}이 거칠게 부딪혔고, 라커룸에서 언성이 높아졌다. 선수단이 둘로 갈릴 조짐이다.`,
    choices: (g) => {
      const rebel = troublemaker(g);
      return [
        {
          id: 'dinner', label: '둘을 데리고 밥을 먹는다', detail: '장악력 판정',
          run: (h) => roll(h, 'lead', 0.1)
            ? { text: '고깃집에서 세 시간. 마지막엔 둘이 어깨동무를 하고 나왔다. 다음 날 훈련 분위기가 달라졌다.', tone: 'good', effects: fx(h, { morale: 8, cohesion: 4 }) }
            : { text: '식사 자리는 어색한 침묵으로 끝났다. 계산만 감독이 했다.', tone: 'bad', effects: fx(h, { morale: -5 }) },
        },
        {
          id: 'fine', label: '둘 다 벌금을 물린다', detail: '규율은 서지만 분위기는 식는다',
          run: (h) => ({ text: '원칙대로 처리했다. 아무도 불만을 말하지 않았다. 적어도 감독 앞에서는.', tone: 'plain', effects: fx(h, { morale: -3, cohesion: 3 }) }),
        },
        {
          id: 'bench', label: ko`${rebel.name}을 명단에서 뺀다`, detail: '본보기. 당분간 전력이 빠진다',
          run: (h) => {
            rebel.temp -= 2;
            return { text: ko`${rebel.name}은 두 경기를 관중석에서 봤다. 돌아온 뒤로는 조용하다. 조금 지나치게 조용하다.`, tone: 'plain', effects: [`${rebel.name} OVR -2 (이번 시즌)`, ...fx(h, { morale: 2 })] };
          },
        },
      ];
    },
  },
  {
    id: 'injuries', weight: 3,
    when: () => true,
    title: () => '부상 병동',
    text: (g) => ko`한 주 사이에 주전 둘이 쓰러졌다. ${g.squad.find((p) => p.trait === 'glass')?.name ?? eldest(g).name}은 또 햄스트링이다. 다음 경기 명단을 채우기도 빠듯하다.`,
    choices: (g) => [
      {
        id: 'kids', label: isClub(g) ? '유소년을 올려 쓴다' : '어린 선수를 추가 발탁한다', detail: '육성 판정. 잘 풀리면 뜻밖의 수확',
        run: (h) => roll(h, 'youth')
          ? { text: '열아홉 살짜리가 데뷔전에서 결승 골을 넣었다. 위기가 기회가 됐다.', tone: 'good', effects: fx(h, { depth: 2, morale: 5 }) }
          : { text: '아이들은 아직 준비가 안 됐다. 그래도 경험은 남았다.', tone: 'bad', effects: fx(h, { depth: -2 }) },
      },
      ...(isClub(g) ? [{
        id: 'loan', label: '급히 임대해 온다', detail: `예산 ${won(money(g) * 0.15)}`,
        run: (h: Game): Outcome => ({ text: '이적 시장 마감 직전에 임대 계약 두 건을 성사시켰다. 급한 불은 껐다.', tone: 'plain' as Tone, effects: fx(h, { budget: -Math.min(h.job!.budget, money(h) * 0.15), depth: 2 }) }),
      }] : []),
      {
        id: 'grit', label: '있는 선수로 버틴다', detail: '스쿼드 뎁스이 얇아진다',
        run: (h) => ({ text: '남은 선수들이 이를 악물었다. 하지만 일정은 사정을 봐주지 않는다.', tone: 'bad', effects: fx(h, { depth: -3, morale: 2 }) }),
      },
    ],
  },
  {
    id: 'owner', weight: 2,
    when: () => true,
    title: (g) => `${boss(g)}의 전화`,
    text: (g) => amateur(g)
      ? `회장님이 전화를 했다. 조카가 이번에 팀에 들어왔는데 선발로 좀 써 달라는 부탁이다. 조카의 실력은, 솔직히 말해 조기축구에서도 후보다.`
      : ko`${boss(g)}이 직접 전화를 했다. 다음 경기 선발 명단에 대해 "의견"이 있다고 한다. 거액을 주고 데려온 선수를 왜 안 쓰느냐는 것이다.`,
    choices: () => [
      {
        id: 'accept', label: '뜻대로 해 드린다', detail: '신뢰는 얻지만 선수단이 본다',
        run: (h) => ({ text: '명단이 발표되자 라커룸이 술렁였다. 윗선은 흡족해했다.', tone: 'plain', effects: fx(h, { confidence: 8, morale: -7 }) }),
      },
      {
        id: 'refuse', label: '명단은 감독이 짠다고 말한다', detail: '협상력 판정. 실패하면 미운털이 박힌다',
        run: (h) => roll(h, 'deal')
          ? { text: '정중하지만 분명하게 말했다. 수화기 너머에서 잠시 침묵이 흐르더니 웃음소리가 들렸다. "그래, 그게 감독이지."', tone: 'good', effects: fx(h, { morale: 6, confidence: 2 }) }
          : { text: '전화는 차갑게 끊겼다. 선수들은 감독 편이지만, 윗선은 그렇지 않다.', tone: 'bad', effects: fx(h, { morale: 5, confidence: -8 }) },
      },
    ],
  },
  {
    id: 'derby', weight: 2,
    when: () => true,
    title: () => '경기 전 기자회견',
    text: (g) => amateur(g)
      ? '라이벌 팀 총무가 단체 대화방에 "이번 주는 몸 풀러 간다"고 올렸다. 우리 선수들이 캡처해서 돌려 보고 있다.'
      : '큰 경기를 앞둔 기자회견. 상대 감독이 먼저 "저 팀 축구는 10년 전 축구"라고 말했다. 기자들이 답을 기다린다.',
    choices: () => [
      {
        id: 'fire', label: '맞받아친다', detail: '장악력 판정. 선수단이 불타거나, 역풍을 맞거나',
        run: (h) => roll(h, 'lead')
          ? { text: '"경기장에서 봅시다. 90분이면 충분합니다." 선수들이 그 영상을 돌려 봤다. 훈련장 공기가 달라졌다.', tone: 'good', effects: fx(h, { morale: 10 }) }
          : { text: '말이 조금 지나쳤다. 발언은 종일 화제가 됐고, 선수들은 괜한 부담을 안고 뛰게 됐다.', tone: 'bad', effects: fx(h, { morale: -6 }) },
      },
      {
        id: 'calm', label: '웃으며 넘긴다',
        run: (h) => ({ text: '"좋은 팀과 좋은 경기 하겠습니다." 기자들은 실망했지만 선수단은 평소대로 준비했다.', tone: 'plain', effects: fx(h, { morale: 2 }) }),
      },
    ],
  },
  {
    id: 'gem', weight: 2,
    when: (g) => isClub(g) && g.manager.attrs.eye >= 8,
    title: () => '스카우터의 귀띔',
    text: (g) => `오랜 지인인 스카우터가 연락했다. ${LEAGUES[league(g)].down ? '아래 리그' : '대학 리그'}에 아무도 모르는 선수가 있다고 한다. "지금 아니면 못 데려와요."`,
    choices: (g) => {
      const { level, region } = stage(g);
      return [
        {
          id: 'sign', label: '믿고 계약한다', detail: `예산 ${won(money(g) * 0.12)}`,
          run: (h) => {
            const gemPlayer = makePlayer(h, weakest(h.squad, 'FW').ovr < weakest(h.squad, 'DF').ovr ? 'FW' : 'DF', level + 1, int(h, 19, 21), region);
            gemPlayer.pot = Math.min(99, gemPlayer.ovr + int(h, 8, 14) + Math.round(h.manager.attrs.eye / 3));
            const out = addPlayer(h, gemPlayer);
            return { text: ko`${gemPlayer.name}이 합류했다. ${gemPlayer.age}세, OVR ${gemPlayer.ovr}, ${potentialText(h, gemPlayer)}. ${out.name} 대신 주전으로 뛴다. 첫 훈련을 본 코치들이 서로 얼굴을 쳐다봤다.`, tone: 'good', effects: fx(h, { budget: -Math.min(h.job!.budget, money(h) * 0.12) }) };
          },
        },
        { id: 'pass', label: '지금 선수단을 믿는다', run: (h) => ({ text: '고맙지만 사양했다. 그 선수는 한 달 뒤 다른 팀 유니폼을 입었다.', tone: 'plain', effects: fx(h, { cohesion: 3 }) }) },
      ];
    },
  },
  {
    id: 'protest', weight: 5,
    when: (g) => isClub(g) && positionOf(g, myClub(g).league, myClub(g).id) >= g.job!.objective + 3,
    title: () => '팬들의 항의',
    text: (g) => amateur(g)
      ? '경기가 끝나고 동네 어르신들이 벤치로 찾아왔다. "감독 바꾼 뒤로 축구가 재미없어졌어." 회장님도 옆에서 듣고 있다.'
      : `경기장 밖에 현수막이 걸렸다. "이대로는 안 된다." 순위는 ${positionOf(g, myClub(g).league, myClub(g).id)}위, 목표는 ${g.job!.objective}위 이내였다.`,
    choices: () => [
      {
        id: 'meet', label: '팬들 앞에 직접 선다', detail: '장악력 판정',
        run: (h) => roll(h, 'lead')
          ? { text: '변명하지 않고 계획을 설명했다. 박수가 나오지는 않았지만, 현수막은 다음 날 내려갔다.', tone: 'good', effects: fx(h, { confidence: 8, morale: 4 }) }
          : { text: '말을 꺼내기도 전에 야유가 쏟아졌다. 그 장면은 그대로 퍼졌다.', tone: 'bad', effects: fx(h, { confidence: -6, morale: -4 }) },
      },
      {
        id: 'change', label: '전술을 뜯어고치겠다고 약속한다', detail: '전술 완성도가 깎이지만 시간을 번다',
        run: (h) => ({ text: '훈련 일정을 전부 바꿨다. 선수들은 혼란스러워하지만 윗선은 "뭔가 하고 있다"고 본다.', tone: 'plain', effects: fx(h, { confidence: 6, cohesion: -15 }) }),
      },
      {
        id: 'ignore', label: '결과로 답하겠다', detail: '흔들리지 않는다. 신뢰는 깎인다',
        run: (h) => ({ text: '아무 말도 하지 않았다. 훈련장 문을 닫고 준비에만 매달렸다.', tone: 'plain', effects: fx(h, { confidence: -4, cohesion: 6 }) }),
      },
    ],
  },
  {
    id: 'referee', weight: 2,
    when: () => true,
    title: () => '오심 논란',
    text: () => '명백한 오프사이드가 골로 인정됐고, 그 한 골로 졌다. 경기가 끝나고 카메라가 감독을 향한다.',
    choices: (g) => [
      {
        id: 'rage', label: '판정을 공개 비판한다', detail: '선수들은 좋아한다. 징계가 따라올 수 있다',
        run: (h) => chance(h, 0.5)
          ? { text: '"오늘은 축구가 진 날입니다." 선수들은 감독이 대신 싸워 줬다고 느꼈다. 징계는 경고로 끝났다.', tone: 'good', effects: fx(h, { morale: 8 }) }
          : { text: '발언이 문제가 돼 두 경기 벤치에 앉지 못했고 벌금까지 나왔다.', tone: 'bad', effects: fx(h, { morale: 4, cohesion: -6, ...(isClub(h) ? { budget: -Math.min(h.job!.budget, money(h) * 0.05) } : {}) }) },
      },
      {
        id: 'swallow', label: '삼킨다',
        run: (h) => ({ text: '"판정도 경기의 일부입니다." 속은 탔지만 다음 경기를 준비했다.', tone: 'plain', effects: fx(h, { cohesion: 3, ...(isClub(g) ? {} : { confidence: 2 }) }) }),
      },
    ],
  },
  {
    id: 'captain', weight: 2,
    when: (g) => g.job!.seasons === 0,
    title: () => '주장 완장',
    text: (g) => ko`새 팀의 주장을 정해야 한다. 최고참 ${eldest(g).name}(${eldest(g).age}세), 에이스 ${best(g).name}(OVR ${best(g).ovr}), 그리고 ${kid(g).age}세 막내 ${kid(g).name}이 후보로 거론된다.`,
    choices: (g) => [
      {
        id: 'old', label: `${eldest(g).name}에게 맡긴다`, detail: '안정적인 선택',
        run: (h) => ({ text: ko`${eldest(h).name}은 묵묵히 완장을 찼다. 라커룸에 중심이 생겼다.`, tone: 'good', effects: fx(h, { morale: eldest(h).trait === 'leader' ? 9 : 5 }) }),
      },
      {
        id: 'star', label: `${best(g).name}에게 맡긴다`, detail: '에이스의 책임감에 건다',
        run: (h) => chance(h, 0.6)
          ? { text: ko`완장을 찬 ${best(h).name}은 경기장 안팎에서 달라졌다.`, tone: 'good', effects: fx(h, { att: 1, morale: 3 }) }
          : { text: `${best(h).name}에게 완장은 짐이었다. 경기력까지 흔들린다.`, tone: 'bad', effects: fx(h, { att: -1 }) },
      },
      {
        id: 'young', label: `${kid(g).name}에게 맡긴다`, detail: '파격. 육성 판정',
        run: (h) => roll(h, 'youth')
          ? { text: ko`모두가 놀랐지만 ${kid(h).name}은 누구보다 먼저 훈련장에 나왔다. 형들이 따라 움직이기 시작했다.`, tone: 'good', effects: fx(h, { morale: 7, cohesion: 4 }) }
          : { text: '고참들의 표정이 굳었다. 완장은 한 달 만에 주인이 바뀌었다.', tone: 'bad', effects: fx(h, { morale: -6 }) },
      },
    ],
  },
  {
    id: 'overtime', weight: 4,
    when: (g) => amateur(g),
    title: () => '골키퍼의 야근',
    text: (g) => ko`토요일 아침 7시 경기인데, 주전 골키퍼 ${keeper(g).name}이 금요일 밤에 연락했다. "감독님, 내일 출근하래요." 후보 골키퍼는 지난주에 이사를 갔다.`,
    choices: (g) => [
      {
        id: 'call', label: `${keeper(g).name}의 부장에게 전화한다`, detail: '협상력 판정',
        run: (h) => roll(h, 'deal')
          ? { text: '"부장님, 이 친구 없으면 우리 동네가 집니다." 10분 통화 끝에 반차를 얻어 냈다. 부장님은 경기도 보러 왔다.', tone: 'good', effects: fx(h, { morale: 8 }) }
          : { text: '부장님은 축구에 관심이 없었다. 통화는 30초 만에 끝났고, 필드 플레이어가 장갑을 꼈다.', tone: 'bad', effects: fx(h, { def: -1, morale: -2 }) },
      },
      {
        id: 'self', label: '감독이 직접 장갑을 낀다', detail: '선수 겸 감독',
        run: (h) => chance(h, 0.4)
          ? { text: '서른다섯 넘은 무릎으로 페널티킥을 막아 냈다. 그날 회식 자리에서 그 얘기만 세 시간을 했다.', tone: 'good', effects: fx(h, { morale: 12 }) }
          : { text: '네 골을 먹었다. 선수들은 웃었고, 감독은 일주일을 절뚝거렸다. 그래도 분위기는 좋다.', tone: 'plain', effects: fx(h, { morale: 4, def: -1 }) },
      },
    ],
  },
  {
    id: 'wages', weight: 3,
    when: (g) => isClub(g) && league(g) === 'kr5' && myClub(g).wealth <= 0,
    title: () => '오른 대관료',
    text: () => '구청이 운동장 대관료를 올렸다. 총무 계산으로는 올 시즌 운영비가 모자라 다음 달 대관 신청이 어렵다.',
    choices: (g) => [
      {
        id: 'pocket', label: '이적 예산을 헐어 메운다', detail: `예산 ${won(Math.min(g.job!.budget, money(g) * 0.3))}`,
        run: (h) => ({ text: '선수 영입은 물 건너갔다. 대신 선수단은 감독이 누구 편인지 알게 됐다.', tone: 'good', effects: fx(h, { budget: -Math.min(h.job!.budget, money(h) * 0.3), morale: 9 }) }),
      },
      {
        id: 'sponsor', label: '후원사를 직접 찾아 나선다', detail: '협상력 판정',
        run: (h) => roll(h, 'deal')
          ? { text: '동네 상가를 사흘 동안 돌았다. 유니폼 소매에 치킨집 로고가 붙었고, 모자란 운영비가 채워졌다.', tone: 'good', effects: fx(h, { budget: money(h) * 0.2, morale: 6, confidence: 5 }) }
          : { text: '명함만 한 뭉치 받아 왔다. 훈련에 빠진 사흘이 아깝다.', tone: 'bad', effects: fx(h, { cohesion: -5, morale: -4 }) },
      },
      {
        id: 'ask', label: '선수들에게 기다려 달라고 한다', detail: '장악력 판정',
        run: (h) => roll(h, 'lead', -0.1)
          ? { text: '"이번 시즌 끝날 때까지만 나를 믿어 달라." 아무도 훈련에 빠지지 않았다.', tone: 'good', effects: fx(h, { morale: 4 }) }
          : { text: '두 명이 팀을 떠났다. 남은 선수들의 발도 무겁다.', tone: 'bad', effects: fx(h, { depth: -3, morale: -8 }) },
      },
    ],
  },
  {
    id: 'wonderkid', weight: 3,
    when: (g) => kid(g).age <= 21 && kid(g).pot - kid(g).ovr >= 5,
    title: () => '어린 재능',
    text: (g) => ko`${kid(g).age}세 ${kid(g).name}이 최근 훈련에서 눈에 띄게 달라졌다. 코치들은 지금 밀어줘야 한다고 하고, 의무팀은 아직 몸이 덜 만들어졌다고 한다.`,
    choices: () => [
      {
        id: 'push', label: '매 경기 풀타임을 준다', detail: '빨리 크거나, 다치거나',
        run: (h) => {
          const p = kid(h);
          if (chance(h, p.trait === 'glass' ? 0.5 : 0.25)) {
            p.temp -= 3;
            return { text: ko`${p.name}은 한 달 만에 피로 골절로 쓰러졌다. 의무팀장은 아무 말도 하지 않았다.`, tone: 'bad', effects: [`${p.name} OVR -3 (이번 시즌)`] };
          }
          p.ovr = Math.min(p.pot, p.ovr + 3);
          return { text: ko`${p.name}은 경기를 뛸수록 달라졌다. 석 달 만에 다른 선수가 됐다.`, tone: 'good', effects: [`${p.name} OVR +3`] };
        },
      },
      {
        id: 'slow', label: '천천히 키운다', detail: '유소년 지도 판정. 포텐셜이 더 열릴 수 있다',
        run: (h) => {
          const p = kid(h);
          if (roll(h, 'youth')) {
            p.pot = Math.min(99, p.pot + 3);
            p.ovr = Math.min(p.pot, p.ovr + 1);
            return { text: `개인 훈련 프로그램을 따로 짰다. ${p.name}의 약점이던 왼발이 무기가 되어 간다.`, tone: 'good', effects: [`${p.name} OVR +1, 포텐셜 +3`] };
          }
          return { text: ko`${p.name}은 벤치에서 조바심을 냈다. 성장은 예상한 만큼만 이뤄졌다.`, tone: 'plain', effects: [] };
        },
      },
    ],
  },
  {
    id: 'analyst', weight: 2,
    when: () => true,
    title: () => '분석팀의 보고서',
    text: (g) => amateur(g)
      ? '팀에서 유일하게 축구 영상을 챙겨 보는 막내가 종이 한 장을 내밀었다. 우리 팀 실점의 절반이 같은 패턴이라는 것이다.'
      : '분석팀이 두꺼운 보고서를 들고 왔다. 상대들이 우리 빌드업의 버릇을 읽었다고 한다. 손보려면 2주는 훈련을 갈아엎어야 한다.',
    choices: () => [
      {
        id: 'adopt', label: '보고서대로 고친다', detail: '전술 판정',
        run: (h) => roll(h, 'tactics')
          ? { text: '수정은 정확히 들어맞았다. 상대는 준비해 온 압박이 헛도는 걸 보고 당황했다.', tone: 'good', effects: fx(h, { att: 1, def: 1 }) }
          : { text: '고치려다 원래 잘하던 것까지 흔들렸다.', tone: 'bad', effects: fx(h, { cohesion: -10 }) },
      },
      { id: 'keep', label: '하던 대로 밀고 간다', run: (h) => ({ text: '선수들에게 익숙한 것을 지켰다. 전술 완성도는 계속 쌓인다.', tone: 'plain', effects: fx(h, { cohesion: 5 }) }) },
    ],
  },
  {
    id: 'pitch', weight: 3,
    when: (g) => isClub(g) && league(g) === 'kr5',
    title: () => '운동장 이중 예약',
    text: () => '일요일 아침 운동장에 도착하니 배드민턴 동호회가 먼저 와 있다. 구청 예약 시스템이 또 말썽이다. 상대 팀은 30분 뒤에 도착한다.',
    choices: () => [
      {
        id: 'nego', label: '동호회 회장과 담판을 짓는다', detail: '협상력 판정',
        run: (h) => roll(h, 'deal')
          ? { text: '음료수 한 상자와 다음 달 예약 양보로 합의했다. 배드민턴 회원 몇은 남아서 응원까지 했다.', tone: 'good', effects: fx(h, { morale: 6 }) }
          : { text: '언성만 높아졌다. 결국 옆 동네 학교 운동장까지 뛰어가서 경기를 치렀다. 몸도 못 풀었다.', tone: 'bad', effects: fx(h, { morale: -5 }) },
      },
      { id: 'half', label: '운동장을 반씩 쓴다', run: (h) => ({ text: '셔틀콕이 날아다니는 옆에서 7 대 7로 경기를 했다. 아무도 이 경기를 잊지 못할 것이다.', tone: 'plain', effects: fx(h, { morale: 3, cohesion: -3 }) }) },
    ],
  },
  {
    id: 'tv', weight: 2,
    when: (g) => isClub(g) && ['kr2', 'kr1', 'eu2', 'eu1'].includes(league(g)),
    title: () => '다큐멘터리 제안',
    text: () => '방송사가 한 시즌 밀착 다큐멘터리를 찍자고 한다. 제작비 일부가 구단에 들어오고, 라커룸까지 카메라가 들어온다.',
    choices: (g) => [
      {
        id: 'yes', label: '찍는다', detail: `예산 +${won(money(g) * 0.2)}. 선수단이 흔들릴 수 있다`,
        run: (h) => chance(h, 0.5 + h.manager.attrs.lead * 0.02)
          ? { text: '선수들은 카메라 앞에서 오히려 더 뭉쳤다. 감독의 하프타임 연설 장면은 조회 수가 폭발했다.', tone: 'good', effects: fx(h, { budget: money(h) * 0.2, rep: 2, morale: 3 }) }
          : { text: '라커룸에서 나온 말이 편집돼 예고편에 실렸다. 분위기가 싸늘해졌다.', tone: 'bad', effects: fx(h, { budget: money(h) * 0.2, morale: -8 }) },
      },
      { id: 'no', label: '라커룸은 선수들의 공간이다', run: (h) => ({ text: '정중히 거절했다. 선수들은 그 결정을 들었다.', tone: 'plain', effects: fx(h, { morale: 4 }) }) },
    ],
  },
  {
    id: 'release', weight: 5,
    when: (g) => myClub(g).nation,
    title: () => '소속팀의 차출 거부',
    text: (g) => `${best(g).name}의 유럽 소속팀이 이번 소집에 선수를 보내지 않겠다고 통보했다. 부상 위험이 있다는 이유다. 규정상 강제할 수는 있지만 선수가 곤란해진다.`,
    choices: (g) => [
      {
        id: 'force', label: '규정대로 소집한다', detail: '전력은 지킨다. 선수는 지친 채로 온다',
        run: (h) => ({ text: ko`${best(h).name}은 14시간을 날아와 이틀 뒤 경기에 나섰다. 뛰어 주긴 했다.`, tone: 'plain', effects: fx(h, { morale: -4 }) }),
      },
      {
        id: 'talk', label: '소속팀 감독과 직접 통화한다', detail: '협상력 판정',
        run: (h) => roll(h, 'deal')
          ? { text: '출전 시간을 조절하기로 약속하고 양해를 얻었다. 선수는 홀가분하게 합류했다.', tone: 'good', effects: fx(h, { morale: 6, confidence: 3 }) }
          : (best(h).temp -= 3, { text: ko`통화는 평행선이었다. 결국 ${best(g).name}은 반쪽짜리 몸으로 합류했다.`, tone: 'bad', effects: [`${best(g).name} OVR -3 (올해)`] }),
      },
      {
        id: 'rest', label: '이번엔 쉬게 한다', detail: '에이스 없이 치른다',
        run: (h) => ({ text: '에이스 없는 명단이 발표됐다. 대신 기회를 얻은 선수들의 눈빛이 다르다.', tone: 'plain', effects: fx(h, { att: -2, morale: 5, depth: 2 }) }),
      },
    ],
  },
  {
    id: 'roster', weight: 5,
    when: (g) => myClub(g).nation,
    title: () => '명단 논란',
    text: (g) => ko`대표팀 명단이 발표되자 여론이 들끓는다. 리그 득점 선두를 왜 안 뽑았느냐는 것이다. 감독이 보기에 그 선수는 지금 전술에 맞지 않는다. ${eldest(g).name}을 계속 뽑는 것도 도마에 올랐다.`,
    choices: () => [
      {
        id: 'explain', label: '기자회견에서 이유를 설명한다', detail: '장악력 판정',
        run: (h) => roll(h, 'lead')
          ? { text: '전술판까지 들고 나와 20분 동안 설명했다. 다음 날 기사 제목이 달라졌다. "감독에게는 계획이 있다."', tone: 'good', effects: fx(h, { confidence: 6, morale: 4 }) }
          : { text: '설명은 변명으로 들렸다. 논란은 더 커졌다.', tone: 'bad', effects: fx(h, { confidence: -6 }) },
      },
      {
        id: 'add', label: '여론대로 추가 발탁한다', detail: '잠잠해지지만 손발이 안 맞는다',
        run: (h) => ({ text: '추가 발탁이 발표되자 여론은 잦아들었다. 훈련장에서는 호흡을 다시 맞추고 있다.', tone: 'plain', effects: fx(h, { confidence: 5, cohesion: -10, att: 1 }) }),
      },
    ],
  },
];

/** 조건에 맞는 사건 가운데 하나를 고른다. 바로 전 사건은 다시 나오지 않는다. */
export function pickEvent(g: Game): GameEvent {
  const pool = EVENTS.filter((e) => e.id !== g.eventId && e.when(g));
  let at = spread(g, 0, pool.reduce((sum, e) => sum + e.weight, 0));
  for (const e of pool) {
    at -= e.weight;
    if (at < 0) return e;
  }
  return pool[0] as GameEvent;
}

export const eventById = (id: string): GameEvent => EVENTS.find((e) => e.id === id) as GameEvent;
