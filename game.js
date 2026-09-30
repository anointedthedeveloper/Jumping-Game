'use strict';
/* ============================================================
   Sky Hopper — endless jumper
   Canvas 2D · fixed-timestep loop · procedural sprites · Web Audio
   ============================================================ */
(() => {

// ============================== Config ==============================
const VH = 800;                          // virtual height (game units)
const VW_MIN = 400, VW_MAX = 640;        // virtual width adapts to aspect
const GRAV = 2600;
const JUMP_V = 1010;
const MOVE_V = 450;
const MAX_FALL = 1500;
const COYOTE = 0.10;                     // grace period to jump after leaving a ledge
const BUFFER = 0.12;                     // jump input buffer
const START_LIVES = 3;
const STEP = 1 / 120;                    // fixed physics timestep
const PLAT_WS = [64, 80, 96, 112, 128];  // quantized platform widths (sprite per size)
const MAX_PARTICLES = 150;

// ============================== Utils ==============================
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;

function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0];
}
function mixStops(stops, t) {
  const n = stops.length - 1;
  const x = clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  return mixColor(stops[i], stops[i + 1], x - i);
}
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

// In-place compaction (avoids per-frame array allocation)
function sweep(arr, keep) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[n++] = arr[i];
  arr.length = n;
}

// ============================== Canvas / view ==============================
const canvas = $('game');
const ctx = canvas.getContext('2d');
const stage = $('stage');
let VW = 480, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const ww = window.innerWidth, wh = window.innerHeight;
  VW = clamp(Math.round(VH * ww / wh), VW_MIN, VW_MAX);
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  const scale = Math.min(ww / VW, wh / VH);
  const cw = Math.round(VW * scale), ch = Math.round(VH * scale);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  stage.style.width = cw + 'px';
  stage.style.height = ch + 'px';
}
window.addEventListener('resize', resize);

// ============================== Audio (synthesized, no files) ==============================
const Sound = {
  ctx: null, master: null,
  muted: localStorage.getItem('sh_muted') === '1',
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  setMuted(m) {
    this.muted = m;
    localStorage.setItem('sh_muted', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },
  tone(freq, dur, type, vol, slide, delay) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  jump()  { this.tone(280, 0.16, 'square', 0.16, 340); },
  coin()  { this.tone(950, 0.07, 'sine', 0.24); this.tone(1420, 0.13, 'sine', 0.2, 0, 0.06); },
  land()  { this.tone(170, 0.09, 'triangle', 0.2, -70); },
  boing() { this.tone(170, 0.24, 'sine', 0.3, 520); },
  hit()   { this.tone(220, 0.26, 'sawtooth', 0.28, -160); },
  fall()  { this.tone(520, 0.4, 'sine', 0.2, -400); },
  over()  { this.tone(420, 0.5, 'sawtooth', 0.22, -320); this.tone(290, 0.75, 'triangle', 0.18, -190, 0.16); },
  click() { this.tone(650, 0.05, 'sine', 0.16); }
};

// ============================== Persistent data ==============================
let best = +(localStorage.getItem('sh_best') || 0);
let totalCoins = +(localStorage.getItem('sh_coins') || 0);
const SHOP_THEMES = [
  { id: 'sky', name: 'Sky Garden', price: 0, top: [110, 190, 255], bottom: [205, 240, 255], swatch: '#8cc9ff' },
  { id: 'sunset', name: 'Peach Horizon', price: 15, top: [255, 148, 110], bottom: [255, 220, 166], swatch: '#ff9876' },
  { id: 'aurora', name: 'Aurora Night', price: 30, top: [35, 73, 112], bottom: [100, 156, 177], swatch: '#5ca6c4' },
  { id: 'mint', name: 'Mint Summit', price: 45, top: [64, 156, 139], bottom: [190, 235, 194], swatch: '#65bba3' }
];
const SHOP_SKINS = [
  { id: 'sunny', name: 'Sunny', price: 0, body: '#ff5f6d', light: '#ffb26b', leaf: '#57c866', swatch: '#ff786e' },
  { id: 'berry', name: 'Berry Pop', price: 12, body: '#d94f8d', light: '#ff9fc7', leaf: '#79cf8b', swatch: '#e15e9b' },
  { id: 'sprout', name: 'Little Sprout', price: 24, body: '#57a96b', light: '#b8e986', leaf: '#e0f27a', swatch: '#73bd79' },
  { id: 'tide', name: 'Tide Hopper', price: 36, body: '#4388cb', light: '#91dded', leaf: '#5bd1bc', swatch: '#5da9d7' }
];
const readOwned = (key, starter) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || JSON.stringify([starter]))); }
  catch { return new Set([starter]); }
};
const ownedThemes = readOwned('sh_owned_themes', 'sky');
const ownedSkins = readOwned('sh_owned_skins', 'sunny');
let activeTheme = localStorage.getItem('sh_theme') || 'sky';
let activeSkin = localStorage.getItem('sh_skin') || 'sunny';
let shopTab = 'themes';
let shopReturn = 'menu';
let currentLevel = 1;
let lastLevel = 1;
const Settings = {
  particles: localStorage.getItem('sh_parts') !== '0',
  shake: localStorage.getItem('sh_shake') !== '0',
  save() {
    localStorage.setItem('sh_parts', this.particles ? '1' : '0');
    localStorage.setItem('sh_shake', this.shake ? '1' : '0');
  }
};

// ============================== Sprite pre-rendering ==============================
// Everything is drawn once onto tiny offscreen canvases — zero per-frame path
// work for static art, zero network requests, zero memory churn.
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function star(g, cx, cy, r, points) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = i * Math.PI / points - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

