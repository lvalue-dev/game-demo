import { isMuted, playEvents, setMuted, unlock } from './audio.ts';
import { JOBS } from './game/map.ts';
import { buy, canBuy, choosePerk, finishJob, newRun, nextJob, perkChoices, perkDef, startJob } from './game/run.ts';
import type { Run } from './game/run.ts';
import { MAX_HEAT, NO_INPUT, heatLevel, leaveBuilding, quotaMet, step, xpForLevel } from './game/sim.ts';
import type { GameEvent, Vec, World } from './game/types.ts';
import { attachControls } from './input.ts';
import { createBank, stepInterior } from './interior/level.ts';
import type { Interior } from './interior/level.ts';
import { createView3D } from './interior/view3d.ts';
import type { View3D } from './interior/view3d.ts';
import { draw, drawOverlay, makeView, screenToWorld, snapCamera, updateCamera } from './render.ts';
import type { Insets, View } from './render.ts';

/** inside: 건물 안. 화면이 1인칭 3D로 바뀐다. */
type Screen = 'title' | 'play' | 'inside' | 'perk' | 'shop' | 'dead' | 'won';

const LANDSCAPE_KEY = 'mungigol-landscape';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('game');
const ctx = canvas.getContext('2d')!;
const hud = $('hud');
const panel = $('panel');
const banner = $('banner');
const dashButton = $('dash');
const bombButton = $('bomb');
const muteButton = $('mute');
const rotateButton = $('rotate');
const canvas3d = $<HTMLCanvasElement>('game3d');
const crosshair = $('crosshair');
const fireButton = $('fire');

/** 지금 들어가 있는 건물 안의 상태. 밖에 있으면 null. */
let interior: Interior | null = null;
let view3d: View3D | null = null;
let fireHeld = false;
/** 사격 버튼을 누른 채 끈 만큼의 시점 이동. */
let fireDrag: { last: Vec | null; x: number; y: number } = { last: null, x: 0, y: 0 };

/** 세로로 선 폰에서 화면을 옆으로 돌려 가로로 쓰는 중인가. */
let rotated = false;
let wantLandscape = loadLandscapePref();

