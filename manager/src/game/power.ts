// 감독 팀이 한 경기에 내는 전력. 자동 진행 경기와 직접 지휘하는 경기가 같은 바탕을 쓴다.
import { depthOf } from './contract.ts';
import { ratings, stage } from './squad.ts';
import { BASE, matchup } from './tactics.ts';
import type { Game, StyleId } from './types.ts';

export interface Side {
  att: number;
  def: number;
}

/**
 * 평범한 감독이 팀에 더하는 전력. 다른 구단의 전력에는 이 몫이 이미 들어 있으므로,
 * 감독 팀은 그만큼을 빼고 시작해 전술과 숙련도와 사기로 그 이상을 끌어내야 한다.
 */
export const AVERAGE_MANAGER = 3.5;

/** 전술 능력치가 전술의 효과를 키우는 배수. 6이면 1.0, 20이면 1.9. */
export const skill = (g: Game): number => 0.6 + g.manager.attrs.tactics / 15;

/** 전술 숙련도가 주는 공수 보정. */
export const drilled = (g: Game): number => (g.cohesion / 100) * (1 + g.manager.attrs.tactics / 6);

/** 전술과 무관한 바탕 전력: 선수단, 사기, 훈련, 시즌 중 사건의 여파. mid는 미드필더 실력이다. */
export function baseSide(g: Game, half: 1 | 2): Side & { mid: number } {
  const s = g.season;
  const r = ratings(g, depthOf(g));
  const mood = (g.morale - 55) / 15;
  const fit = s.focus === 'fitness' && half === 2 ? 1 : 0;
  return {
    att: r.att + s.attMod - AVERAGE_MANAGER + mood + fit + (s.focus === 'attack' ? 1.5 : 0),
    def: r.def + s.defMod - AVERAGE_MANAGER + mood + fit + (s.focus === 'defense' ? 1.5 : 0),
    mid: r.mid,
  };
}

/** 우리 미드필더가 이 무대의 평균보다 얼마나 좋은지. 압박과 점유의 싸움을 가른다. */
export const midEdge = (g: Game): number => ratings(g, depthOf(g)).mid - stage(g).level;

/**
 * 자동으로 진행되는 경기의 전력. 시즌 전에 고른 전술을 그대로 쓴다.
 * 상대의 전술을 알면 상성이 더해지고, 후반기에는 후반기 운영이 더해진다.
 */
export function autoSide(g: Game, opp: Side, oppStyle: StyleId | null, half: 1 | 2, cup: boolean): Side {
  const s = g.season;
  const base = baseSide(g, half);
  const k = skill(g);
  const edge = midEdge(g);
  let { att, def } = base;
  if (s.style === 'press' && half === 2 && s.focus !== 'fitness') {
    // 전방 압박은 시즌 후반에 지친다. 체력 훈련을 해 두면 버틴다.
    att -= 0.5;
    def -= 1;
  } else {
    // 점유는 미드필더가 받쳐 줘야 한다.
    const scale = s.style === 'possess' && edge < 0 ? 0.4 : 1;
    att += BASE[s.style].att * k * scale;
    def += BASE[s.style].def * k * scale;
  }
  if (s.style === 'counter') {
    // 역습은 강팀을 상대로 더 날카롭고, 약팀을 상대로는 공을 떠안아 답답하다.
    att += (opp.att + opp.def) / 2 > (att + def) / 2 + 1 ? 1.5 : -1;
  }
  if (oppStyle) {
    const m = matchup(s.style, oppStyle, edge);
    att += m.att;
    def += m.def;
  }
  att += drilled(g);
  def += drilled(g);
  if (half === 2) {
    if (s.plan === 'allout') {
      att += 2.5;
      def -= 1.5;
    } else if (s.plan === 'steady') {
      def += 2.5;
      att -= 1.5;
    } else {
      att += cup ? 2 : -1;
      def += cup ? 2 : -1;
    }
  }
  return { att, def };
}