const Spr = { plat: {}, coin: [], cloud: [] };
let stars = [], clouds = [];

function buildPlatform(type, w) {
  const h = 34;
  const c = makeCanvas(w + 4, h);
  const g = c.getContext('2d');
  const x = 2, ww = w;

  const grad = g.createLinearGradient(0, 4, 0, h);
  if (type === 'moving')      { grad.addColorStop(0, '#5aa2ff'); grad.addColorStop(1, '#2f6bd8'); }
  else if (type === 'bouncy') { grad.addColorStop(0, '#c98a5a'); grad.addColorStop(1, '#9a5f36'); }
  else if (type === 'crumble'){ grad.addColorStop(0, '#b08968'); grad.addColorStop(1, '#8a6647'); }
  else                        { grad.addColorStop(0, '#a06b3f'); grad.addColorStop(1, '#7c4f2a'); }
  rr(g, x, 6, ww, h - 6, 10);
  g.fillStyle = grad; g.fill();

  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.arc(x + 6 + Math.random() * (ww - 12), 16 + Math.random() * 12, 1.6, 0, TAU);
    g.fill();
  }

  if (type === 'moving') {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#8fc3ff'; g.fill();
    rr(g, x + 2, 0, ww - 4, 5, 3); g.fillStyle = '#d6e9ff'; g.fill();
    g.fillStyle = '#e8f4ff';
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.arc(x + ww / 2 + (i - 1) * 18, 18, 2.2, 0, TAU); g.fill();
    }
  } else if (type === 'bouncy') {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#ff9f1c'; g.fill();
    rr(g, x + 2, 0, ww - 4, 5, 3); g.fillStyle = '#ffc46b'; g.fill();
    g.strokeStyle = '#7a4a20'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x + 6, 21); g.lineTo(x + ww - 6, 21); g.stroke();
  } else if (type === 'crumble') {
    rr(g, x, 3, ww, 12, 6); g.fillStyle = '#9c7a54'; g.fill();
    g.strokeStyle = '#6b4f33'; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x + ww * 0.28, 4); g.lineTo(x + ww * 0.36, 11); g.lineTo(x + ww * 0.3, 17);
    g.moveTo(x + ww * 0.62, 3); g.lineTo(x + ww * 0.58, 13);
    g.stroke();
  } else {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#6bcb77'; g.fill();
    rr(g, x + 2, 0, ww - 4, 5, 3); g.fillStyle = '#93e6a4'; g.fill();
  }
  return c;
}

function buildSpike() {
  const c = makeCanvas(20, 16);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 16);
  grad.addColorStop(0, '#f2f2fa'); grad.addColorStop(1, '#9a9ab0');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(1, 16); g.lineTo(10, 1); g.lineTo(19, 16);
  g.closePath(); g.fill();
  g.strokeStyle = '#6a6a80'; g.lineWidth = 1; g.stroke();
  return c;
}

function buildMine() {
  const c = makeCanvas(44, 44);
  const g = c.getContext('2d');
  const cx = 22, cy = 22;
  g.fillStyle = '#4a4a5e';
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - 0.2) * 12, cy + Math.sin(a - 0.2) * 12);
    g.lineTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
    g.lineTo(cx + Math.cos(a + 0.2) * 12, cy + Math.sin(a + 0.2) * 12);
    g.closePath(); g.fill();
  }
  const grad = g.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, 14);
  grad.addColorStop(0, '#6a6a85'); grad.addColorStop(1, '#33334a');
  g.beginPath(); g.arc(cx, cy, 13, 0, TAU); g.fillStyle = grad; g.fill();
  g.beginPath(); g.arc(cx, cy, 4, 0, TAU); g.fillStyle = '#ff4d4d'; g.fill();
  g.beginPath(); g.arc(cx - 1.5, cy - 1.5, 1.5, 0, TAU); g.fillStyle = '#ffb0b0'; g.fill();
  return c;
}

function buildCoins() {
  for (let f = 0; f < 6; f++) {
    const c = makeCanvas(36, 36);
    const g = c.getContext('2d');
    const sx = Math.abs(Math.cos(f / 6 * TAU));
    const w = 13 * (0.25 + 0.75 * sx);
    const grad = g.createLinearGradient(0, 4, 0, 32);
    grad.addColorStop(0, '#ffe066'); grad.addColorStop(1, '#f0a008');
    g.beginPath(); g.ellipse(18, 18, w, 13, 0, 0, TAU);
    g.fillStyle = grad; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#c77e00'; g.stroke();
    if (w > 6) {
      g.beginPath(); g.ellipse(18, 18, w * 0.55, 7, 0, 0, TAU);
      g.strokeStyle = '#c77e00'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#c77e00';
      star(g, 18, 18, 5, 5); g.fill();
    }
    Spr.coin.push(c);
  }
}

function buildClouds() {
  for (let v = 0; v < 3; v++) {
    const c = makeCanvas(140, 70);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.92)';
    const blobs = [[40, 46, 21], [65, 36, 25], [95, 46, 19], [66, 50, 22]];
    for (const b of blobs) { g.beginPath(); g.arc(b[0], b[1], b[2], 0, TAU); g.fill(); }
    g.fillRect(28, 48, 84, 8);
    Spr.cloud.push(c);
  }
}