/** 브라우저 좌표를 캔버스 안의 좌표로 바꾼다. 화면을 90도 돌렸으면 축이 서로 바뀐다. */
function toLocal(clientX: number, clientY: number): Vec {
  if (rotated) return { x: clientY, y: window.innerWidth - clientX };
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

const controls = attachControls(canvas, dashButton, bombButton, toLocal);

let run: Run = newRun(randomSeed());
let world: World = startJob(run);
let screen: Screen = 'title';
let view: View = makeView(1, 1, 1);
let last = performance.now();
let bannerUntil = 0;
/** 쓰러진 뒤 결과 화면을 띄우기까지의 여유 시간. */
let deadDelay = 0;
/** 악명이 올랐을 때 고를 수 있는 능력. */
let choices: string[] = [];
/** 직전 프레임의 상태. 바뀌는 순간에 안내 문구를 띄우는 데 쓴다. */
let seen = { alarmed: false, level: 0, quota: false, sheriff: false };

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function loadLandscapePref(): boolean {
  try {
    return localStorage.getItem(LANDSCAPE_KEY) === '1';
  } catch {
    return false;
  }
}

function setLandscape(value: boolean): void {
  wantLandscape = value;
  try {
    localStorage.setItem(LANDSCAPE_KEY, value ? '1' : '0');
  } catch {
    // 저장이 막혀 있으면 이번 판에만 적용된다.
  }
  layout();
  if (screen !== 'play') renderPanel();
}

const isPortraitViewport = (): boolean => window.innerHeight > window.innerWidth;

/** 화면 크기와 방향에 맞춰 무대, 캔버스, 카메라 여백을 다시 잡는다. */
function layout(): void {
  const touch = controls.usesTouch();
  rotated = touch && wantLandscape && isPortraitViewport();
  stage.classList.toggle('is-rotated', rotated);
  stage.classList.toggle('is-touch', touch);
  stage.style.width = rotated ? window.innerHeight + 'px' : '';
  stage.style.height = rotated ? window.innerWidth + 'px' : '';
  rotateButton.hidden = !(touch && isPortraitViewport());
  rotateButton.textContent = rotated ? '세로 화면' : '가로 화면';

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  // 조작부가 덮는 만큼은 게임 화면에서 뺀다. 세로에서는 아래쪽, 가로에서는 양옆이다.
  const insets: Insets = !touch ? { top: 0, right: 0, bottom: 0, left: 0 }
    : w > h ? { top: 0, right: 120, bottom: 0, left: 120 }
    : { top: 64, right: 0, bottom: 132, left: 0 };
  const prev = view;
  view = makeView(w, h, dpr, insets);
  view.camX = prev.camX;
  view.camY = prev.camY;
  view3d?.resize(w, h, dpr);
}

// ---------- 건물 안(1인칭) ----------

function enterBank(): void {
  interior = createBank(run.job, run.stats, world.player.hp, world.player.ammo, randomSeed());
  view3d ??= createView3D(canvas3d);
  view3d.build(interior);
  setScreen('inside');
  layout();
  say('은행 안이다. 금고는 안쪽 오른편 방에 있다. 문으로 나가면 마을로 돌아간다.', 5);
}

function leaveBank(): void {
  const s = interior!;
  leaveBuilding(world, {
    loot: s.loot, hp: s.player.hp, ammo: s.player.ammo, xp: s.xp, kills: s.kills, alerted: s.alerted, seconds: s.time,
  });
  interior = null;
  if (document.pointerLockElement) document.exitPointerLock();
  hudKey = '';
  seen.alarmed = world.alarmed;
  snapCamera(view, world);
  setScreen('play');
  if (world.phase !== 'play') return;
  say(s.loot > 0 ? '은행에서 $' + s.loot + ' 챙겨 나왔다. 밖이 시끄럽다.' : '빈손으로 나왔다.', 3.5);
}

function stepInside(dt: number, now: number): void {
  const s = interior!;
  const moved = controls.read(world.player, (sx, sy) => screenToWorld(view, sx, sy), []);
  const look = controls.takeLook();
  const touch = controls.usesTouch();
  const turn = touch ? 0.0058 : 0.0026;
  stepInterior(s, {
    moveX: moved.moveX,
    moveZ: -moved.moveY,
    lookX: (look.x + fireDrag.x) * turn,
    lookY: -(look.y + fireDrag.y) * turn,
    fire: fireHeld || controls.mouseDown(),
    reload: moved.reload,
    assist: touch,
  }, dt);
  fireDrag.x = fireDrag.y = 0;

  view3d!.react(s);
  const sounds: GameEvent[] = [];
  for (const e of s.events) if (e.type === 'sound') sounds.push(e.name);
  playEvents(sounds);
  s.events.length = 0;
  view3d!.render(s, dt);
  const message = now < bannerUntil ? banner.textContent ?? '' : '';
  drawOverlay(ctx, view, controls.sticks(), s.player.hurtFlash, s.player.hp <= 2, now / 1000, message);
  updateHudInside(s);
  if (s.done) leaveBank();
}

function updateHudInside(s: Interior): void {
  const p = s.player;
  const key = ['in', p.hp, s.loot, p.ammo, p.reload > 0, Math.floor(s.safe.progress * 10), s.safe.taken].join('/');
  if (key === hudKey) return;
  hudKey = key;
  const total = world.loot + s.loot;
  hudHp.innerHTML = hearts(p.hp, s.stats.maxHp);
  hudLoot.textContent = '$' + total;
  hudQuota.textContent = ' / ' + world.quota;
  hudFill.style.width = Math.min(100, (total / world.quota) * 100) + '%';
  hud.classList.toggle('is-ready', total >= world.quota);
  hudLevel.textContent = s.safe.taken ? '금고 털림' : s.safe.progress > 0 ? '금고 ' + Math.round((s.safe.progress / s.safe.time) * 100) + '%' : '금고 안쪽';
  hudXp.style.width = Math.min(100, (s.safe.progress / s.safe.time) * 100) + '%';
  hudBomb.textContent = p.reload > 0 ? '재장전' : '탄 ' + p.ammo + '/' + s.stats.maxAmmo;
  hudBomb.classList.toggle('is-ready', p.reload === 0);
  fireButton.textContent = p.reload > 0 ? '장전' : '사격 ' + p.ammo;
}

function say(text: string, seconds = 2.6): void {
  banner.textContent = text;
  // 1인칭 장면에서는 안내 문구를 3D 화면 위의 캔버스에 직접 쓴다.
  banner.hidden = screen === 'inside';
  bannerUntil = performance.now() + seconds * 1000;
}

function beginJob(): void {
  world = startJob(run);
  seen = { alarmed: false, level: 0, quota: false, sheriff: false };
  deadDelay = 0;
  hudKey = '';
  snapCamera(view, world);
  setScreen('play');
  const job = JOBS[run.job]!;
  say('작전 ' + (run.job + 1) + '/' + JOBS.length + ' · ' + job.name + ' · $' + job.quota + ' 이상 챙겨 말에게 돌아가라', 4);
}

function setScreen(next: Screen): void {
  screen = next;
  controls.reset();
  const playing = next === 'play';
  const inside = next === 'inside';
  const touch = controls.usesTouch();
  hud.hidden = !(playing || inside || next === 'perk');
  panel.hidden = playing || inside;
  dashButton.hidden = !(playing && touch);
  bombButton.hidden = !(playing && touch);
  // 1인칭 장면에서는 3D 화면, 조준점, 사격 버튼이 나온다.
  canvas3d.hidden = !inside;
  crosshair.hidden = !inside;
  fireButton.hidden = !(inside && touch);
  stage.classList.toggle('is-inside', inside);
  controls.setLookMode(inside);
  fireHeld = false;
  if (!playing && !inside) {
    banner.hidden = true;
    renderPanel();
  }
}

// ---------- 안내판(시작, 능력 선택, 상점, 결과) ----------

function renderPanel(): void {
  panel.innerHTML =
    screen === 'title' ? titlePanel()
    : screen === 'perk' ? perkPanel()
    : screen === 'shop' ? shopPanel()
    : screen === 'dead' ? deadPanel()
    : wonPanel();
  panel.classList.toggle('is-light', screen === 'perk');
}

function titlePanel(): string {
  // 세로로 선 폰에서는 화면 방향을 고르게 한다. 가로가 조작부에 덜 가려진다.
  const choose = controls.usesTouch() && (isPortraitViewport() || rotated);
  const buttons = choose
    ? `<button type="button" class="btn btn-go" data-action="start-landscape">가로 화면으로 시작</button>
       <p class="poster-note">폰을 옆으로 돌려 잡는다. 화면이 넓어지고 조작부가 양쪽 구석으로 빠진다.</p>
       <button type="button" class="btn" data-action="start-portrait">세로 화면으로 시작</button>`
    : `<button type="button" class="btn btn-go" data-action="start">작전 시작</button>`;
  return `
    <div class="poster">
      <p class="poster-eyebrow">WANTED</p>
      <h1>먼지골 한탕</h1>
      <p class="poster-lead">마을 곳곳의 돈을 털어 상납금을 채우고, 말에게 돌아가 달아나라. 오래 머물수록 수배 등급이 올라 추격대가 늘어난다.</p>
      <dl class="howto">
        <div><dt>폰</dt><dd>왼쪽 스틱으로 이동한다. 쏘고 싶은 곳을 화면에서 누르거나, 오른쪽 스틱을 밀면 그 방향으로 쏜다.</dd></div>
        <div><dt>PC</dt><dd>WASD 이동, 마우스 조준과 사격, 스페이스 구르기, 오른쪽 클릭이나 E로 다이너마이트, R 재장전.</dd></div>
        <div><dt>요령</dt><dd>적은 가는 방향을 앞질러 쏜다. 붉은 선이 굵어지는 순간 방향을 틀거나 굴러라. 다이너마이트는 금고도 터뜨린다.</dd></div>
        <div><dt>은행</dt><dd>은행 문 앞에 서면 안으로 들어간다. 안에서는 1인칭이다. 화면을 끌거나 마우스를 움직여 위아래까지 겨누고, 금고 앞에서 금고를 바라보면 턴다.</dd></div>
      </dl>
      ${buttons}
    </div>`;
}

function hearts(hp: number, max: number): string {
  return Array.from({ length: max }, (_, i) => `<i class="heart${i < hp ? ' is-on' : ''}"></i>`).join('');
}

function offerButton(id: string, action: string, index: number, price: string, disabled: boolean): string {
  const def = perkDef(id);
  const count = run.owned[id] ?? 0;
  const rank = def.max > 1 && def.max < 99 ? ` <span class="offer-rank">${count}/${def.max}</span>` : '';
  return `
    <button type="button" class="offer" data-action="${action}" data-index="${index}" ${disabled ? 'disabled' : ''}>
      <span class="offer-name">${def.name}${rank}</span>
      <span class="offer-text">${def.text}</span>
      <span class="offer-price">${price}</span>
    </button>`;
}

function perkPanel(): string {
  const offers = choices.map((id, index) => offerButton(id, 'perk', index, '선택', false)).join('');
  return `
    <div class="poster">
      <p class="poster-eyebrow">악명 ${world.level}단계</p>
      <h1>이름이 퍼진다</h1>
      <p class="poster-lead">하나를 골라라. 고르는 동안 시간은 멈춘다.</p>
      <div class="offers">${offers}</div>
    </div>`;
}

function shopPanel(): string {
  const next = JOBS[run.job + 1]!;
  const offers = run.offers.map((offer, index) => {
    const price = offer.sold ? '구입함' : run.freePicks > 0 ? '무료' : '$' + perkDef(offer.id).price;
    return offerButton(offer.id, 'buy', index, price, !canBuy(run, index));
  }).join('');
  const note = run.freePicks > 0
    ? '장물아비가 하나는 그냥 준다. 그다음부터는 값을 치른다.'
    : '남은 돈으로 더 살 수 있다. 쓰지 않은 돈은 다음 상점으로 넘어간다.';
  return `
    <div class="poster">
      <p class="poster-eyebrow">탈출 성공 · 내 몫 $${run.lastKept}</p>
      <h1>장물아비의 천막</h1>
      <div class="purse">
        <span class="purse-money">$${run.money}</span>
        <span class="hud-hp" aria-label="체력 ${run.hp} / ${run.stats.maxHp}">${hearts(run.hp, run.stats.maxHp)}</span>
      </div>
      <p class="poster-lead">${note}</p>
      <div class="offers">${offers}</div>
      <p class="next-job"><b>다음 작전</b> ${next.name} · 상납금 $${next.quota}</p>
      <button type="button" class="btn btn-go" data-action="next">출발</button>
    </div>`;
}

function deadPanel(): string {
  return `
    <div class="poster">
      <p class="poster-eyebrow">작전 ${run.job + 1}/${JOBS.length} 실패</p>
      <h1>쓰러졌다</h1>
      <p class="poster-lead">${JOBS[run.job]!.name}에서 쓰러졌다. 쥐고 있던 돈 $${world.loot}, 쓰러뜨린 추격대 ${world.kills}명, 수배 ${heatLevel(world)}등급, 악명 ${world.level}단계.</p>
      <button type="button" class="btn btn-go" data-action="restart">처음부터 다시</button>
    </div>`;
}

function wonPanel(): string {
  return `
    <div class="poster">
      <p class="poster-eyebrow">작전 완료</p>
      <h1>빚 청산</h1>
      <p class="poster-lead">${JOBS.length}번의 상납을 모두 끝냈다. 손에 남은 돈은 $${run.money}, 악명 ${run.level}단계.</p>
      <button type="button" class="btn btn-go" data-action="restart">새 판 시작</button>
    </div>`;
}

panel.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!target || target.disabled) return;
  const index = Number(target.dataset.index);
  unlock();
  switch (target.dataset.action) {
    case 'start-landscape':
      setLandscape(true);
      beginJob();
      break;
    case 'start-portrait':
      setLandscape(false);
      beginJob();
      break;
    case 'start':
      beginJob();
      break;
    case 'restart':
      run = newRun(randomSeed());
      beginJob();
      break;
    case 'perk':
      choosePerk(run, world, choices[index]!);
      hudKey = '';
      setScreen('play');
      break;
    case 'buy':
      buy(run, index);
      renderPanel();
      break;
    case 'next':
      nextJob(run);
      beginJob();
      break;
  }
});

