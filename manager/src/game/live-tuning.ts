// scripts/calibrate-live.ts가 만든 파일. 손으로 고치지 않는다.
// 전력이 같을 때 어떤 전술, 대형, 지시를 골라도 기대 득점이 같아지도록 맞춘 배수다.
export const tuning: { style: number[][]; shape: number[][]; extra: Record<string, [number, number]> } = {
  style: [
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1],
  ],
  shape: [
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ],
  extra: {},
};