function buildBody() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const skin = SHOP_SKINS.find(item => item.id === activeSkin) || SHOP_SKINS[0];
  const grad = g.createRadialGradient(24, 20, 4, 32, 34, 26);
  grad.addColorStop(0, skin.light); grad.addColorStop(1, skin.body);
  g.beginPath(); g.ellipse(32, 34, 21, 22, 0, 0, TAU); g.fillStyle = grad; g.fill();
  g.beginPath(); g.ellipse(32, 42, 12, 12, 0, 0, TAU); g.fillStyle = '#ffe3c2'; g.fill();
  // sprout
  g.strokeStyle = skin.leaf; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(32, 13); g.quadraticCurveTo(32, 8, 32, 5); g.stroke();
  g.fillStyle = skin.leaf;
  g.beginPath(); g.ellipse(27, 6, 6, 3.2, -0.5, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(37, 5, 6, 3.2, 0.5, 0, TAU); g.fill();
  // beak
  g.beginPath(); g.moveTo(28, 30); g.lineTo(36, 30); g.lineTo(32, 35); g.closePath();
  g.fillStyle = '#ff9f1c'; g.fill();
  // cheeks
  g.fillStyle = 'rgba(255,120,120,0.45)';
  g.beginPath(); g.arc(20, 34, 4, 0, TAU); g.fill();
  g.beginPath(); g.arc(44, 34, 4, 0, TAU); g.fill();
  Spr.body = c;
}

function buildSprites() {
  const types = ['normal', 'moving', 'bouncy', 'crumble'];
  for (const t of types) {
    Spr.plat[t] = {};
    for (const w of PLAT_WS) Spr.plat[t][w] = buildPlatform(t, w);
  }
  Spr.spike = buildSpike();
  Spr.mine = buildMine();
  buildCoins();
  buildClouds();
  buildBody();
  stars = [];
  for (let i = 0; i < 70; i++) stars.push({ x: Math.random(), y: Math.random(), r: rand(1, 2.4), ph: rand(0, TAU) });
  clouds = [];
  for (let i = 0; i < 11; i++) clouds.push({ x: rand(0, 1), y: rand(0, VH + 260), sp: rand(4, 14), v: (Math.random() * 3) | 0 });
}

// ============================== Game state ==============================
let state = 'menu';           // menu | playing | paused | gameover
let platforms = [], coins = [], mines = [], particles = [];
let player = null;
let camY = 0, nextY = 0, lastX = 0.5, startY = 0, maxY = 0;
let lives = START_LIVES, coinCount = 0, score = 0;
let genCount = 0;
let time = 0;
let shakeT = 0, shakeDur = 0.001, shakeMag = 0, flashA = 0;

const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ============================== World generation ==============================
function difficulty() {
  return clamp((startY - maxY) / 50 / 1200, 0, 1);   // 0 → 1 over 1200 m
}

function makePlatform(y, xFrac, type, w) {
  const pl = {
    xFrac, y, w, type,
    x: xFrac * VW,
    dx: type === 'moving' ? (Math.random() < 0.5 ? -1 : 1) * rand(45, 70 + difficulty() * 70) : 0,
    crumbleT: null, broken: false, vy: 0, anim: 0,
    spikes: false, spikeOff: 0
  };
  platforms.push(pl);
  return pl;
}

function genPlatform(y) {
  const d = difficulty();
  genCount++;
  const safe = genCount % 5 === 0;               // every 5th platform is a breather

  let type = 'normal';
  if (!safe) {
    const r = Math.random();
    const pCrumble = d > 0.2 ? lerp(0, 0.15, d) : 0;
    const pBounce = 0.07;
    const pMove = lerp(0.06, 0.34, d);
    if (r < pCrumble) type = 'crumble';
    else if (r < pCrumble + pBounce) type = 'bouncy';
    else if (r < pCrumble + pBounce + pMove) type = 'moving';
  }

  const w = safe ? 128 : clamp(Math.round(lerp(112, 70, d) / 16) * 16, 64, 112);

  // keep horizontal distance reachable from the previous platform
  const maxDx = clamp(320 / VW, 0.28, 0.5);
  const xf = clamp(lastX + rand(-maxDx, maxDx), (w / 2 + 10) / VW, 1 - (w / 2 + 10) / VW);
  lastX = xf;

  const pl = makePlatform(y, xf, type, w);

  if (!safe && (type === 'normal' || type === 'crumble') && Math.random() < lerp(0.05, 0.3, d)) {
    pl.spikes = true;
    pl.spikeOff = rand(-0.25, 0.25) * w;
  }

  if (Math.random() < 0.42) {
    const n = Math.random() < 0.3 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      coins.push({
        xFrac: clamp(xf + (n === 3 ? (i - 1) * 0.09 : 0), 0.05, 0.95),
        y: y - (n === 3 ? (i === 1 ? 62 : 50) : 54),
        taken: false, phase: Math.random()
      });
    }
  }

  if (!safe && Math.random() < lerp(0.04, 0.12, d)) {
    mines.push({
      xFrac: clamp(xf + rand(-0.2, 0.2), 0.06, 0.94),
      baseY: y - rand(85, 150),
      t: rand(0, TAU), x: 0, y: 0
    });
  }
}

function gap() {
  const d = difficulty();
  return lerp(95, 158, d) + rand(0, 24);
}

function ensurePlatforms() {
  while (nextY > camY - 220) {
    genPlatform(nextY);
    nextY -= gap();
  }
}

function cleanup() {
  const limit = camY + VH + 140;
  sweep(platforms, pl => pl.y < limit);
  sweep(coins, c => !c.taken && c.y < limit);
  sweep(mines, m => m.baseY < limit);
}

