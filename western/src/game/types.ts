export interface Vec {
  x: number;
  y: number;
}

export type ObstacleKind = 'bank' | 'saloon' | 'store' | 'house' | 'cover';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ObstacleKind;
  label?: string;
}

export interface Loot {
  id: number;
  x: number;
  y: number;
  kind: 'bag' | 'safe';
  value: number;
  /** 터는 데 걸리는 시간(초). */
  time: number;
  progress: number;
  taken: boolean;
}

export type EnemyKind = 'deputy' | 'rifle';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  /** 조준 중이면 발사까지 남은 시간. 0이면 조준하지 않는 중. */
  aim: number;
  aimDir: number;
  cooldown: number;
  strafe: number;
  hitFlash: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  fromPlayer: boolean;
  damage: number;
  pierce: number;
  /** 이미 맞힌 적의 id. 관통탄이 같은 적을 두 번 맞히지 않게 한다. */
  hit: number[];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface Decor {
  x: number;
  y: number;
  kind: 'cactus' | 'bush' | 'stone';
  size: number;
}

/** 업그레이드로 바뀌는 수치. 한 판 내내 유지된다. */
export interface Stats {
  fireInterval: number;
  reloadTime: number;
  maxAmmo: number;
  speed: number;
  pierce: number;
  pellets: number;
  crackSpeed: number;
  maxHp: number;
}

export interface Player {
  x: number;
  y: number;
  hp: number;
  ammo: number;
  /** 재장전이 끝날 때까지 남은 시간. 0이면 재장전 중이 아니다. */
  reload: number;
  fireCd: number;
  dashCd: number;
  dashTime: number;
  dashX: number;
  dashY: number;
  invuln: number;
  aimDir: number;
  hurtFlash: number;
}

export type WorldPhase = 'play' | 'escaped' | 'dead';

export interface World {
  rng: number;
  job: number;
  phase: WorldPhase;
  time: number;
  player: Player;
  stats: Stats;
  enemies: Enemy[];
  bullets: Bullet[];
  loots: Loot[];
  particles: Particle[];
  obstacles: Rect[];
  decor: Decor[];
  horse: Vec;
  /** 수배 수치. 정수 부분이 화면의 별 개수다. */
  heat: number;
  alarmed: boolean;
  spawnTimer: number;
  loot: number;
  quota: number;
  escapeProgress: number;
  shake: number;
  kills: number;
  nextId: number;
}

export interface Input {
  moveX: number;
  moveY: number;
  /** 조준 방향(라디안). 조준 입력이 없으면 null. */
  aim: number | null;
  fire: boolean;
  dash: boolean;
  reload: boolean;
}