muteButton.addEventListener('click', () => {
  setMuted(!isMuted());
  muteButton.textContent = isMuted() ? '소리 켜기' : '소리 끄기';
  muteButton.setAttribute('aria-pressed', String(isMuted()));
});
rotateButton.addEventListener('click', () => setLandscape(!wantLandscape));

// 사격 버튼: 누르고 있는 동안 쏘고, 누른 채 끌면 시점도 돈다.
function fireTouch(e: TouchEvent): void {
  e.preventDefault();
  const t = e.targetTouches[0];
  fireHeld = !!t;
  if (!t) {
    fireDrag.last = null;
    return;
  }
  const at = toLocal(t.clientX, t.clientY);
  if (fireDrag.last) {
    fireDrag.x += at.x - fireDrag.last.x;
    fireDrag.y += at.y - fireDrag.last.y;
  }
  fireDrag.last = at;
}
for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
  fireButton.addEventListener(type, fireTouch, { passive: false });
}
// PC에서는 화면을 누르면 마우스를 붙잡아 시점을 자유롭게 돌린다. 붙잡지 못하는 환경에서는 그냥 움직여 돌린다.
canvas.addEventListener('click', () => {
  if (screen !== 'inside' || controls.usesTouch() || document.pointerLockElement) return;
  try {
    const locking = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    locking?.catch?.(() => undefined);
  } catch {
    // 마우스를 붙잡지 못해도 게임은 계속된다.
  }
});