function resetWorld() {
  platforms = []; coins = []; mines = []; particles = [];
  genCount = 0;
  lives = START_LIVES; coinCount = 0; score = 0;
  currentLevel = 1; lastLevel = 1;
  startY = VH - 140;
  maxY = startY;
  camY = 0;
  lastX = 0.5;
  makePlatform(startY, 0.5, 'normal', 128);
  nextY = startY - 100;
  player = {
    x: VW / 2, y: startY - 22, w: 40, h: 44,
    vx: 0, vy: 0, prevY: 0,
    grounded: true, ground: platforms[0],
    coyote: 0, buffer: 0, landT: 0, inv: 0, knockT: 0,
    look: 0, blink: 0, nextBlink: 2
  };
  ensurePlatforms();
  HUD.reset();
}

// ============================== Particles (pooled) ==============================
function burst(x, y, n, colors, speed, grav) {
  if (!Settings.particles) return;
  for (let i = 0; i < n; i++) {
    if (particles.length >= MAX_PARTICLES) break;
    const a = rand(0, TAU), sp = rand(speed * 0.3, speed);
    const life = rand(0.35, 0.7);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      life, max: life,
      size: rand(2, 5), color: colors[(Math.random() * colors.length) | 0],
      grav: grav == null ? 700 : grav
    });
  }
}

function updateParticles(dt) {
  for (const pt of particles) {
    pt.life -= dt;
    pt.vy += pt.grav * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
  }
  sweep(particles, pt => pt.life > 0);
}

// ============================== Physics ==============================
function updatePlayer(dt) {
  const p = player;
  p.prevY = p.y;

  // horizontal movement (with brief knockback lockout after a hit)
  if (p.knockT > 0) {
    p.knockT -= dt;
  } else {
    const dir = (Input.right ? 1 : 0) - (Input.left ? 1 : 0);
    p.vx = dir * MOVE_V;
    if (dir !== 0) p.look = dir;
  }
  p.x += p.vx * dt;
  if (p.x < -p.w / 2) p.x = VW + p.w / 2;          // wrap around screen edges
  else if (p.x > VW + p.w / 2) p.x = -p.w / 2;

  // timers
  if (p.grounded) p.coyote = COYOTE;
  else if (p.coyote > 0) p.coyote -= dt;
  if (p.buffer > 0) p.buffer -= dt;
  if (p.landT > 0) p.landT -= dt;
  if (p.inv > 0) p.inv -= dt;
  p.nextBlink -= dt;
  if (p.nextBlink <= 0) { p.blink = 0.12; p.nextBlink = rand(1.8, 4); }
  if (p.blink > 0) p.blink -= dt;

  // jump (buffered + coyote time for a responsive feel)
  if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
    p.vy = -JUMP_V;
    p.grounded = false; p.ground = null;
    p.coyote = 0; p.buffer = 0;
    Sound.jump();
    burst(p.x, p.y + p.h / 2, 6, ['#ffffff', '#dfe8ff'], 130, 300);
  }

  if (p.grounded && p.ground) {
    const g = p.ground;
    if (g.broken) {
      p.grounded = false; p.ground = null;
    } else {
      p.y = g.y - p.h / 2;
      p.x += g.dx * dt;                            // moving platform carries the player
      p.vy = 0;
      if (Math.abs(p.x - g.x) > g.w / 2 + p.w / 2) { p.grounded = false; p.ground = null; }
    }
  }

  if (!p.grounded) {
    p.vy = Math.min(p.vy + GRAV * dt, MAX_FALL);
    p.y += p.vy * dt;
    if (p.vy > 0) checkLanding();
  }
}

function checkLanding() {
  const p = player;
  const prevBottom = p.prevY + p.h / 2;
  const bottom = p.y + p.h / 2;
  for (const pl of platforms) {
    if (pl.broken) continue;
    if (prevBottom <= pl.y + 8 && bottom >= pl.y &&
        Math.abs(p.x - pl.x) < (p.w / 2 + pl.w / 2) * 0.78) {
      landOn(pl, p.vy);
      break;
    }
  }
}

function landOn(pl, impact) {
  const p = player;
  if (pl.type === 'bouncy') {
    p.vy = -1480;
    p.grounded = false;
    pl.anim = 0.25;
    Sound.boing();
    burst(p.x, pl.y, 10, ['#ffd93d', '#ff9f1c'], 220, 500);
    return;
  }
  p.grounded = true;
  p.ground = pl;
  p.y = pl.y - p.h / 2;
  p.vy = 0;
  p.landT = 0.12;
  if (pl.type === 'crumble' && pl.crumbleT === null) pl.crumbleT = 0.45;
  if (impact > 500) {
    Sound.land();
    burst(p.x, pl.y, 5, ['#e8dcc8', '#ffffff'], 110, 350);
  }
}

function updatePlatforms(dt) {
  for (const pl of platforms) {
    if (pl.type === 'moving' && !pl.broken) {
      pl.xFrac += pl.dx * dt / VW;
      const minF = (pl.w / 2 + 8) / VW, maxF = 1 - (pl.w / 2 + 8) / VW;
      if (pl.xFrac < minF) { pl.xFrac = minF; pl.dx = Math.abs(pl.dx); }
      else if (pl.xFrac > maxF) { pl.xFrac = maxF; pl.dx = -Math.abs(pl.dx); }
    }
    pl.x = pl.xFrac * VW;
    if (pl.anim > 0) pl.anim -= dt;
    if (pl.crumbleT !== null) {
      pl.crumbleT -= dt;
      if (pl.crumbleT <= 0) { pl.broken = true; pl.vy = 0; }
    }
    if (pl.broken) {
      pl.vy += GRAV * 0.6 * dt;
      pl.y += pl.vy * dt;
    }
  }
}

