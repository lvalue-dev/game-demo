import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overlaps, spread } from '../src/ui/spread.ts';
import type { Dot } from '../src/ui/spread.ts';

const dot = (x: number, y: number, hold = 1): Dot => ({ x, y, r: 2.4, hold });

test('포개진 말은 반지름의 합만큼 벌어진다', () => {
  const dots = [dot(50, 30), dot(50.8, 30.3)];
  spread(dots);
  const [a, b] = dots as [Dot, Dot];
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 4.8 - 1e-6);
  // 서로의 방향은 그대로다(마크맨이 어느 쪽에 붙었는지 알 수 있다).
  assert.ok(b.x > a.x && b.y > a.y);
});

test('떨어져 있는 말은 건드리지 않는다', () => {
  const dots = [dot(20, 20), dot(30, 20), dot(20, 30)];
  spread(dots);
  assert.deepEqual(dots.map((d) => [d.x, d.y]), [[20, 20], [30, 20], [20, 30]]);
});

test('같은 자리에 선 말도 갈라놓고, 공을 가진 선수는 덜 밀린다', () => {
  const dots = [dot(40, 34, 3), dot(40, 34)];
  spread(dots);
  const [a, b] = dots as [Dot, Dot];
  assert.equal(overlaps(dots), 0);
  assert.ok(Math.hypot(a.x - 40, a.y - 34) < Math.hypot(b.x - 40, b.y - 34));
});

test('문전 혼전도 풀고, 경기장 밖으로 멀리 내보내지 않는다', () => {
  // 코너킥: 열네 명이 골문 앞 12×10미터에 몰려 있다.
  const dots: Dot[] = [];
  for (let k = 0; k < 14; k++) dots.push(dot(96 + (k % 4) * 3, 29 + Math.floor(k / 4) * 3.2 + (k % 2) * 0.7));
  spread(dots, 16);
  assert.equal(overlaps(dots), 0);
  for (const d of dots) assert.ok(d.x <= 107 && d.x >= -2 && d.y >= -2 && d.y <= 70);
});

test('입력이 조금 바뀌면 결과도 조금만 바뀐다', () => {
  const make = (shift: number): Dot[] => [dot(50, 30), dot(51 + shift, 30.5), dot(49, 32.5), dot(52.5, 33)];
  const a = make(0);
  const b = make(0.05);
  spread(a);
  spread(b);
  a.forEach((d, k) => assert.ok(Math.hypot(d.x - (b[k] as Dot).x, d.y - (b[k] as Dot).y) < 0.5));
});

test('스쿼드 미리보기: 어느 대형이든 선발 열한 명의 말이 포개지지 않고 경기장 안에 선다', async () => {
  const { SLOTS } = await import('../src/game/live.ts');
  const { peekSpots } = await import('../src/ui/peek.ts');
  for (const [shape, slots] of Object.entries(SLOTS)) {
    const spots = peekSpots(slots);
    for (let i = 0; i < spots.length; i++) {
      const a = spots[i]!;
      assert.ok(a.x >= 9 && a.x <= 91 && a.y >= 11 && a.y <= 107, `${shape} ${i}번이 밖으로 나갔다 (${a.x.toFixed(1)}, ${a.y.toFixed(1)})`);
      for (let j = i + 1; j < spots.length; j++) {
        const b = spots[j]!;
        // 말 하나의 자리는 너비 18.5, 높이 21.5다. 타원으로 보고 살짝(4%) 닿는 것까지는 봐준다.
        const d = Math.hypot((b.x - a.x) / 18.5, (b.y - a.y) / 21.5);
        assert.ok(d >= 0.96, `${shape} ${i}번과 ${j}번이 포개진다 (${d.toFixed(2)})`);
      }
    }
    // 줄의 앞뒤는 지킨다: 골키퍼가 맨 아래, 공격수가 수비수보다 위.
    const y = (line: string): number[] => slots.map((s, i) => (s.line === line ? spots[i]!.y : NaN)).filter((v) => !Number.isNaN(v));
    assert.ok(Math.min(...y('GK')) > Math.max(...y('DF')), `${shape} 골키퍼가 수비수보다 앞에 섰다`);
    assert.ok(Math.min(...y('DF')) > Math.max(...y('FW')), `${shape} 수비수가 공격수보다 앞에 섰다`);
  }
});
