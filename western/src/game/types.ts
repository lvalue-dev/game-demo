export interface Vec {
  x: number;
  y: number;
}

/** 물체의 재질. 색과, 총알이나 폭발에 대한 반응이 여기서 정해진다. */
export type Material = 'wood' | 'adobe' | 'brick' | 'stone' | 'metal' | 'plant' | 'powder';

export type ObstacleKind =
  | 'building' | 'crate' | 'barrel' | 'powder' | 'trough' | 'wagon' | 'cactus' | 'rock'
  | 'outhouse' | 'hay' | 'tree' | 'well' | 'windmill';

/** 물체 표면에 남는 흔적. dx, dy는 물체 왼쪽 위에서의 위치, u는 옆면에서의 높이(0~1). */
export interface Mark {
  dx: number;
  dy: number;
  u: number;
  kind: 'hole' | 'scorch';
  size: number;
}

/** 건물을 이루는 부품 조합. 실제 서부 개척 마을의 건물 유형을 따른다. */
export interface BuildingStyle {
  /**
   * falsefront: 박공지붕 앞에 높은 가짜 정면을 세운 목조 상점.
   * flat: 난간벽을 두른 평지붕. 벽돌 은행과 어도비 건물.
   * barn: 박공 벽이 그대로 드러나는 마구간.
   * cabin: 가짜 정면이 없는 작은 집과 작업장.
   */
  form: 'falsefront' | 'flat' | 'barn' | 'cabin';
  stories: 1 | 2;
  roof: 'shingle' | 'tin' | 'tar';
  /** 가게 종류. 문과 창, 딸린 물건이 달라진다. */
  trade: 'saloon' | 'bank' | 'store' | 'jail' | 'livery' | 'smithy' | 'hotel' | 'shop';
  /** 보도 위를 덮는 차양. 2층 건물에서는 발코니가 된다. */
  awning: boolean;
  chimney: boolean;
}

/** 길을 막지 않는 마을 시설물. */
export interface Decor {
  kind: 'pole' | 'rail' | 'grave' | 'woodpile';
  x: number;
  y: number;
  /** 가로대의 길이처럼 종류마다 뜻이 다른 치수. */
  size: number;
}

/** 길을 막는 물체. 사각형 바닥을 차지한다. */
export interface Rect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ObstacleKind;
  material: Material;
  /** 부서지지 않는 물체는 Infinity. */
  hp: number;
  maxHp: number;
  /** 화면에 그릴 때의 높이. */
  tall: number;
  marks: Mark[];
  label?: string;
  style?: BuildingStyle;
}

/** 지나다닐 수 있는 덤불. 총알은 통과하고, 불에는 탄다. */
export interface Bush {
  id: number;
  /** creosote: 크레오소트 덤불, pear: 프리클리페어 선인장, grass: 마른 풀, ocotillo: 오코티요. */
  kind: 'creosote' | 'pear' | 'grass' | 'ocotillo';
  x: number;
  y: number;
  size: number;
  burnt: boolean;
}

/** 바닥에 남는 자국. */
export interface Decal {
  x: number;
  y: number;
  kind: 'crater' | 'scorch' | 'blood' | 'ash' | 'puddle' | 'debris' | 'stump';
  size: number;
  rot: number;
}

/** 타고 있는 불. 닿으면 누구든 다친다. */
export interface Fire {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  tick: number;
  /** 건물 벽에 붙은 불은 바닥보다 위에 그린다. */
  lift: number;
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
  /** 이미 맞힌 대상의 id. 같은 대상을 두 번 맞히지 않게 한다. */
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
  /** 누가 터뜨렸는가. 화약통처럼 주인이 없으면 누구든 다친다. */
  owner: 'player' | 'enemy' | 'neutral';
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
  /** 폭발이나 불에 쓰러져 그을렸는가. */
  charred: boolean;
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

export type ParticleShape = 'dot' | 'shard' | 'chunk' | 'spark' | 'leaf' | 'drop' | 'smoke' | 'flame';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: ParticleShape;
  rot: number;
  spin: number;
}

/** 소리와 화면 연출이 반응하는 사건. 화면 쪽이 매 프레임 읽고 비운다. */
export type GameEvent =
  | 'shot' | 'enemyShot' | 'hit' | 'kill' | 'hurt' | 'loot' | 'safe' | 'coin' | 'heal'
  | 'reload' | 'dash' | 'throw' | 'boom' | 'alarm' | 'levelup' | 'sheriff' | 'escape' | 'dead'
  | 'hitWood' | 'hitStone' | 'hitMetal' | 'hitPlant' | 'splash' | 'break' | 'burn';

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

/** inside: 건물 안에 들어가 있어 바깥 세상이 멈춘 상태. */
export type WorldPhase = 'play' | 'inside' | 'escaped' | 'dead';

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
  bushes: Bush[];
  decor: Decor[];
  decals: Decal[];
  fires: Fire[];
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
  /** 은행 문 앞에 서 있은 시간. 다 차면 안으로 들어간다. */
  enterProgress: number;
  /** 은행에는 한 작전에 한 번만 들어갈 수 있다. */
  bankVisited: boolean;
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