function updateMines(dt) {
  for (const m of mines) {
    m.t += dt;
    m.x = m.xFrac * VW;
    m.y = m.baseY + Math.sin(m.t * 2.2) * 12;
  }
}

function checkHazards() {
  const p = player;
  if (p.inv > 0) return;
  const hw = p.w / 2 - 6, hh = p.h / 2 - 4;         // forgiving hitbox
  for (const pl of platforms) {
    if (pl.spikes && !pl.broken) {
      const sx = pl.x + pl.spikeOff, sy = pl.y - 8;
      if (Math.abs(p.x - sx) < hw + 17 && Math.abs(p.y - sy) < hh + 8) {
        damage(p.x < pl.x ? -1 : 1);
        return;
      }
    }
  }
  for (const m of mines) {
    if (Math.abs(p.x - m.x) < hw + 13 && Math.abs(p.y - m.y) < hh + 13) {
      damage(m.x < p.x ? -1 : 1);
      return;
    }
  }
}

function collectCoins() {
  const p = player;
  for (const c of coins) {
    if (c.taken) continue;
    const cx = c.xFrac * VW;
    if (Math.abs(p.x - cx) < p.w / 2 + 14 && Math.abs(p.y - c.y) < p.h / 2 + 14) {
      c.taken = true;
      coinCount++;
      Sound.coin();
      HUD.coins();
      burst(cx, c.y, 8, ['#ffd93d', '#fff3b0'], 180, 400);
    }
  }
}

function update(dt) {
  updatePlayer(dt);
  updatePlatforms(dt);
  updateMines(dt);
  checkHazards();
  collectCoins();
  updateParticles(dt);
  ensurePlatforms();
  cleanup();

  // camera follows upward only, smoothly
  const target = player.y - VH * 0.45;
  if (target < camY) camY += (target - camY) * Math.min(1, dt * 9);

  // score = height + coin bonus
  if (player.y < maxY) maxY = player.y;
  const s = Math.max(0, Math.floor((startY - maxY) / 50)) + coinCount * 10;
  if (s !== score) { score = s; HUD.score(s); }

  // fell below the screen
  if (player.y - camY > VH + 80) onFall();
}

// ============================== Damage / lives ==============================
function damage(dir) {
  if (player.inv > 0 || state !== 'playing') return;
  lives--;
  HUD.lives();
  if (Settings.shake) shake(0.4, 15);
  flashA = 0.4;
  Sound.hit();
  burst(player.x, player.y, 12, ['#ff5f6d', '#ffb26b'], 260, 600);
  player.inv = 1.6;
  player.vy = -650;
  player.vx = dir * 260;
  player.knockT = 0.25;
  player.grounded = false;
  player.ground = null;
  if (lives <= 0) gameOver();
}

function onFall() {
  lives--;
  HUD.lives();
  Sound.fall();
  if (lives <= 0) { gameOver(); return; }
  respawn();
}

function respawn() {
  const p = player;
  let bestPl = null;
  for (const pl of platforms) {
    if (pl.broken) continue;
    if (pl.y > camY + 30 && pl.y < camY + VH - 60) {
      if (!bestPl || pl.y > bestPl.y) bestPl = pl;
    }
  }
  if (!bestPl) bestPl = makePlatform(camY + VH * 0.6, 0.5, 'normal', 112);
  p.x = bestPl.x;
  p.y = bestPl.y - p.h / 2 - 2;
  p.vx = 0; p.vy = 0;
  p.grounded = true;
  p.ground = bestPl;
  p.inv = 1.6;
  if (Settings.shake) shake(0.3, 10);
}

function shake(dur, mag) {
  shakeT = dur; shakeDur = dur; shakeMag = mag;
}

// ============================== Rendering ==============================
const REGION_SKIES = [
  { name: 'Cloud Garden', top: [110, 190, 255], bottom: [205, 240, 255] },
  { name: 'Sunset Ridge', top: [255, 156, 108], bottom: [255, 225, 175] },
  { name: 'Aurora Reach', top: [52, 91, 143], bottom: [138, 184, 199] },
  { name: 'Mint Heights', top: [91, 177, 151], bottom: [204, 239, 197] }
];

function drawBackground() {
  const theme = SHOP_THEMES.find(item => item.id === activeTheme) || SHOP_THEMES[0];
  const regionIndex = Math.floor((currentLevel - 1) / 3) % REGION_SKIES.length;
  const region = REGION_SKIES[regionIndex];
  const alt = clamp(-camY / 50000, 0, 1);
  const top = mixColor(theme.top, region.top, 0.28);
  const bottom = mixColor(theme.bottom, region.bottom, 0.28);
  const deepTop = mixColor(top, [38, 30, 80], 0.65);
  const deepBottom = mixColor(bottom, [120, 80, 150], 0.55);
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, rgb(mixColor(top, deepTop, alt)));
  g.addColorStop(1, rgb(mixColor(bottom, deepBottom, alt)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);

  if (alt > 0.2) {
    const a = (alt - 0.2) / 0.8;
    ctx.fillStyle = '#ffffff';
    for (const s of stars) {
      ctx.globalAlpha = a * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(time * 2 + s.ph)));
      ctx.fillRect(s.x * VW, s.y * VH, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  drawCloudLayer(0.22, 0.45, 0.7, 6);
  drawCloudLayer(0.45, 0.75, 1.0, 5);
}

function drawCloudLayer(factor, alpha, scale, count) {
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const c = clouds[i];
    let y = (c.y - camY * factor + time * c.sp) % (VH + 260);
    if (y < 0) y += VH + 260;
    y -= 130;
    const img = Spr.cloud[c.v];
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, c.x * VW - w / 2, y, w, h);
  }
  ctx.globalAlpha = 1;
}

