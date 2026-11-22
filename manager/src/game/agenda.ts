// 감독이 지금 챙겨야 할 일. 진행 화면과 스쿼드 탭 위에 보여 준다.
import { won } from './data.ts';
import { ko } from './josa.ts';
import { ESC_SLOTS, NON_HG_LIMIT, RESERVE_LIMIT, englandStatus, foreignCount, inEngland, promiseKept, quota, totalWages } from './contract.ts';
import { posPenalty } from './player.ts';
import { LEAGUES } from './data.ts';
import { COUNTRIES } from './countries.ts';
import { courseStatus, licenseName } from './hiring.ts';
import { positionOf } from './world.ts';
import { lineAt, myClub } from './squad.ts';
import type { Game, Player, Tone } from './types.ts';

export interface Todo {
  text: string;
  tone: Tone;
  /** 어디서 처리하는지: 이적시장, 스쿼드 탭. */
  where: string;
}

const names = (list: Player[]): string => list.map((p) => p.name).join(', ');

export function agenda(g: Game): Todo[] {
  if (!g.job) return [];
  const club = myClub(g);
  const todo: Todo[] = [];
  const everyone = [...g.squad, ...g.reserves];
  const market = g.phase === 'market' || g.phase === 'winter';
  const w = market ? g.window : null;

  if (w && w.bids.length > 0) todo.push({ text: `들어온 이적 제안 ${w.bids.length}건. 답하지 않으면 시장 마감과 함께 사라진다.`, tone: 'plain', where: '이적시장' });

  if (!club.nation) {
    const expiring = everyone.filter((p) => p.contract && p.contract.years <= 1 && !p.loan);
    if (expiring.length) todo.push({ text: `계약 만료 임박: ${names(expiring)}. 재계약하지 않으면 시즌이 끝나고 이적료 없이 떠난다.`, tone: 'bad', where: '이적시장 재계약' });
    const unhappy = everyone.filter((p) => p.unhappy);
    if (unhappy.length) todo.push({ text: `불만 있는 선수: ${names(unhappy)}. 이적 요구가 들어오기 쉽고 재계약이 어렵다.`, tone: 'bad', where: '스쿼드 · 이적시장' });
    const broken = g.reserves.filter((p) => !promiseKept(g, p) && !p.unhappy);
    if (broken.length) todo.push({ text: `출전 약속을 어기고 있다: ${names(broken)}. 시장 마감이나 시즌 끝에 불만으로 번진다.`, tone: 'bad', where: '스쿼드 선발 배치' });

    const job = g.job;
    if (job.budget < 0) todo.push({ text: `이적 예산이 바닥났다(${won(job.budget)}).`, tone: 'bad', where: '이적시장 판매' });
    if (job.wageBudget > 0) {
      const wages = totalWages(g);
      if (wages > job.wageBudget) todo.push({ text: `연봉 총액 ${won(wages)}이 예산 ${won(job.wageBudget)}을 넘었다. 새 계약을 맺을 수 없다.`, tone: 'bad', where: '이적시장 판매 · 임대 · 해지' });
      else if (wages > job.wageBudget * 0.92) todo.push({ text: `연봉 예산이 거의 찼다(${won(wages)} / ${won(job.wageBudget)}).`, tone: 'plain', where: '이적시장' });
    }
    if (g.reserves.length >= RESERVE_LIMIT) todo.push({ text: `등록 인원이 꽉 찼다(후보 ${RESERVE_LIMIT}명). 영입하려면 먼저 자리를 비워야 한다.`, tone: 'plain', where: '이적시장 판매 · 임대' });

    const q = quota(g);
    const reg = foreignCount(g, everyone);
    const start = foreignCount(g, g.squad);
    if (q.reg !== null && reg > q.reg) todo.push({ text: `외국인 등록 ${reg}명으로 한도 ${q.reg}명을 넘었다. 새 외국인 선수를 등록할 수 없다.`, tone: 'bad', where: '이적시장' });
    if (q.pitch !== null && start > q.pitch) todo.push({ text: `외국인 선발 ${start}명으로 한도 ${q.pitch}명을 넘었다. 시즌이 시작되면 자동으로 빠진다.`, tone: 'bad', where: '스쿼드 선발 배치' });

    if (inEngland(g)) {
      const st = englandStatus(g);
      if (st.nonHg > NON_HG_LIMIT) todo.push({ text: `홈그로운이 아닌 21세 이상 선수가 ${st.nonHg}명으로 한도 ${NON_HG_LIMIT}명을 넘었다. 이런 선수를 새로 등록할 수 없다.`, tone: 'bad', where: '이적시장 판매 · 임대' });
      else if (st.nonHg >= NON_HG_LIMIT) todo.push({ text: `비홈그로운 등록 한도가 찼다(${st.nonHg}/${NON_HG_LIMIT}). 새로 데려올 수 있는 건 홈그로운이나 21세 이하 선수뿐이다.`, tone: 'plain', where: '이적시장' });
      if (st.esc > 0) todo.push({ text: `ESC 예외 슬롯 ${st.esc}/${ESC_SLOTS} 사용 중. 워크퍼밋 점수가 모자란 23세 이하 선수만 이 슬롯으로 데려올 수 있다.`, tone: 'plain', where: '이적시장' });
    }
    const debts = job.debts.filter((d) => d.due === g.year + 1);
    if (debts.length) todo.push({ text: `다음 시즌에 낼 분할 이적료 ${won(debts.reduce((s, d) => s + d.amount, 0))}.`, tone: 'plain', where: '예산' });
  }

  // 지도자 자격: 승격하면 더 높은 자격이 필요한지, 지금 들을 수 있는 강습이 있는지.
  if (!club.nation) {
    const meta = LEAGUES[club.league]!;
    const up = meta.up ? LEAGUES[meta.up]! : null;
    const m = g.manager;
    if (up && up.license > m.license && m.course?.level !== up.license) {
      const pos = g.round > 0 ? positionOf(g, club.league, club.id) : 0;
      const close = pos > 0 && pos <= meta.promote + 2;
      const country = COUNTRIES[meta.country];
      const way = up.license - m.license === 1 && country.grace ? `${country.name} 규정상 강습을 들으며 한 시즌은 지휘할 수 있다` : '자격이 없으면 승격해도 감독직을 내려놓아야 한다';
      todo.push({ text: ko`${up.name}는 ${licenseName(up.license, meta.country)}이 필요하다(지금 ${licenseName(m.license)}). ${way}.`, tone: close ? 'bad' : 'plain', where: '시즌 뒤 구직 화면 · 강습' });
    }
    const st = courseStatus(g);
    if (st.ok) todo.push({ text: `${licenseName(st.level)} 강습을 신청할 수 있다. 시즌이 끝나면 구직 화면에서 신청한다.`, tone: 'plain', where: '시즌 뒤 강습' });
  }

  const off = g.squad.map((p, i) => ({ p, line: lineAt(i) })).filter((x) => posPenalty(x.p.spot, x.line) > 0);
  if (off.length) todo.push({ text: `포지션 밖 기용: ${off.map((x) => `${x.p.name}(${x.p.spot}→${x.line}, OVR -${posPenalty(x.p.spot, x.line)})`).join(', ')}.`, tone: 'plain', where: '스쿼드 선발 배치' });

  const loanIn = everyone.filter((p) => p.loan?.dir === 'in');
  if (loanIn.length) todo.push({ text: `임대 온 선수: ${loanIn.map((p) => `${p.name}(${p.loan!.until === 'winter' ? '겨울에' : '시즌 끝에'} ${p.loan!.club} 복귀)`).join(', ')}.`, tone: 'plain', where: '스쿼드' });
  if (g.loaned.length) todo.push({ text: `임대 보낸 선수: ${g.loaned.map((p) => `${p.name}(${p.loan!.club}, ${p.loan!.until === 'winter' ? '겨울 복귀' : '시즌 끝 복귀'})`).join(', ')}.`, tone: 'plain', where: '스쿼드' });

  return todo;
}
