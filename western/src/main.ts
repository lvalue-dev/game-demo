import { JOBS } from './game/map.ts';
import { buy, canBuy, finishJob, newRun, nextJob, startJob, upgradeDef } from './game/run.ts';
import type { Run } from './game/run.ts';
import { MAX_HEAT, NO_INPUT, heatLevel, quotaMet, step } from './game/sim.ts';
import type { World } from './game/types.ts';
import { attachControls } from './input.ts';
import { draw, makeView, screenToWorld, snapCamera, updateCamera } from './render.ts';
import type { View } from './render.ts';

type Screen = 'title' | 'play' | 'shop' | 'dead' | 'won';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const ctx = canvas.getContext('2d')!;
const hud = $('hud');
const panel = $('panel');
const banner = $('banner');
const dashButton = $('dash');
const controls = attachControls(canvas, dashButton);

let run: Run = newRun(randomSeed());
let world: World = startJob(run);
let screen: Screen = 'title';
let view: View = makeView(1, 1, 1);
let last = performance.now();
let bannerUntil = 0;
/** 쓰러진 뒤 결과 화면을 띄우기까지의 여유 시간. */
let deadDelay = 0;
/** 직전 프레임의 상태. 바뀌는 순간에 안내 문구를 띄우는 데 쓴다. */
let seen = { alarmed: false, level: 0, quota: false };

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const prev = view;
  view = makeView(w, h, dpr);
  view.camX = prev.camX;
  view.camY = prev.camY;
}

function say(text: string, seconds = 2.6): void {
  banner.textContent = text;
  banner.hidden = false;
  bannerUntil = performance.now() + seconds * 1000;
}

function beginJob(): void {
  world = startJob(run);
  seen = { alarmed: false, level: 0, quota: false };
  deadDelay = 0;
  snapCamera(view, world);
  setScreen('play');
  const job = JOBS[run.job]!;
  say(`작전 ${run.job + 1}/${JOBS.length} · ${job.name} · $${job.quota} 이상 챙겨 말에게 돌아가라`, 4);
}

function setScreen(next: Screen): void {
  screen = next;
  hud.hidden = next !== 'play';
  panel.hidden = next === 'play';
  dashButton.hidden = !(next === 'play' && (controls.usesTouch() || matchMedia('(pointer: coarse)').matches));
  if (next !== 'play') {
    banner.hidden = true;
    renderPanel();
  }
}

// ---------- 안내판(시작, 상점, 결과) ----------

function renderPanel(): void {
  panel.innerHTML =
    screen === 'title' ? titlePanel()
    : screen === 'shop' ? shopPanel()
    : screen === 'dead' ? deadPanel()
    : wonPanel();
}

function titlePanel(): string {
  return `
    <div class="poster">
      <p class="poster-eyebrow">WANTED</p>
      <h1>먼지골 한탕</h1>
      <p class="poster-lead">마을 곳곳의 돈을 털어 상납금을 채우고, 말에게 돌아가 달아나라. 오래 머물수록 수배 등급이 올라 추격대가 늘어난다.</p>
      <dl class="howto">
        <div><dt>폰</dt><dd>화면 왼쪽을 끌어 이동, 오른쪽을 끌어 조준하면 바로 쏜다. 구르기 버튼으로 총알을 피한다.</dd></div>
        <div><dt>PC</dt><dd>WASD로 이동, 마우스로 조준하고 눌러서 쏜다. 스페이스로 구르고 R로 재장전한다.</dd></div>
        <div><dt>털기</dt><dd>돈자루나 금고 곁에 서 있으면 저절로 턴다. 금고는 오래 걸리지만 크다.</dd></div>
      </dl>
      <button type="button" class="btn btn-go" data-action="start">작전 시작</button>
    </div>`;
}

function hearts(hp: number, max: number): string {
  return Array.from({ length: max }, (_, i) => `<i class="heart${i < hp ? ' is-on' : ''}"></i>`).join('');
}