function drawPlatforms() {
  for (const pl of platforms) {
    if (pl.y < camY - 60 || pl.y > camY + VH + 160) continue;
    const img = Spr.plat[pl.type][pl.w];
    ctx.save();
    ctx.translate(pl.x, pl.y);
    if (pl.crumbleT !== null) ctx.translate(rand(-1.6, 1.6), 0);
    if (pl.broken) ctx.rotate(pl.y * 0.001);
    if (pl.anim > 0) {
      const k = Math.sin((pl.anim / 0.25) * Math.PI);
      ctx.scale(1 + 0.15 * k, 1 - 0.3 * k);
    }
    ctx.drawImage(img, -pl.w / 2 - 2, 0);
    ctx.restore();

    if (pl.spikes && !pl.broken) {
      const n = Math.max(2, Math.round(pl.w / 22));
      const startX = pl.x + pl.spikeOff - (n * 20) / 2;
      for (let i = 0; i < n; i++) ctx.drawImage(Spr.spike, startX + i * 20, pl.y - 15);
    }
  }
}

function drawCoins() {
  for (const c of coins) {
    if (c.taken) continue;
    if (c.y < camY - 40 || c.y > camY + VH + 40) continue;
    const f = Math.floor((time * 9 + c.phase * 6) % 6);
    const bob = Math.sin(time * 3 + c.phase * 9) * 3;
    ctx.drawImage(Spr.coin[f], c.xFrac * VW - 18, c.y - 18 + bob);
  }
}

function drawMines() {
  for (const m of mines) {
    if (m.y < camY - 40 || m.y > camY + VH + 40) continue;
    const pulse = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(time * 5 + m.t));
    ctx.fillStyle = `rgba(255,60,60,${pulse * 0.5})`;
    ctx.beginPath(); ctx.arc(m.x, m.y, 20, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(Math.sin(m.t * 1.5) * 0.2);
    ctx.drawImage(Spr.mine, -22, -22);
    ctx.restore();
  }
}

function drawShadow() {
  const p = player;
  let bestPl = null, bestD = 220;
  for (const pl of platforms) {
    if (pl.broken) continue;
    if (Math.abs(p.x - pl.x) > pl.w / 2 + 10) continue;
    const d = pl.y - (p.y + p.h / 2);
    if (d >= -4 && d < bestD) { bestD = d; bestPl = pl; }
  }
  if (bestPl) {
    ctx.fillStyle = `rgba(20,20,40,${0.2 * (1 - bestD / 220)})`;
    ctx.beginPath();
    ctx.ellipse(p.x, bestPl.y + 5, Math.max(6, 16 * (1 - bestD / 400)), 5, 0, 0, TAU);
    ctx.fill();
  }
}

