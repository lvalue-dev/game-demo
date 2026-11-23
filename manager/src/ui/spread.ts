// 선수 말이 서로 포개지지 않게, 화면에 그릴 자리만 벌린다. 경기 엔진의 위치는 건드리지 않는다.
// 엔진에서는 마크맨이 1미터 옆에 붙지만 말은 지름이 4미터쯤이라, 그대로 그리면 등번호가 가려진다.

export interface Dot {
  x: number;
  y: number;
  /** 말의 반지름(m). 두 말의 중심은 반지름의 합보다 가까워지지 않는다. */
  r: number;
  /** 버티는 힘. 클수록 덜 밀린다(공을 가진 선수는 제자리에 가깝게 둔다). */
  hold: number;
}

/** 말이 벗어나지 못하는 테두리. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 경기장. 밖으로 2m까지는 밀려나도 된다. */
const FIELD: Box = { x0: -2, x1: 107, y0: -2, y1: 70 };

/**
 * 겹친 말을 둘씩 밀어낸다. 차례가 늘 같아서 입력이 조금 바뀌면 결과도 조금만 바뀐다(화면이 튀지 않는다).
 * 몇 바퀴 돌려도 못 푼 겹침은 남긴다. 문전에 스무 명이 몰리면 다 벌릴 자리가 없다.
 */
export function spread(dots: Dot[], rounds = 8, box: Box = FIELD): void {
  for (let n = 0; n < rounds; n++) {
    let moved = false;
    for (let i = 0; i < dots.length; i++) {
      const a = dots[i] as Dot;
      for (let j = i + 1; j < dots.length; j++) {
        const b = dots[j] as Dot;
        const need = a.r + b.r;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if (Math.abs(dx) >= need || Math.abs(dy) >= need) continue;
        let d = Math.hypot(dx, dy);
        if (d >= need) continue;
        if (d < 0.01) {
          // 같은 자리에 섰으면 번호에 따라 정해진 쪽으로 가른다.
          const ang = (i * 7 + j * 13) * 0.61;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (need - d) / d;
        const ka = b.hold / (a.hold + b.hold);
        a.x -= dx * push * ka;
        a.y -= dy * push * ka;
        b.x += dx * push * (1 - ka);
        b.y += dy * push * (1 - ka);
        moved = true;
      }
    }
    if (!moved) return;
    for (const p of dots) {
      p.x = Math.max(box.x0, Math.min(box.x1, p.x));
      p.y = Math.max(box.y0, Math.min(box.y1, p.y));
    }
  }
}

/** 아직 포개진 쌍의 수(검사용). 틈은 반지름 합의 몇 배까지 봐줄지다. */
export function overlaps(dots: Dot[], slack = 0.98): number {
  let n = 0;
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const a = dots[i] as Dot;
      const b = dots[j] as Dot;
      if (Math.hypot(b.x - a.x, b.y - a.y) < (a.r + b.r) * slack) n++;
    }
  }
  return n;
}