function shopPanel(): string {
  const next = JOBS[run.job + 1]!;
  const offers = run.offers.map((offer, index) => {
    const def = upgradeDef(offer.id);
    const price = offer.sold ? '구입함' : run.freePicks > 0 ? '무료' : `$${def.price}`;
    return `
      <button type="button" class="offer" data-action="buy" data-index="${index}" ${canBuy(run, index) ? '' : 'disabled'}>
        <span class="offer-name">${def.name}</span>
        <span class="offer-text">${def.text}</span>
        <span class="offer-price">${price}</span>
      </button>`;
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
      <p class="poster-lead">${JOBS[run.job]!.name}에서 쓰러졌다. 쥐고 있던 돈 $${world.loot}, 쓰러뜨린 추격대 ${world.kills}명, 수배 ${heatLevel(world)}등급.</p>
      <button type="button" class="btn btn-go" data-action="restart">처음부터 다시</button>
    </div>`;
}

function wonPanel(): string {
  return `
    <div class="poster">
      <p class="poster-eyebrow">작전 완료</p>
      <h1>빚 청산</h1>
      <p class="poster-lead">${JOBS.length}번의 상납을 모두 끝냈다. 손에 남은 돈은 $${run.money}.</p>
      <button type="button" class="btn btn-go" data-action="restart">새 판 시작</button>
    </div>`;
}

panel.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!target || target.disabled) return;
  switch (target.dataset.action) {
    case 'start':
      beginJob();
      break;
    case 'restart':
      run = newRun(randomSeed());
      beginJob();
      break;
    case 'buy':
      buy(run, Number(target.dataset.index));
      renderPanel();
      break;
    case 'next':
      nextJob(run);
      beginJob();
      break;
  }
});

// ---------- 플레이 중 화면 위 정보 ----------

const hudHp = $('hud-hp');
const hudHeat = $('hud-heat');
const hudLoot = $('hud-loot');
const hudQuota = $('hud-quota');
const hudFill = $('hud-bar-fill');
const hudNote = $('hud-note');
let hudKey = '';

function updateHud(): void {
  const p = world.player;
  const level = heatLevel(world);
  const key = `${p.hp}/${world.stats.maxHp}/${level}/${world.loot}/${world.quota}`;
  if (key === hudKey) return;
  hudKey = key;
  hudHp.innerHTML = hearts(p.hp, world.stats.maxHp);
  hudHp.setAttribute('aria-label', `체력 ${p.hp} / ${world.stats.maxHp}`);
  hudHeat.innerHTML = Array.from({ length: MAX_HEAT }, (_, i) => `<i class="star${i < level ? ' is-on' : ''}">★</i>`).join('');
  hudLoot.textContent = `$${world.loot}`;
  hudQuota.textContent = ` / ${world.quota}`;
  hudFill.style.width = `${Math.min(100, (world.loot / world.quota) * 100)}%`;
  const done = quotaMet(world);
  hud.classList.toggle('is-ready', done);
  hudNote.textContent = done
    ? `말에게 돌아가면 탈출 · 내 몫 $${world.loot - world.quota}`
    : `상납금까지 $${world.quota - world.loot}`;
}

function announce(): void {
  const level = heatLevel(world);
  const quota = quotaMet(world);
  if (quota && !seen.quota) say('상납금을 채웠다. 말에게 돌아가거나, 더 털어라.', 3.5);
  else if (world.alarmed && !seen.alarmed) say('경보가 울렸다. 보안관이 온다.');
  else if (level > seen.level && seen.alarmed) say(`수배 ${level}등급. 추격대가 늘어난다.`);
  seen = { alarmed: world.alarmed, level, quota };
}

// ---------- 메인 루프 ----------

function frame(now: number): void {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;

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
      if (deadDelay > 1) setScreen('dead');
    }
  } else {
    // 안내판 뒤에서는 연기와 흔들림만 가라앉힌다.
    step(world, NO_INPUT, dt);
  }

  draw(ctx, view, world, screen === 'play' ? controls.sticks() : [], now / 1000);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
snapCamera(view, world);
setScreen('title');
requestAnimationFrame(frame);
