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

export type EnemyKind = 'deputy' | 'shotgun' | 'rifle' | 'bomber' | 'sheriff';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  /** 총에 맞아 밀려나는 속도. */
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  /** 조준 중이면 발사까지 남은 시간. 0이면 조준하지 않는 중. */
  aim: number;
  aimDir: number;
  cooldown: number;
  /** 연사 중 남은 발수. */
  burst: number;
  strafe: number;
  facing: number;
  hitFlash: number;
  muzzle: number;
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

/** 던져진 다이너마이트. 날아가서 떨어진 뒤 도화선이 다 타면 터진다. */
export interface Bomb {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  elapsed: number;
  flight: number;
  fuse: number;
  radius: number;
  damage: number;
  fromPlayer: boolean;
}

export interface Pickup {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: 'coin' | 'whiskey';
  value: number;
  life: number;
}

export interface Corpse {
  x: number;
  y: number;
  dir: number;
  kind: EnemyKind;
}

export interface Blast {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
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

/** 소리와 화면 연출이 반응하는 사건. 화면 쪽이 매 프레임 읽고 비운다. */
export type GameEvent =
  | 'shot' | 'enemyShot' | 'hit' | 'kill' | 'hurt' | 'loot' | 'safe' | 'coin' | 'heal'
  | 'reload' | 'dash' | 'throw' | 'boom' | 'alarm' | 'levelup' | 'sheriff' | 'escape' | 'dead';

/** 능력으로 바뀌는 수치. 한 판 내내 유지된다. */
export interface Stats {
  fireInterval: number;
  reloadTime: number;
  maxAmmo: number;
  speed: number;
  damage: number;
  pierce: number;
  pellets: number;
  crackSpeed: number;
  maxHp: number;
  bombCooldown: number;
  bombRadius: number;
  dashCooldown: number;
  /** 떨어진 돈을 끌어당기는 거리. */
  magnet: number;
  /** 돈자루와 금고에서 얻는 돈의 배수. */
  lootMult: number;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  ammo: number;
  /** 재장전이 끝날 때까지 남은 시간. 0이면 재장전 중이 아니다. */
  reload: number;
  fireCd: number;
  bombCd: number;
  dashCd: number;
  dashTime: number;
  dashX: number;
  dashY: number;
  invuln: number;
  aimDir: number;
  hurtFlash: number;
  muzzle: number;
  dust: number;
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
  bombs: Bomb[];
  pickups: Pickup[];
  loots: Loot[];
  corpses: Corpse[];
  blasts: Blast[];
  texts: FloatText[];
  particles: Particle[];
  obstacles: Rect[];
  decor: Decor[];
  horse: Vec;
  /** 수배 수치. 정수 부분이 화면의 별 개수다. */
  heat: number;
  alarmed: boolean;
  spawnTimer: number;
  sheriffSpawned: boolean;
  loot: number;
  quota: number;
  /** 악명. 가득 차면 능력을 하나 고른다. */
  xp: number;
  level: number;
  /** 아직 고르지 않은 능력 선택 횟수. */
  pendingPerks: number;
  escapeProgress: number;
  shake: number;
  /** 타격 순간 화면을 잠깐 멈추는 시간. */
  hitStop: number;
  kills: number;
  nextId: number;
  events: GameEvent[];
}

export interface Input {
  moveX: number;
  moveY: number;
  /** 조준 방향(라디안). 조준 입력이 없으면 null. */
  aim: number | null;
  /** 조준점까지의 거리. 다이너마이트를 던질 곳을 정한다. 없으면 기본 거리. */
  aimDist: number | null;
  fire: boolean;
  dash: boolean;
  reload: boolean;
  bomb: boolean;
}
