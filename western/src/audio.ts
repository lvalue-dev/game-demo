import type { GameEvent } from './game/types.ts';

// 소리 파일 없이 브라우저의 신시사이저로 효과음을 만든다.
// 브라우저는 사용자가 화면을 한 번 누른 뒤에만 소리를 허용하므로, 시작 버튼에서 unlock()을 부른다.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;

export function unlock(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function setMuted(value: boolean): void {
  muted = value;
}
export const isMuted = (): boolean => muted;

interface Tone {
  type: OscillatorType;
  from: number;
  to?: number;
  time: number;
  gain: number;
  delay?: number;
}

function tone({ type, from, to = from, time, gain, delay = 0 }: Tone): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + time);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + time);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + time + 0.02);
}

function hiss(time: number, gain: number, cutoff: number, delay = 0, kind: BiquadFilterType = 'lowpass'): void {
  if (!ctx || !master || !noise) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = kind;
  filter.frequency.setValueAtTime(cutoff, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.25), t + time);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + time);
  src.connect(filter).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, time + 0.05);
}

const SOUNDS: Record<GameEvent, () => void> = {
  shot: () => {
    hiss(0.16, 0.7, 5200);
    tone({ type: 'square', from: 190, to: 55, time: 0.12, gain: 0.35 });
  },
  enemyShot: () => {
    hiss(0.1, 0.22, 3200);
    tone({ type: 'square', from: 260, to: 110, time: 0.08, gain: 0.1 });
  },
  hit: () => tone({ type: 'triangle', from: 520, to: 260, time: 0.06, gain: 0.25 }),
  kill: () => {
    tone({ type: 'sawtooth', from: 220, to: 60, time: 0.2, gain: 0.3 });
    hiss(0.12, 0.2, 1800);
  },
  hurt: () => {
    tone({ type: 'sawtooth', from: 160, to: 70, time: 0.28, gain: 0.45 });
    hiss(0.2, 0.3, 900);
  },
  loot: () => {
    tone({ type: 'triangle', from: 660, time: 0.08, gain: 0.25 });
    tone({ type: 'triangle', from: 990, time: 0.12, gain: 0.25, delay: 0.07 });
  },
  safe: () => {
    hiss(0.25, 0.35, 1400);
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, time: 0.14, gain: 0.28, delay: 0.08 + i * 0.07 }));
  },
  coin: () => tone({ type: 'sine', from: 1320, to: 1760, time: 0.07, gain: 0.16 }),
  heal: () => {
    tone({ type: 'sine', from: 440, to: 660, time: 0.18, gain: 0.25 });
    tone({ type: 'sine', from: 660, to: 880, time: 0.18, gain: 0.2, delay: 0.1 });
  },
  reload: () => {
    tone({ type: 'square', from: 900, to: 700, time: 0.03, gain: 0.12 });
    tone({ type: 'square', from: 1200, to: 900, time: 0.03, gain: 0.12, delay: 0.12 });
  },
  dash: () => hiss(0.18, 0.25, 900, 0, 'bandpass'),
  throw: () => hiss(0.22, 0.18, 1600, 0, 'bandpass'),
  boom: () => {
    hiss(0.7, 0.95, 1200);
    tone({ type: 'sine', from: 110, to: 30, time: 0.6, gain: 0.8 });
  },
  alarm: () => {
    for (let i = 0; i < 4; i++) {
      tone({ type: 'triangle', from: 880, time: 0.16, gain: 0.3, delay: i * 0.22 });
      tone({ type: 'triangle', from: 1320, time: 0.16, gain: 0.14, delay: i * 0.22 });
    }
  },
  levelup: () => [392, 523, 659, 784].forEach((f, i) => tone({ type: 'square', from: f, time: 0.13, gain: 0.16, delay: i * 0.08 })),
  sheriff: () => {
    tone({ type: 'sawtooth', from: 98, time: 0.5, gain: 0.35 });
    tone({ type: 'sawtooth', from: 92, time: 0.7, gain: 0.35, delay: 0.45 });
  },
  escape: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', from: f, time: 0.2, gain: 0.25, delay: i * 0.09 })),
  dead: () => {
    tone({ type: 'sawtooth', from: 220, to: 40, time: 0.9, gain: 0.45 });
    hiss(0.5, 0.3, 600);
  },
};

/** 한 프레임에 같은 소리가 여러 번 겹치면 한 번만 낸다. */
export function playEvents(events: GameEvent[]): void {
  if (muted || !ctx || events.length === 0) return;
  for (const event of new Set(events)) SOUNDS[event]();
}