// ---------- 플레이 중 화면 위 정보 ----------

const hudHp = $('hud-hp');
const hudHeat = $('hud-heat');
const hudLoot = $('hud-loot');
const hudQuota = $('hud-quota');
const hudFill = $('hud-bar-fill');
const hudLevel = $('hud-level');
const hudXp = $('hud-xp-fill');
const hudBomb = $('hud-bomb');
let hudKey = '';

function updateHud(): void {
  const p = world.player;
  const level = heatLevel(world);
  const bombLeft = Math.ceil(p.bombCd);
  const key = [p.hp, world.stats.maxHp, level, world.loot, world.quota, world.level, world.xp, bombLeft].join('/');
  if (key === hudKey) return;
  hudKey = key;
  hudHp.innerHTML = hearts(p.hp, world.stats.maxHp);
  hudHp.setAttribute('aria-label', '체력 ' + p.hp + ' / ' + world.stats.maxHp);
  hudHeat.innerHTML = Array.from({ length: MAX_HEAT }, (_, i) => `<i class="star${i < level ? ' is-on' : ''}">★</i>`).join('');
  hudHeat.setAttribute('aria-label', '수배 ' + level + '등급');
  hudLoot.textContent = '$' + world.loot;
  hudQuota.textContent = ' / ' + world.quota;
  hudFill.style.width = Math.min(100, (world.loot / world.quota) * 100) + '%';
  hud.classList.toggle('is-ready', quotaMet(world));
  hudLevel.textContent = '악명 ' + world.level;
  hudXp.style.width = Math.min(100, (world.xp / xpForLevel(world.level)) * 100) + '%';
  hudBomb.textContent = bombLeft > 0 ? '다이너마이트 ' + bombLeft + '초' : '다이너마이트 준비';
  hudBomb.classList.toggle('is-ready', bombLeft === 0);
  bombButton.textContent = bombLeft > 0 ? String(bombLeft) : '폭탄';
  bombButton.classList.toggle('is-waiting', bombLeft > 0);
}