function drawPlayer() {
  const p = player;
  drawShadow();

  let sx = 1, sy = 1;
  if (!p.grounded) {
    const st = clamp(Math.abs(p.vy) / 1700, 0, 0.22);   // squash & stretch
    sx = 1 - st * 0.55; sy = 1 + st;
  }
  if (p.landT > 0) {
    const k = p.landT / 0.12;
    sx = 1 + 0.28 * k; sy = 1 - 0.22 * k;
  }
  if (p.inv > 0 && Math.floor(time * 16) % 2 === 0) ctx.globalAlpha = 0.35;

  const bob = (state === 'menu') ? Math.sin(time * 2.4) * 3 : 0;
  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.scale(sx, sy);

  // wings
  const flap = p.grounded ? 0.25 : Math.sin(time * 28) * 0.7 - clamp(p.vy / 900, -0.5, 0.5);
  ctx.fillStyle = '#e8505f';
  ctx.save(); ctx.translate(-19, 2); ctx.rotate(-0.5 - flap * 0.4);
  ctx.beginPath(); ctx.ellipse(-6, 0, 8, 5, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(19, 2); ctx.rotate(0.5 + flap * 0.4);
  ctx.beginPath(); ctx.ellipse(6, 0, 8, 5, 0, 0, TAU); ctx.fill(); ctx.restore();

  // body
  ctx.drawImage(Spr.body, -32, -32);

  // feet
  if (p.grounded) {
    ctx.fillStyle = '#d94f5f';
    ctx.beginPath(); ctx.ellipse(-8, 21, 5, 3, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, 21, 5, 3, 0, 0, TAU); ctx.fill();
  }

  // eyes (drawn dynamically so they can look around & blink)
  const look = p.look * 2.2;
  if (p.blink > 0) {
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-13, 26); ctx.lineTo(-5, 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 26); ctx.lineTo(13, 26); ctx.stroke();
  } else {
    for (const ex of [-9, 9]) {
      ctx.beginPath(); ctx.arc(ex, 26, 6.5, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + look, 27, 3.2, 0, TAU); ctx.fillStyle = '#2b2b3a'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + look + 1, 25.5, 1.1, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawParticles() {
  for (const pt of particles) {
    ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBackground();

  let shX = 0, shY = 0;
  if (shakeT > 0 && Settings.shake) {
    const k = shakeT / shakeDur;
    shX = rand(-1, 1) * shakeMag * k;
    shY = rand(-1, 1) * shakeMag * k;
  }

  ctx.save();
  ctx.translate(shX, -camY + shY);
  drawPlatforms();
  drawCoins();
  drawMines();
  drawPlayer();
  drawParticles();
  ctx.restore();

  if (flashA > 0) {
    ctx.fillStyle = `rgba(255,60,60,${flashA * 0.35})`;
    ctx.fillRect(0, 0, VW, VH);
  }
}

// ============================== HUD ==============================
const HUD = {
  scoreEl: $('hud-score'), bestEl: $('hud-best'), coinsEl: $('hud-coins'), livesEl: $('hud-lives'),
  levelEl: $('hud-level'), regionEl: $('hud-region'),
  lastScore: -1, lastCoins: -1,
  score(s) {
    if (s === this.lastScore) return;
    this.lastScore = s;
    this.scoreEl.textContent = s;
    if (s > best) {
      best = s;
      this.bestEl.textContent = best;
    }
    this.scoreEl.parentElement.animate(
      [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 160, easing: 'ease-out' });
    this.level(s);
  },
  level(s) {
    currentLevel = Math.floor(s / 250) + 1;
    const region = REGION_SKIES[Math.floor((currentLevel - 1) / 3) % REGION_SKIES.length];
    this.levelEl.textContent = `LEVEL ${currentLevel}`;
    this.regionEl.textContent = region.name;
    if (currentLevel > lastLevel && state === 'playing') {
      totalCoins += 4;
      localStorage.setItem('sh_coins', totalCoins);
    }
    lastLevel = currentLevel;
  },
  coins() {
    if (coinCount === this.lastCoins) return;
    this.lastCoins = coinCount;
    this.coinsEl.textContent = coinCount;
  },
  lives() {
    const hearts = this.livesEl.querySelectorAll('.heart');
    for (let i = 0; i < hearts.length; i++) hearts[i].classList.toggle('lost', i >= lives);
  },
  reset() {
    this.lastScore = -1; this.lastCoins = -1;
    this.score(0);
    this.level(0);
    this.coins();
    this.lives();
    this.bestEl.textContent = best;
  }
};

// ============================== Flow ==============================
const overlays = ['menu', 'shop', 'settings', 'pause', 'gameover'];
function show(id) {
  for (const o of overlays) $(o).classList.toggle('hidden', o !== id);
}

function startGame() {
  Sound.ensure(); Sound.click();
  resetWorld();
  state = 'playing';
  show(null);
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch-controls').classList.remove('hidden');
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  Sound.click();
  show('pause');
}

function resumeGame() {
  if (state !== 'paused') return;
  Sound.click();
  state = 'playing';
  show(null);
}

function gameOver() {
  state = 'gameover';
  Sound.over();
  if (Settings.shake) shake(0.5, 18);
  const isBest = score >= best && score > 0;
  if (score > best) {
    best = score;
    localStorage.setItem('sh_best', best);
  }
  totalCoins += coinCount;
  localStorage.setItem('sh_coins', totalCoins);
  $('go-score').textContent = score;
  $('go-best').textContent = best;
  $('go-coins').textContent = coinCount;
  $('go-level').textContent = currentLevel;
  $('new-best').classList.toggle('hidden', !isBest);
  show('gameover');
  $('hud').classList.add('hidden');
  $('touch-controls').classList.add('hidden');
}

function goHome() {
  Sound.click();
  state = 'menu';
  resetWorld();
  show('menu');
  $('hud').classList.add('hidden');
  $('touch-controls').classList.add('hidden');
  updateMenuStats();
}

function updateMenuStats() {
  $('menu-best').textContent = best;
  $('menu-coins').textContent = totalCoins;
}

function openShop(from) {
  shopReturn = from;
  renderShop();
  show('shop');
}

function saveOwned(key, items) {
  localStorage.setItem(key, JSON.stringify([...items]));
}

function renderShop() {
  const items = shopTab === 'themes' ? SHOP_THEMES : SHOP_SKINS;
  const owned = shopTab === 'themes' ? ownedThemes : ownedSkins;
  const active = shopTab === 'themes' ? activeTheme : activeSkin;
  $('shop-coins').textContent = totalCoins;
  $('shop-grid').replaceChildren(...items.map(item => {
    const card = document.createElement('article');
    card.className = `shop-item${active === item.id ? ' selected' : ''}`;
    const action = document.createElement('button');
    const unlocked = owned.has(item.id);
    action.className = unlocked ? 'shop-action' : 'shop-action purchase';
    action.dataset.item = item.id;
    action.dataset.kind = shopTab;
    action.textContent = active === item.id ? 'Equipped' : unlocked ? 'Equip' : `Unlock · ${item.price} coins`;
    action.disabled = active === item.id || (!unlocked && totalCoins < item.price);
    card.innerHTML = `<span class="shop-swatch" style="--swatch:${item.swatch}" aria-hidden="true"></span><span class="shop-item-copy"><b>${item.name}</b><small>${unlocked ? 'Owned' : `${item.price} coins`}</small></span>`;
    card.append(action);
    return card;
  }));
}

function useShopItem(id, kind) {
  const items = kind === 'themes' ? SHOP_THEMES : SHOP_SKINS;
  const owned = kind === 'themes' ? ownedThemes : ownedSkins;
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  if (!owned.has(id)) {
    if (totalCoins < item.price) return;
    totalCoins -= item.price;
    owned.add(id);
    saveOwned(kind === 'themes' ? 'sh_owned_themes' : 'sh_owned_skins', owned);
    localStorage.setItem('sh_coins', totalCoins);
  }
  if (kind === 'themes') {
    activeTheme = id;
    localStorage.setItem('sh_theme', id);
  } else {
    activeSkin = id;
    localStorage.setItem('sh_skin', id);
    buildBody();
  }
  updateMenuStats();
  renderShop();
}

// ============================== Input ==============================
const Input = { left: false, right: false };

function pressJump() {
  Sound.ensure();
  if (state === 'menu' || state === 'gameover') { startGame(); return; }
  if (state !== 'playing') return;
  player.buffer = BUFFER;
}

function releaseJump() {
  if (state !== 'playing') return;
  if (player.vy < -380) player.vy = -380;           // variable jump height
}

const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];

window.addEventListener('keydown', e => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  Sound.ensure();
  switch (e.code) {
    case 'Space': case 'ArrowUp': case 'KeyW':
      if (state === 'menu' || state === 'gameover') { if (!e.repeat) startGame(); }
      else pressJump();
      break;
    case 'ArrowLeft': case 'KeyA': Input.left = true; break;
    case 'ArrowRight': case 'KeyD': Input.right = true; break;
    case 'KeyP': case 'Escape':
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      break;
    case 'KeyM': toggleMute(); break;
    case 'Enter':
      if (state === 'menu' || state === 'gameover') startGame();
      else if (state === 'paused') resumeGame();
      break;
  }
});

window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'Space': case 'ArrowUp': case 'KeyW': releaseJump(); break;
    case 'ArrowLeft': case 'KeyA': Input.left = false; break;
    case 'ArrowRight': case 'KeyD': Input.right = false; break;
  }
});