function announce(): void {
  const level = heatLevel(world);
  const quota = quotaMet(world);
  if (world.sheriffSpawned && !seen.sheriff) say('보안관이 직접 나섰다.', 3);
  else if (quota && !seen.quota) say('상납금을 채웠다. 말에게 돌아가거나, 더 털어라.', 3.5);
  else if (world.alarmed && !seen.alarmed) say('경보가 울렸다. 추격대가 온다.');
  else if (level > seen.level && seen.alarmed) say('수배 ' + level + '등급. 추격대가 늘어난다.');
  seen = { alarmed: world.alarmed, level, quota, sheriff: world.sheriffSpawned };
}

// ---------- 메인 루프 ----------

function frame(now: number): void {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;

  if (screen === 'inside' && interior) {
    stepInside(dt, now);
    requestAnimationFrame(frame);
    return;
  }

  if (screen === 'play') {
    const input = controls.read(world.player, (sx, sy) => screenToWorld(view, sx, sy), world.enemies);
    step(world, input, dt);
    updateCamera(view, world, dt);
    updateHud();
    announce();
    if (!banner.hidden && now > bannerUntil) banner.hidden = true;

    if (world.phase === 'escaped') {
      setScreen(finishJob(run, world) ? 'won' : 'shop');
    } else if (world.phase === 'dead') {
      deadDelay += dt;
      if (deadDelay > 1.1) setScreen('dead');
    } else if (world.phase === 'inside') {
      enterBank();
    } else if (world.pendingPerks > 0) {
      choices = perkChoices(run, world);
      if (choices.length === 0) world.pendingPerks = 0;
      else setScreen('perk');
    }
  } else if (screen !== 'perk') {
    // 안내판 뒤에서는 연기와 흔들림만 가라앉힌다.
    step(world, NO_INPUT, dt);
  }

  playEvents(world.events);
  world.events.length = 0;
  draw(ctx, view, world, screen === 'play' ? controls.sticks() : [], now / 1000);
  requestAnimationFrame(frame);
}

// 자동 점검 스크립트가 진행 상태를 들여다보고 바꿀 수 있게 열어 둔 창구.
(window as unknown as { __game: () => { world: World; run: Run; rotated: boolean; interior: Interior | null } }).__game =
  () => ({ world, run, rotated, interior });

window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
layout();
snapCamera(view, world);
setScreen('title');
requestAnimationFrame(frame);