canvas.addEventListener('pointerdown', e => { e.preventDefault(); pressJump(); });
window.addEventListener('pointerup', releaseJump);
window.addEventListener('pointercancel', releaseJump);
canvas.addEventListener('contextmenu', e => e.preventDefault());

function bindHold(el, on, off) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); Sound.ensure(); on(); });
  el.addEventListener('pointerup', e => { e.preventDefault(); off(); });
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
bindHold($('tc-left'), () => { Input.left = true; }, () => { Input.left = false; });
bindHold($('tc-right'), () => { Input.right = true; }, () => { Input.right = false; });
bindHold($('tc-jump'),
  () => { if (state === 'playing') player.buffer = BUFFER; else pressJump(); },
  releaseJump);

// ============================== UI wiring ==============================
function toggleMute() {
  Sound.ensure();
  Sound.setMuted(!Sound.muted);
  updateSoundIcons();
  if (!Sound.muted) Sound.click();
}
function updateSoundIcons() {
  const on = !Sound.muted;
  for (const id of ['btn-sound-menu', 'btn-sound-hud', 'btn-sound-pause']) {
    $(id).classList.toggle('muted', !on);
  }
}

$('btn-play').addEventListener('click', startGame);
$('btn-shop').addEventListener('click', () => openShop('menu'));
$('btn-shop-go').addEventListener('click', () => openShop('gameover'));
$('btn-shop-back').addEventListener('click', () => show(shopReturn));
$('shop-grid').addEventListener('click', e => {
  const button = e.target.closest('button[data-item]');
  if (button && !button.disabled) useShopItem(button.dataset.item, button.dataset.kind);
});
for (const tab of document.querySelectorAll('.shop-tab')) {
  tab.addEventListener('click', () => {
    shopTab = tab.dataset.tab;
    document.querySelectorAll('.shop-tab').forEach(item => item.classList.toggle('active', item === tab));
    renderShop();
  });
}
$('btn-pause').addEventListener('click', () => {
  Sound.ensure();
  if (state === 'playing') pauseGame();
  else if (state === 'paused') resumeGame();
});
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart-pause').addEventListener('click', startGame);
$('btn-restart-go').addEventListener('click', startGame);
$('btn-home-pause').addEventListener('click', goHome);
$('btn-home-go').addEventListener('click', goHome);
$('btn-settings').addEventListener('click', () => { Sound.ensure(); Sound.click(); show('settings'); });
$('btn-settings-close').addEventListener('click', () => { Sound.click(); show('menu'); });
$('btn-sound-menu').addEventListener('click', toggleMute);
$('btn-sound-hud').addEventListener('click', toggleMute);
$('btn-sound-pause').addEventListener('click', toggleMute);

function bindToggle(id, key) {
  const el = $(id);
  const render = () => el.classList.toggle('on', Settings[key]);
  el.addEventListener('click', () => {
    Sound.ensure(); Sound.click();
    Settings[key] = !Settings[key];
    Settings.save();
    render();
  });
  render();
}
bindToggle('tgl-particles', 'particles');
bindToggle('tgl-shake', 'shake');

$('btn-reset-best').addEventListener('click', () => {
  Sound.click();
  best = 0;
  localStorage.setItem('sh_best', '0');
  HUD.bestEl.textContent = '0';
  updateMenuStats();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});
window.addEventListener('blur', () => {
  if (state === 'playing') pauseGame();
});

// ============================== Main loop ==============================
let last = performance.now(), acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  time += dt;

  if (shakeT > 0) shakeT -= dt;
  if (flashA > 0) flashA = Math.max(0, flashA - dt * 1.6);

  if (state === 'playing') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) { update(STEP); acc -= STEP; n++; }
    if (n === 8) acc = 0;                            // avoid spiral of death
  } else if (state === 'menu') {
    updatePlatforms(dt);                              // keep the demo scene alive
    updateMines(dt);
    updateParticles(dt);
    ensurePlatforms();
    cleanup();
  } else if (state === 'gameover') {
    updateParticles(dt);
  }

  render();
}

// ============================== Init ==============================
function init() {
  resize();
  buildSprites();
  resetWorld();
  updateSoundIcons();
  updateMenuStats();
  renderShop();
  show('menu');
  requestAnimationFrame(frame);
}
init();

})();
